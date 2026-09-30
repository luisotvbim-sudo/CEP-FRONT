param([Parameter(Mandatory)][string]$PackagePath)
$ErrorActionPreference='Stop'
$installer=New-Object -ComObject WindowsInstaller.Installer
$database=$installer.OpenDatabase((Resolve-Path -LiteralPath $PackagePath).Path,0)
function Read-Rows([string]$sql,[int]$columns) {
    $view=$database.OpenView($sql); [void]$view.Execute()
    $rows=@(); while($record=$view.Fetch()) { $row=@(); for($index=1;$index -le $columns;$index++){ $row+= $record.StringData($index) }; $rows+= ,$row }
    [void]$view.Close(); return ,$rows
}
$scope=Read-Rows 'SELECT `Value` FROM `Property` WHERE `Property` = ''ALLUSERS''' 1
if($scope[0][0] -ne '1') { throw 'O MSI deve ser exclusivamente por máquina.' }
$service=Read-Rows 'SELECT `Name`, `ServiceType`, `StartType`, `StartName`, `Arguments` FROM `ServiceInstall`' 5
if($service.Count -ne 1 -or $service[0][0] -ne 'CepHorasControl' -or $service[0][1] -ne '16' -or $service[0][2] -ne '2' -or $service[0][3] -ne 'LocalSystem' -or $service[0][4] -ne '--service') { throw 'Serviço incorreto.' }
$restore=Read-Rows 'SELECT `Type`, `Target` FROM `CustomAction` WHERE `Action` = ''RestorePolicy''' 2
if((([int]$restore[0][0]) -band 0xC00) -ne 0xC00 -or $restore[0][1] -ne '--uninstall-restore') { throw 'Restauração precisa executar diferida e elevada.' }
$rollback=Read-Rows 'SELECT `Type`, `Target` FROM `CustomAction` WHERE `Action` = ''RollbackPolicyRestore''' 2
if((([int]$rollback[0][0]) -band 0xD00) -ne 0xD00 -or $rollback[0][1] -ne '--rollback-restore') { throw 'Rollback da política ausente.' }
$sequence=Read-Rows 'SELECT `Action`, `Condition`, `Sequence` FROM `InstallExecuteSequence`' 3
$restoreSequence=$sequence | Where-Object { $_[0] -eq 'RestorePolicy' }
$stopSequence=$sequence | Where-Object { $_[0] -eq 'StopServices' }
if([int]$restoreSequence[2] -ge [int]$stopSequence[2] -or $restoreSequence[1] -notmatch 'NOT UPGRADINGPRODUCTCODE') { throw 'Restaurar antes de parar/remover; preservar política em upgrade.' }
$configure=$sequence | Where-Object { $_[0] -eq 'OpenConfiguration' }
if($configure) { throw 'Não abrir UI administrativa em instalação silenciosa.' }
$locks=Read-Rows 'SELECT `SDDLText` FROM `MsiLockPermissionsEx`' 1
if(-not($locks | Where-Object { $_[0] -eq 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)' })) { throw 'ACL protegida de Program Files ausente.' }
$files=Read-Rows 'SELECT `File` FROM `File`' 1
if(-not($files | Where-Object { $_[0] -eq 'ControlExe' }) -or -not($files | Where-Object { $_[0] -eq 'AppExe' })) { throw 'Payload incompleto.' }
Write-Output 'PASS: MSI somente por máquina, serviço automático LocalSystem, restauração elevada antes de remover, rollback, upgrade preservado, ACL e executáveis. Nenhuma instalação executada.'
