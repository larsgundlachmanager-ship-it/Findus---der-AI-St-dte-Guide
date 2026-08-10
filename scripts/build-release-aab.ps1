# Upload-fertiges Android App Bundle (.aab) für Google Play.
# Signiert mit android/keystore.properties + Upload-Keystore.
param(
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

# Guard: expo-modules-core's index.js is intentionally null (Node stub).
# Metro must resolve via "main": "src/index.ts" — otherwise black screen on boot.
$emcPkg = Join-Path (Get-Location) 'node_modules\expo-modules-core\package.json'
if (Test-Path $emcPkg) {
    $emcMain = (Get-Content $emcPkg -Raw | ConvertFrom-Json).main
    if ($emcMain -ne 'src/index.ts') {
        throw "expo-modules-core package.json main is '$emcMain' (expected 'src/index.ts'). Fix before release build."
    }
}

$props = Join-Path (Get-Location) 'android\keystore.properties'
if (-not (Test-Path $props)) {
    throw "Fehlt: android\keystore.properties (Upload-Signing)."
}

if (-not $SkipFetch) {
    npm run fetch:espeak
    npm run generate:voice-assets
}

Write-Host "Starte Play-Bundle-Build (bundleRelease)…"
Set-Location android
& .\gradlew.bat bundleRelease
$code = $LASTEXITCODE
Set-Location ..

if ($code -ne 0) {
    throw "AAB-Build fehlgeschlagen (Exit $code)"
}

$aab = Get-ChildItem -Path "android\app\build\outputs\bundle\release" -Filter "*.aab" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($aab) {
    Write-Host ""
    Write-Host "Upload-AAB bereit:" -ForegroundColor Green
    Write-Host $aab.FullName
    Write-Host ("Größe: {0:N1} MB" -f ($aab.Length / 1MB))
} else {
    Write-Warning "Build abgeschlossen, aber keine AAB unter android\app\build\outputs\bundle\release gefunden."
}
