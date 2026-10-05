#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$SigningKeyPath,
    [string]$PublicKeyPath = (Join-Path $PSScriptRoot '..\desktop\CepHoras.Updates\MsiUpdatePublicKey.pem'),
    [string]$Version
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Assinatura MSI exige Windows, PowerShell 7 e a conta que protegeu a chave DPAPI.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$package = (Resolve-Path -LiteralPath $PackagePath).Path
if ([IO.Path]::GetFileName($package) -cne 'CEP-Horas-Windows-win-x64.msi') { throw 'O nome do asset MSI deve ser CEP-Horas-Windows-win-x64.msi.' }
$installer = $null; $database = $null; $summary = $null
function Read-MsiProperty([string]$Name) {
    $view = $null; $record = $null
    try {
        $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
        [void]$view.Execute()
        $record = $view.Fetch()
        if ($null -eq $record) { throw "Propriedade MSI ausente: $Name" }
        return [string]$record.StringData(1)
    } finally {
        if ($null -ne $view) { [void]$view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
        if ($null -ne $record) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
    }
}
try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($package, 0)
    $msiVersion = Read-MsiProperty 'ProductVersion'
    if ((Read-MsiProperty 'ProductName') -cne 'CEP Horas' -or
        (Read-MsiProperty 'Manufacturer') -cne 'Conceito' -or
        [Guid](Read-MsiProperty 'UpgradeCode') -ne [Guid]'8D0D0DC8-E744-42E7-A57A-20F489145ED8' -or
        (Read-MsiProperty 'ALLUSERS') -cne '1') { throw 'Identidade MSI incompatível com CEP Horas corporativo.' }
    $summary = $database.SummaryInformation(0)
    if (([string]$summary.Property(7)).Split(';')[0] -cne 'x64') { throw 'O MSI deve ser x64.' }
} finally {
    foreach ($com in @($summary, $database, $installer)) { if ($null -ne $com) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($com) } }
}
if ($msiVersion -notmatch '^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,4})$') { throw 'O ProductVersion MSI deve ser canônico e ter três partes.' }
$parts = $msiVersion.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -gt 255 -or $parts[1] -gt 255 -or $parts[2] -gt 65535 -or [Version]$msiVersion -lt [Version]'0.4.7') { throw 'Versão fora dos limites do canal MSI: bootstrap 0.4.7, máximo 255.255.65535.' }
if ($Version -and $Version -cne $msiVersion) { throw 'A versão pedida não corresponde ao ProductVersion dentro do MSI.' }
$size = (Get-Item -LiteralPath $package).Length
if ($size -le 0 -or $size -gt 512MB) { throw 'Tamanho MSI inválido ou superior ao limite de 512 MiB do canal.' }
$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash.ToLowerInvariant()
$directory = [IO.Path]::GetDirectoryName($package)
$manifestPath = Join-Path $directory 'CEP-Horas-Windows-win-x64.manifest.json'
$signaturePath = Join-Path $directory 'CEP-Horas-Windows-win-x64.manifest.sig'
if ((Test-Path -LiteralPath $manifestPath) -or (Test-Path -LiteralPath $signaturePath)) { throw 'Manifesto/assinatura já existem; não serão substituídos.' }
# Canonical release bytes: exactly these five properties, compact UTF-8, no BOM, one final LF.
$manifest = [ordered]@{ product = 'Conceito.CepHoras'; version = $msiVersion; asset = 'CEP-Horas-Windows-win-x64.msi'; size = $size; sha256 = $sha256 }
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Compress) + "`n")
if (-not ('CepMsiSigningCrypto' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Security.Cryptography;
public static class CepMsiSigningCrypto {
    public static byte[] Sign(byte[] data, byte[] privateBytes, string publicPem) {
        using var privateKey = RSA.Create(); using var publicKey = RSA.Create();
        privateKey.ImportPkcs8PrivateKey(privateBytes, out int read);
        publicKey.ImportFromPem(publicPem);
        if (read != privateBytes.Length || privateKey.KeySize != 3072 || publicKey.KeySize != 3072)
            throw new CryptographicException("A identidade de assinatura deve ser RSA 3072.");
        var expected = publicKey.ExportParameters(false); var actual = privateKey.ExportParameters(false);
        if (!CryptographicOperations.FixedTimeEquals(expected.Modulus, actual.Modulus) ||
            !CryptographicOperations.FixedTimeEquals(expected.Exponent, actual.Exponent))
            throw new CryptographicException("A chave de publicação não corresponde à chave pública embutida.");
        var signature = privateKey.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pss);
        if (!publicKey.VerifyData(data, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss))
            throw new CryptographicException("A assinatura gerada não passou na verificação local.");
        return signature;
    }
}
'@
}
$privateBytes = $null
try {
    $entropy = [Text.Encoding]::UTF8.GetBytes('Conceito.CepHoras.MsiUpdates.v1')
    $privateBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SigningKeyPath).Path), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $signature = [CepMsiSigningCrypto]::Sign($bytes, $privateBytes, [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyPath).Path))
    foreach ($entry in @(@($manifestPath, $bytes), @($signaturePath, $signature))) {
        $stream = [IO.FileStream]::new($entry[0], [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($entry[1], 0, $entry[1].Length); $stream.Flush($true) } finally { $stream.Dispose() }
    }
    Write-Output "Manifesto MSI $msiVersion assinado e verificado: $manifestPath; $signaturePath"
} finally { if ($null -ne $privateBytes) { [Array]::Clear($privateBytes, 0, $privateBytes.Length) } }
