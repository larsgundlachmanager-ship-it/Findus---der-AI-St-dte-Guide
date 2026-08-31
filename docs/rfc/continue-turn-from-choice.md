# continueTurnFromChoice — Tap ohne Mic

## Ziel

User tippt Chip (Aufgabegepäck, Option 1, „Ja nimm Verleih“) — **kein** neues Mic, **kein** Call 1, Ack < 500 ms.

## API (Konzept)

```typescript
continueTurnFromChoice(input: {
  parentTurnId: string;
  choiceId: string;       // stabiler id, z.B. "baggage_checked"
  label: string;          // angezeigter Text
  slotKey: string;        // baggage_type | pitch_option | plan_fork | sup_own_vs_rent | generic_fork
  threadId: string;
  inventoryPatch?: Record<string, string | number | boolean | null>;
}): Promise<PipelineTurnResult>
```

## Flow

```
Tap
 → sofort Ack-TTS (~1 Satz, Lite, keine Bridge)
 → State patch (flight session, plan pending, live inventory, pitch fork)
 → Fanout mit gewähltem Slot / inheritInventoryOnTap
 → Call 2 (oder Modul-Continue) mit authorIntent: "User wählte: {label}"
 → presentToUi
```

## Wer liefert shortAnswers?

| Phase | Quelle |
|-------|--------|
| Labels | **Call 2 Tail** `shortAnswers[]` (SSOT) |
| Kandidaten | Modul/Pitch/Plan können `META.forkOptions` an Fanout liefern |
| Blocking | Call 1 `needsBlockingChoice` setzt `slotKey` + Roh-Optionen |

## Tap-Typen (aus Tests)

| slotKey | Beispiel | Nach Tap |
|---------|----------|----------|
| `baggage_type` | Aufgabe- vs. Handgepäck | Flight-Worker weiter |
| `pitch_option` | Option 1 / Option 2 | Nav oder URL für Gewähltes |
| `plan_fork` | Plan-Kalender-Zweig | `runPlanningModule` continue |
| `sup_own_vs_rent` | Eigenes Board / Verleih | activity_sport mit Wahl |
| `generic_fork` | Ja / Nein / Genau | liveInventory oder Handoff |

## UI

- Chips aus `shortAnswers` in Concierge-Card (wie `uiCardContract.buildUiCard`).
- Tap disabled während TTS/Nav-Start läuft (optional).
- Nach Tap: andere Chips ausblenden (wie Pitch nach Wahl).

## Nicht Call 3

Blocking-Choice ist **synchroner Fast-Path**, kein async Enrichment.
