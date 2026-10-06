param([switch]$Build, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$privateDir = Join-Path $workspace '.local/desktop-environment'
$stateRoot = Join-Path $env:LOCALAPPDATA 'Conceito/CepHoras-Test'
$api = 'http://127.0.0.1:8080'
New-Item -ItemType Directory -Force $privateDir | Out-Null
@{ api = $api; stateRoot = $stateRoot; configuration = 'Debug'; energy = 'simulated' } |
    ConvertTo-Json | Set-Content (Join-Path $privateDir 'config.private.json')
$health = Invoke-WebRequest "$api/health/ready" -TimeoutSec 10
if ($health.StatusCode -ne 200) { throw 'API de testes indisponível.' }
$env:CEP_API_URL = $api
$env:CEP_DESKTOP_LOCAL_TEST = '1'
$env:CEP_DESKTOP_TESTING = '1'
$env:CEP_SESSION_DIR = Join-Path $stateRoot 'Sessions'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $stateRoot 'WebView2'
# Never inherit debugging ports or alternative browser executables from another task.
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
Remove-Item Env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER -ErrorAction SilentlyContinue
$payload = Join-Path $privateDir 'payload'
if ($Build) {
    Push-Location $workspace
    try {
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE) { throw 'pnpm install falhou.' }
        pnpm build
        if ($LASTEXITCODE) { throw 'Build web falhou.' }
        dotnet publish desktop/CepHoras.Desktop -c Debug -o $payload
        if ($LASTEXITCODE) { throw 'Build desktop falhou.' }
    } finally { Pop-Location }
}
if (Test-Path (Join-Path $payload 'managed-install.marker')) { throw 'Payload gerenciado recusado.' }
$exe = Join-Path $payload 'CepHoras.exe'
if (!(Test-Path $exe) -or !(Test-Path (Join-Path $payload 'wwwroot/index.html'))) { throw 'Execute primeiro com -Build.' }
Write-Output "TESTE: API $api; sessão/perfil $stateRoot; energia simulada."
if (!$CheckOnly) {
    $process = Start-Process -FilePath $exe -WorkingDirectory $payload -WindowStyle Hidden -PassThru
    @{ launcherPid = $process.Id; executable = $exe; api = $api; stateRoot = $stateRoot } |
        ConvertTo-Json | Set-Content (Join-Path $privateDir 'process.private.json')
    Write-Output "Launcher PID: $($process.Id). A janela WPF abre pelo aplicativo."
}
