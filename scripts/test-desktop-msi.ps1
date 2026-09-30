# Simulates MSI costing and the actual scope-dialog events. Does not install, remove, or start the application.
param([Parameter(Mandatory)][string]$PackagePath)
$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$installer = New-Object -ComObject WindowsInstaller.Installer
$installer.UILevel = 2
$database = $installer.OpenDatabase($package, 0)
$launchView = $database.OpenView('SELECT `Condition` FROM `ControlEvent` WHERE `Dialog_` = ''ExitDialog'' AND `Control_` = ''Finish'' AND `Event` = ''DoAction'' AND `Argument` = ''LaunchCepHoras''')
$launchView.Execute()
$launchRecord = $launchView.Fetch()
if (-not $launchRecord) { throw 'A tela final não oferece abertura do aplicativo.' }
$launchCondition = $launchRecord.StringData(1)
$launchView.Close()
$actionView = $database.OpenView('SELECT `Target` FROM `CustomAction` WHERE `Action` = ''LaunchCepHoras''')
$actionView.Execute()
if ($actionView.Fetch().StringData(1) -ne 'WixUnelevatedShellExec') { throw 'A abertura deve usar o contexto não elevado do usuário.' }
$actionView.Close()
$sequenceView = $database.OpenView('SELECT `Action` FROM `InstallExecuteSequence` WHERE `Action` = ''LaunchCepHoras''')
$sequenceView.Execute()
if ($sequenceView.Fetch()) { throw 'Instalação silenciosa não deve iniciar o aplicativo.' }
$sequenceView.Close()
foreach ($scope in @('user','machine')) {
 $session = $installer.OpenPackage($package, 1)
 function Set-MsiProperty($name,$value) { $null = $session.GetType().InvokeMember('Property','SetProperty',$null,$session,@($name,$value)) }
 foreach ($action in @('AppSearch','CostInitialize','FileCost','SetUserInstallFolder','SetUserPrograms','CostFinalize')) {
  if ($session.DoAction($action) -ne 1) { throw "Falha em $action" }
 }
 Set-MsiProperty 'CEPINSTALLSCOPE' $scope
 $view = $database.OpenView('SELECT `Event`, `Argument`, `Condition` FROM `ControlEvent` WHERE `Dialog_` = ''CepScopeDlg'' AND `Control_` = ''Next'' ORDER BY `Ordering`')
 $view.Execute()
 while ($record = $view.Fetch()) {
  $event = $record.StringData(1)
  $argument = $record.StringData(2)
  $condition = $record.StringData(3)
  if ($condition -and $session.EvaluateCondition($condition) -ne 1) { continue }
  if ($event.StartsWith('[')) {
   $value = if ($argument -eq '{}') { '' } else { [regex]::Replace($argument,'\[([A-Za-z0-9_]+)\]', { param($m) $session.Property($m.Groups[1].Value) }) }
   Set-MsiProperty $event.Trim('[',']') $value
  } elseif ($event -eq 'SetTargetPath') {
   $null = $session.GetType().InvokeMember('TargetPath','SetProperty',$null,$session,@($argument,$session.Property($argument)))
  }
 }
 $view.Close()
 $target = $session.TargetPath('INSTALLFOLDER')
 $menu = $session.TargetPath('ProgramMenuFolder')
 if ($scope -eq 'user' -and (-not $target.TrimEnd('\').Equals((Join-Path $env:LOCALAPPDATA 'Programs\Conceito\CEP Horas Teste MSI'), [StringComparison]::OrdinalIgnoreCase) -or -not $menu.StartsWith($env:APPDATA))) { throw "Destino por usuário incorreto: $target / $menu" }
 if ($scope -eq 'machine' -and (-not $target.StartsWith($env:ProgramFiles) -or -not $menu.StartsWith($env:ProgramData))) { throw "Destino por máquina incorreto: $target / $menu" }
 "${scope}: $target; menu=$menu; ALLUSERS=$($session.Property('ALLUSERS'))"
 if ($session.Property('WIXUI_EXITDIALOGOPTIONALCHECKBOX') -ne '1') { throw 'Abrir CEP Horas deve vir marcado.' }
 if ($session.Property('WixUnelevatedShellExecTarget') -ne '[#AppExe]') { throw 'Alvo de abertura incorreto.' }
 foreach ($case in @(
  @{ Checked = '1'; Installed = ''; Remove = ''; Expected = 1 },
  @{ Checked = ''; Installed = ''; Remove = ''; Expected = 0 },
  @{ Checked = '1'; Installed = '1'; Remove = ''; Expected = 0 },
  @{ Checked = '1'; Installed = ''; Remove = 'ALL'; Expected = 0 }
 )) {
  Set-MsiProperty 'WIXUI_EXITDIALOGOPTIONALCHECKBOX' $case.Checked
  Set-MsiProperty 'Installed' $case.Installed
  Set-MsiProperty 'REMOVE' $case.Remove
  if ($session.EvaluateCondition($launchCondition) -ne $case.Expected) { throw 'Condição de abertura incorreta para instalação/manutenção.' }
 }
 "${scope}: abertura marcada; desmarcar, reparar e remover não abrem o aplicativo."
 [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($session)
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
