/**
 * Live-Fares für Oberfläche Bus/Camper — belegte Preise via Search-Grounding,
 * kein Fake-„ab €…“. Partner-Link bleibt Buchungsweg; Cache ~3 Tage.
 */

import { extractJsonObject } from './proEnrichParse';

export type SurfaceFareQuote = {
  priceEur: number | null;
  /** Kurzbeleg / Carrier-Hinweis */
  note: string | null;
  /** Abfahrt / Dauer wenn belegt */
  departAt?: string | null;
  arriveAt?: string | null;
  durationHint?: string | null;
  source: 'grounded' | 'journey' | 'cache' | 'none';
};

function nightsBetween(checkin: string, checkout: string): number {
  const a = Date.parse(`${checkin}T12:00:00`);
  const b = Date.parse(`${checkout}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 3;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function parseEvidencedPrice(raw: string | null | undefined): {
  priceEur: number | null;
  note: string | null;
  departAt: string | null;
  durationHint: string | null;
} {
  const parsed = extractJsonObject(raw || '');
  const evidenced = parsed?.evidenced === true;
  const priceEur =
    evidenced &&
    typeof parsed?.priceEur === 'number' &&
    Number.isFinite(parsed.priceEur) &&
    parsed.priceEur > 0 &&
    parsed.priceEur < 50_000
      ? Math.round(parsed.priceEur)
      : null;
  const note =
    evidenced && typeof parsed?.note === 'string' && parsed.note.trim()
      ? parsed.note.trim().slice(0, 140)
      : null;
  const departAt =
    typeof parsed?.departAt === 'string' && /^\d{1,2}:\d{2}/.test(parsed.departAt.trim())
      ? parsed.departAt.trim().slice(0, 5)
      : null;
  const durationHint =
    typeof parsed?.durationHint === 'string' && parsed.durationHint.trim()
      ? parsed.durationHint.trim().slice(0, 40)
      : null;
  return { priceEur, note, departAt, durationHint };
}

async function readFareCache(key: string): Promise<SurfaceFareQuote | null> {
  try {
    const { getTravelCache } = await import('./travelResearchCache');
    const hit = await getTravelCache(key, 'surface_fare');
    if (!hit) return null;
    const p = hit.payload as Partial<SurfaceFareQuote>;
    if (p.priceEur == null || !(p.priceEur > 0)) return null;
    return {
      priceEur: Math.round(p.priceEur),
      note: typeof p.note === 'string' ? p.note : null,
      departAt: typeof p.departAt === 'string' ? p.departAt : null,
      arriveAt: typeof p.arriveAt === 'string' ? p.arriveAt : null,
      durationHint: typeof p.durationHint === 'string' ? p.durationHint : null,
      source: 'cache',
    };
  } catch {
    return null;
  }
}

async function writeFareCache(key: string, quote: SurfaceFareQuote): Promise<void> {
  if (quote.priceEur == null || quote.priceEur <= 0) return;
  try {
    const { putTravelCache } = await import('./travelResearchCache');
    await putTravelCache({
      key,
      kind: 'surface_fare',
      payload: {
        priceEur: quote.priceEur,
        note: quote.note,
        departAt: quote.departAt ?? null,
        arriveAt: quote.arriveAt ?? null,
        durationHint: quote.durationHint ?? null,
      },
      validUntilMs: Date.now() + 3 * 24 * 3600_000,
    });
  } catch {
    /* soft */
  }
}

/** HAFAS/Journey: Dauer + Zeiten (kein Preis) — Fernstrecke ok (>4 h). */
export async function journeyTimingHint(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
}): Promise<Pick<SurfaceFareQuote, 'departAt' | 'arriveAt' | 'durationHint'>> {
  try {
    const { lookupRailJourneyTiming } = await import('./railJourneyTiming');
    const t = await lookupRailJourneyTiming(opts);
    return {
      departAt: t.departAt,
      arriveAt: t.arriveAt,
      durationHint: t.durationHint,
    };
  } catch {
    return {};
  }
}

/**
 * Fernbus-Preis (FlixBus/Omio o.ä.) — nur mit evidenced:true.
 * priceEur = typischer Einzelticket-Preis (p.P., einfache Fahrt).
 */
export async function lookupFernbusLiveQuote(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
}): Promise<SurfaceFareQuote> {
  const cacheKey = `bus|${opts.originCity}|${opts.destCity}|${opts.checkin}`.toLowerCase().slice(0, 200);
  const cached = await readFareCache(cacheKey);
  if (cached) return cached;

  const timing = await journeyTimingHint(opts);
  let grounded: ReturnType<typeof parseEvidencedPrice> = {
    priceEur: null,
    note: null,
    departAt: null,
    durationHint: null,
  };

  try {
    const { hasGeminiApiKey, generateGeminiText } = await import(
      '../../services/geminiService'
    );
    if (hasGeminiApiKey()) {
      const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
        '../../services/concierge/findusResponsePolicy'
      );
      const prompt = [
        FINDUS_FEW_SHOT_DISCLAIMER,
        `Belegter Fernbus-Preis (FlixBus, Omio, BlaBlaBus) ${opts.originCity} → ${opts.destCity} am ${opts.checkin}.`,
        'Google Search. Nur wenn eine konkrete €-Zahl auf einer Ticket-/Vergleichsseite steht.',
        'priceEur = Einzelticket Erwachsener, einfache Fahrt (nicht Hin+Rück, nicht Schätzung).',
        'JSON: {"priceEur":null,"note":"Carrier oder Quelle kurz","departAt":null,"durationHint":null,"evidenced":false}',
      ].join('\n');
      const raw = await generateGeminiText(prompt, {
        task: 'generic',
        costModule: 'research',
        tier: 'lite',
        enableGoogleSearch: true,
        maxTokens: 360,
        temperature: 0.15,
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
      });
      grounded = parseEvidencedPrice(raw);
    }
  } catch {
    /* soft */
  }

  const quote: SurfaceFareQuote = {
    priceEur: grounded.priceEur,
    note: grounded.note,
    departAt: timing.departAt ?? grounded.departAt,
    arriveAt: timing.arriveAt ?? null,
    durationHint: timing.durationHint ?? grounded.durationHint,
    source: grounded.priceEur != null ? 'grounded' : timing.durationHint ? 'journey' : 'none',
  };
  await writeFareCache(cacheKey, quote);
  return quote;
}

/**
 * Camper/Wohnmobil-Miete für Zeitraum — belegte Tages-/Gesamtrate.
 * priceEur = Gesamt-Miete für die Gruppe (nicht p.P.).
 */
export async function lookupCamperLiveQuote(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  checkout: string;
  guests?: number | null;
}): Promise<SurfaceFareQuote> {
  const nights = nightsBetween(opts.checkin, opts.checkout);
  const guests = Math.max(1, opts.guests ?? 2);
  const cacheKey =
    `camper|${opts.originCity}|${opts.checkin}|${opts.checkout}|${guests}`
      .toLowerCase()
      .slice(0, 200);
  const cached = await readFareCache(cacheKey);
  if (cached) return cached;

  let grounded: ReturnType<typeof parseEvidencedPrice> = {
    priceEur: null,
    note: null,
    departAt: null,
    durationHint: null,
  };

  try {
    const { hasGeminiApiKey, generateGeminiText } = await import(
      '../../services/geminiService'
    );
    if (hasGeminiApiKey()) {
      const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
        '../../services/concierge/findusResponsePolicy'
      );
      const prompt = [
        FINDUS_FEW_SHOT_DISCLAIMER,
        `Belegte Camper-/Wohnmobil-Miete ab ${opts.originCity} (Richtung ${opts.destCity}) ${opts.checkin}–${opts.checkout} (~${nights} Nächte), ${guests} Personen.`,
        'Quellen: PaulCamper, Yescapa, Camperdays, Indie Campers — Google Search.',
        'priceEur = Gesamtmiete für den Zeitraum (nicht nur 1 Tag), nur mit konkreter €-Zahl. Nichts erfinden.',
        'JSON: {"priceEur":null,"note":"Anbieter + Fahrzeugtyp kurz","durationHint":null,"evidenced":false}',
      ].join('\n');
      const raw = await generateGeminiText(prompt, {
        task: 'generic',
        costModule: 'research',
        tier: 'lite',
        enableGoogleSearch: true,
        maxTokens: 400,
        temperature: 0.15,
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
      });
      grounded = parseEvidencedPrice(raw);
      // Sanity: Tagesrate * Nächte falls Modell nur Tag lieferte
      if (
        grounded.priceEur != null &&
        grounded.priceEur < 40 * nights &&
        grounded.priceEur <= 250
      ) {
        grounded = {
          ...grounded,
          priceEur: Math.round(grounded.priceEur * nights),
          note: grounded.note
            ? `${grounded.note} · ${nights} Nächte`
            : `~${nights} Nächte`,
        };
      }
    }
  } catch {
    /* soft */
  }

  const quote: SurfaceFareQuote = {
    priceEur: grounded.priceEur,
    note: grounded.note,
    durationHint: grounded.durationHint ?? `${nights} Nächte`,
    source: grounded.priceEur != null ? 'grounded' : 'none',
  };
  await writeFareCache(cacheKey, quote);
  return quote;
}

/**
 * Bahn-Sparpreis (DB/Omio) — nur belegt, kein Fake.
 * priceEur = p.P. Hin+Rück wenn checkout ≠ checkin, sonst einfache Fahrt.
 */
export async function lookupBahnLiveQuote(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  checkout?: string | null;
  bahncard?: string | null;
  /** true wenn Caller Zeiten schon per HAFAS hat — nur Preis/Note holen */
  skipTiming?: boolean;
}): Promise<SurfaceFareQuote & { roundtrip: boolean }> {
  const roundtrip = Boolean(
    opts.checkout &&
      /^\d{4}-\d{2}-\d{2}/.test(opts.checkout) &&
      opts.checkout.slice(0, 10) !== opts.checkin.slice(0, 10),
  );
  const bc =
    opts.bahncard && opts.bahncard !== 'none' && opts.bahncard !== 'unknown'
      ? opts.bahncard
      : null;
  const cacheKey =
    `bahn|${opts.originCity}|${opts.destCity}|${opts.checkin}|${opts.checkout || ''}|${bc || 'none'}`
      .toLowerCase()
      .slice(0, 220);
  const cached = await readFareCache(cacheKey);
  if (cached) {
    return { ...cached, roundtrip };
  }

  const timing = opts.skipTiming
    ? ({} as Pick<SurfaceFareQuote, 'departAt' | 'arriveAt' | 'durationHint'>)
    : await journeyTimingHint({
        originCity: opts.originCity,
        destCity: opts.destCity,
        checkin: opts.checkin,
      });

  let grounded: ReturnType<typeof parseEvidencedPrice> = {
    priceEur: null,
    note: null,
    departAt: null,
    durationHint: null,
  };

  try {
    const { hasGeminiApiKey, generateGeminiText } = await import(
      '../../services/geminiService'
    );
    if (hasGeminiApiKey()) {
      const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
        '../../services/concierge/findusResponsePolicy'
      );
      const tripBit = roundtrip
        ? `Hin+Rück ${opts.checkin} → ${opts.checkout}`
        : `einfache Fahrt am ${opts.checkin}`;
      const bcBit = bc ? `Mit Bahncard ${bc}.` : 'Ohne Bahncard.';
      const prompt = [
        FINDUS_FEW_SHOT_DISCLAIMER,
        `Belegter DB-/Bahn-Sparpreis ${opts.originCity} → ${opts.destCity}, ${tripBit}. ${bcBit}`,
        'Google Search (bahn.de, Omio, Trainline). Nur konkrete €-Zahl von Ticket-/Vergleichsseite.',
        roundtrip
          ? 'priceEur = Preis pro Person Hin+Rück (Sparpreis/Flex wenn belegt), nicht Schätzung.'
          : 'priceEur = Preis pro Person einfache Fahrt, nicht Schätzung.',
        'JSON: {"priceEur":null,"note":"Sparpreis / Flex / Quelle kurz","departAt":null,"durationHint":null,"evidenced":false}',
      ].join('\n');
      const raw = await generateGeminiText(prompt, {
        task: 'generic',
        costModule: 'research',
        tier: 'lite',
        enableGoogleSearch: true,
        maxTokens: 360,
        temperature: 0.15,
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
      });
      grounded = parseEvidencedPrice(raw);
    }
  } catch {
    /* soft */
  }

  const quote: SurfaceFareQuote = {
    priceEur: grounded.priceEur,
    note: grounded.note,
    departAt: timing.departAt ?? grounded.departAt,
    arriveAt: timing.arriveAt ?? null,
    durationHint: timing.durationHint ?? grounded.durationHint,
    source: grounded.priceEur != null ? 'grounded' : timing.durationHint ? 'journey' : 'none',
  };
  await writeFareCache(cacheKey, quote);
  return { ...quote, roundtrip };
}

/** FlixBus Shop — altes `/bus-suchen` ist 404. */
export function formatFlixRideDate(iso: string | null | undefined): string | null {
  const key = (iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}`;
}

export function buildFlixBusSearchUrl(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  adults?: number;
  /** FlixTrain über denselben Shop. */
  train?: boolean;
}): string {
  const rideDate = formatFlixRideDate(opts.checkin) || formatFlixRideDate(new Date().toISOString());
  const q = new URLSearchParams({
    departureCity: opts.originCity.trim(),
    arrivalCity: opts.destCity.trim(),
    adults: String(Math.max(1, opts.adults ?? 1)),
  });
  if (rideDate) q.set('rideDate', rideDate);
  if (opts.train) q.set('rideType', 'train');
  return `https://shop.flixbus.de/search?${q.toString()}`;
}

