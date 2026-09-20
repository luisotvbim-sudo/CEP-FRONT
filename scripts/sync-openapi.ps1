[CmdletBinding()]
param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8080",
    [string]$OutputPath = (Join-Path $PSScriptRoot "..\docs\openapi.json")
)

$ErrorActionPreference = "Stop"
$swaggerUri = "$($ApiBaseUrl.TrimEnd('/'))/swagger/v1/swagger.json"
$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $fullOutputPath
$temporaryPath = "$fullOutputPath.download"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

try {
    Invoke-WebRequest -UseBasicParsing -Uri $swaggerUri -OutFile $temporaryPath
    $document = Get-Content -Raw -LiteralPath $temporaryPath | ConvertFrom-Json

    if ([string]::IsNullOrWhiteSpace($document.openapi) -or $null -eq $document.paths) {
        throw "A resposta de $swaggerUri não é um documento OpenAPI válido."
    }

    Move-Item -LiteralPath $temporaryPath -Destination $fullOutputPath -Force
    Write-Host "OpenAPI atualizado em $fullOutputPath"
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}
