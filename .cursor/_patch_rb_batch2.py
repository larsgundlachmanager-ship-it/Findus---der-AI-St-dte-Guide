from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# ========== store.ts ==========
p = ROOT / "src/reisebuero/store.ts"
t = p.read_text(encoding="utf-8")
t = t.replace(
    "import { applyAskedContext, applyLedgerCorrections, parseBriefSlots } from './parseBriefSlots';",
    "import { applyAskedContext, applyLedgerCorrections, looksLikeGarbageFact, parseBriefSlots } from './parseBriefSlots';",
)

old_ingest = """    if (__DEV__) console.log('[Reisebuero] ingest:', t.slice(0, 80));
    const lastAsk = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] ?? null;
    const patch = applyAskedContext(t, lastAsk, parseBriefSlots(t, Date.now(), trip.ledger));
"""

new_ingest = """    if (__DEV__) console.log('[Reisebuero] ingest:', t.slice(0, 80));
    const lastAsk = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] ?? null;
    // Meta: Frage wiederholen — kein Slot-Schreiben
    if (/\\b(was\\s+war\\s+die\\s+frage|welche\\s+frage|nochmal\\s+die\\s+frage|hab(?:e)?\\s+(?:die\\s+)?frage\\s+vergessen)\\b/iu.test(t)) {
      const lastHint = [...trip.chat].reverse().find((c) => c.role === 'assistant')?.hint;
      const q =
        (typeof lastHint === 'string' && lastHint.trim()) ||
        (lastAsk ? `Nochmal zu ${lastAsk}` : null) ||
        'Sag kurz nochmal, worauf ich gerade hinauswollte.';
      const turn: ChatTurn = { id: nid(), role: 'user', text: t, atMs: Date.now() };
      const speech = `Klar — die Frage war: ${q.replace(/\\?+$/, '')}?`;
      set({
        trip: {
          ...trip,
          chat: [
            ...trip.chat,
            turn,
            { id: nid(), role: 'assistant', text: speech, atMs: Date.now(), hint: q },
          ],
          updatedAtMs: Date.now(),
        },
      });
      return;
    }
    if (looksLikeGarbageFact(t) && t.length < 80) {
      if (__DEV__) console.log('[Reisebuero] ingest skip garbage:', t.slice(0, 60));
      return;
    }
    const patch = applyAskedContext(t, lastAsk, parseBriefSlots(t, Date.now(), trip.ledger));
"""

if old_ingest not in t:
    raise SystemExit("ingest block missing")
t = t.replace(old_ingest, new_ingest, 1)

# Protect origin from being cleared when airport hubs mentioned
old_origin = """    const ledger = applyLedgerCorrections(
      t,
      deactivateUnmatchedSlots(applyOriginDefaults(mergeLedger(trip.ledger, patch))),
    );
"""
new_origin = """    // Startort hard-pin: Flughafen-Wunsch darf Origin nicht löschen
    if (
      trip.ledger.originCity?.source === 'user' &&
      trip.ledger.originCity.value &&
      patch.originCity &&
      patch.originCity.value !== trip.ledger.originCity.value &&
      /\\b(hamburg|berlin|bremen|hannover|flughafen|direktflug)\\b/iu.test(t) &&
      !/\\b(starten|startort|wohne|aus\\s+\\w+\\s+starten|von\\s+\\w+\\s+aus)\\b/iu.test(t)
    ) {
      delete (patch as { originCity?: unknown }).originCity;
    }
    const ledger = applyLedgerCorrections(
      t,
      deactivateUnmatchedSlots(applyOriginDefaults(mergeLedger(trip.ledger, patch))),
    );
"""
if old_origin not in t:
    raise SystemExit("origin merge missing")
t = t.replace(old_origin, new_origin, 1)
p.write_text(t, encoding="utf-8")
print("store ok")

# ========== briefingChat: generic trip + garbage ack ==========
p = ROOT / "src/reisebuero/briefingChat.ts"
t = p.read_text(encoding="utf-8")
t = t.replace(
    "  if (/\\bparty|feiern|kneipe|männerwochenende|jungs\\b/iu.test(t) && !ledger.purpose) {\n    return 'Klingt nach einem richtigen Trip.';\n  }",
    "  if (/\\bparty|feiern|kneipe|männerwochenende|jungs\\b/iu.test(t) && !ledger.purpose) {\n    return 'Party und Entspannung — merke ich als Mix.';\n  }",
)
# echo short garbage
t = t.replace(
    """  const echo = t.replace(/\\s+/g, ' ').trim();
  if (echo.length >= 12 && echo.length <= 48) {
    return `Okay, ${echo.replace(/[.!?]+$/, '')} — steht.`;
  }
  return 'Okay, merke ich mir.';
""",
    """  try {
    const { looksLikeGarbageFact } = require('./parseBriefSlots') as typeof import('./parseBriefSlots');
    if (looksLikeGarbageFact(t)) {
      return 'Das hab ich nicht klar verstanden — sag’s nochmal in einem Satz.';
    }
  } catch { /* soft */ }
  const echo = t.replace(/\\s+/g, ' ').trim();
  if (echo.length >= 12 && echo.length <= 48) {
    return `Okay, ${echo.replace(/[.!?]+$/, '')} — steht.`;
  }
  return 'Okay, merke ich mir.';
""",
)
p.write_text(t, encoding="utf-8")
print("briefingChat ok")

