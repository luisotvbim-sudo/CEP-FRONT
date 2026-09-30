param(
    [string]$Version = '0.2.7'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
    throw 'Informe uma versão MSI com três números, por exemplo 0.2.2.'
}
$parts = $Version.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -gt 255 -or $parts[1] -gt 255 -or $parts[2] -gt 65535) {
    throw 'Limites da versão MSI: 255.255.65535.'
}
$output = Join-Path $repo ".local\msi\$Version"
if (Test-Path -LiteralPath $output) {
    throw "A saída $output já existe. Use uma versão nova para preservar o pacote anterior."
}
$publish = Join-Path $output 'publish'
$artifacts = Join-Path $output 'artifacts'
New-Item -ItemType Directory -Path $output | Out-Null
Push-Location $repo
try {
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Falha no build do frontend.' }
    & dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained true -o $publish "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw 'Falha no publish do desktop.' }
    # The fresh publish directory is the only payload source. Never harvest the repository or user profiles.
    foreach ($required in @('CepHoras.exe', 'coreclr.dll', 'hostfxr.dll', 'wwwroot\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $publish $required))) { throw "Payload incompleto: $required" }
    }
    $unexpected = Get-ChildItem -LiteralPath $publish -Recurse -File | Where-Object {
        $_.Extension -in @('.pfx', '.p12', '.pem', '.key', '.dat', '.notifications') -or
        $_.Name -like '.env*' -or $_.Name -like '*.marker'
    }
    if ($unexpected) { throw 'O publish contém arquivos de sessão, certificado ou instalação anterior. Inspecione a saída.' }
    $payload = Join-Path $output 'Payload.wxs'
    & (Join-Path $PSScriptRoot 'new-msi-payload.ps1') -PublishDirectory $publish -OutputFile $payload
    & dotnet build desktop/CepHoras.Installer -c Release "-p:PublishDir=$publish" "-p:InstallerVersion=$Version" "-p:PayloadSource=$payload" "-p:OutputPath=$artifacts\"
    if ($LASTEXITCODE -ne 0) { throw 'Falha na criação/validação do MSI.' }
} finally { Pop-Location }
$packageName = 'CEP-Horas-Teste-win-x64.msi'
$package = Join-Path $artifacts $packageName
if (-not (Test-Path -LiteralPath $package)) { throw 'MSI não encontrado na saída.' }
& (Join-Path $PSScriptRoot 'test-desktop-msi.ps1') -PackagePath $package
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $artifacts 'SHA256SUMS.txt'), "$hash  $packageName`n")
Copy-Item -LiteralPath (Join-Path $repo 'desktop\CepHoras.Installer\LEIA-ME.txt') -Destination (Join-Path $artifacts 'LEIA-ME.txt')
Write-Output "MSI de teste: $package"
Write-Output "SHA-256: $hash"
Write-Output 'Escolha no instalador: somente para mim ou todos os usuários. Sem assinatura. Requer WebView2 Runtime. Sem serviço supervisor.'
