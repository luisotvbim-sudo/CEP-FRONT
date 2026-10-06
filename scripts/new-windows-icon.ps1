#Requires -Version 7.0
param(
    [string]$SourcePath = (Join-Path $PSScriptRoot '..\src\assets\conceito-icon.png'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\desktop\CepHoras.Desktop\Assets\Conceito.ico')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath).Path)
try {
    # PNG frames preserve the supplied logo's transparency at every Windows DPI.
    $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
    $frames = @()
    foreach ($size in $sizes) {
        $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
                $width = [int][Math]::Round($source.Width * $scale)
                $height = [int][Math]::Round($source.Height * $scale)
                $graphics.DrawImage($source, [int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
            } finally { $graphics.Dispose() }
            $stream = [IO.MemoryStream]::new()
            try {
                $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                $frames += ,$stream.ToArray()
            } finally { $stream.Dispose() }
        } finally { $bitmap.Dispose() }
    }

    $output = [IO.Path]::GetFullPath($OutputPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
    $buffer = [IO.MemoryStream]::new()
    try {
        $writer = [IO.BinaryWriter]::new($buffer)
        try {
            $writer.Write([ushort]0) # ICONDIR reserved
            $writer.Write([ushort]1) # icon
            $writer.Write([ushort]$sizes.Count)
            $offset = 6 + 16 * $sizes.Count
            for ($index = 0; $index -lt $sizes.Count; $index++) {
                $size = $sizes[$index]
                $writer.Write([byte]($size % 256))
                $writer.Write([byte]($size % 256))
                $writer.Write([byte]0) # true color
                $writer.Write([byte]0)
                $writer.Write([ushort]1) # planes
                $writer.Write([ushort]32) # bits per pixel
                $writer.Write([uint32]$frames[$index].Length)
                $writer.Write([uint32]$offset)
                $offset += $frames[$index].Length
            }
            foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
            $writer.Flush()
            [IO.File]::WriteAllBytes($output, $buffer.ToArray())
        } finally { $writer.Dispose() }
    } finally { $buffer.Dispose() }
    Write-Output "Ícone Windows gerado: $output"
} finally { $source.Dispose() }