/**
 * Omio-Vergleich: Deep-Search auf omio.de/com ist oft 404/403 —
 * Google site-Prefill trifft Omio-Treffer; CheckMyBus/Trainline sind harte Partner.
 */
export function buildOmioBusSearchUrl(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  checkout?: string | null;
}): string {
  const dateBit = /^\d{4}-\d{2}-\d{2}/.test(opts.checkin)
    ? opts.checkin.slice(0, 10)
    : '';
  const q = [
    'site:omio.com OR site:omio.de',
    opts.originCity.trim(),
    opts.destCity.trim(),
    'bus',
    dateBit,
  ]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Omio Bahn — gleicher robuster Prefill (Zug statt Bus). */
export function buildOmioRailSearchUrl(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  checkout?: string | null;
}): string {
  const dateBit = /^\d{4}-\d{2}-\d{2}/.test(opts.checkin)
    ? opts.checkin.slice(0, 10)
    : '';
  const q = [
    'site:omio.com OR site:omio.de',
    opts.originCity.trim(),
    opts.destCity.trim(),
    'zug OR train',
    dateBit,
  ]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** CheckMyBus — belastbarer DE-Fernbus-Vergleich (Omio-Deep-Links oft tot). */
export function buildCheckMyBusSearchUrl(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
  adults?: number;
}): string {
  const from = slugCity(opts.originCity);
  const to = slugCity(opts.destCity);
  const day = /^\d{4}-\d{2}-\d{2}/.test(opts.checkin)
    ? opts.checkin.slice(0, 10)
    : '';
  const q = new URLSearchParams();
  if (day) q.set('date', day);
  q.set('adults', String(Math.max(1, opts.adults ?? 1)));
  return `https://www.checkmybus.de/${from}/${to}?${q.toString()}`;
}

