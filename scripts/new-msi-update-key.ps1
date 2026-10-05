#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PrivateKeyPath,
    [string]$PublicKeyPath = (Join-Path $PSScriptRoot '..\desktop\CepHoras.Updates\MsiUpdatePublicKey.pem'),
    [switch]$ExportRecoveryBackup,
    [switch]$ImportRecoveryBackup,
    [string]$RecoveryBackupPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Este script exige Windows e PowerShell 7 para DPAPI CurrentUser.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privatePath = [IO.Path]::GetFullPath($PrivateKeyPath)
$publicPath = [IO.Path]::GetFullPath($PublicKeyPath)
$localPrefix = (Join-Path $repo '.local') + [IO.Path]::DirectorySeparatorChar
if ($privatePath.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
    -not $privatePath.StartsWith($localPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Dentro do checkout, a chave privada deve ficar somente em .local, ignorada pelo Git.'
}
$entropy = [Text.Encoding]::UTF8.GetBytes('Conceito.CepHoras.MsiUpdates.v1')
function Write-PrivateFile([string]$Path, [byte[]]$Bytes) {
    $directory = [IO.Path]::GetDirectoryName($Path)
    [void][IO.Directory]::CreateDirectory($directory)
    $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $acl = [Security.AccessControl.FileSecurity]::new()
        $acl.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;$sid)")
        Set-Acl -LiteralPath $Path -AclObject $acl
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
}

