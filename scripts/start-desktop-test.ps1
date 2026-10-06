param([ValidateSet('Real', 'Mock')][string]$Environment = 'Real', [switch]$Build, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$mock = $Environment -eq 'Mock'
$privateDir = Join-Path $workspace $(if ($mock) { '.local/desktop-mock-environment' } else { '.local/desktop-environment' })
$stateRoot = Join-Path $env:LOCALAPPDATA $(if ($mock) { 'Conceito/CepHoras-Mock-Test' } else { 'Conceito/CepHoras-Test' })
$api = if ($mock) { 'https://localhost:9443' } else { 'http://127.0.0.1:8080' }
New-Item -ItemType Directory -Force $privateDir | Out-Null
@{ api = $api; stateRoot = $stateRoot; configuration = 'Debug'; energy = 'simulated' } |
    ConvertTo-Json | Set-Content (Join-Path $privateDir 'config.private.json')
if ($mock) {
    # This proxy forwards /api/ only. /health/ready would return the Front HTML.
    # Use normal certificate validation and prove the protected API is reached.
    $probe = Invoke-WebRequest "$api/api/v1/me" -SkipHttpErrorCheck -TimeoutSec 10
    if ($probe.StatusCode -ne 401 -or $probe.Headers['WWW-Authenticate'] -notcontains 'Bearer') {
        throw 'API mock não confirmou o endpoint protegido esperado.'
    }
} else {
    $health = Invoke-WebRequest "$api/health/ready" -TimeoutSec 10
    if ($health.StatusCode -ne 200) { throw 'API de testes indisponível.' }
}
$env:CEP_API_URL = $api
$env:CEP_DESKTOP_TEST_TARGET = if ($mock) { 'mock' } else { 'real' }
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
