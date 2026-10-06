param(
    [Parameter(Mandatory)][string]$PublishDirectory,
    [Parameter(Mandatory)][string]$OutputFile,
    [switch]$Corporate
)
$ErrorActionPreference = 'Stop'
# HKMU follows the selected installation scope; stable key paths support repair in either scope.
$namespace = 'http://wixtoolset.org/schemas/v4/wxs'
$document = [xml]"<Wix xmlns='$namespace'><Fragment /></Wix>"
function Add-Element($parent, [string]$name, [hashtable]$attributes) {
    $element = $document.CreateElement($name, $namespace)
    foreach ($key in $attributes.Keys) { $element.SetAttribute($key, [string]$attributes[$key]) }
    [void]$parent.AppendChild($element)
    return $element
}
function Get-Identifier([string]$path) {
    return 'p' + [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($path.ToLowerInvariant()))).Substring(0, 32)
}
$fragment = $document.DocumentElement.FirstChild
$registryRoot = if ($Corporate) { 'Software\Conceito\CepHorasCorporateMsi' } else { 'Software\Conceito\CepHorasMsi' }
function Get-ComponentGuid([string]$id) {
    $componentNamespace = if ($Corporate) { 'Conceito.CepHoras.CorporateMsi/' } else { 'Conceito.CepHoras.Msi/' }
    $hash = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($componentNamespace + $id))
    return [guid]::new([byte[]]$hash[0..15]).ToString()
}
$root = Add-Element $fragment 'DirectoryRef' @{ Id = 'INSTALLFOLDER' }
$group = Add-Element $fragment 'ComponentGroup' @{ Id = 'AppFiles' }
$directories = @{ '' = $root }
$directoryIds = @{ '' = 'INSTALLFOLDER' }
$publish = [IO.Path]::GetFullPath($PublishDirectory)
foreach ($directory in (Get-ChildItem -LiteralPath $publish -Directory -Recurse | Sort-Object FullName)) {
    $relative = [IO.Path]::GetRelativePath($publish, $directory.FullName)
    $parent = [IO.Path]::GetDirectoryName($relative)
    $id = Get-Identifier "directory/$relative"
    $directories[$relative] = Add-Element $directories[$parent] 'Directory' @{ Id = $id; Name = $directory.Name }
    $directoryIds[$relative] = $id
}
foreach ($relative in @($directories.Keys | Sort-Object)) {
    $id = Get-Identifier "cleanup/$relative"
    $component = Add-Element $directories[$relative] 'Component' @{ Id = $id; Guid = (Get-ComponentGuid $id) }
    $null = Add-Element $component 'RegistryValue' @{ Root = 'HKMU'; Key = "$registryRoot\Folders"; Name = $id; Type = 'integer'; Value = '1'; KeyPath = 'yes' }
    $null = Add-Element $component 'RemoveFolder' @{ Id = $id; Directory = $directoryIds[$relative]; On = 'uninstall' }
    $null = Add-Element $group 'ComponentRef' @{ Id = $id }
}
foreach ($file in (Get-ChildItem -LiteralPath $publish -File -Recurse | Sort-Object FullName)) {
    $relative = [IO.Path]::GetRelativePath($publish, $file.FullName)
    $parent = [IO.Path]::GetDirectoryName($relative)
    $id = Get-Identifier "file/$relative"
    $component = Add-Element $directories[$parent] 'Component' @{ Id = $id; Guid = (Get-ComponentGuid $id) }
    $isControl = $Corporate -and $relative -eq 'control\CepHoras.Control.exe'
    if ($relative -ne 'CepHoras.exe' -and -not $isControl) {
        $null = Add-Element $component 'RegistryValue' @{ Root = 'HKMU'; Key = "$registryRoot\Files"; Name = $id; Type = 'integer'; Value = '1'; KeyPath = 'yes' }
    }
    $fileId = if ($relative -eq 'CepHoras.exe') { 'AppExe' } elseif ($isControl) { 'ControlExe' } else { 'f' + $id }
    $fileKeyPath = if ($relative -eq 'CepHoras.exe' -or $isControl) { 'yes' } else { 'no' }
    $fileElement = Add-Element $component 'File' @{ Id = $fileId; Source = $file.FullName; KeyPath = $fileKeyPath }
    if ($relative -eq 'CepHoras.exe') {
        $shortcutName = if ($Corporate) { 'CEP Horas' } else { 'CEP Horas (Teste MSI)' }
        $shortcutAttributes = @{ Id = 'StartMenuShortcut'; Directory = 'ProgramMenuFolder'; Name = $shortcutName; Advertise = 'yes'; WorkingDirectory = 'INSTALLFOLDER' }
        if ($Corporate) { $shortcutAttributes.Icon = 'CepHoras.ico' }
        $null = Add-Element $fileElement 'Shortcut' $shortcutAttributes
        if ($Corporate) {
            $null = Add-Element $fileElement 'Shortcut' @{ Id = 'DesktopShortcut'; Directory = 'DesktopFolder'; Name = $shortcutName; Advertise = 'yes'; WorkingDirectory = 'INSTALLFOLDER'; Icon = 'CepHoras.ico' }
        }
    }
    if ($isControl) {
        $null = Add-Element $fileElement 'Shortcut' @{ Id = 'AdminShortcut'; Directory = 'ProgramMenuFolder'; Name = 'CEP Horas - Recuperacao TI'; Advertise = 'yes'; Arguments = '--configure'; WorkingDirectory = 'INSTALLFOLDER' }
        $service = Add-Element $component 'ServiceInstall' @{ Id = 'ControlService'; Name = 'CepHorasControl'; DisplayName = 'CEP Horas - Controle de energia'; Description = 'Autoriza e executa acoes de energia solicitadas pelo CEP Horas.'; Type = 'ownProcess'; Start = 'auto'; ErrorControl = 'normal'; Account = 'LocalSystem'; Arguments = '--service'; Vital = 'yes' }
        $null = Add-Element $component 'ServiceControl' @{ Id = 'ControlServiceLifecycle'; Name = 'CepHorasControl'; Start = 'install'; Stop = 'both'; Remove = 'uninstall'; Wait = 'yes' }
        $recovery = $document.CreateElement('ServiceConfig', 'http://wixtoolset.org/schemas/v4/wxs/util')
        foreach ($entry in @{ ServiceName = 'CepHorasControl'; FirstFailureActionType = 'restart'; SecondFailureActionType = 'restart'; ThirdFailureActionType = 'restart'; RestartServiceDelayInSeconds = '10'; ResetPeriodInDays = '1' }.GetEnumerator()) { $recovery.SetAttribute($entry.Key,$entry.Value) }
        [void]$component.AppendChild($recovery)
    }
    $null = Add-Element $group 'ComponentRef' @{ Id = $id }
}
$document.Save($OutputFile)
