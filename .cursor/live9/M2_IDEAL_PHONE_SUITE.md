# Modul-2 Ideal — Phone-Suite + Live-Fail-Lock

Device: `de.findus.app` · Ask: `scripts/deviceQa/ask.mjs` · adb reverse 8791

## Live-Fail-Lock (muss grün)

1. „Ken Eat / all you can eat, kein Asiatisch“ → Dining/AYCE, **nicht** Events; **kein** Goldschätzchen ohne AYCE-Beleg
2. Specialty lokal leer → Expand ~100 km / Nachbarstadt
3. Follow-up gleiche Frage → Must halten, kein Lane-Drift
4. Speisekarte/Website/Maps vor „Web suchen“
5. Fuß-Profil/Speech → Route **nicht** still ÖPNV
6. Calendar/Timeline **nicht** auto bei Pitch
7. Museum/Hop-on → Just-Do-It Pitch, kein reines Ask-Back
8. Stichpunkte max 3 × 2 Zeilen / Char-Budget

## Ideal extra

- Hotel für heute · Taxi bestellen · Hop-on Tickets · Wetter-Slot

## Beweis

Logs + Screenshot pro FAIL; Retest max 4× nach Fix.
