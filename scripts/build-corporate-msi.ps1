param([string]$Version = '0.3.0')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,5}$') { throw 'Versão MSI inválida.' }
$numbers=$Version.Split('.') | ForEach-Object { [int]$_ }
if($numbers[0] -gt 255 -or $numbers[1] -gt 255 -or $numbers[2] -gt 65535) { throw 'Limites MSI: 255.255.65535.' }
$output=Join-Path $repo ".local\corporate-msi\$Version"
if(Test-Path -LiteralPath $output) { throw 'Saída já existe. Use uma versão nova.' }
$publish=Join-Path $output 'publish'; $artifacts=Join-Path $output 'artifacts'
New-Item -ItemType Directory -Path $output | Out-Null
Push-Location $repo
try {
    & pnpm build
    if($LASTEXITCODE) { throw 'Falha no frontend.' }
    & dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained true -o $publish "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false
    if($LASTEXITCODE) { throw 'Falha no desktop.' }
    & dotnet publish desktop/CepHoras.Control -c Release -r win-x64 --self-contained true -o (Join-Path $publish 'control') "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false
    if($LASTEXITCODE) { throw 'Falha no serviço.' }
    [IO.File]::WriteAllText((Join-Path $publish 'corporate-install.marker'), 'CEP Horas corporate pilot')
    foreach($required in @('CepHoras.exe','control\CepHoras.Control.exe','coreclr.dll','control\coreclr.dll','wwwroot\index.html')) {
        if(-not(Test-Path -LiteralPath (Join-Path $publish $required))) { throw "Payload incompleto: $required" }
    }
    $unexpected=Get-ChildItem -LiteralPath $publish -File -Recurse | Where-Object { $_.Extension -in @('.pfx','.p12','.pem','.key','.dat','.notifications') -or $_.Name -like '.env*' -or $_.Name -in @('policy.json','restore-journal.json') }
    if($unexpected) { throw 'Payload contém configuração privada ou credenciais.' }
    $payload=Join-Path $output 'Payload.wxs'
    & ./scripts/new-msi-payload.ps1 -PublishDirectory $publish -OutputFile $payload -Corporate
    & dotnet build desktop/CepHoras.CorporateInstaller -c Release "-p:InstallerVersion=$Version" "-p:PayloadSource=$payload" "-p:OutputPath=$artifacts\"
    if($LASTEXITCODE) { throw 'Falha no MSI corporativo.' }
    & ./scripts/test-corporate-msi.ps1 -PackagePath (Join-Path $artifacts 'CEP-Horas-Corporativo-Piloto-win-x64.msi')
    Copy-Item -LiteralPath (Join-Path $repo 'desktop\CepHoras.CorporateInstaller\LEIA-ME-TI.txt') -Destination $artifacts
    Copy-Item -LiteralPath (Join-Path $publish 'control') -Destination (Join-Path $artifacts 'RecuperacaoTI') -Recurse
    $hash=(Get-FileHash -LiteralPath (Join-Path $artifacts 'CEP-Horas-Corporativo-Piloto-win-x64.msi')).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $artifacts 'SHA256SUMS.txt'), "$hash  CEP-Horas-Corporativo-Piloto-win-x64.msi`n")
    Compress-Archive -LiteralPath (Join-Path $artifacts 'CEP-Horas-Corporativo-Piloto-win-x64.msi'),(Join-Path $artifacts 'LEIA-ME-TI.txt'),(Join-Path $artifacts 'SHA256SUMS.txt'),(Join-Path $artifacts 'RecuperacaoTI') -DestinationPath (Join-Path $artifacts "CEP-Horas-Corporativo-Piloto-$Version-TI.zip")
    Write-Output "Pacote: $artifacts; SHA-256=$hash"
} finally { Pop-Location }