function slugCity(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stadt';
}

/** Trainline — belastbarer Deeplink als zweiter Bus/Bahn-Partner. */
export function buildTrainlineSearchUrl(opts: {
  originCity: string;
  destCity: string;
  checkin: string;
}): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(opts.checkin)
    ? opts.checkin.slice(0, 10)
    : '';
  const q = new URLSearchParams({
    journeySearchType: 'single',
    origin: opts.originCity.trim(),
    destination: opts.destCity.trim(),
  });
  if (day) q.set('outwardDate', `${day}T08:00:00`);
  return `https://www.thetrainline.com/book/results?${q.toString()}`;
}

/** Yescapa Camper-Suche als zweiter Partner. */
export function buildYescapaCamperUrl(opts: {
  originCity: string;
  checkin: string;
  checkout: string;
}): string {
  const q = new URLSearchParams({
    location: opts.originCity,
    start_date: opts.checkin,
    end_date: opts.checkout,
  });
  return `https://www.yescapa.de/wohnmobil-mieten?${q.toString()}`;
}

/** Pure helper for smokes — Tagesrate → Gesamtmiete. */
export function expandCamperDayRateIfNeeded(
  priceEur: number,
  nights: number,
): number {
  if (priceEur < 40 * nights && priceEur <= 250) {
    return Math.round(priceEur * nights);
  }
  return Math.round(priceEur);
}
