# Chrome Instant Boot — Plan (Mic / Settings / Timeline / Zurück / Orte)

**Ziel:** Ab dem Moment, in dem der Splash-Vorhang öffnet (`onInteractive`), sind **Mic, Dock (Timeline/Orte/Einstellungen), Zurück** immer tippbar — ≤1 Frame Feedback, nie „tot“. Orte-Icons so früh wie möglich, ohne Chrome zu erdrücken.

**Kurzantwort:** Technisch geht das. Es ist kein RN-Limit. Heute blockiert der **JS-Thread** (Karte/Hydrate/erster Overlay-Mount), nicht ein „Mic aus“-Flag.

---

## Was der User spürt

| Symptom | Typische Ursache |
|---|---|
| Mic reagiert nicht nach App-Start | JS-Thread voll → Press-In kommt nicht an / wird verzögert |
| Einstellungen ~3 s bis sichtbar | Settings rendert bei `!visible` → `null` → **Kaltstart** beim ersten Tap |
| Timeline ähnlich träge | Gleiches Muster (`return null` wenn geschlossen) |
| Zurück „tot“ | Gleiche JS-Starvation; Gate parkt Laden erst *nach* dem Tap |
| Orte spät / Tap unzuverlässig | Places hinter 10 s Polish-Grace *oder* Paint friert Touch ein |

---

## Architektur heute (was schon richtig ist)

```
Lane C Chrome  → immer frei (Gate: mic | overlays | mapCore)
Lane B Voice   → Mic Press-In setzt Listening sync + noteMicActive
Lane A Map     → LightPins / Polish / Idle / Hydrate hinter Gate
```

- SSOT: `src/services/boot/interactiveBootGate.ts`
- Vertrag: `npx tsx src/services/ui/uiInstant.smoke.test.ts`
- Splash: `blockTouches=false` + `markSplashInteractive` schon beim **Vorhang-Start** (nicht erst nach Curtain-Ende)
- Dock: `onPressIn` öffnet Chrome (wie Mic)
- zIndex: `placePopup < hud < sheet < overlay` — Popup darf Mic/Dock nicht fressen

**Problem:** Das Gate stoppt nur *wartende* Jobs. Sync-Arbeit, die **ohne Gate** auf dem JS-Thread läuft, lässt Touch-Events trotzdem liegen.

---

## Warum es stört (Root Causes)

### 1. JS-Thread-Starvation (Hauptursache Mic/Zurück)

Unter/direkt nach Splash laufen schwere Jobs parallel zum Chrome:

- MapView + Protomaps-Style unter dem Vorhang
- `listLocalCityDatasets` / `registerCoverageFromLocalPacks` (HomePresenceMap Boot)
- Post-Splash-Leiter: LightPins → Places-Paint → Fog → Neighbor-Warm  
  (`homeMapBootSchedule.ts`: Places erst nach `MAP_POLISH_TOUCH_GRACE_MS` = **10 s**)
- Idle-Prefetch Heavy nach Settle (Pin-Index, VisitLog)

Solange eine Sync-Schleife den Thread hält, **reagiert kein Pressable** — egal wie hoch die Priorität im Gate ist.

### 2. Settings/Timeline = Fake-Premount (Hauptursache „3 Sekunden“)

- Host setzt `settingsMounted` / `calendarMounted` (Premount-Flag).
- `SettingsScreen` / `PlanCalendarModal` machen bei `!visible` bewusst **`return null`**  
  (Fix gegen Android Fabric SoftException / Blackscreen bei `absoluteFill` + `display:none`).
- Erster Tap = voller Native-Tree-Mount + Accordion-Hydrate → spürbar 1–3 s.

Premount lädt heute nur Bundles früh; der **sichtbare Chrome-Shell** fehlt im RAM.

### 3. Interactive Window vs. Orte-Wunsch

- 10 s Grace: Pan/Mic geschützt, Orte erscheinen spät.
- User will Orte ≈ innerhalb 5 s nach Splash tippbar.
- Wenn Orte zu früh als Mega-ShapeSource kommen → wieder Mic tot.

→ Braucht **leichte Pins früh**, **schwere Paint später**, nie Sync-Clip im Hot-Path.

### 4. Was *nicht* die Ursache ist

- Gate „sperrt Mic“ — nein (`isLaneFree('mic'|'overlays'|'mapCore')` immer true).
- „RN kann das nicht“ — doch; Touch braucht freie JS-Frames.
- Kernel / TTS-Pipeline — falsche Baustelle (Performance-Lanes-LOCK).

---

## Soll-Vertrag (messbar)

Ab `markSplashInteractive()`:

| Aktion | Soll |
|---|---|
| Mic Press-In | ≤ 1 Frame rot/Listening; Map-Polish bleibt geparkt |
| Dock Settings/Timeline/Orte | Overlay-Chrome ≤ 1 Frame sichtbar (Shell), Body nachziehbar |
| Android Zurück | sofort; `noteChromePriority` + Overlay-Close ohne Warten auf Map |
| Orte-Icons tippbar | Light-Pins ≤ ~1–1,5 s; volle Polish erst wenn Chrome idle |
| Nie | Sync-JSON / volles Places-Inject während Mic/Overlay/Zurück |

Smoke erweitern (`uiInstant.smoke.test.ts` + optional Device-QA-Timing).

---

## Plan — in Phasen (ohne Kernel/TTS/zweites Map-System)

### Phase A — Diagnose (1 Session, Gerät)

1. Dev-Log `[boot-gate]` + einfache Tap→Feedback-Timestamps (Mic / Settings).
2. Messen: Zeit Splash-Interactive → erster Mic-Response; Settings-Tap → Shell sichtbar.
3. Identifizieren: welcher Job den Thread hält (Places inject? Coverage parse? Settings mount?).

