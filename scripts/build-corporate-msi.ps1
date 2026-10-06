#Requires -Version 7.0
param(
    [string]$Version = '0.4.15',
    [string]$UpdateSigningKeyPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Reject an unsupported build host before creating an incomplete output/version.
if (-not $IsWindows) { throw 'Build MSI exige Windows e PowerShell 7.' }
foreach ($command in @('pnpm', 'dotnet')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Ferramenta de build ausente: $command" }
}
$sdks = @(& dotnet --list-sdks)
if ($LASTEXITCODE -ne 0 -or -not ($sdks | Where-Object { $_ -match '^10\.' })) { throw 'Build MSI exige .NET SDK 10; apenas o runtime não é suficiente.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publicKey = Join-Path $repo 'desktop\CepHoras.Updates\MsiUpdatePublicKey.pem'
if (-not (Test-Path -LiteralPath $publicKey -PathType Leaf)) { throw 'Falta a chave pública MSI embutida. Gere a identidade de publicação antes do bootstrap; não use chave de teste.' }
# The signer and both installed processes must use the same publishing identity.
$trust = [Security.Cryptography.RSA]::Create()
try {
    $publicPem = [IO.File]::ReadAllText($publicKey)
    # ImportFromPem also accepts private keys; embedding one would disclose it in the DLL.
    if ($publicPem -cnotmatch '\A\s*-----BEGIN PUBLIC KEY-----\s+[A-Za-z0-9+/=\s]+-----END PUBLIC KEY-----\s*\z') { throw 'O recurso MSI deve conter somente a chave pública SPKI, nunca uma chave privada.' }
    $trust.ImportFromPem($publicPem)
    if ($trust.KeySize -ne 3072) { throw 'A chave pública MSI deve ser RSA 3072, conforme a identidade de publicação.' }
} finally { $trust.Dispose() }
if ($UpdateSigningKeyPath) {
    $UpdateSigningKeyPath = (Resolve-Path -LiteralPath $UpdateSigningKeyPath).Path
    if (-not (Test-Path -LiteralPath $UpdateSigningKeyPath -PathType Leaf)) { throw 'A chave de publicação deve ser um arquivo DPAPI protegido.' }
}
if ($Version -notmatch '^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,4})$') { throw 'Versão MSI inválida ou não canônica.' }
$numbers = $Version.Split('.') | ForEach-Object { [int]$_ }
if ($numbers[0] -gt 255 -or $numbers[1] -gt 255 -or $numbers[2] -gt 65535) { throw 'Limites MSI: 255.255.65535.' }
$output = Join-Path $repo ".local\corporate-msi\$Version"
if (Test-Path -LiteralPath $output) { throw 'Saída já existe. Use uma versão nova ou remova somente esse diretório de artefatos.' }
$publish = Join-Path $output 'publish'
$artifacts = Join-Path $output 'artifacts'
New-Item -ItemType Directory -Path $output | Out-Null
Push-Location $repo
try {
    & pnpm build
    if ($LASTEXITCODE) { throw 'Falha no frontend.' }
    & dotnet publish desktop/CepHoras.Desktop -c Release -r win-x64 --self-contained true -o $publish "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE) { throw 'Falha no desktop.' }
    & dotnet publish desktop/CepHoras.Control -c Release -r win-x64 --self-contained true -o (Join-Path $publish 'control') "-p:Version=$Version" -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE) { throw 'Falha no serviço.' }
    [IO.File]::WriteAllText((Join-Path $publish 'managed-install.marker'), 'CEP Horas managed installation')
    foreach ($required in @('CepHoras.exe', 'control\CepHoras.Control.exe', 'coreclr.dll', 'control\coreclr.dll', 'wwwroot\index.html', 'managed-install.marker')) {
        if (-not (Test-Path -LiteralPath (Join-Path $publish $required))) { throw "Payload incompleto: $required" }
    }
    $unexpected = Get-ChildItem -LiteralPath $publish -File -Recurse | Where-Object {
        $_.Extension -in @('.pfx', '.p12', '.pem', '.key', '.dat', '.notifications') -or
        $_.Name -like '.env*' -or $_.Name -in @('policy.json', 'restore-journal.json', 'policy-upgrade-journal.json', 'power-journal.json', 'publisher.key')
    }
    if ($unexpected) { throw 'Payload contém configuração privada ou credenciais.' }
    $payload = Join-Path $output 'Payload.wxs'
    & ./scripts/new-msi-payload.ps1 -PublishDirectory $publish -OutputFile $payload -Corporate
    & dotnet build desktop/CepHoras.CorporateInstaller -c Release "-p:InstallerVersion=$Version" "-p:PayloadSource=$payload" "-p:OutputPath=$artifacts\" "-p:IntermediateOutputPath=$output\wix-obj\" -p:CreateHardLinksForCopyFilesToOutputDirectoryIfPossible=false -p:CreateSymbolicLinksForCopyFilesToOutputDirectoryIfPossible=false
    if ($LASTEXITCODE) { throw 'Falha no MSI.' }
    $msi = Join-Path $artifacts 'CEP-Horas-Windows-win-x64.msi'
    & ./scripts/test-corporate-msi.ps1 -PackagePath $msi
    $updateAssets = @()
    if ($UpdateSigningKeyPath) {
        # Check the actual published resource, not only the public source used by the signer.
        foreach ($libraryPath in @((Join-Path $publish 'CepHoras.Updates.dll'), (Join-Path $publish 'control\CepHoras.Updates.dll'))) {
            $library = [Reflection.Assembly]::LoadFile($libraryPath)
            $resource = $library.GetManifestResourceStream('CepHoras.Updates.MsiUpdatePublicKey.pem')
            if ($null -eq $resource) { throw 'Payload sem a raiz pública embutida do atualizador MSI.' }
            $reader = [IO.StreamReader]::new($resource, [Text.Encoding]::UTF8)
            try { $embeddedPem = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($embeddedPem -cne [IO.File]::ReadAllText($publicKey)) { throw 'A chave pública publicada diverge da identidade usada para assinar.' }
        }
        & ./scripts/sign-msi-update.ps1 -PackagePath $msi -Version $Version -SigningKeyPath $UpdateSigningKeyPath
        $updateAssets = @((Join-Path $artifacts 'CEP-Horas-Windows-win-x64.manifest.json'), (Join-Path $artifacts 'CEP-Horas-Windows-win-x64.manifest.sig'))
    }
    Copy-Item -LiteralPath (Join-Path $repo 'desktop\CepHoras.CorporateInstaller\LEIA-ME-TI.txt') -Destination $artifacts
    Copy-Item -LiteralPath (Join-Path $repo 'scripts\check-corporate-windows.ps1') -Destination (Join-Path $artifacts 'Verificar-Windows.ps1')
    Copy-Item -LiteralPath (Join-Path $publish 'control') -Destination (Join-Path $artifacts 'RecuperacaoTI') -Recurse
    $hash = (Get-FileHash -LiteralPath $msi).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $artifacts 'SHA256SUMS.txt'), "$hash  CEP-Horas-Windows-win-x64.msi`n")
    $tiFiles = @($msi, (Join-Path $artifacts 'LEIA-ME-TI.txt'), (Join-Path $artifacts 'Verificar-Windows.ps1'), (Join-Path $artifacts 'SHA256SUMS.txt'), (Join-Path $artifacts 'RecuperacaoTI')) + $updateAssets
    Compress-Archive -LiteralPath $tiFiles -DestinationPath (Join-Path $artifacts "CEP-Horas-Windows-$Version-TI.zip")
    Write-Output "Pacote: $artifacts; SHA-256=$hash"
    if ($UpdateSigningKeyPath) { Write-Output 'Manifesto e assinatura gerados. Publicação e homologação Windows ainda são etapas separadas.' }
    else { Write-Warning 'Build sem assinatura de atualização: inspeção estrutural somente, não está pronto para o canal MSI automático.' }
} finally { Pop-Location }
