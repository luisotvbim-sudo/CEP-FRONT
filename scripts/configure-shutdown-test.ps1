# Opt-in configuration for the current Windows user only. Never store the supplied password.
param([switch]$Disable, [Security.SecureString]$Password)
$ErrorActionPreference = 'Stop'
$config = Join-Path $env:LOCALAPPDATA 'Conceito\CepHoras\shutdown-test.dat'
if ($Disable) {
    if (Test-Path -LiteralPath $config) { Remove-Item -LiteralPath $config }
    Write-Output 'Teste desativado na configuração. Reinicie o CEP Horas para aplicar.'
    return
}
if (-not $Password) { $Password = Read-Host 'Senha temporária para o teste de desligamento' -AsSecureString }
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Informe uma senha não vazia.' }
    $salt = [Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $hash = [Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($plain, $salt, 600000, [Security.Cryptography.HashAlgorithmName]::SHA256, 32)
    $json = @{ Version = 1; Salt = [Convert]::ToBase64String($salt); Hash = [Convert]::ToBase64String($hash) } | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    New-Item -ItemType Directory -Path (Split-Path $config) -Force | Out-Null
    [IO.File]::WriteAllBytes($config, $protected)
    Write-Output 'Teste configurado somente para este usuário. Reinicie o CEP Horas para aplicar.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $plain = $null
    if ($bytes) { [Array]::Clear($bytes) }
}