if ($ImportRecoveryBackup -and $ExportRecoveryBackup) { throw 'Selecione somente exportação ou importação de backup.' }
if ($ImportRecoveryBackup) {
    if (-not $RecoveryBackupPath) { throw 'Informe o backup PKCS#8 criptografado em -RecoveryBackupPath.' }
    if (Test-Path -LiteralPath $privatePath) { throw 'Chave privada já existe; a recuperação não substitui arquivos.' }
    if (-not (Test-Path -LiteralPath $publicPath -PathType Leaf)) { throw 'A recuperação exige a chave pública aprovada, já embutida nos clientes.' }
    if ((Get-Item -LiteralPath $RecoveryBackupPath).Length -gt 64KB) { throw 'Backup de chave excede o limite.' }
    if (-not ('CepMsiImportRecoveryCrypto' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
public static class CepMsiImportRecoveryCrypto {
    public static byte[] Import(byte[] encrypted, SecureString password, string publicPem) {
        var ptr = Marshal.SecureStringToBSTR(password); var chars = new char[password.Length];
        try {
            Marshal.Copy(ptr, chars, 0, chars.Length);
            using var rsa = RSA.Create(); using var expectedKey = RSA.Create();
            rsa.ImportEncryptedPkcs8PrivateKey(chars, encrypted, out int read);
            expectedKey.ImportFromPem(publicPem);
            var expected = expectedKey.ExportParameters(false); var actual = rsa.ExportParameters(false);
            if (read != encrypted.Length || rsa.KeySize != 3072 || expectedKey.KeySize != 3072 ||
                !CryptographicOperations.FixedTimeEquals(expected.Modulus, actual.Modulus) ||
                !CryptographicOperations.FixedTimeEquals(expected.Exponent, actual.Exponent))
                throw new CryptographicException("Backup não corresponde à identidade pública aprovada.");
            return rsa.ExportPkcs8PrivateKey();
        } finally { Array.Clear(chars, 0, chars.Length); Marshal.ZeroFreeBSTR(ptr); }
    }
}
'@
    }
    $password = Read-Host 'Senha do backup portátil' -AsSecureString
    $keyBytes = $null
    try {
        $keyBytes = [CepMsiImportRecoveryCrypto]::Import([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $RecoveryBackupPath).Path), $password, [IO.File]::ReadAllText($publicPath))
        $protected = [Security.Cryptography.ProtectedData]::Protect($keyBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        Write-PrivateFile $privatePath $protected
        Write-Output "Identidade aprovada recuperada para DPAPI CurrentUser: $privatePath. A chave pública não foi alterada."
    } finally {
        if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
        $password.Dispose()
    }
    return
}

if ($ExportRecoveryBackup) {
    if (-not $RecoveryBackupPath) { throw 'Informe -RecoveryBackupPath para o backup PKCS#8 criptografado.' }
    $backupPath = [IO.Path]::GetFullPath($RecoveryBackupPath)
    if ($backupPath.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        -not $backupPath.StartsWith($localPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'O backup criptografado também deve ficar fora do Git.'
    }
    if (Test-Path -LiteralPath $backupPath) { throw 'Backup já existe; não será substituído.' }
    if (-not ('CepMsiRecoveryCrypto' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
public static class CepMsiRecoveryCrypto {
    private static char[] Read(SecureString value) {
        var ptr = Marshal.SecureStringToBSTR(value);
        try {
            var chars = new char[value.Length];
            Marshal.Copy(ptr, chars, 0, chars.Length);
            return chars;
        } finally { Marshal.ZeroFreeBSTR(ptr); }
    }
    public static byte[] Export(byte[] privateBytes, SecureString password, SecureString confirmation) {
        var first = Read(password); var second = Read(confirmation);
        try {
            if (first.Length < 16 || first.Length != second.Length)
                throw new ArgumentException("Use uma senha de backup com pelo menos 16 caracteres e confirmação idêntica.");
            int difference = 0;
            for (int i = 0; i < first.Length; i++) difference |= first[i] ^ second[i];
            if (difference != 0) throw new ArgumentException("A confirmação da senha não corresponde.");
            using var rsa = RSA.Create();
            rsa.ImportPkcs8PrivateKey(privateBytes, out int read);
            if (read != privateBytes.Length || rsa.KeySize != 3072)
                throw new CryptographicException("Chave de atualização inválida.");
            return rsa.ExportEncryptedPkcs8PrivateKey(first,
                new PbeParameters(PbeEncryptionAlgorithm.Aes256Cbc, HashAlgorithmName.SHA256, 600000));
        } finally { Array.Clear(first, 0, first.Length); Array.Clear(second, 0, second.Length); }
    }
}
'@
    }
    $password = Read-Host 'Senha para o backup portátil (guarde no cofre da TI)' -AsSecureString
    $confirmation = Read-Host 'Confirme a senha do backup' -AsSecureString
    $keyBytes = $null
    try {
        $keyBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($privatePath), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $encrypted = [CepMsiRecoveryCrypto]::Export($keyBytes, $password, $confirmation)
        # DER PKCS#8 encrypted: portable backup, never plaintext private PEM.
        Write-PrivateFile $backupPath $encrypted
        Write-Output "Backup PKCS#8 criptografado criado: $backupPath. Guarde arquivo e senha em locais separados."
    } finally {
        if ($null -ne $keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
        $password.Dispose(); $confirmation.Dispose()
    }
    return
}
if ($RecoveryBackupPath) { throw 'Use -ExportRecoveryBackup ou -ImportRecoveryBackup para o backup com senha.' }
if (Test-Path -LiteralPath $privatePath) { throw 'Chave privada já existe; não será substituída.' }
if (Test-Path -LiteralPath $publicPath) { throw 'Chave pública já existe; não será substituída. Reutilize a identidade aprovada.' }
if ($privatePath.Equals($publicPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminhos de chave pública e privada devem ser distintos.' }
$rsa = [Security.Cryptography.RSA]::Create(3072)
$privateBytes = $null
try {
    $privateBytes = $rsa.ExportPkcs8PrivateKey()
    $protected = [Security.Cryptography.ProtectedData]::Protect($privateBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    Write-PrivateFile $privatePath $protected
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($publicPath))
    $publicPem = $rsa.ExportSubjectPublicKeyInfoPem().Replace("`r`n", "`n").TrimEnd() + "`n"
    $stream = [IO.FileStream]::new($publicPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($publicPem); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    Write-Output "RSA 3072 criada. Privada DPAPI CurrentUser: $privatePath; pública SPKI: $publicPath."
    Write-Output 'Antes do rollout, execute -ExportRecoveryBackup e guarde o backup criptografado fora desta máquina. DPAPI isoladamente não é backup portátil.'
} finally {
    if ($null -ne $privateBytes) { [Array]::Clear($privateBytes, 0, $privateBytes.Length) }
    $rsa.Dispose()
}
