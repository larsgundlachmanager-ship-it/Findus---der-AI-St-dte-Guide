# Modul 1 — Prompt Preview (SSOT Review)

Implementierung: `src/services/ai/module1PromptBuilders.ts` · `src/services/ai/module1PoiChat.ts`

Few-Shot-Disclaimer: Abstrakte Blaupausen — Wortlaut frei, Struktur bindend.

## Ablauf

1. **systemInstruction** einmal pro POI-Chat (Persona, Hartregeln)
2. **Turn 1 (Wegweiser/Direkt-Arrival):** voller Datensatz + Aufgabe + Code-`lookPhrase`
3. **Folge-Turns:** nur neue Anweisung (Arrival / Mehr Historie / Rückfrage)

## lookPhrase

Berechnet in `src/services/navigation/module1Facing.ts` (nicht von Gemini).  
Bänder: 0–20° vorne · 20–45° leicht L/R · 45–100° L/R · 100–150° weiter drehen · >150° Skip.

## Prompts

Die exakten Strings baut `module1PromptBuilders.ts`:

| Turn | Builder |
|------|---------|
| System | `buildModule1SystemInstruction` (+ Master-Prompt) |
| Wegweiser Seed | `buildModule1SeedUserMessage(..., mode: 'approach')` |
| Direkt-Arrival Seed | `buildModule1SeedUserMessage(..., mode: 'arrival')` |
| Hauptstory | `buildModule1ArrivalInstruction` |
| Mehr Historie | `buildModule1DeepInstruction` |
| Rückfrage | `buildModule1FollowupInstruction` |

## FAQ-Lernen (Code, nicht Speech-Prompt)

- `src/services/memory/module1FaqLearn.ts`
- Verifizierte Recherche → sofort speichern + Community-Sync
- must_say / fett ab **3** verschiedenen Usern
- Geschmacksprofile steuern erst ab **150 User × 15 Fragen** (`tasteProfilesUnlocked`)

## Dev

`[module1PoiChat] mode=… preview=…` in __DEV__