# ========== storyMagazine: summary + flight titles ==========
p = ROOT / "src/reisebuero/research/storyMagazine.ts"
t = p.read_text(encoding="utf-8")

t = t.replace(
    """    hook
      ? `${opt.placeName} für ${hook.toLowerCase()} — trifft euren Brief.`
      : `${opt.placeName} — passt zu dem, was ihr wolltet.`,
""",
    """    hook
      ? `${opt.placeName} für ${hook.toLowerCase()} — genau euer Tempo.`
      : `${opt.placeName} — eine Variante, die sich für euch anfühlt.`,
""",
)

t = t.replace(
    "    hook ? `${place} — ${hook}, genau euer Trip.` : `${place} — die Variante, die zum Brief passt.`,",
    "    hook ? `${place} — ${hook}, genau euer Trip.` : `${place} — eine Variante, die zu euch passt.`,",
)

# Flight outbound title: city route first
old_flight_title = """    const title =
      tr.kind === 'flight'
        ? [
            tr.flightNumber
              ? `${tr.carrier ? `${tr.carrier} ` : ''}${tr.flightNumber}`
              : null,
            tr.fromIata && tr.toIata ? `${tr.fromIata} → ${tr.toIata}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Flug hin'
        : stripAbPriceWording(tr.label || (tr.kind === 'train' ? 'Bahn hin' : 'Anreise'));
    outbound.push({
      id: `out-${tr.id}`,
      kind,
      title: stripAbPriceWording(title),
      detail:
        tr.kind === 'flight'
          ? [
              tr.departAt ? `Abflug ${tr.departAt}` : null,
              tr.fromIata && tr.toIata ? `${tr.fromIata} → ${tr.toIata}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || opt.placeName
          : [
              tr.departAt ? `Abfahrt ${tr.departAt}` : null,
              tr.fromIata && tr.toIata ? `${tr.fromIata} → ${tr.toIata}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || opt.placeName,
      priceEur: tr.priceEur ?? opt.flightPriceEur ?? null,
      // Foto kommt async in deepEnrichMagazineOption (Wiki Flugzeug/Bahn)
      photoUrl: null,
      bookUrl: tr.bookUrl,
      icon: tr.kind === 'flight' ? '✈️' : tr.kind === 'train' ? '🚆' : '🚗',
      durationHint: tr.durationHint ?? null,
    });
"""

new_flight_title = """    const fromLabel = tr.fromIata || 'Start';
    const toLabel = tr.toIata || opt.placeName;
    const cityRoute = `${fromLabel} → ${toLabel}`;
    const stopsHint =
      tr.transfers == null ? null : tr.transfers === 0 ? 'Direkt' : `${tr.transfers} Stopp${tr.transfers > 1 ? 's' : ''}`;
    const title =
      tr.kind === 'flight'
        ? cityRoute
        : stripAbPriceWording(tr.label || (tr.kind === 'train' ? 'Bahn hin' : 'Anreise'));
    const flightNo =
      tr.kind === 'flight' && tr.flightNumber
        ? `${tr.carrier ? `${tr.carrier} ` : ''}${tr.flightNumber}`
        : null;
    outbound.push({
      id: `out-${tr.id}`,
      kind,
      title: stripAbPriceWording(title),
      detail:
        tr.kind === 'flight'
          ? [
              tr.departDateKey ? tr.departDateKey.slice(0, 10) : null,
              tr.departAt ? `Abflug ${tr.departAt}` : null,
              tr.arriveAt ? `Ankunft ${tr.arriveAt}` : null,
              flightNo,
              stopsHint,
            ]
              .filter(Boolean)
              .join(' · ') || opt.placeName
          : [
              tr.departAt ? `Abfahrt ${tr.departAt}` : null,
              tr.fromIata && tr.toIata ? `${tr.fromIata} → ${tr.toIata}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || opt.placeName,
      priceEur: tr.priceEur ?? opt.flightPriceEur ?? null,
      photoUrl: null,
      bookUrl: tr.bookUrl,
      icon: tr.kind === 'flight' ? '✈️' : tr.kind === 'train' ? '🚆' : '🚗',
      durationHint: tr.durationHint ?? null,
    });
"""

