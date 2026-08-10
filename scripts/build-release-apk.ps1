# Release-APK für Findus (signiert mit debug.keystore — nur für interne Tests).
param(
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

# Node 24 + Expo Config: ohne NODE_ENV scheitert createExpoConfig
if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }

# Guard: expo-modules-core's index.js is intentionally null (Node stub).
# Metro must resolve via "main": "src/index.ts" — otherwise the app boots to a black screen
# ("Cannot read property 'requireOptionalNativeModule' of null").
$emcPkg = Join-Path (Split-Path $PSScriptRoot -Parent) 'node_modules\expo-modules-core\package.json'
if (Test-Path $emcPkg) {
    $emcMain = (Get-Content $emcPkg -Raw | ConvertFrom-Json).main
    if ($emcMain -ne 'src/index.ts') {
        throw "expo-modules-core package.json main is '$emcMain' (expected 'src/index.ts'). Fix before release build."
    }
}

if (-not $SkipFetch) {
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
