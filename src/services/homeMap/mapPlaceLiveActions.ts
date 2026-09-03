/**
 * Live-Aktionen für das Ort-Popup — Google-frei.
 *
 * Diese Buttons lösen erst beim Tap eine Live-Abfrage aus (kein Vorab-Fetch,
 * keine Google Places): Öffnungszeiten (OSM/Overpass), Speisekarte (OSM-Website
 * → menuDeepLink), Buchen (Stay22-Affiliate), Abfahrten (Transit-Adapter).
 *
 * Jede Aktion ist fail-closed: findet sie nichts Belegtes, kommt eine ehrliche
 * Rückmeldung statt eines erfundenen Ergebnisses.
 */

export type MapPlaceLiveActionId =
  | 'hours'
  | 'menu'
  | 'book'
  | 'ticket'
  | 'departures';

export type MapPlaceLiveActionDef = {
  id: MapPlaceLiveActionId;
  label: string;
};

export type MapPlaceLiveActionContext = {
  id: number;
  name: string;
  category: string;
  lat: number;
  lng: number;
  websiteUrl?: string | null;
  /** Optionaler Stadt-Kontext (für Buchen/Abfahrten). */
  city?: string | null;
  /** Optionale Roh-Tags (name/category/tags_json) für die Klassifizierung. */
  tagsBlob?: string | null;
};

export type MapPlaceLiveActionResult = {
  ok: boolean;
  /** Zeilen, die als Stichpunkte ins Popup übernommen werden. */
  bullets?: string[];
  /** URL, die geöffnet werden soll (Speisekarte / Buchung). */
  url?: string | null;
  /** Kurzer Satz zum Sprechen/Anzeigen. */
  speak?: string | null;
  /** Ehrliche Fallback-Meldung, wenn nichts Belegtes gefunden wurde. */
  message?: string | null;
};

const GASTRO_RE =
  /restaurant|caf[eé]|kaffee|bistro|imbiss|gasthof|gasthaus|wirtshaus|pizzeria|trattoria|osteria|\bbar\b|\bpub\b|kneipe|brauhaus|biergarten|grill|b[aä]ck|baeck|bakery|eisdiele|eiscaf[eé]|d[oö]ner|steakhouse|steak.?haus/i;
const HOTEL_RE =
  /hotel|pension|hostel|lodging|unterkunft|ferienwohnung|ferienhaus|apartment|appartement|g[aä]stehaus|gaestehaus|motel|resort|herberge|fewo/i;
const TRANSIT_RE =
  /bahnhof|haltepunkt|haltestelle|\bbus\b|[oö]pnv|oepnv|\bhbf\b|\bs-?bahn\b|u-?bahn|stra[ßs]enbahn|\btram\b|\bstation\b|f[aä]hre|anleger|\b[oö]pnv\b/i;
const MUSEUM_RE = /museum|ausstellung|galerie|gallery|kunsthalle/i;
const ACTIVITY_RE =
  /kletter|boulder|schwimmbad|freibad|hallenbad|therme|minigolf|bowling|kino|theater|\bsport\b|fitness|wasserski|surf|\bkart\b|paintball|freizeitpark|zoo|tierpark/i;
const SHOP_RE =
  /shop|laden|gesch[aä]ft|supermarkt|apotheke|drogerie|markt|store|kiosk|buchhandlung|metzger|fleischer/i;

/** Straßen-/District-Tag „bahnhof“ ist kein echter Halt. */
function isRealTransitStop(blob: string): boolean {
  if (!TRANSIT_RE.test(blob)) return false;
  if (/(bahnhof|haltestelle)(?:stra[ßs]e|str\.)/i.test(blob)) return false;
  return true;
}

/**
 * Welche Live-Buttons passen zu diesem Ort? (Reihenfolge = Anzeige-Reihenfolge)
 */
