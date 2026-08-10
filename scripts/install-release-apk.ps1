# Installiert die neueste Release-APK (ohne Metro) auf dem verbundenen Gerät.
# Daten bleiben erhalten (install -r). Stempel/Profil/DB bleiben.
param(
    [string]$Serial = '',
    [switch]$Build,
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

if ($Build) {
    $fetch = if ($SkipFetch) { @('-SkipFetch') } else { @() }
    & powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\build-release-apk.ps1" @fetch
    if ($LASTEXITCODE -ne 0) { throw "Release-APK Build fehlgeschlagen ($LASTEXITCODE)" }
}

$apk = Get-ChildItem "$Root\android\app\build\outputs\apk\release" -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $apk) { throw 'Keine Release-APK. Zuerst: npm run build:android:release' }

Write-Host "APK: $($apk.FullName) ($([math]::Round($apk.Length/1MB,1)) MB)"
Write-Host 'install -r…'
Invoke-Adb @('install', '-r', '-d', $apk.FullName)
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'install -r fehlgeschlagen (oft Signatur-Konflikt Debug↔Release). Versuche Reinstall…'
    Invoke-Adb @('uninstall', $pkg)
    Invoke-Adb @('install', $apk.FullName)
    if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }
}

Invoke-Adb @('shell', 'am', 'force-stop', $pkg)
Invoke-Adb @('shell', 'monkey', '-p', $pkg, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Write-Host 'Fertig: Release-APK installiert (JS eingebettet, kein Metro nötig).' -ForegroundColor Green
Write-Host $apk.FullName
