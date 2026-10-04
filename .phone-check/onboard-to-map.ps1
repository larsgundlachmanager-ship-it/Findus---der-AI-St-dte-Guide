# Onboarding bis Karte (Express, Gast-Pfad)
adb shell input tap 540 943
Start-Sleep -Seconds 3
# Vorname
adb shell input tap 200 520
Start-Sleep -Seconds 1
adb shell input text Test
Start-Sleep -Seconds 1
# Geschlecht: Keine Angabe (rechts)
adb shell input swipe 540 900 540 400 400
Start-Sleep -Seconds 1
adb shell input tap 900 750
Start-Sleep -Seconds 1
# Allergien: Keine
adb shell input tap 200 950
Start-Sleep -Seconds 1
# Scroll zu Persönlichkeit
adb shell input swipe 540 1200 540 300 500
Start-Sleep -Seconds 1
adb shell input swipe 540 1200 540 300 500
Start-Sleep -Seconds 1
# Erstes Golden-Preset (Mitte oben)
adb shell input tap 270 700
Start-Sleep -Seconds 2
adb shell input swipe 540 1400 540 200 600
Start-Sleep -Seconds 1
adb shell input swipe 540 1400 540 200 600
Start-Sleep -Seconds 1
# Stimme: erste in Liste
adb shell input tap 540 900
Start-Sleep -Seconds 2
adb shell input swipe 540 1400 540 200 600
Start-Sleep -Seconds 1
# Reisezweck chip
adb shell input tap 200 1100
Start-Sleep -Seconds 1
adb shell input tap 400 1100
Start-Sleep -Seconds 1
# Mobilität zu Fuß
adb shell input tap 200 1300
Start-Sleep -Seconds 1
# Energie mittel
adb shell input tap 540 1450
Start-Sleep -Seconds 1
# Budget
adb shell input tap 270 1600
Start-Sleep -Seconds 1
adb shell input swipe 540 1600 540 400 500
Start-Sleep -Seconds 1
# Stadt Prisdorf suchen / erste Stadt
adb shell input tap 540 1200
Start-Sleep -Seconds 2
adb shell input tap 540 1000
Start-Sleep -Seconds 2
# Weiter zur Erklärung
adb shell input swipe 540 1800 540 400 400
Start-Sleep -Seconds 1
adb shell input tap 540 2100
Start-Sleep -Seconds 3
# Intro überspringen / weiter
adb shell input tap 540 2180
Start-Sleep -Seconds 2
adb shell input tap 540 2180
Start-Sleep -Seconds 2
adb shell input tap 540 2050
Start-Sleep -Seconds 40
adb shell screencap -p /sdcard/map-v76-test.png
adb pull /sdcard/map-v76-test.png ".phone-check/map-v76-test.png"
