param(
    [string]$Publisher,
    [string]$Version = '',
    [string]$CertificateThumbprint = '',
    [switch]$UnsignedForTest
)

$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageName = 'Conceito.CepHoras'
$assetName = 'CEP-Horas-win-x64.msix'

if (-not $CertificateThumbprint -and -not $UnsignedForTest) {
    throw 'Forneça -CertificateThumbprint para assinar ou -UnsignedForTest para gerar apenas um pacote de validação.'
}
if ($CertificateThumbprint -and $UnsignedForTest) {
    throw 'Escolha assinatura ou teste sem assinatura, não ambos.'
}

if ($CertificateThumbprint) {
    $thumbprint = $CertificateThumbprint.Replace(' ', '').ToUpperInvariant()
    $certificate = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $thumbprint -and $_.HasPrivateKey }) | Select-Object -First 1
    if (-not $certificate) { throw 'Certificado de assinatura com chave privada não encontrado.' }
    if ($Publisher -and $Publisher -ne $certificate.Subject) {
        throw 'O Publisher deve corresponder exatamente ao Subject do certificado.'
    }
    $Publisher = $certificate.Subject
}
if (-not $Publisher) { throw 'Informe -Publisher (Subject do futuro certificado) para o pacote de teste.' }

if (-not $Version) {
    $webVersion = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
    $Version = "$webVersion.0"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'A versão MSIX deve ter quatro números: 1.2.3.4.' }
$parts = $Version.Split('.') | ForEach-Object { [int]$_ }
if (@($parts | Where-Object { $_ -lt 0 -or $_ -gt 65535 }).Count -gt 0) {
    throw 'Cada parte da versão MSIX deve estar entre 0 e 65535.'
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$sdk = Get-ChildItem -LiteralPath $sdkRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Windows SDK com MakeAppx não encontrado.' }
$makeAppx = Join-Path $sdk.FullName 'x64\makeappx.exe'
$signTool = Join-Path $sdk.FullName 'x64\signtool.exe'
if (-not (Test-Path -LiteralPath $makeAppx -PathType Leaf)) { throw 'MakeAppx x64 não encontrado.' }
if ($CertificateThumbprint -and -not (Test-Path -LiteralPath $signTool -PathType Leaf)) {
    throw 'SignTool x64 não encontrado.'
}

$releaseDir = Join-Path $repo ('.local\msix\' + $Version)
if (Test-Path -LiteralPath $releaseDir) {
    throw "A saída $releaseDir já existe. Incremente a versão antes de criar outro pacote."
}
$publishDir = Join-Path $releaseDir 'publish'
$stageDir = Join-Path $releaseDir 'stage'
New-Item -ItemType Directory -Path $releaseDir | Out-Null

Push-Location $repo
try {
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Falha no build do frontend.' }
    & dotnet publish 'desktop/CepHoras.Desktop' -c Release -r win-x64 --self-contained false -o $publishDir "-p:Version=$Version"
    if ($LASTEXITCODE -ne 0) { throw 'Falha no publish do desktop.' }
} finally { Pop-Location }

Copy-Item -LiteralPath $publishDir -Destination $stageDir -Recurse
$assets = Join-Path $stageDir 'Assets'
New-Item -ItemType Directory -Path $assets | Out-Null
Add-Type -AssemblyName System.Drawing
$iconSource = Join-Path $repo 'src\assets\conceito-icon.png'
foreach ($size in @(44, 50, 150)) {
    $original = [System.Drawing.Image]::FromFile($iconSource)
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $scale = [Math]::Min(($size - 8) / $original.Width, ($size - 8) / $original.Height)
            $width = [int][Math]::Round($original.Width * $scale)
            $height = [int][Math]::Round($original.Height * $scale)
            $graphics.DrawImage($original, [int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
        } finally { $graphics.Dispose() }
        $bitmap.Save((Join-Path $assets "Logo$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose(); $original.Dispose() }
}

$escapedPublisher = [System.Security.SecurityElement]::Escape($Publisher)
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="$packageName" Publisher="$escapedPublisher" Version="$Version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>CEP Horas</DisplayName>
    <PublisherDisplayName>Conceito Engenharia</PublisherDisplayName>
    <Description>CEP Horas</Description>
    <Logo>Assets\Logo50.png</Logo>
  </Properties>
  <Resources><Resource Language="pt-BR" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Applications>
    <Application Id="CepHoras" Executable="CepHoras.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="CEP Horas" Description="CEP Horas" Square150x150Logo="Assets\Logo150.png" Square44x44Logo="Assets\Logo44.png" BackgroundColor="#FFFFFF" />
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
[System.IO.File]::WriteAllText((Join-Path $stageDir 'AppxManifest.xml'), $manifest,
    (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $stageDir 'msix-install.marker'), $packageName,
    (New-Object System.Text.UTF8Encoding($false)))

$outputName = if ($UnsignedForTest) { 'CEP-Horas-win-x64-UNSIGNED.msix' } else { $assetName }
$packagePath = Join-Path $releaseDir $outputName
& $makeAppx pack /d $stageDir /p $packagePath /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx não conseguiu criar o pacote.' }

if ($CertificateThumbprint) {
    & $signTool sign /fd SHA256 /sha1 $thumbprint $packagePath
    if ($LASTEXITCODE -ne 0) { throw 'Falha na assinatura do MSIX.' }
    & $signTool verify /pa $packagePath
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do MSIX não foi validada.' }
}

Write-Output "Pacote: $packagePath"
Write-Output "SHA-256: $((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash)"
if ($UnsignedForTest) { Write-Output 'Somente validação: pacote sem assinatura não deve ser distribuído nem instalado.' }
