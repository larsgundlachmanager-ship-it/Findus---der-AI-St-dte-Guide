# Repro mic→blackscreen with correct app pid logcat
$ErrorActionPreference = "Continue"
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$S = "00143157P001105"
$outDir = "C:\Users\larsf\Findus 2.0\.cursor\live6w"
$logPath = Join-Path $outDir "bs-repro-log2.txt"

& $adb -s $S shell am force-stop de.findus.app
Start-Sleep 1
& $adb -s $S logcat -c
& $adb -s $S shell am start -n de.findus.app/.MainActivity
Write-Host "waiting boot 18s..."
Start-Sleep 18

$appPid = (& $adb -s $S shell pidof de.findus.app).Trim()
Write-Host "appPid=$appPid"
if (-not $appPid) { throw "no app pid" }

Remove-Item $logPath -ErrorAction SilentlyContinue
$logProc = Start-Process -FilePath $adb -ArgumentList @(
  '-s', $S, 'logcat', '--pid', $appPid, '-v', 'threadtime'
) -RedirectStandardOutput $logPath -NoNewWindow -PassThru

# Wait for idle premount (~6s after splash) — already waited 18s
Write-Host "mic hold 5.5s..."
& $adb -s $S shell input swipe 540 1977 540 1977 5500

$blackAt = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep 1
  & $adb -s $S shell uiautomator dump /sdcard/bs-poll.xml 2>$null | Out-Null
  & $adb -s $S pull /sdcard/bs-poll.xml (Join-Path $outDir "bs-poll.xml") 2>$null | Out-Null
  $sz = (Get-Item (Join-Path $outDir "bs-poll.xml")).Length
  Write-Host "t=$i ui=$sz"
  if ($sz -lt 5000) {
    $blackAt = $i
    Write-Host "BLACK at t=$i"
    & $adb -s $S shell screencap -p /sdcard/bs-black.png
    & $adb -s $S pull /sdcard/bs-black.png (Join-Path $outDir "bs-black.png") | Out-Null
    break
  }
}

Start-Sleep 1
Stop-Process -Id $logProc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 1
Write-Host "logBytes=$((Get-Item $logPath).Length) blackAt=$blackAt"

# Dump interesting lines
Select-String -Path $logPath -Pattern "Error|Exception|FATAL|Uncaught|ReactNative|Hermes|TypeError|ReferenceError|voice|submit|stt|MapLibre|EGL|GL_|Surface|OOM|js global|Invariant|fabric|UIManager|ExpoSpeech|Cartesia|Audio|SoftException|SoLoader|libc|SIGSEGV|crash" |
  Select-Object -Last 80 | ForEach-Object { $_.Line }
