# Downloads German Kokoro ONNX + Martin voice into android/ios native assets.
# Usage: powershell -File scripts/download-kokoro-de-bundle.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$modelUrl = "https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx"
$voiceNpzUrl = "https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/voices-martin.npz"

$androidDir = Join-Path $root "android\app\src\main\assets\kokoro"
$iosDir = Join-Path $root "ios\Findus\kokoro"
New-Item -ItemType Directory -Force -Path $androidDir | Out-Null
New-Item -ItemType Directory -Force -Path $iosDir -ErrorAction SilentlyContinue | Out-Null

Write-Host "Downloading ~310 MB German model…"
$modelPath = Join-Path $androidDir "kokoro-martin.onnx"
Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
Copy-Item $modelPath (Join-Path $iosDir "kokoro-martin.onnx") -ErrorAction SilentlyContinue

Write-Host "Downloading Martin voice (voices-martin.npz)…"
$voicePath = Join-Path $androidDir "voices-martin.npz"
Invoke-WebRequest -Uri $voiceNpzUrl -OutFile $voicePath
Copy-Item $voicePath (Join-Path $iosDir "voices-martin.npz") -ErrorAction SilentlyContinue

Write-Host "Done. Rebuild native app (expo run:android)."
Get-ChildItem $androidDir -File | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}
