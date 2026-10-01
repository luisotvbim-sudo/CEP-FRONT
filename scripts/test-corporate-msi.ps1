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
    @('RollbackPolicyRestore', '--rollback-restore')
)) {
    $row = @($actions | Where-Object { $_.Values[0] -eq $expected[0] })
    if ($row.Count -ne 1 -or $row[0].Values[2] -ne $expected[1] -or (([int]$row[0].Values[1]) -band 0xC00) -ne 0xC00) { throw "Ação MSI ausente ou não elevada: $($expected[0])" }
}
$sequence = Read-Rows 'SELECT `Action`, `Condition`, `Sequence` FROM `InstallExecuteSequence`' 3
$apply = @($sequence | Where-Object { $_.Values[0] -eq 'ApplyPolicy' })
$files = @($sequence | Where-Object { $_.Values[0] -eq 'InstallFiles' })
if ([int]$apply[0].Values[2] -le [int]$files[0].Values[2] -or $apply[0].Values[1] -notmatch 'NOT Installed') { throw 'Política deve ser aplicada somente depois dos arquivos numa instalação nova/upgrade.' }
$restore = @($sequence | Where-Object { $_.Values[0] -eq 'RestorePolicy' })
$stop = @($sequence | Where-Object { $_.Values[0] -eq 'StopServices' })
if ([int]$restore[0].Values[2] -ge [int]$stop[0].Values[2] -or $restore[0].Values[1] -notmatch 'NOT UPGRADINGPRODUCTCODE') { throw 'Restauração deve ocorrer antes de parar/remover, preservando upgrade.' }
$locks = Read-Rows 'SELECT `SDDLText` FROM `MsiLockPermissionsEx`' 1
if (-not ($locks | Where-Object { $_.Values[0] -eq 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)' })) { throw 'ACL protegida de Program Files ausente.' }
$filesTable = Read-Rows 'SELECT `File` FROM `File`' 1
if (-not ($filesTable | Where-Object { $_.Values[0] -eq 'ControlExe' }) -or -not ($filesTable | Where-Object { $_.Values[0] -eq 'AppExe' })) { throw 'Payload incompleto.' }
Write-Output 'PASS: MSI único por máquina, política automática com rollback, serviço LocalSystem, restauração antes da remoção, ACL e payload.'