if old_flight_title not in t:
    raise SystemExit("flight title block missing")
t = t.replace(old_flight_title, new_flight_title, 1)

old_ret = """    inbound.push({
      id: `ret-${tr.id}`,
      kind: retKind,
      title: tr.kind === 'flight' ? 'Rückflug' : 'Rückfahrt',
      detail:
        tr.arriveAt ||
        (tr.priceEur != null || opt.flightPriceEur != null
          ? `Zurück von ${opt.placeName} — oft im Hinpreis`
          : `Zurück von ${opt.placeName}`),
      priceEur: null,
      photoUrl: null,
      bookUrl: tr.bookUrl,
      icon: tr.kind === 'flight' ? '✈️' : '🚆',
    });
"""

new_ret = """    const retStops =
      tr.transfers == null ? null : tr.transfers === 0 ? 'Direkt' : `${tr.transfers} Stopp${tr.transfers > 1 ? 's' : ''}`;
    inbound.push({
      id: `ret-${tr.id}`,
      kind: retKind,
      title:
        tr.kind === 'flight'
          ? `${tr.toIata || opt.placeName} → ${tr.fromIata || 'Heim'}`
          : 'Rückfahrt',
      detail: [
        tr.departDateKey ? tr.departDateKey.slice(0, 10) : null,
        tr.departAt ? `Abflug ${tr.departAt}` : null,
        tr.arriveAt ? `Landung ${tr.arriveAt}` : null,
        retStops,
        tr.flightNumber ? `Flug ${tr.flightNumber}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || `Zurück von ${opt.placeName}`,
      priceEur: tr.priceEur ?? opt.flightPriceEur ?? null,
      photoUrl: null,
      bookUrl: tr.bookUrl,
      icon: tr.kind === 'flight' ? '✈️' : '🚆',
    });
"""

if old_ret not in t:
    raise SystemExit("return block missing")
t = t.replace(old_ret, new_ret, 1)

# Transfer title nudge
t = t.replace(
    "      title: 'Taxi und Transfer',",
    "      title: 'Transfer vor Ort (Uber/Taxi)',",
)

p.write_text(t, encoding="utf-8")
print("storyMagazine ok")

# ========== TripStoryScroll: remove offer chip ==========
p = ROOT / "src/components/reisebuero/TripStoryScroll.tsx"
t = p.read_text(encoding="utf-8")
t = t.replace(
    """  const diy = !opt.packageBookUrl;
  const offerKind = diy
    ? 'Yorro vermittelt — einzeln bei Partnern buchbar'
    : 'Pauschal beim Veranstalter vergleichen — kein Yorro-Ticket';
  const nights = ledger.stayNights?.value ?? null;
""",
    """  const nights = ledger.stayNights?.value ?? null;
""",
)
t = t.replace(
    """          {summary ? (
            <View style={styles.intro}>
              <Text style={styles.offerChip}>{offerKind}</Text>
              <Text style={styles.introText}>{summary}</Text>
              {opt.priceIncludes ? <Text style={styles.includes}>{opt.priceIncludes}</Text> : null}
            </View>
          ) : (
            <View style={styles.intro}>
              <Text style={styles.offerChip}>{offerKind}</Text>
            </View>
          )}
""",
    """          {summary ? (
            <View style={styles.intro}>
              <Text style={styles.introText}>{summary}</Text>
              {opt.priceIncludes ? <Text style={styles.includes}>{opt.priceIncludes}</Text> : null}
            </View>
          ) : null}
""",
)

# Stay ranking numbers - find Andere Häuser section
old_stay_map = """            {otherStays.map((s) => (
"""
# try several patterns
if "otherStays.map" in t:
    t = t.replace(
        "otherStays.map((s) => (",
        "otherStays.map((s, si) => (",
        1,
    )
    # add rank in label if pattern exists
    if "{s.placeName || s.title}" in t or "s.name" in t:
        t = t.replace(
            """                  <Text style={styles.altStayName} numberOfLines={1}>
                    {s.name}
                  </Text>""",
            """                  <Text style={styles.altStayName} numberOfLines={1}>
                    {si + 2}. {s.name}
                  </Text>""",
            1,
        )

# Featured stay rank
if "EMPFOHLENES HAUS" in t or "Empfohlenes" in t:
    t = t.replace("EMPFOHLENES HAUS", "1 · EMPFOHLENES HAUS")
    t = t.replace("Empfohlenes Haus", "1 · Empfohlenes Haus")

p.write_text(t, encoding="utf-8")
print("TripStoryScroll ok")

