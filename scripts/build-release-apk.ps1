# Release-APK fuer Findus (signiert mit debug.keystore — nur fuer interne Tests).
param(
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

# Node 24 + Expo Config: ohne NODE_ENV scheitert createExpoConfig
if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }

# Prefer portable Node 22 (stable for Expo config + Metro).
$portableNode = Join-Path (Get-Location) '.tools\node-v22.14.0-win-x64'
if (Test-Path (Join-Path $portableNode 'node.exe')) {
    $env:PATH = "$portableNode;$env:PATH"
    Write-Host "NODE=$(node -v) (portable)"
}

# NEVER flip expo-modules-core "main" to index.js (null stub). That caused
# recurring black screens when Metro bundled while main pointed at the stub.
# createExpoConfig loads .ts via Node's strip-types instead.
node .\scripts\ensure-expo-modules-core-main.cjs
$emcPkg = Join-Path (Get-Location) 'node_modules\expo-modules-core\package.json'
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

# Keep launcher icons in sync with assets/icon.png + adaptive-icon.png
# (gradle alone never regenerates mipmaps from Expo assets).
Write-Host "Sync Android app icons…"
node .\scripts\sync-android-icons.mjs
if ($LASTEXITCODE -ne 0) { throw "Icon-Sync fehlgeschlagen (Exit $LASTEXITCODE)" }

Write-Host "Starte Release-Build (assembleRelease)…"
Set-Location android

# Strip TypeScript types so plain Node can require expo-modules-core src/*.ts
# during :expo-constants:createExpoConfig — without mutating package.json.
$prevNodeOptions = $env:NODE_OPTIONS
if ($env:NODE_OPTIONS) {
    if ($env:NODE_OPTIONS -notmatch 'experimental-strip-types') {
        $env:NODE_OPTIONS = "$env:NODE_OPTIONS --experimental-strip-types"
    }
} else {
    $env:NODE_OPTIONS = '--experimental-strip-types'
}

try {
    & .\gradlew.bat :expo-constants:createExpoConfig
    if ($LASTEXITCODE -ne 0) { throw "createExpoConfig fehlgeschlagen (Exit $LASTEXITCODE)" }

    # Re-assert before Metro embeds the JS bundle.
    Set-Location ..
    node .\scripts\ensure-expo-modules-core-main.cjs
    $emcMain2 = (Get-Content $emcPkg -Raw | ConvertFrom-Json).main
    if ($emcMain2 -ne 'src/index.ts') {
        throw "expo-modules-core main drifted to '$emcMain2' before assembleRelease."
    }
    Set-Location android

    & .\gradlew.bat assembleRelease
    $code = $LASTEXITCODE
} finally {
    $env:NODE_OPTIONS = $prevNodeOptions
    Set-Location (Split-Path $PSScriptRoot -Parent)
    node .\scripts\ensure-expo-modules-core-main.cjs
}

Set-Location (Split-Path $PSScriptRoot -Parent)

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
