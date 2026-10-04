# Call-1 Phone-Test — 2026-09-11

Metro :8081 · Ask-Server :8791 · `adb reverse` 8791+8081 · Bundle neu laden (App Vordergrund).

Ask tippen (PC):
```
curl -X POST http://127.0.0.1:8791/ask --data-binary "FRAGE"
```

## A — Orchestrator-Worker (neu)

| # | Frage | Erwartung | FAIL wenn |
|---|---|---|---|
| 1 | Wo waren wir gestern essen? | Memory-Recall / ehrlich wenn leer — **kein** neues Restaurant-Pitch | Frisch-Pitch „hier in der Nähe…“ |
| 2 | Flug nach Wangerooge buchen | Deep-Web: Optionen / ehrlich Charter — Button nur mit URL | Fake-Preise / Fake-Links |
| 3 | Was ist das? | Identify-nearby: naher Pack-Ort oder ehrlich kein GPS | Nav startet / falsche Stadt |
| 4 | Zeig den Michel auf der Karte | Map-Pin: Popup/Pin + optional Route | Nur Text, Karte unberührt |
| 5 | Stimme von Alina | Voice: Bestätigung Stimme | Settings-Vortrag / Ignorieren |
| 6 | Ich bin mit dem Fahrrad | Device: Rad-Modus bestätigt | Taxi/Fuß-Route erzwingen |
| 7 | Timer 3 Minuten und wie ist das Wetter? | Kombi: Timer **und** Wetter in einem Turn | Nur eins von beiden |
| 8 | Morgen dahin zum Michel | Premature: **keine** Sofort-Route | Navigation startet jetzt |
| 9 | Taxi zum Flughafen | AskBack / Blocker ohne Flugzeit | Sofort Taxi/Nav |

## B — Regression kurz

| # | Frage | Erwartung |
|---|---|---|
| 10 | SUP auf der Alster | Alster/Hamburg, nicht Prisdorf |
| 11 | Restaurant mit Terrasse in der Nähe | 1–2 Orte + Route/Speisekarte |
| 12 | Wie ist das Wetter gerade hier? | Wetter-Slots, kurz |

## Ablauf Agent

1. App offen, Mikro/Dev-Poller aktiv (__DEV__).
2. Pro Frage: POST /ask → 15–35 s warten → UI-Dump/Screenshot + Speech/Stichpunkte/Buttons.
3. FAIL → Fix (Gold/Code) → Retest max. 4×.
4. Logs: `adb logcat -d | findstr /i "call1Worker memory_recall deep_web identify map_pin voice"`
