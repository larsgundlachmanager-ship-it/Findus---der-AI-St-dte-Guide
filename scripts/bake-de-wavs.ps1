# Generates bootstrap German WAVs for Findus onboarding (intro + voice samples).
# Uses Windows SAPI so the APK has instant audio before Kokoro finishes downloading.
# Later these can be replaced with Kokoro-Martin baked WAVs.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$outDir = Join-Path $PSScriptRoot "..\assets\tts\de"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Speak-ToWav([string]$text, [string]$path, [double]$rate = 0) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.Rate = [int][Math]::Max(-5, [Math]::Min(5, [Math]::Round($rate)))
    # Prefer a German voice if installed
    $de = $synth.GetInstalledVoices() | Where-Object {
      $_.Enabled -and $_.VoiceInfo.Culture.Name -like "de*"
    } | Select-Object -First 1
    if ($de) {
      $synth.SelectVoice($de.VoiceInfo.Name)
    }
    if (Test-Path $path) { Remove-Item $path -Force }
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($text)
  } finally {
    $synth.Dispose()
  }
  $len = (Get-Item $path).Length
  Write-Host "OK $path ($len bytes)"
}

$head = "Hallo und herzlich willkommen. Ich bin Findus."
$body = "Ich bin kein normaler Audioguide, der einfach nur Texte vorliest. Ich bin das, was du aus mir machst. Gleich darfst du entscheiden, wie ich klingen soll, ob als weiser Historiker, als lockerer Kumpel oder als die gute Seele des Ortes. Lass uns gemeinsam dein Profil anlegen, damit ich dir die Stadt genauso erklären kann, wie es perfekt zu dir passt. Ich freue mich auf dich."

Speak-ToWav $head (Join-Path $outDir "intro-head.wav") 0
Speak-ToWav $body (Join-Path $outDir "intro-body.wav") 0

$samples = @{
  "martin" = "Hallo, ich bin Martin — die Standardstimme von Findus. Klar, warm und gut verständlich. Ich begleite dich ruhig durch die Stadt."
  "historiker" = "Guten Tag. Ich bin der Historiker. Mit Bedacht und Respekt erzähle ich von Menschen, Orten und Jahrhunderten."
  "erzaehler" = "Ich bin der Erzähler. Stell dir vor, die Straßen sind Seiten und wir blättern gemeinsam."
  "genz" = "Yo, ich bin so Gen-Z Vibes. Kurz, ehrlich, ohne Beamtendeutsch."
  "aufgedreht" = "Heyyy! Ich bin die aufgedrehte Stimme! Energie, Tempo, große Augen!"
  "ruhig" = "Ich bin ruhig und besonnen. Langsam atmen. Die Stadt kommt zu dir."
  "weiblich" = "Hallo, ich spreche mit einer weiblichen Stimme — offen, nahbar und mit einem Lächeln."
  "maennlich" = "Moin. Männliche Stimme, klar und bodenständig. Ich erkläre dir die Stadt ohne Schnörkel."
  "neutral" = "Ich bin die neutrale Stimme. Sachlich, ausgewogen, ohne Drama."
  "prinzessin" = "Seid gegrüßt! Ich bin die Prinzessin. Sanft, ein wenig märchenhaft und trotzdem ehrlich."
}

foreach ($key in $samples.Keys) {
  Speak-ToWav $samples[$key] (Join-Path $outDir "sample-$key.wav") 0
}

Write-Host "Done. Files in $outDir"
Get-ChildItem $outDir | Format-Table Name, Length
