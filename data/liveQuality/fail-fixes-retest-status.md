# Fail-Fixes Retest — Status 2026-08-29

## Code (fertig, Release-APK war installiert)

1. **SoftFail-UI** — Pitch mit 0 Optionen bleibt sichtbar (`LiveStage` + `PitchChoiceSlot`); Speech→Bullets bei SoftFail.
2. **Hauptbahnhof** — `expandBareHauptbahnhof.ts`: bare Hbf → regionaler Groß-Hbf (Prisdorf/GPS → Hamburg Hbf); verdrahtet in `resolveNavTarget`, `hardNavOverride`, `transitAdvisor`.
3. **Pass/Konsulat** — `docs`-Kind vor Orientierungs-`lost`; Places-Suche Konsulat/Botschaft; Early-Handoff in `runConciergeTurn`.
4. **Notfall Early** — Fuß/Zahn/SOS → `handleEmergencyConcierge` vor Chat-Lane.
5. **Wetter** — längerer Fetch + ehrlicher Fallback statt LLM „Keine Live-Wetterdaten…“.

Smokes: `expandBareHauptbahnhof.smoke` OK · `emergencyDetect.docs.smoke` OK.

## Retest

Gerät **offline** nach Install (`adb devices` leer). Tippfeld-Retest (11 Fails) war **Harness-Fail** (TIPPFELD_STUCK / NO_MODAL), nicht inhaltlich bewertbar.

**Bitte USB/Wireless-Debug wieder verbinden** — dann Retest:
`python scripts/deviceQa/_full_3week_live.py wetter vegan angus oepnv nav_fast_hbf fuss_notfall zahn pass_lost`
