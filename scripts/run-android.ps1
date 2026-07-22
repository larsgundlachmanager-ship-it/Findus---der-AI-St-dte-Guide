# Native Android-Build + Dev Client (setzt JAVA_HOME/SDK automatisch).
param(
    [int]$Port = 0,
    [string]$Device,
    [switch]$NoFetch
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

. "$PSScriptRoot\android-env.ps1"
Set-FindusAndroidEnv

if (-not $Port) {
    $Port = Get-FindusMetroPort
}

Write-Host "Metro-Port: $Port"

if (-not $NoFetch) {
    npm run fetch:kokoro
    npm run fetch:espeak
}

$args = @('expo', 'run:android', '--port', "$Port")
if ($Device) {
    $args += @('--device', $Device)
}

Write-Host "Starte: npx $($args -join ' ')"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& npx.cmd @args
$exit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($exit -ne 0) { exit $exit }