export function deriveMapPlaceLiveActions(ctx: {
  name?: string | null;
  category?: string | null;
  tagsBlob?: string | null;
}): MapPlaceLiveActionDef[] {
  const blob = `${ctx.name ?? ''} ${ctx.category ?? ''} ${ctx.tagsBlob ?? ''}`
    .toLowerCase()
    .trim();
  if (!blob) return [];

  const transit = isRealTransitStop(blob);
  const gastro = !transit && GASTRO_RE.test(blob);
  const hotel = HOTEL_RE.test(blob);
  const museum = MUSEUM_RE.test(blob);
  const activity = ACTIVITY_RE.test(blob);
  const shop = SHOP_RE.test(blob);
  const park =
    /\bpark\b|garten|spielplatz|grünanlage|gruenanlage|wald|picknick|hundewiese/i.test(
      blob,
    );
  const toilet = /toilette|\bwc\b|restroom|bathroom/i.test(blob);

  const acts: MapPlaceLiveActionDef[] = [];
  // Öffnungszeiten für Orte mit plausiblen Zeiten (kein reiner Halt).
  if (
    !transit &&
    (gastro || hotel || museum || activity || shop || park || toilet)
  ) {
    acts.push({ id: 'hours', label: 'Öffnungszeiten' });
  }
  if (gastro) acts.push({ id: 'menu', label: 'Speisekarte' });
  // Hotel: Affiliate-Buchen (Stay22) — kein externes Maps daneben.
  if (hotel) acts.push({ id: 'book', label: 'Buchen' });
  // Museum/Attraktion: Ticket über Partner-Link (GYG/Musement).
  if (museum || activity) acts.push({ id: 'ticket', label: 'Tickets' });
  // ÖPNV bleibt in-app (Abfahrten), kein externes Maps.
  if (transit) acts.push({ id: 'departures', label: 'Abfahrten' });
  return acts;
}

function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function nameSimilar(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.includes(y) || y.includes(x)) return 70;
  const xt = x.split(/\s+/).filter((t) => t.length >= 3);
  if (!xt.length) return 0;
  let hit = 0;
  for (const t of xt) if (y.includes(t)) hit += 1;
  return Math.round((hit / xt.length) * 60);
}

/** Ortstyp → Overpass placeType für die OSM-Suche. */
function osmPlaceTypeFor(blob: string): string {
  if (/museum|ausstellung|galerie|kunsthalle/i.test(blob)) return 'museum';
  if (/b[aä]ck|baeck|bakery/i.test(blob)) return 'bakery';
  if (/caf[eé]|kaffee|eiscaf[eé]/i.test(blob)) return 'cafe';
  if (/apotheke/i.test(blob)) return 'pharmacy';
  if (/supermarkt/i.test(blob)) return 'supermarket';
  if (/park|garten/i.test(blob)) return 'park';
  if (GASTRO_RE.test(blob)) return 'restaurant';
  return 'dwell';
}

const OSM_DAY_MAP: Record<string, string> = {
  Mo: 'Mo',
  Tu: 'Di',
  We: 'Mi',
  Th: 'Do',
  Fr: 'Fr',
  Sa: 'Sa',
  Su: 'So',
  PH: 'Feiertag',
};

