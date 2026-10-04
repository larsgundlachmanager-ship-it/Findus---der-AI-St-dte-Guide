# Agent Harden Contract (kein Rewrite)

**SSOT für Masterplan „Härten + selbstständig werden“.**

## Darf / Darf nicht

| Darf | Darf nicht |
|---|---|
| Engines erweitern, Steals fixen, Compose für Multi-Need | Pitch / Flight / Reisebüro / Leave-by / Wetter / TTS / Turn-Kernel neu erfinden |
| Playbooks / Self-teach oben drauf | Jede novel Frage = neuer APK-Hardcode |
| Alte Smokes + Live-Quality grün halten | „Alles überwerfen“ für Agent-Gefühl |

## Bestehende Engines (nur erweitern)

- Pitch: `src/module2/pitch/runPitchModule.ts`
- Flight: `src/services/flights/flightTripAdvisor.ts`
- Reisebüro: `src/reisebuero/`
- Leave-by: `src/services/navigation/journeyLeaveBy.ts`
- Wetter/Outfit: `src/services/concierge/outfitWeatherPresent.ts`
- Lernen: `correctionLearning` / `betaSituationSync` / `ownerGold`
- Timeline: `plannedJourneyGroup` / `upsertFutureStopSafe`
- MultiStop: `src/services/navigation/multiStopTour.ts`

## Regression — Muss-grün vor/nach Phasen

| Suite | Command / Pfad |
|---|---|
| Live-Quality scenarios | `src/assets/data/liveQualityScenarios.v1.json` + `liveQualityHarness.ts` |
| Lübeck battery | `npm run test:luebeck-scenarios` |
| Regression gate | `npm run test:regression-gate` |
| Call1 / solo flight | `src/module2/router/soloFlightAb.smoke.test.ts`, `call1Dispatch.smoke.test.ts` |
| Turn kernel / TTS | `npm run test:turn-kernel`, `npm run test:tts-pipeline` (LOCK — nicht anfassen außer Batterie) |

## Compose-Ausnahme

Call1 bleibt „EIN Backend“ für Exclusive-Handoffs (`flight_only`, `trip_package`, `place_dining`, …).  
**Ausnahme:** `arrival_home` / `logistics_multi` → `task_fanout` + ComposeRunner, damit Geschwister-Worker nicht durch Early-Return sterben.

## P7 Latency / Bridge parallel

- Research-Tiers: `src/module2/router/call1ResearchTier.ts` — `instant` | `standard` | `cover` steuern Bridge-Länge und Parallel-Work.
- Bridge parallel (bestehend): `kickCall1ParallelWork` + `runConciergeTurn` — Recherche/Pitch/Nav parallel zur Call-1-TTS (`call1ParallelWork.smoke.test.ts`).
- Owner-Gold: neue Struktur-Blaupausen nur in `ownerGold.pack.json` (dish-verify / need / rain vs outfit) — kein Stadt-Hardcode.

## Self-teach

Novel Erfolg / Korrektur → Playbook-Candidate → Qualitätsgate → Cloud (Beta/Gold-Pfad) — **kein** Runtime-APK-Codegen.
