# Upload-fertiges Android App Bundle (.aab) fuer Google Play.
# Signiert mit android/keystore.properties + Upload-Keystore.
param(
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

if (-not $env:NODE_ENV) { $env:NODE_ENV = 'production' }

$portableNode = Join-Path (Get-Location) '.tools\node-v22.14.0-win-x64'
if (Test-Path (Join-Path $portableNode 'node.exe')) {
    $env:PATH = "$portableNode;$env:PATH"
    Write-Host "NODE=$(node -v) (portable)"
}

# NEVER flip expo-modules-core "main" to the null stub (black-screen APKs).
node .\scripts\ensure-expo-modules-core-main.cjs
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

Write-Host "Sync Android app icons…"
node .\scripts\sync-android-icons.mjs
if ($LASTEXITCODE -ne 0) { throw "Icon-Sync fehlgeschlagen (Exit $LASTEXITCODE)" }

Write-Host "Starte Play-Bundle-Build (bundleRelease)…"
Set-Location android

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

    Set-Location ..
    node .\scripts\ensure-expo-modules-core-main.cjs
    $emcMain2 = (Get-Content $emcPkg -Raw | ConvertFrom-Json).main
    if ($emcMain2 -ne 'src/index.ts') {
        throw "expo-modules-core main drifted to '$emcMain2' before bundleRelease."
    }
    Set-Location android

    & .\gradlew.bat bundleRelease
    $code = $LASTEXITCODE
} finally {
    $env:NODE_OPTIONS = $prevNodeOptions
    Set-Location (Split-Path $PSScriptRoot -Parent)
    node .\scripts\ensure-expo-modules-core-main.cjs
}

Set-Location (Split-Path $PSScriptRoot -Parent)

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
} else {
    Write-Warning "Build abgeschlossen, aber keine AAB unter android\app\build\outputs\bundle\release gefunden."
}
