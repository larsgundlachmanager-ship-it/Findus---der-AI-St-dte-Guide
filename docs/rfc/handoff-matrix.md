# Modul-Handoff-Matrix v1.0

Call 1 setzt `lane` + `handoff` + `work[]`. Backend führt aus — Call 2 formuliert nur wenn nicht `skipLlm`.

## Legende

| Symbol | Bedeutung |
|--------|-----------|
| C1 | Call 1 entscheidet |
| Exec | Parallel zur Bridge |
| C2 | Call 2 Speech + Tail |
| C3 | Async nur bei fehlenden Slots |
| Skip | Kein Call 2 |
| Chat | `runChatLane` eigener Pfad |

---

## Hauptmatrix

| # | Beispiel | lane | handoff | work | Exec | C2 | C3 | Pack |
|---|----------|------|---------|------|------|----|----|------|
| 1 | Navigiere zum Michel | nav | m3_nav | nav | commitHandsFreeNavStart | Kurz ETA | — | GPS |
| 2 | Wo bin ich? | m1 | m1_poi | m1 | GPS + pack lookup | M1-Ton | — | lokal |
| 3 | Was geht heute Abend HH? | pitch | pitch | events | web_events | Hiebsatz 2 Opt | Programm | HH cached |
| 4 | Steak in der Nähe | pitch | pitch | dining | places+pack race | Venues | menu_prices | lokal |
| 5 | Flug morgen Athen | plan/chat | flight | flight | flightBoardJob | Leave-by | security | — |
| 6 | Aufgabe- oder Handgepäck? | plan | flight | flight | await choice | shortAnswers Tail | — | — |
| 7 | Montag HH: Elbphi + Essen | plan | m5_plan | plan,dining | runPlanningModule | Tages-Summary | — | HH |
| 8 | Wie wird das Wetter? | chat | none | chat | weather | **Chat** | — | — |
| 9 | Wie alt ist der Papst? | chat | none | chat | knowledge | **Chat** | — | optional |
| 10 | Tour / Rundgang | pitch | tour | tour | runTourModule | Stopps | — | lokal |
| 11 | Hotel heute Nacht | pitch | pitch | hotel | Stay22 | 2 Opt + Preis | live price | cityScope |
| 12 | Taxi zum Hotel | nav | m3_nav | taxi | Uber+Tel | Commit | live fare | — |
| 13 | London planen (in HH) | plan | m5_plan | plan | London pack | Plan speech | — | require_dl if missing |
| 14 | New York (kein Katalog) | chat | none | chat | live_bootstrap | Web+inbox | Pack build | bootstrap |
| 15 | Wecker 7 + Café + Wetter | plan | none | plan,chat | parallel | splitPlan 1→2 | — | — |
| 16 | Pitch Option 1/2 | pitch | pitch | — | pendingChoice | shortAnswers | — | — |
| 17 | Mehr Historie POI | m1 | m1_poi | m1 deep | wiki depth | deep 2000 | — | lokal |
| 18 | Reisebüro / Pauschal | plan | reisebuero | reisebuero | reisebuero module | Skip wenn fertig | — | — |
| 19 | Mietrad über Portal X | pitch/nav | pitch | mobility | booking URL | OPEN_URL | booking_dl | — |
| 20 | Weinfest heute | pitch | pitch | events | web_events festType | 2 Feste | PDF | — |
| 21 | SUP eigen vs Verleih | pitch | pitch | activity | fork | shortAnswers | — | — |
| 22 | Ja / wie teuer (Hotel) | pitch | none | — | liveInventory | C2 follow | — | inherited |
| 23 | Compound Hamburg-Tag | plan | none* | multi | call1OwnsCompound | weave + split | menu | HH |
| 24 | Sonnenuntergang + Essen | pitch | pitch | dining+weather | parallel | woven | — | — |
| 25 | Nächste S-Bahn | chat/nav | none | transit | transit_live | C2 or Chat | — | — |
| 26 | Picknick + Wetter | pitch | pitch | activity | weather+places | ownerGold picnic | — | — |
| 27 | Ferry / Bergbahn Ticket | plan | none | transit | ticketed_access | transit+URL | — | — |
| 28 | Affiliate Ja (Hotel) | pitch | none | — | handleQuickAction | Skip/kurz | — | — |
| 29 | Erinner mich um 15 Uhr | plan/chat | none | — | alarm task | C2 + background_tasks | — | — |
| 30 | Bring mich da hin | nav | m3_nav | nav | anchor resolve | Nav | — | shortIntent |

\* Compound: `call1OwnsCompoundTurn` — kein exclusive M5 steal, `weaveDayPlan: true`.

---

## Exec-Pfad (Code)

```
Call 1 JSON
  ├─ handoff=m5_plan     → runPlanningModule
  ├─ handoff=pitch       → runPitchModule
  ├─ handoff=tour        → runTourModule
  ├─ handoff=m1_poi      → buildM1PoiOffer / M1 chat
  ├─ handoff=m3_nav      → hardNav / amenityNav / commitHandsFreeNavStart
  ├─ handoff=flight      → flightBoardJob (frame worker)
  ├─ handoff=memory      → handleMemoryIntent
  ├─ handoff=reisebuero  → reisebuero handoff (runConciergeTurn)
  ├─ lane=chat, handoff=none, no nextHandoff → runChatLane
  └─ else                → runManagerTaskFanout → Call 2
```

## skipLlm → kein Call 2

- Nav committed + coordinates
- pitchModule finished speech
- system / liveChat trigger
- memory / reisebuero mit fertiger Antwort
- affiliate quick action only

## Owner-Gold / Blueprints

Call 2 erhält `ownerGoldHint` aus `intentFamily`:

| intentFamily | Trigger |
|--------------|---------|
| dining | dining_*, gastro |
| navigation | taxi, airport |
| general | weather |
| activity_poi | picknick, outdoor |
| planning | day_plan, flight, leave_by, ticketed_access |
| events | tonight, cinema, fest |

## Goldene Tests (müssen grün bleiben)

- `wiringBattery.cases` — 55 jobs + 20 follows
- `liveReplay.cases` — ~30 situations
- `hamburgCompound.smoke.test.ts`
- `ownerGold.smoke.test.ts`