### Phase B — Chrome wirklich warm (Settings/Timeline „3 s“ weg)

**Ziel:** Tap = nur Visibility, kein Kaltstart.

1. **Chrome-Shell Premount** unter Splash (nach Map-Core, vor Lift):
   - Nur dünne Shell (Backdrop + Header + leerer Scroll) dauerhaft gemountet, `visible=false` ohne Fullscreen-`absoluteFill`-Tree.
   - Accordion-Bodies weiter lazy (`chromeReady` / `timelineBodyReady`) — wie heute Frame-0, aber Shell schon da.
2. Fabric-Blackscreen-Fix **behalten**: kein `display:none` auf riesigem absoluteFill; Shell ohne schweren Body.
3. Premount-Timing: unter Splash parallel zu Style-Warmup, **nicht** 160 ms nach Interactive in die Map-Leiter reinballern.
4. Erster Settings-Open: sichtbare Shell ≤1 Frame; Inhalt in nächsten 1–2 Frames (akzeptabel), nicht 3 s Schwarz/Warten.

Dateien: `SettingsScreen.tsx`, `PlanCalendarModal.tsx`, `idlePrefetch.ts`, `HomeOverlayHost.tsx`, `useHomeOverlayStore.ts`.

### Phase C — JS-Thread schützen (Mic/Zurück immer)

1. Alles Schwere weiter nur über Gate; Audit: Boot-Pfade die **ohne** `runMap*WhenFree` / Yields laufen.
2. `registerCoverageFromLocalPacks` / Pack-Listen: kleiner Chunk + Yield; unter Splash nur **1 Stadt**.
3. Places: **Light-Pins früh** (~1 s), volles `injectPlacesOnly` erst wenn `!chromeHoldsLoad()` und nach kurzem Quiet nach Finger.
4. Polish-Grace von 10 s **nicht** blind kürzen — nur Light-Pins vorziehen; volle Paint hinter Chrome.
5. Failsafe prüfen: nichts darf Hydrate wieder anwerfen, solange Mic/Overlay/Zurück aktiv (`chromeHoldsLoad`).

Dateien: `interactiveBootGate.ts`, `HomePresenceMap.tsx`, `homeMapBootSchedule.ts`, `fogTrackEngine.ts`.

### Phase D — Splash als Vorbereitung (deine 5 s Frage)

**Ja — Splash kann die 5 s nutzen**, damit danach Chrome sofort geht:

| Unter Splash (≤5 s Cap) | Nach Interactive |
|---|---|
| Protomaps-Style + Map core render | Mic/Dock sofort tippbar |
| GPS seed / last-known | Light-Pins (~1 s) |
| Voice-Buffer + Mic-Pipeline warm | Settings/Timeline-Shell schon gemountet |
| Bundle-Import Settings/Timeline | Volle Orte + Fog + Neighbor idle |
| Chrome-Shell premount (dünn) | Heavy hydrate erst nach Window |

Splash hebt weiter bei First-Look **oder** Hard-Cap 5 s — unverändert.  
Neu: unter dem Vorhang **Chrome vorbereiten**, nicht nur die Karte.

### Phase E — Orte tippbar ohne Mic zu töten

1. Light-Pin-Index warm unter Splash / +1 s.
2. Tap auf Pin: Skeleton-Popup sofort (schon da); Enrich async.
3. Kein Mega-Reinject bei Pan im Interactive Window.
4. Place-Popup zIndex/Backdrop: nie über Dock/Mic (bereits Regel — Regression-Smoke halten).

---

## Reihenfolge / Risiko

| Prio | Arbeit | Risiko | Nutzen |
|---|---|---|---|
| 1 | Settings/Timeline echte Shell-Premount | Mittel (Fabric) | 3 s Settings weg |
| 2 | Boot-Jobs chunked + Audit ungated Sync | Niedrig | Mic/Zurück stabil |
| 3 | Light-Pins vor voller Places-Paint | Niedrig | Orte früher |
| 4 | Splash: Shell+Voice parallel Map-Core | Mittel | Instant nach Vorhang |
| 5 | Device-QA Timings + Smoke-Asserts | Niedrig | Regression-Schutz |

**Nicht anfassen:** Kernel, TTS-Pipeline, zweites Map-System, Pflicht-Sätze.

---

## Definition of Done

- [ ] Nach Splash-Interactive: Mic Press-In ≤1 Frame (QA-Gerät, Kaltstart)
- [ ] Settings/Timeline Shell ≤1 Frame; kein 3 s Warten
- [ ] Zurück schließt Overlay / parkt Load sofort
- [ ] Light-Pins tippbar ≈ ≤1,5 s; volle Polish ohne Chrome-Freeze
- [ ] `uiInstant.smoke.test.ts` + Gate-Smoke grün
- [ ] Kein Fabric-Blackscreen nach Mic (Regression)

---

## Direkte Antwort auf die Fragen

1. **Geht das technisch?** Ja.
2. **Woran liegt’s?** JS-Thread + Kalt-Mount von Settings/Timeline — nicht „Mic absichtlich aus“.
3. **Kann Splash in 5 s Mic/Settings/Timeline/Orte vorbereiten?** Ja: Map-Core + Voice + Chrome-Shell unter dem Vorhang; schwere Orte/Fog danach, Light-Pins früh.
4. **Warum stört’s trotz Gate?** Gate priorisiert Lanes; er ersetzt keine freien Frames. Sync ohne Gate / Cold Mount umgeht die Absicht.
