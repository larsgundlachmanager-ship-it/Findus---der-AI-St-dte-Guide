# Release-APK für Findus (signiert mit debug.keystore — nur für interne Tests).
param(
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

if (-not $SkipFetch) {
    npm run fetch:kokoro
    npm run fetch:espeak
    npm run generate:voice-assets
}

Write-Host "Starte Release-Build (assembleRelease)…"
Set-Location android
& .\gradlew.bat assembleRelease
$code = $LASTEXITCODE
Set-Location ..

if ($code -ne 0) {
    throw "Release-Build fehlgeschlagen (Exit $code)"
}

$apk = Get-ChildItem -Path "android\app\build\outputs\apk\release" -Filter "*.apk" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($apk) {
    Write-Host ""
    Write-Host "Release-APK bereit:" -ForegroundColor Green
    Write-Host $apk.FullName
} else {
    Write-Warning "Build abgeschlossen, aber keine APK unter android\app\build\outputs\apk\release gefunden."
}
