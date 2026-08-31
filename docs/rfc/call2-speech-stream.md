# Call 2 — Speech Stream (Variante B)

## Ablauf

1. **Prefill:** Gemini `messages` endet mit Assistant-Turn = gesprochene Bridge + Leerzeichen.
2. **Stream:** Plain-Text, `responseJson: false`, `streamGeminiSentences` → Cartesia sofort.
3. **Tail:** Separater kurzer Call (oder SSE-Ende) → JSON laut `call2-tail-v1.schema.json`.

## System-Prompt (Sandwich)

**Oben:** Persona-Matrix (voll) + TTS-Hygiene (kein Markdown, Zahlen 1–12 als Wort, Euro als Wort).

**Mitte (User):** RUCKSACK, authorIntent, scoped history, FAKTEN-DRAFT, ACTIONS_IN, META, thinkAhead, ownerGoldHint, learnedRules.

**Unten (User, letzter Satz):**
> Formuliere die Fortsetzung als Fließtext zum Vorlesen. Max. {speechBudgetChars} Zeichen. Kein Markdown. Bullets kommen danach separat.

## Assistant-Prefill

```
[
  { "role": "user", "parts": [{ "text": "<userPrompt ohne bridge>" }] },
  { "role": "model", "parts": [{ "text": "<bridgeOnce> " }] }
]
```

Call 2 setzt grammatikalisch fort — kein Meta „Beat 2“ im Prompt.

## Bullets (Hybrid)

| Priorität | Quelle |
|-----------|--------|
| 1 | Tail `bullets[]` (Gemini) |
| 2 | Agent `fact.bullets[]` wenn Tail leer |
| 3 | Nie `deriveMemoryBullets` als Standard |

Backend: `clampVisualBullets(speech, bullets, bulletMaxChars)` — Speech-Gate, keine Adresse.

## Call 3 Trigger aus Tail

`followUp.needed === true` && `delegateTo === "call3"` → async Enrichment.

## skipLlm (kein Call 2)

Nav committed, pitchModule, system/liveChat, memory handoff mit fertiger Antwort — unverändert.
