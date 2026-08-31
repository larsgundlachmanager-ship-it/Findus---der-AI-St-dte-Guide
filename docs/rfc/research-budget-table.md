# researchBudgetSec — Hybrid-Tabelle (Code-Floor)

Backend berechnet:

```
baseSec = TABLE[lane][handoff][needsResearch]  // unten
deltaSec = clamp(call1.bridgeMeta.researchBudgetSec - baseSec, -2, +2)
finalSec = clamp(baseSec + deltaSec, 0, 12)
bridgeWords = clamp(8 + finalSec * 2.5, 12, 48)
call2EarliestMs = bridgeSpokenEndMs
call2LatestMs = bridgeSpokenEndMs + finalSec * 1000
```

## Tabelle `baseSec` (Sekunden)

| lane | handoff | needsResearch | baseSec |
|------|---------|---------------|---------|
| nav | m3_nav | * | 0–1 |
| m1 | m1_poi | quick | 1–2 |
| m1 | m1_poi | pack/deep | 3 |
| chat | none | quick | 2 |
| chat | none | pack | 4 |
| chat | none | deep | 8 |
| pitch | pitch | pack | 5 |
| pitch | pitch | deep | 7 |
| plan | m5_plan | * | 5 |
| plan | flight | * | 8 |
| pitch | tour | pack | 6 |
| * | reisebuero | * | 6 |
| chat | none + live_events BP | deep | 8–10 |

## Bridge-Pacing

| finalSec | pace | Bridge-Verhalten |
|----------|------|------------------|
| 0–2 | instant | 1 kurzer Satz, Say-Do parallel |
| 3–5 | standard | 1–2 Sätze, Bezug zum Wunsch |
| 6–12 | cover | 2–3 Sätze, füllt Recherche-Wartezeit |

**Wichtig:** Call 2 startet **nach Bridge-Ende**, nicht nach vollem Fanout. Fanout läuft parallel zur Bridge.

## Fanout-Cap (separat von Bridge)

| Stufe | Deadline | Abbruch |
|-------|----------|---------|
| Pack lokal | 800 ms | Web kill wenn hard match |
| Places/OSM | 1500 ms | — |
| Call-2-Minimum | bridgeEnd + finalSec | Best-Effort an Call 2 |
| Call 3 | bis 12 s Task-Cap | nur fehlende Slots |
