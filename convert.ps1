Add-Type -AssemblyName System.Drawing
$pngPath = Join-Path (Get-Location) "resources\icon.png"
$icoPath = Join-Path (Get-Location) "resources\icon.ico"

Write-Host "Converting $pngPath to $icoPath"

if (-not (Test-Path $pngPath)) {
    Write-Error "PNG file not found: $pngPath"
    exit 1
}

try {
    $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
    $handle = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    $file = [System.IO.FileStream]::new($icoPath, [System.IO.FileMode]::Create)
    $icon.Save($file)
    $file.Close()
    $icon.Dispose()
    $bmp.Dispose()
    Write-Host "Conversion successful."
} catch {
    Write-Error "Conversion failed: $_"
    exit 1
}
