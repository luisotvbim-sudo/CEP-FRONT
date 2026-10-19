#Requires -Version 5.1
[CmdletBinding()]
param([switch]$AsJson)
$ErrorActionPreference = 'Stop'
# Read-only. No administrator, service commands, policy changes or personal inventory.
if ($env:OS -ne 'Windows_NT') { throw 'Execute esta verificacao no computador Windows que recebera o CEP Horas.' }
$machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
$machine32 = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry32)
$os = $null; $architectureKey = $null; $webview = $null
try {
    $os = $machine.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion')
    $architectureKey = $machine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
    $webview = $machine32.OpenSubKey('SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
    $edition = [string]$os.GetValue('EditionID')
    $build = 0
    [void][int]::TryParse([string]$os.GetValue('CurrentBuildNumber'), [ref]$build)
    $architecture = [string]$architectureKey.GetValue('PROCESSOR_ARCHITECTURE')
    $installationType = [string]$os.GetValue('InstallationType')
    $webviewVersion = if ($null -ne $webview) { [string]$webview.GetValue('pv') } else { '' }
    $parsedWebview = $null
    $webviewPresent = [Version]::TryParse($webviewVersion, [ref]$parsedWebview) -and $parsedWebview.Major -gt 0
    $familySupported = @('Professional', 'Enterprise', 'Education') | Where-Object { $edition.StartsWith($_, [StringComparison]::Ordinal) }
    $reasons = @()
    if ($architecture -ne 'AMD64') { $reasons += 'Requer Windows x64 (AMD64).' }
    if ($build -ne 19045 -and $build -lt 26100) { $reasons += 'Requer Windows 10 22H2 (build 19045) ou Windows 11 24H2 ou posterior (build 26100+).' }
    if ($installationType -ne 'Client' -or -not $familySupported) { $reasons += 'Requer Windows cliente Pro, Enterprise ou Education.' }
    if (-not $webviewPresent) { $reasons += 'Instale o Microsoft Edge WebView2 Evergreen por maquina.' }
    $result = [pscustomobject][ordered]@{
        Edition = $edition; WindowsVersion = [string]$os.GetValue('DisplayVersion'); Build = $build
        Architecture = $architecture; WebView2Version = $webviewVersion
        Compatible = ($reasons.Count -eq 0); RequiredActions = $reasons
    }
    if ($AsJson) { $result | ConvertTo-Json -Depth 3 }
    else {
        $result | Format-List
        Write-Output 'Esta verificacao apenas le a configuracao. Instalacao e homologacao devem ser feitas pela TI.'
    }
} finally {
    foreach ($key in @($webview, $architectureKey, $os, $machine32, $machine)) { if ($null -ne $key) { $key.Dispose() } }
}