/** Rohes OSM opening_hours leicht eindeutschen — kein voller OH-Parser. */
export function prettyOpeningHours(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed === '24/7') return 'Durchgehend geöffnet (24/7)';
  let out = trimmed.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => OSM_DAY_MAP[m] ?? m);
  out = out
    .replace(/\s*;\s*/g, ' · ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\boff\b/gi, 'geschlossen')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

async function nearestOsmMatch(
  ctx: MapPlaceLiveActionContext,
): Promise<{
  openingHours: string | null;
  website: string | null;
} | null> {
  try {
    const { searchOsmPlacesNearby } = await import(
      '../navigation/overpassService'
    );
    const blob = `${ctx.name} ${ctx.category} ${ctx.tagsBlob ?? ''}`.toLowerCase();
    const placeType = osmPlaceTypeFor(blob);
    const hits = await searchOsmPlacesNearby({
      lat: ctx.lat,
      lng: ctx.lng,
      placeType,
      radiusM: 160,
    });
    if (!hits.length) return null;
    let best = hits[0]!;
    let bestScore = -1;
    for (const h of hits) {
      const nameScore = nameSimilar(ctx.name, h.name);
      // Nähe + Namensähnlichkeit; Öffnungszeiten leicht bevorzugen.
      const score =
        nameScore * 2 +
        (h.openingHours ? 40 : 0) +
        Math.max(0, 120 - h.distanceM) / 4;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return { openingHours: best.openingHours, website: best.website };
  } catch {
    return null;
  }
}

async function runHours(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  const match = await nearestOsmMatch(ctx);
  if (!match?.openingHours) {
    return {
      ok: false,
      message: 'Für diesen Ort sind keine Öffnungszeiten hinterlegt.',
    };
  }
  const pretty = prettyOpeningHours(match.openingHours);
  return {
    ok: true,
    bullets: [`Öffnungszeiten: ${pretty}`],
    speak: `Öffnungszeiten: ${pretty}`,
  };
}

async function runMenu(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  let website = (ctx.websiteUrl || '').trim();
  if (!/^https?:\/\//i.test(website)) {
    const match = await nearestOsmMatch(ctx);
    website = (match?.website || '').trim();
  }
  if (!/^https?:\/\//i.test(website)) {
    return {
      ok: false,
      message: 'Keine Website gefunden — deshalb keine Speisekarte verlinkbar.',
    };
  }
  try {
    const { findDeepestMenuLink } = await import(
      '../actionBoard/menuDeepLink'
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const hit = await findDeepestMenuLink({
        websiteUrl: website,
        kind: 'food',
        signal: ctrl.signal,
      });
      if (hit?.url) {
        return { ok: true, url: hit.url, speak: 'Speisekarte öffnet.' };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* soft */
  }
  // Fail-open auf die Website (nicht die Speisekarte, aber ehrlich benannt).
  return {
    ok: true,
    url: website,
    speak: 'Keine direkte Speisekarte gefunden — ich öffne die Website.',
    message: 'Keine direkte Speisekarte gefunden — öffne Website.',
  };
}

async function runBook(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  const city = (ctx.city || '').trim();
  try {
    const {
      lookupHotelAvailability,
      defaultHotelStayWindow,
    } = await import('../concierge/hotelAvailabilityService');
    const win = defaultHotelStayWindow();
    const res = await lookupHotelAvailability({
      hotelName: ctx.name,
      city,
      checkin: win.checkin,
      checkout: win.checkout,
      adults: 2,
      lat: ctx.lat,
      lng: ctx.lng,
    });
    const pick = res.matched ?? res.alternatives[0] ?? null;
    if (pick?.bookUrl) {
      const { finalizeHotelBookAffiliateUrl } = await import(
        '../affiliate/hotelPropertyDeepLink'
      );
      const url = finalizeHotelBookAffiliateUrl({
        hotelName: pick.name || ctx.name,
        city,
        bookUrl: pick.bookUrl,
        checkin: res.checkin,
        checkout: res.checkout,
        adults: 2,
        expediaPropertyId: pick.expediaPropertyId ?? null,
      });
      const price =
        pick.priceTotal != null
          ? ` ab ${Math.round(pick.priceTotal)} ${pick.currency || 'EUR'}`
          : '';
      return {
        ok: true,
        url,
        speak: `Ich öffne die Buchung${price}.`,
      };
    }
  } catch {
    /* soft — fall through to generic accommodation URL */
  }
  // Kein Live-Preis → generische Stay22-Unterkunftssuche (ehrlich, buchbar).
  try {
    const { getStay22AccommodationUrl } = await import(
      '../affiliate/affiliateService'
    );
    const { defaultHotelStayWindow } = await import(
      '../concierge/hotelAvailabilityService'
    );
    const win = defaultHotelStayWindow();
    const dest = [ctx.name, city].filter(Boolean).join(', ') || ctx.name;
    const url = getStay22AccommodationUrl(dest, {
      checkin: win.checkin,
      checkout: win.checkout,
      adults: 2,
    });
    return {
      ok: true,
      url,
      speak: 'Ich öffne die Unterkunftssuche.',
      message: 'Kein Live-Preis gefunden — öffne Unterkunftssuche.',
    };
  } catch {
    return {
      ok: false,
      message: 'Buchung gerade nicht verfügbar. Versuch es später nochmal.',
    };
  }
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `when` = Live-/Prognosezeit (schon inkl. Verspätung).
 * Bei Verspätung: Plan durchgestrichen + neue Uhrzeit — kein verwirrendes „+20 Min“.
 */
export function departureLine(d: {
  line: string;
  direction: string;
  when: Date;
  plannedWhen?: Date | null;
  delaySec: number | null;
  cancelled: boolean;
}): string {
  const live = clock(d.when);
  const dir = d.direction ? ` → ${d.direction}` : '';
  if (d.cancelled) {
    return `${d.line}${dir} fällt aus`.trim();
  }
  const planned = d.plannedWhen instanceof Date ? d.plannedWhen : null;
  const delayed =
    (d.delaySec != null && d.delaySec >= 60) ||
    (planned != null &&
      Math.abs(d.when.getTime() - planned.getTime()) >= 60_000);
  if (delayed && planned) {
    // Unicode-Durchgestrichen für Plan-Zeit (RN Text ohne nested styles).
    const planStruck = [...clock(planned)]
      .map((ch) => `${ch}\u0336`)
      .join('');
    return `${d.line}${dir} ${planStruck} → ${live}`.trim();
  }
  return `${d.line}${dir} ${live}`.trim();
}

/** Kurze Speech nur für die nächste Abfahrt. */
export function departureSpeakFirst(d: {
  line: string;
  direction: string;
  when: Date;
}): string {
  const live = `${d.when.getHours()}:${String(d.when.getMinutes()).padStart(2, '0')}`;
  const dest = (d.direction || '').trim();
  const blob = `${d.line} ${dest}`;
  const vehicle = /\bbus\b/i.test(d.line)
    ? 'Bus'
    : /\b(tram|stra[ßs]enbahn)\b/i.test(blob)
      ? 'Bahn'
      : /\b(u-?bahn|s-?bahn|rb|re|ic|ice|ec|ire)\b/i.test(d.line)
        ? 'Zug'
        : 'Verbindung';
  if (dest) {
    return `Der nächste ${vehicle} fährt um ${live} Uhr nach ${dest}.`;
  }
  return `Die nächste ${vehicle} ${d.line} fährt um ${live} Uhr.`;
}

async function runDepartures(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  try {
    const { fetchLiveDeparturesForCity } = await import(
      '../transit/adapters'
    );
    let cityId: string | null = ctx.city ?? null;
    try {
      const { getCachedUserProfile } = await import('../userProfileService');
      const profile = getCachedUserProfile();
      cityId = profile?.cityId ?? profile?.cityName ?? cityId;
    } catch {
      /* soft */
    }
    const live = await fetchLiveDeparturesForCity({
      cityId,
      stopId: ctx.name,
      stationName: ctx.name,
      stationLat: ctx.lat,
      stationLng: ctx.lng,
      limit: 6,
    });
    const rows = (live?.departures ?? [])
      .filter((d) => d.when.getTime() >= Date.now() - 60_000)
      .slice(0, 3);
    if (!rows.length) {
      return {
        ok: false,
        message: 'Gerade keine Live-Abfahrten für diesen Halt gefunden.',
      };
    }
    const bullets = rows.map(departureLine);
    const first = rows[0]!;
    return {
      ok: true,
      bullets,
      // Speech: nur die nächste Verbindung — kurz und knackig.
      speak: departureSpeakFirst(first),
    };
  } catch {
    return {
      ok: false,
      message: 'Live-Abfahrten gerade nicht abrufbar.',
    };
  }
}

async function runTicket(
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  const city = (ctx.city || '').trim();
  const q = [ctx.name, city].filter(Boolean).join(' ').trim() || ctx.name;
  try {
    const { buildTourBookingAction } = await import(
      '../affiliate/affiliateService'
    );
    const act = buildTourBookingAction({
      kind: 'museum',
      query: q,
      city,
    });
    const url = String(act?.payload?.url || '').trim();
    if (/^https?:\/\//i.test(url)) {
      return {
        ok: true,
        url,
        speak: 'Ich öffne die Ticket-Suche.',
      };
    }
  } catch {
    /* soft */
  }
  try {
    const { buildGetYourGuideSearchUrl } = await import(
      '../affiliate/affiliateService'
    );
    const url = buildGetYourGuideSearchUrl(q);
    return {
      ok: true,
      url,
      speak: 'Ich öffne die Ticket-Suche.',
    };
  } catch {
    return {
      ok: false,
      message: 'Ticket-Link gerade nicht verfügbar.',
    };
  }
}

/** Führt eine Live-Aktion aus (Google-frei). */
export async function runMapPlaceLiveAction(
  action: MapPlaceLiveActionId,
  ctx: MapPlaceLiveActionContext,
): Promise<MapPlaceLiveActionResult> {
  if (!Number.isFinite(ctx.lat) || !Number.isFinite(ctx.lng)) {
    return { ok: false, message: 'Für den Ort fehlen gültige Koordinaten.' };
  }
  switch (action) {
    case 'hours':
      return runHours(ctx);
    case 'menu':
      return runMenu(ctx);
    case 'book':
      return runBook(ctx);
    case 'ticket':
      return runTicket(ctx);
    case 'departures':
      return runDepartures(ctx);
    default:
      return { ok: false, message: 'Aktion nicht verfügbar.' };
  }
}
