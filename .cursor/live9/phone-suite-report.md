# Phone-Suite Ergebnis (nach Code-Fertigstellung)

## Code / Smokes
15 Ideal-Smokes grün (Open-World, Live-Fail-Lock, Learn, Leftover-Audit, AYCE, Dispatch, …).

## Phone 2026-09-11
- Ask-Server queue: OK (`queued:1`)
- Device + Metro :8081 + Ask :8791: OK
- AYCE-Ask UI-Dump: **kein neues Goldschätzchen** im frischen Home-Dump (PASS `ayce_no_goldsch`)
- Timeline zeigt **alte** Goldschätzchen-/ÖPNV-Stops aus früherer Session (Accordion löschen = out of scope) — verfälscht Hotel-UI-Heuristik (FAIL `hotel_ui` = Noise, kein Beweis für Soft-Fill)
- RN/JS-Logcat ohne Treffer (Release-Build oder Log-Tag still) — Speech/Lane nicht aus Logs beweisbar
- `adb input text RR` Reload unsicher

## Offen für harten Phone-Done-Gate
1. App im Vordergrund mit Metro-Reload (Shake → Reload) damit Ideal-JS live ist  
2. Timeline-Altlast manuell weg oder Live-Pitch-Panel prüfen  
3. AYCE erneut → Speech + Speisekarte-Buttons + kein Events-Lane

Bis dahin: **Code Ideal umgesetzt + Smokes grün**; Phone Live-Fail nur teilweise beweisbar.
