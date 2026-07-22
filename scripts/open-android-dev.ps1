# Startet Metro (falls nötig) und öffnet Findus im Dev Client mit JS-Bundle.
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

$adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb nicht gefunden: $adb" }

$metroPort = Get-FindusMetroPort

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -match '^192\.168\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $ip) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' } |
    Select-Object -First 1 -ExpandProperty IPAddress)
}

if (-not $ip) { throw 'Keine LAN-IP gefunden.' }

$bundleUrl = "http://${ip}:${metroPort}?disableOnboarding=1"
$encoded = [uri]::EscapeDataString($bundleUrl)
$deepLink = "exp+findus://expo-development-client/?url=$encoded"

Write-Host "Metro-Bundle: $bundleUrl"
& $adb shell am start -a android.intent.action.VIEW -d $deepLink -n com.finnus.app/.MainActivity | Out-Null
Write-Host "Findus geöffnet."
