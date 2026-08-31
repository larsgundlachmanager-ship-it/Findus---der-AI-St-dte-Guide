# Regression Gate — Definition of Done

**Ship erst nach:** Implementierung aller Sprints A–D **und** grüner Gate-Liste.

## Automatisch (CI / lokal)

```bash
npm run test:regression-gate
```

Oder einzeln:

```bash
npm run test:turn-kernel
npm run test:tts-pipeline
npm run test:call-pipeline
npm run test:wiring-battery
npm run test:live-replay
npx --yes tsx src/module2/blueprints/ownerGold.smoke.test.ts
```

## Metriken (P50-Ziele)

| Metrik | Ziel |
|--------|------|
| `ttfa_bridge_ms` | < 800 ms nach STT-Final |
| `ttfa_call2_sentence_ms` | < bridge_end + 1500 ms |
| `silence_after_bridge_ms` | < 500 ms |
| `tap_choice_ack_ms` | < 400 ms |
| `call3_rate` | < 25 % der Turns |
| `bullet_trim_rate` | < 10 % |

## Manuelle Voice-Referenzturns (10)

Nach jedem Sprint mindestens diese Sätze am Gerät:

1. Navigiere mich zum Michel  
2. Wo bin ich gerade?  
3. Was geht heute Abend in Hamburg?  
4. Ich will Steak in der Nähe  
5. Fliege morgen nach Athen — wann muss ich am Flughafen sein?  
6. Aufgabegepäck oder Handgepäck? (Tap, kein Mic)  
7. Morgen 9 Uhr Hamburg — Frühstück, Michel, Pannfisch (Compound)  
8. Wie wird das Wetter — was anziehen?  
9. London am Wochenende planen (Pack-Check)  
10. Taxi zum Hotel  

## Turn-Checkliste (einzelner Turn)

- [ ] Bridge in Persona-Stimme, Key-1-Stream  
- [ ] Call 2 Prefill + Speech-Stream  
- [ ] Bullets aus Tail, max 3, im bulletMaxChars  
- [ ] Buttons aus Agents, nicht erfunden  
- [ ] Nav Say-Do wenn explicit  
- [ ] Call 3 nur bei followUp / Completeness  
- [ ] Keine zweite TTS-Session  
- [ ] Thread/memory gemäß topicScope  

## Bekannte Nicht-Ziele (v1)

- LTM Cloud-Sync  
- Gemini Pro  
- Embedding-Retrieval  
- Call-3-Speech während aktiver Session  
