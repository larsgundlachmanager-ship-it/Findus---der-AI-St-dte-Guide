# Yorro Turn-Architektur RFC (v2.1)

Spezifikation für Call 1 → Fanout → Call 2 → Call 3. **Implementierung folgt diesen RFCs**; vor Release: Regression-Gate (siehe `regression-gate.md`).

## Entscheidungen (final)

| Thema | Entscheidung |
|--------|--------------|
| Modell | Immer **Gemini Lite** (Call 1, 2, 3, M1 Deep) |
| Bullets | **Hybrid**: Call-2-Tail primär, Agent-Fallback, Backend validiert |
| Call-2-Speech | **Variante B**: Plain-Text-Stream, danach JSON-Tail |
| Historie | Max **10** Turn-Paare; Call 1 wählt **0–10** für Call 2 |
| `researchBudgetSec` | **Hybrid**: Code-Tabelle + LLM ±2 s |
| `shortAnswers` | **Call 2 Tail** |
| Chat-Lane | **Eigener Pfad** (kein Call 2) |
| Call 3 | **Nur bei Bedarf**; UI-first, Speech nur idle |
| LTM v1 | **Keyword + subject**, nur lokal |
| `bulletMaxChars` | **1× täglich** messen, im Rucksack |

## Dateien

| Datei | Inhalt |
|--------|--------|
| [call1-output-v1.schema.json](./call1-output-v1.schema.json) | Call-1 Router JSON |
| [call2-speech-stream.md](./call2-speech-stream.md) | Variante B: Speech + Tail |
| [call2-tail-v1.schema.json](./call2-tail-v1.schema.json) | Post-Speech JSON |
| [turn-rucksack-v1.schema.json](./turn-rucksack-v1.schema.json) | Basisrucksack pro Turn |
| [research-budget-table.md](./research-budget-table.md) | Code-Floor für Bridge-Pacing |
| [handoff-matrix.md](./handoff-matrix.md) | Lane × Handoff × Exec |
| [gap-closures.md](./gap-closures.md) | Ergänzungen aus Test-Suites |
| [continue-turn-from-choice.md](./continue-turn-from-choice.md) | Tap ohne Mic |
| [regression-gate.md](./regression-gate.md) | Definition of Done vor Ship |

## Implementierungs-Reihenfolge

1. **Sprint A** — Call-1 bridge-first stream, researchBudget hybrid, Fanout race  
2. **Sprint B** — Call 2 Variante B, Prefill, Hybrid-Bullets, `continueTurnFromChoice`  
3. **Sprint C** — LTM lokal, Call 3 Card-Patch, topicScope  
4. **Sprint D** — Modul-Härtung, splitPlan, Regression voll  

**Ship-Kriterium:** `regression-gate.md` grün + manuelle Voice-Referenzturns.
