param(
    [string]$SourcePath = '',
    [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'Programs\Conceito\CEP Horas'),
    [switch]$ResumeVerifiedCopy
)

$ErrorActionPreference = 'Stop'

if (-not $SourcePath) {
    $bundledApp = Join-Path $PSScriptRoot 'app'
    $SourcePath = if (Test-Path -LiteralPath (Join-Path $bundledApp 'CepHoras.exe') -PathType Leaf) {
        $bundledApp
    } else {
        Join-Path $PSScriptRoot '..\.local\package\CEP-Horas-win-x64'
    }
}

$source = [System.IO.Path]::GetFullPath($SourcePath)
$target = [System.IO.Path]::GetFullPath($InstallPath)
$userPrograms = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
$startMenu = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))
$shortcutPath = Join-Path $startMenu 'CEP Horas.lnk'

if (-not ($target.StartsWith($userPrograms + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "A instalação deve ficar abaixo de $userPrograms."
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'CepHoras.exe') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $source 'wwwroot\index.html') -PathType Leaf)) {
    throw "Pacote incompleto em $source. Gere o build do frontend e publique o desktop antes de instalar."
}
if ((Test-Path -LiteralPath $target) -and -not $ResumeVerifiedCopy) {
    throw "Já existe uma instalação em $target. Este script não substitui arquivos existentes."
}
if ($ResumeVerifiedCopy -and -not (Test-Path -LiteralPath $target -PathType Container)) {
    throw "Não há instalação copiada para retomar em $target."
}
if (Test-Path -LiteralPath $shortcutPath) {
    throw "Já existe um atalho em $shortcutPath. Este script não o substitui."
}

$runtime = & dotnet --list-runtimes
if ($LASTEXITCODE -ne 0 -or -not ($runtime | Where-Object { $_ -match '^Microsoft\.WindowsDesktop\.App 10\.' })) {
    throw 'O .NET Desktop Runtime 10 é necessário para este pacote.'
}

if (-not $ResumeVerifiedCopy) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse
}

$sourceFiles = Get-ChildItem -LiteralPath $source -File -Recurse
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($source.Length + 1)
    $installedFile = Join-Path $target $relative
    if (-not (Test-Path -LiteralPath $installedFile -PathType Leaf) -or
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash) {
        throw "Cópia não validada: $relative. Confira a instalação antes de executar."
    }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $target 'CepHoras.exe'
$shortcut.WorkingDirectory = $target
$shortcut.Description = 'CEP Horas'
$shortcut.IconLocation = Join-Path $target 'CepHoras.exe'
$shortcut.Save()

Write-Output "Instalado: $target"
Write-Output "Atalho: $shortcutPath"
Write-Output "Arquivos verificados: $($sourceFiles.Count)"
