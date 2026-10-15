param(
    [string]$UserProfilePath = $env:USERPROFILE,
    [string]$ControlRoot = (Join-Path $env:ProgramData 'Conceito.CepHoras.Control')
)

$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $env:ProgramFiles 'Conceito CEP Horas'
$webViewLog = Join-Path $UserProfilePath 'AppData\Local\Conceito\CepHoras\Diagnostics\webview.jsonl'

function Read-JsonLines {
    param([string]$Path, [int]$Tail)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
    $items = @()
    foreach ($line in (Get-Content -LiteralPath $Path -Tail $Tail -ErrorAction Stop)) {
        try { $items += ConvertFrom-Json -InputObject $line -ErrorAction Stop }
        catch { $items += [pscustomobject]@{ at = ''; code = 'invalid-json'; detail = '' } }
    }
    return $items
}

function Read-WindowsEvents {
    param([string]$LogName, [int[]]$Ids, [string]$SourcePattern = '.')
    $since = (Get-Date).AddDays(-2)
    try {
        Get-WinEvent -FilterHashtable @{ LogName = $LogName; Id = $Ids; StartTime = $since } `
            -MaxEvents 300 -ErrorAction Stop |
            Where-Object { $_.Message -match $SourcePattern } |
            Select-Object -First 30 TimeCreated, Id, ProviderName, LevelDisplayName
    } catch [Exception] {
        if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { return @() }
        throw
    }
}

Write-Output '=== DIAGNOSTICO CEP HORAS (sem IDs, SID ou credenciais) ==='
try {
    Get-Service -Name 'CepHorasControl' -ErrorAction Stop |
        Select-Object Name, Status, StartType | Format-Table -AutoSize | Out-String -Width 180 | Write-Output
} catch { Write-Output ('Servico: ' + $_.Exception.GetType().Name) }

foreach ($fileName in @('CepHoras.exe', 'CepHoras.Control.exe')) {
    $file = Join-Path $appRoot $fileName
    if (Test-Path -LiteralPath $file -PathType Leaf) {
        $version = (Get-Item -LiteralPath $file).VersionInfo.ProductVersion
        Write-Output ("{0}: {1}" -f $fileName, $version)
    }
}

try {
    $system = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    Write-Output ('Windows: ' + $system.Version + ' (build ' + $system.BuildNumber + ')')
    Write-Output ('Inicio do Windows: ' + $system.LastBootUpTime.ToString('o'))
} catch { Write-Output ('Inicio do Windows: ' + $_.Exception.GetType().Name) }

Write-Output '=== JOURNAL DE ENERGIA (campos permitidos) ==='
try {
    $journalPath = Join-Path $ControlRoot 'power-journal.json'
    if (Test-Path -LiteralPath $journalPath -PathType Leaf) {
        $journal = Get-Content -LiteralPath $journalPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $journal.Pending) {
            $journal.Pending | Select-Object Action, Phase, ExecuteAt |
                Format-Table -AutoSize | Out-String -Width 180 | Write-Output
        } else { Write-Output 'Sem pedido pendente no journal.' }
    } else { Write-Output 'Journal ausente ou nao acessivel.' }
} catch { Write-Output ('Journal: ' + $_.Exception.GetType().Name) }

Write-Output '=== POLITICA LOCAL (campos permitidos) ==='
try {
    $policyPath = Join-Path $ControlRoot 'policy.json'
    if (Test-Path -LiteralPath $policyPath -PathType Leaf) {
        Get-Content -LiteralPath $policyPath -Raw -ErrorAction Stop |
            ConvertFrom-Json -ErrorAction Stop |
            Select-Object Version, Active, Phase |
            Format-Table -AutoSize | Out-String -Width 180 | Write-Output
    } else { Write-Output 'Politica ausente ou nao acessivel.' }
} catch { Write-Output ('Politica: ' + $_.Exception.GetType().Name) }

Write-Output '=== AUDITORIA DO SERVICO (40 eventos, sem SID) ==='
try {
    Read-JsonLines -Path (Join-Path $ControlRoot 'audit.jsonl') -Tail 40 |
        Select-Object at, code | Format-Table -AutoSize | Out-String -Width 180 | Write-Output
} catch { Write-Output ('Auditoria: ' + $_.Exception.GetType().Name) }

Write-Output '=== WEBVIEW (40 eventos, sem dados da conta) ==='
try {
    Read-JsonLines -Path $webViewLog -Tail 40 |
        Select-Object at, code, detail, trigger, stage, elapsedMs, recoveryId |
        Format-Table -AutoSize | Out-String -Width 240 | Write-Output
} catch { Write-Output ('WebView: ' + $_.Exception.GetType().Name) }

Write-Output '=== EVENTOS WINDOWS (48h, sem mensagens) ==='
foreach ($source in @(
    @{ Label = 'Serviço'; Log = 'System'; Ids = @(7031, 7034, 7035, 7036); Pattern = 'CepHorasControl|CepHoras\.Control' },
    @{ Label = 'Desligamento/reinício do Windows'; Log = 'System'; Ids = @(1074, 6005, 6006, 6008) },
    @{ Label = 'Aplicativo'; Log = 'Application'; Ids = @(1000, 1001, 1026); Pattern = 'CepHoras|CEP Horas' },
    @{ Label = 'Instalador'; Log = 'Application'; Ids = @(1033, 1034, 11707, 11708, 11724); Pattern = 'CEP Horas|CepHoras' }
)) {
    Write-Output ($source.Label + ':')
    try {
        Read-WindowsEvents -LogName $source.Log -Ids $source.Ids -SourcePattern $source.Pattern |
            Format-Table -AutoSize | Out-String -Width 180 | Write-Output
    } catch {
        Write-Output ($_.Exception.GetType().Name)
    }
}
