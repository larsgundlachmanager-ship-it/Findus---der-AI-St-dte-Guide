# Gap Closures — Ergänzungen aus Test-Suites

Diese Punkte ergänzen die RFC-Schemas und sind **Pflicht** bei Implementierung.

---

## 1. background_tasks (Wecker / Timer / Erinnerung)

**Tests:** `liveReplay` `wecker-explicit`, Plan-Compound mit Wecker, `wakeIntentDetect`.

**Vertrag:**
- Call 2 Tail optional `background_tasks[]` (siehe `call2-tail-v1.schema.json`).
- Backend führt aus (`SET_NATIVE_ALARM`, `SET_TIMER`, `SET_DEPARTURE_REMINDER`) **bevor** Speech „Wecker ist gestellt“ sagt.
- Speech ohne erfolgreichen Task → verboten (wie `FINDUS_JUST_DO_IT_BLOCK`).

---

## 2. correctionLearning + Owner-Gold

**Tests:** Founder-Feedback, `ownerGold.pack.json`, `wiringBattery` Just-Do-It.

**Vertrag:**
- Rucksack `learnedRules[]` — aus `correctionLearning` (dieses Profil).
- Rucksack `ownerGoldHint` — aus `ownerGold` via `intentFamily` aus `classifyJob`.
- Call 2 System: beide als Struktur-Constraints (`expect`/`avoid`), keine Scripts.
- Owner-Gold publish: `npm run gold:publish` unverändert.

---

## 3. Reisebüro-Handoff

**Tests:** `reisebuero.smoke.test.ts`, `runConciergeTurn` flight/reisebuero paths.

**Vertrag:**
- Call 1 `handoff: "reisebuero"` oder `work.worker: "reisebuero"`.
- Exec: bestehender Reisebüro-Pfad in `runConciergeTurn` — kein Call 2 wenn fertige Antwort.
- `researchBudgetSec` base ≈ 6 s (siehe Tabelle).

---

## 4. Buchungsportal-Hard-Match

**Tests:** Mietrad, Stay22, `bookingPlatformActions`, `wiringBattery` hotel cases.

**Vertrag:**
- Call 1: `bookingPlatformHint` + `mustHaves[]` wenn Portal genannt.
- Fanout: `OPEN_URL` in derselben Antwort wenn URL belegt.
- Call 3 nur wenn `followUp.reason === "booking_deeplink"` und URL fehlt nach Fanout-Cap.

---

## 5. Fest ≠ Laden (Weinfest vs. Weinhandlung)

**Tests:** Owner-Gold `events`, Masterbook Event-Regeln.

**Vertrag:**
- Call 1: `festTypeHint` + `blueprintId: live_events` bei Fest-Fragen.
- `lane=pitch` nur wenn echte Venue/Programm-Recherche — nicht Weinhandlung als „Fest“.
- Zeit-Ehrlichkeit: laufende Tagesfeste vs. zeitgenaue Starts (Kino/Konzert).

---

## 6. Live-Inventar-Erbe (Follow-ups)

**Tests:** `wiringBattery` FOLLOW_CASES (ja, wie teuer, wann geht's los).

**Vertrag:**
- Call 1: `topicScope.inheritLiveInventory: true` bei kurzem Follow-up auf gleichen Auftrag.
- Backend: `resolveLiveInventoryUserText` + `noteLastLiveInventory` **vor** Fanout.
- Steak → Center Parc: `inheritLiveInventory: false`, `turnsForCall2: 0`.

---

## 7. continueTurnFromChoice — alle Taps, nicht nur Gepäck

**Tests:** `ja-nimm-verleih`, `ja-after-sup`, `f01–f20` Follow cases, Pitch Option 1/2.

**Vertrag:** siehe `continue-turn-from-choice.md`.

Slot-Keys: `baggage_type`, `pitch_option`, `plan_fork`, `sup_own_vs_rent`, `generic_fork`.

---

## 8. Chat-Lane (eigener Pfad)

**Tests:** `chatFirst.smoke`, `chatLaneMeta`, Wetter/Papst/Himmel.

**Vertrag:**
- Call 1 `lane=chat`, `handoff=none`, kein `nextHandoff` → `runChatLane` → eigenes `{speech, bullets}`.
- Kein Call-2-Tail; Bullets aus Chat-Lane-LLM + gleicher `clampVisualBullets`.
- `nextHandoff=pitch|events` → weiter in Fanout/Call 2.

---

## 9. LTM v1 (lokal)

**Kosten:** 0 € Cloud; ~50–300 KB/Device; Retrieval <5 ms.

**Schema:** Tabelle `user_memory_facts` (subject, city_key, facts_json, tags_json, tokens, timestamps).

**Schreiben:** Call-2-Tail `memory_extract[]`.

**Lesen:** Call 1 `memoryPolicy.longTerm` → keyword match → `rucksack.retrievedMemory`.

---

## 10. bulletMaxChars — 1× täglich

**Vertrag:**
- `BulletsSlot` onLayout → `estimateBulletMaxChars` → AsyncStorage/Profil.
- Refresh: 1×/Tag oder Orientation-Change.
- An Call 2: `BULLET_BUDGET: 3 × max {bulletMaxChars}`.

---

## 11. Stadt-Pack ohne UI-Auswahl

**Tests:** `planDestinationCity`, `cityPackOffer`, London-in-Hamburg.

**Vertrag:**
- `researchCity` aus Text/Plan, nicht `selectedCityId`.
- `packPolicy`: use_local | require_download | live_bootstrap.
- `selectedCityId` nur M1-Geofence.

---

## 12. TTS / Kernel — nicht anfassen

**CI:** `npm run test:turn-kernel`, `npm run test:tts-pipeline`.

Eine TTS-Session pro Turn; Bridge + Call 2 same queue (`fusedTurnSpeech`).
