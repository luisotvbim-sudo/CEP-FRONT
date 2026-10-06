param([Parameter(Mandatory)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase((Resolve-Path -LiteralPath $PackagePath).Path, 0)
function Read-Rows([string]$sql, [int]$columns) {
    $view = $database.OpenView($sql); [void]$view.Execute()
    $rows = @()
    while ($record = $view.Fetch()) {
        $row = @(); for ($index = 1; $index -le $columns; $index++) { $row += $record.StringData($index) }
        $rows += [pscustomobject]@{ Values = $row }
    }
    [void]$view.Close(); return $rows
}
$scope = Read-Rows 'SELECT `Value` FROM `Property` WHERE `Property` = ''ALLUSERS''' 1
if ($scope[0].Values[0] -ne '1') { throw 'O MSI deve ser exclusivamente por máquina.' }
$service = Read-Rows 'SELECT `Name`, `ServiceType`, `StartType`, `StartName`, `Arguments` FROM `ServiceInstall`' 5
if ($service.Count -ne 1 -or $service[0].Values[0] -ne 'CepHorasControl' -or $service[0].Values[1] -ne '16' -or $service[0].Values[2] -ne '2' -or $service[0].Values[3] -ne 'LocalSystem' -or $service[0].Values[4] -ne '--service') { throw 'Serviço incorreto.' }
$actions = Read-Rows 'SELECT `Action`, `Type`, `Target` FROM `CustomAction`' 3
foreach ($expected in @(
    @('ApplyPolicy', '--apply-policy'),
    @('RollbackApplyPolicy', '--rollback-apply'),
    @('RestorePolicy', '--uninstall-restore'),
    @('RollbackPolicyRestore', '--rollback-restore'),
    @('UpgradePolicy', '--upgrade-policy'),
    @('RollbackPolicyUpgrade', '--rollback-policy-upgrade'),
    @('FinishPolicyUpgrade', '--finish-policy-upgrade')
)) {
    $row = @($actions | Where-Object { $_.Values[0] -eq $expected[0] })
    if ($row.Count -ne 1 -or $row[0].Values[2] -ne $expected[1] -or (([int]$row[0].Values[1]) -band 0xC00) -ne 0xC00) { throw "Ação MSI ausente ou não elevada: $($expected[0])" }
}
$sequence = Read-Rows 'SELECT `Action`, `Condition`, `Sequence` FROM `InstallExecuteSequence`' 3
$apply = @($sequence | Where-Object { $_.Values[0] -eq 'ApplyPolicy' })
$files = @($sequence | Where-Object { $_.Values[0] -eq 'InstallFiles' })
if ([int]$apply[0].Values[2] -le [int]$files[0].Values[2] -or $apply[0].Values[1] -cne 'NOT Installed AND NOT WIX_UPGRADE_DETECTED') { throw 'Política inicial deve ser aplicada depois dos arquivos, preservando a política anterior durante upgrades.' }
$rollbackApply = @($sequence | Where-Object { $_.Values[0] -eq 'RollbackApplyPolicy' })
if ($rollbackApply.Count -ne 1 -or $rollbackApply[0].Values[1] -cne 'NOT Installed AND NOT WIX_UPGRADE_DETECTED') { throw 'Rollback de upgrade não pode restaurar/liberar a política anterior.' }
$upgradePolicy = @($sequence | Where-Object { $_.Values[0] -eq 'UpgradePolicy' })
$rollbackUpgrade = @($sequence | Where-Object { $_.Values[0] -eq 'RollbackPolicyUpgrade' })
$finishUpgrade = @($sequence | Where-Object { $_.Values[0] -eq 'FinishPolicyUpgrade' })
$startServices = @($sequence | Where-Object { $_.Values[0] -eq 'StartServices' })
if ($upgradePolicy.Count -ne 1 -or $rollbackUpgrade.Count -ne 1 -or $finishUpgrade.Count -ne 1 -or
    $upgradePolicy[0].Values[1] -cne 'NOT Installed AND WIX_UPGRADE_DETECTED' -or
    $rollbackUpgrade[0].Values[1] -cne $upgradePolicy[0].Values[1] -or $finishUpgrade[0].Values[1] -cne $upgradePolicy[0].Values[1] -or
    [int]$files[0].Values[2] -ge [int]$rollbackUpgrade[0].Values[2] -or
    [int]$rollbackUpgrade[0].Values[2] -ge [int]$upgradePolicy[0].Values[2] -or
    [int]$upgradePolicy[0].Values[2] -ge [int]$startServices[0].Values[2]) { throw 'Migração de política precisa de checkpoint/rollback após arquivos e antes do serviço; limpeza somente no commit MSI.' }
$commitType = @($actions | Where-Object { $_.Values[0] -eq 'FinishPolicyUpgrade' })
if (([int]$commitType[0].Values[1] -band 0x200) -ne 0x200) { throw 'Checkpoint de migração só pode ser removido no commit MSI.' }
$restore = @($sequence | Where-Object { $_.Values[0] -eq 'RestorePolicy' })
$stop = @($sequence | Where-Object { $_.Values[0] -eq 'StopServices' })
$remove = @($sequence | Where-Object { $_.Values[0] -eq 'RemoveFiles' })
$rollbackRestore = @($sequence | Where-Object { $_.Values[0] -eq 'RollbackPolicyRestore' })
if ([int]$stop[0].Values[2] -ge [int]$rollbackRestore[0].Values[2] -or [int]$rollbackRestore[0].Values[2] -ge [int]$restore[0].Values[2] -or [int]$restore[0].Values[2] -ge [int]$remove[0].Values[2] -or $restore[0].Values[1] -notmatch 'NOT UPGRADINGPRODUCTCODE') { throw 'Serviço deve parar antes do journal/restore; rollback deve restaurar antes de retomar serviço e arquivos devem permanecer até restore.' }
$serviceControl = Read-Rows 'SELECT `Name`, `Event`, `Wait` FROM `ServiceControl`' 3
if (-not ($serviceControl | Where-Object { $_.Values[0] -eq 'CepHorasControl' -and (([int]$_.Values[1]) -band 0x22) -eq 0x22 -and $_.Values[2] -eq '1' })) { throw 'MSI precisa aguardar StopServices tanto em manutenção quanto na remoção.' }
$conditions = Read-Rows 'SELECT `Condition` FROM `LaunchCondition`' 1
$supportedWindows = 'Installed OR ((CEP_WINDOWS_BUILD = 19045 OR CEP_WINDOWS_BUILD >= 26100) AND CEP_WINDOWS_TYPE = "Client" AND (CEP_WINDOWS_EDITION << "Professional" OR CEP_WINDOWS_EDITION << "Enterprise" OR CEP_WINDOWS_EDITION << "Education"))'
if (-not ($conditions | Where-Object { $_.Values[0] -ceq $supportedWindows }) -or -not ($conditions | Where-Object { $_.Values[0] -match 'CEP_WEBVIEW2_MACHINE' -and $_.Values[0] -match '0.0.0.0' })) { throw 'Preflight de Windows 10/11, edição e Runtime WebView2 por máquina deve preceder os efeitos.' }
$searches = Read-Rows 'SELECT `Root`, `Key`, `Name`, `Type` FROM `RegLocator`' 4
if (-not ($searches | Where-Object { $_.Values[0] -eq '2' -and $_.Values[1] -eq 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -and $_.Values[2] -eq 'pv' -and $_.Values[3] -eq '2' })) { throw 'Runtime precisa ser pesquisado em HKLM na visão 32-bit oficial, não somente HKCU.' }
$launch = @($sequence | Where-Object { $_.Values[0] -eq 'LaunchConditions' })
$initialize = @($sequence | Where-Object { $_.Values[0] -eq 'InstallInitialize' })
if ($launch.Count -ne 1 -or [int]$launch[0].Values[2] -ge [int]$initialize[0].Values[2]) { throw 'Preflight deve preceder a transação MSI.' }
$locks = Read-Rows 'SELECT `SDDLText` FROM `MsiLockPermissionsEx`' 1
if (-not ($locks | Where-Object { $_.Values[0] -eq 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)' })) { throw 'ACL protegida de Program Files ausente.' }
$filesTable = Read-Rows 'SELECT `File` FROM `File`' 1
if (-not ($filesTable | Where-Object { $_.Values[0] -eq 'ControlExe' }) -or -not ($filesTable | Where-Object { $_.Values[0] -eq 'AppExe' })) { throw 'Payload incompleto.' }
Write-Output 'PASS: MSI único por máquina, preflight Windows/WebView2, política com rollback, serviço LocalSystem parado/aguardado antes de restaurar/remover, ACL e payload. Nenhuma instalação executada.'