# ========== flightFilter: direct ==========
p = ROOT / "src/reisebuero/research/flightFilter.ts"
t = p.read_text(encoding="utf-8")
t = t.replace(
    """export type FlightLegLike = {
  departAt?: string | null;
  arriveAt?: string | null;
  layoverHours?: number | null;
  overnightStop?: boolean;
  priceEur?: number | null;
};
""",
    """export type FlightLegLike = {
  departAt?: string | null;
  arriveAt?: string | null;
  layoverHours?: number | null;
  overnightStop?: boolean;
  priceEur?: number | null;
  transfers?: number | null;
  stops?: number | null;
};
""",
)
t = t.replace(
    """  if (leg.layoverHours != null) {
    const h = leg.layoverHours;
    const shortOk = h <= c.maxLayoverHours;
    const exploreMin = c.longLayoverExploreHours;
    const exploreOk = exploreMin != null && exploreMin >= 16 && h >= exploreMin;
    if (!shortOk && !exploreOk) return false;
  }
""",
    """  const stops = leg.transfers ?? leg.stops;
  if (ledger.directFlight?.value === true && stops != null && stops > 0) {
    // Soft wish: nicht hart droppen wenn hardness wish — trotzdem bevorzugen via rank
    if (ledger.directFlight.hardness === 'must') return false;
  }
  if (leg.layoverHours != null) {
    const h = leg.layoverHours;
    const shortOk = h <= c.maxLayoverHours;
    const exploreMin = c.longLayoverExploreHours;
    const exploreOk = exploreMin != null && exploreMin >= 16 && h >= exploreMin;
    if (!shortOk && !exploreOk) return false;
  }
""",
)
t = t.replace(
    """export function rankFlightLegs<T extends FlightLegLike>(
  legs: T[],
  ledger: ReiseLedger,
): T[] {
  return legs
    .filter((l) => passesFlightJunkFilter(l, ledger))
    .sort((a, b) => (a.priceEur ?? 9e6) - (b.priceEur ?? 9e6));
}
""",
    """export function rankFlightLegs<T extends FlightLegLike>(
  legs: T[],
  ledger: ReiseLedger,
): T[] {
  const wantDirect = ledger.directFlight?.value === true;
  return legs
    .filter((l) => passesFlightJunkFilter(l, ledger))
    .sort((a, b) => {
      if (wantDirect) {
        const as = a.transfers ?? a.stops ?? 99;
        const bs = b.transfers ?? b.stops ?? 99;
        if (as !== bs) return as - bs;
      }
      return (a.priceEur ?? 9e6) - (b.priceEur ?? 9e6);
    });
}
""",
)
p.write_text(t, encoding="utf-8")
print("flightFilter ok")

# ========== sparkLatLng sanitize in theaterScene ==========
p = ROOT / "src/reisebuero/research/theaterScene.ts"
t = p.read_text(encoding="utf-8")
if "sanitizeLatLng" not in t:
    t = t.replace(
        """import {
  airportPin,
  extractPriceLabel,
  parseFlightLabel,
  projectPinToPercent,
  resolveTheaterView,
  type SparkPin,
""",
        """import {
  airportPin,
  approxPinForSpark,
  extractPriceLabel,
  parseFlightLabel,
  projectPinToPercent,
  resolveTheaterView,
  sanitizeLatLng,
  type SparkPin,
""",
    )
    t = t.replace(
        """function sparkLatLng(s: ResearchSpark): SparkPin | null {
  if (
    typeof s.lat === 'number' &&
    Number.isFinite(s.lat) &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lng)
  ) {
    return { lat: s.lat, lng: s.lng };
  }
  if (s.kind === 'flight') {
    const parsed = parseFlightLabel(s.label);
    if (parsed.dest) {
      const d = airportPin(parsed.dest);
      if (d) return d;
    }
  }
  return null;
}
""",
        """function sparkLatLng(s: ResearchSpark): SparkPin | null {
  const known = approxPinForSpark(s.label);
  if (
    typeof s.lat === 'number' &&
    Number.isFinite(s.lat) &&
    typeof s.lng === 'number' &&
    Number.isFinite(s.lng)
  ) {
    const sane = sanitizeLatLng(s.lat, s.lng);
    if (sane && known) {
      const dLat = Math.abs(sane.lat - known.lat);
      const dLng = Math.abs(sane.lng - known.lng);
      if (dLat > 3 || dLng > 3) return known;
    }
    return sane;
  }
  if (known) return known;
  if (s.kind === 'flight') {
    const parsed = parseFlightLabel(s.label);
    if (parsed.dest) {
      const d = airportPin(parsed.dest);
      if (d) return d;
    }
  }
  return null;
}
""",
    )
    p.write_text(t, encoding="utf-8")
    print("theaterScene geo ok")
else:
    print("theaterScene already has sanitize")

print("ALL DONE")
