# Frische Findus-APK: neuer Code, Code-Caches weg, Stempel/Karte/POI behalten.
#
# Formel (wichtig):
#   NICHT  adb uninstall / pm clear     → würde Stempel+Karte+DB löschen
#   SONDERN
#   1) assembleDebug (aktuellster Bundle, debuggable)
#   2) adb install -r -d               → Code ersetzt, Daten bleiben
#   3) run-as: cache + volatile JSON weg; Stempel/Profil/Memory/DB/Locks/Walk bleiben
#
# Usage:
#   powershell -File scripts/reinstall-fresh-keep-stamps.ps1
#   powershell -File scripts/reinstall-fresh-keep-stamps.ps1 -SkipBuild
#   powershell -File scripts/reinstall-fresh-keep-stamps.ps1 -Serial 00143157P001105
param(
    [string]$Serial = '',
    [switch]$SkipBuild,
    [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

$pkg = 'de.findus.app'

function Invoke-Adb {
    param([Parameter(Mandatory)][string[]]$Args)
    if ($Serial) {
        & adb -s $Serial @Args
    } else {
        & adb @Args
    }
}

$devices = @(& adb devices | Select-String "`tdevice$" | ForEach-Object {
    ($_ -split "`t")[0].Trim()
})
if ($devices.Count -eq 0) { throw 'Kein Gerät verbunden.' }
if (-not $Serial) { $Serial = $devices[0] }
Write-Host "Gerät: $Serial"

if (-not $SkipBuild) {
    if (-not $SkipFetch) {
        try { npm run fetch:espeak } catch { Write-Warning $_ }
        try { npm run generate:voice-assets } catch { Write-Warning $_ }
    }
    Write-Host 'assembleDebug…'
    Set-Location "$Root\android"
    $env:NODE_ENV = 'production'
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "assembleDebug failed ($LASTEXITCODE)" }
    Set-Location $Root
}

$apk = Get-ChildItem "$Root\android\app\build\outputs\apk\debug" -Filter '*.apk' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $apk) { throw 'Keine Debug-APK.' }
Write-Host "APK: $($apk.FullName) ($([math]::Round($apk.Length/1MB,1)) MB)"

Write-Host 'install -r…'
Invoke-Adb @('install', '-r', '-d', $apk.FullName)
if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }

Invoke-Adb @('shell', 'am', 'force-stop', $pkg)

Write-Host 'Wipe Cache + volatile JSON…'
Invoke-Adb @('shell', "run-as $pkg sh -c 'rm -rf cache/* code_cache/*'")
Invoke-Adb @(
    'shell',
    "run-as $pkg sh -c 'cd files; rm -f findus-pro-escalate-budget.json findus-gemini-billing.json findus-session-plan.json findus-open-questions.json findus-feature-tips.json findus-gps-track3.json findus-weather-cache.json findus-nightly-cache-sync.json findus-poi-drafts.json findus-shopping-tasks.json findus-hud-hint.json findus-mic-hint.json findus-voice-stats.json resource-usage-v1.json api-cost-ledger-v1.json cartesia-cost-v1.json findus-city-welcome.json findus-first-map-welcome.json findus-welcome-back.json dictionary_sync_meta.json'"
)
Invoke-Adb @('shell', "run-as $pkg sh -c 'cd files; rm -rf tts-cartesia tts-audio streetview-cache'")

Write-Host 'Verify KEEP…'
foreach ($f in @(
    'findus-stamp-passport-v1.json',
    'ueber-den-user.json',
    'findus-user-memory.json',
    'findus-poi-locks.json',
    'findus-walk-track.json'
)) {
    Invoke-Adb @('shell', "run-as $pkg ls files/$f")
}
Invoke-Adb @('shell', "run-as $pkg ls files/SQLite")

Invoke-Adb @('shell', 'monkey', '-p', $pkg, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Write-Host 'Fertig: neuer Code + frische Runtime-Caches; Stempel/Karte/DB behalten.' -ForegroundColor Green
