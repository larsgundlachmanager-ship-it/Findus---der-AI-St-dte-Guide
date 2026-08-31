/**
 * Event-Info-URLs: die gefundene Detailseite 1:1, nie erfundene Slugs.
 * Rausgegangen: Umlaute ü→u (lubeck), nicht DIN ü→ue (luebeck).
 */

export type EventInfoUrlHints = {
  title?: string | null;
  venue?: string | null;
  city?: string | null;
};

function stripDiacritics(raw: string): string {
  return raw
    .replace(/ä/gi, 'a')
    .replace(/ö/gi, 'o')
    .replace(/ü/gi, 'u')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** ASCII-Slug wie Rausgegangen: Lübeck → lubeck, nicht luebeck. */
export function slugifyRausgegangen(raw: string): string {
  return stripDiacritics(String(raw ?? '').toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** DIN ü→ue im ersten Slug-Token → Rausgegangen ü→u. */
export function collapseDinCityToken(token: string): string {
  return token.replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
}

function rausgegangenHost(hostname: string): boolean {
  const h = hostname.replace(/^www\./i, '').toLowerCase();
  return h === 'rausgegangen.de' || h.endsWith('.rausgegangen.de');
}

function canonicalizeRausgegangenPath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg || seg === 'en' || seg === 'events') return seg;
      const tokens = seg.toLowerCase().split('-');
      if (tokens[0]) tokens[0] = collapseDinCityToken(tokens[0]);
      return tokens.join('-');
    })
    .join('/');
}

function rausgegangenEventDetailPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const m = path.match(/^\/(?:en\/)?events\/([a-z0-9-]+)$/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * Stadt-Kalender / Suchseite — nicht die Event-Karte, die der User erwartet.
 */
export function isGenericEventListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (rausgegangenHost(u.hostname)) {
      return !rausgegangenEventDetailPath(path);
    }
    if (/eventbrite\./i.test(host) && /\/d\//i.test(path)) return true;

    // City portals: Startseite / Veranstaltungs-Index ohne Artikel-Pfad
    const cityPortal =
      /(^|\.)hamburg\.de$/i.test(host) ||
      /(^|\.)berlin\.de$/i.test(host) ||
      /(^|\.)muenchen\.de$/i.test(host) ||
      /(^|\.)koeln\.de$/i.test(host) ||
      /(^|\.)luebeck\.de$/i.test(host) ||
      /(^|\.)lubeck\.de$/i.test(host) ||
      /tourismus\./i.test(host) ||
      /visit[a-z]*\./i.test(host);

    if (cityPortal) {
      // Root / seichte Listing-Pfade
      if (
        path === '/' ||
        /^\/(de|en)?\/?$/i.test(path) ||
        /\/(veranstaltungen|events|kalender|programm|stadtfuehrer)\/?$/i.test(
          path,
        ) ||
        /\/(veranstaltungen|events)\/(suche|search|uebersicht|übersicht)\/?/i.test(
          path,
        )
      ) {
        return true;
      }
      // Sehr kurze Pfade ohne Detail-Slug
      const segs = path.split('/').filter(Boolean);
      if (segs.length <= 1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function dropTrackingParams(u: URL): void {
  u.hash = '';
  for (const k of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'gclid',
    'fbclid',
  ]) {
    u.searchParams.delete(k);
  }
}

/**
 * Off-topic / Suchmüll — nie als Programm-Button (z. B. Suchtprävention statt Weinfest).
 */
export function isJunkEventInfoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.toLowerCase();
    const blob = `${host}${path}`;
    if (/bildungsserver|schulportal|schulserver/i.test(host)) return true;
    if (/suchtpraevention|suchtpr[aä]vention|alkoholpr[aä]vention/i.test(blob)) {
      return true;
    }
    if (/google\.[^/]+\/search/i.test(u.href)) return true;
    if (/bing\.com\/search/i.test(u.href)) return true;
    if (host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Maps nur mit Ortsnamen — nie nackte „53.5,10.0“-Koordinaten-Query.
 */
export function isCoordsOnlyMapsUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? '').trim();
  if (!raw) return true;
  try {
    const u = new URL(raw);
    if (!/maps\.google|google\.[^/]*\/maps/i.test(u.href)) return false;
    const q = (u.searchParams.get('query') || u.searchParams.get('q') || '')
      .trim()
      .replace(/\+/g, ' ');
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q);
  } catch {
    return true;
  }
}

const INTERNAL_PLACE_ID_RE = /^(pack:|osm:|text:|new:|poi:)/i;

/** Echte Google-Place-ID — nie Pack/OSM-Interna als query_place_id. */
export function looksLikeGooglePlaceId(
  id: string | null | undefined,
): boolean {
  const raw = String(id ?? '').trim();
  if (!raw || INTERNAL_PLACE_ID_RE.test(raw)) return false;
  const bare = raw.replace(/^places\//, '').trim();
  if (!bare || bare.length < 16 || INTERNAL_PLACE_ID_RE.test(bare)) return false;
  if (/\s/.test(bare)) return false;
  if (/^(ChIJ|GhIJ|Ei[A-Z]|op|th)/.test(bare)) return true;
  return /^[A-Za-z0-9_-]{22,}$/.test(bare);
}

/**
 * Maps-Action nur wenn Google einen echten Place-Eintrag hat.
 * Namenssuche / OSM-Pin / pack:-IDs → kein Button (sonst „Teilweise passende Ergebnisse“).
 */
export function isEstablishedGoogleMapsPlaceUrl(
  url: string | null | undefined,
): boolean {
  const raw = String(url ?? '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  if (isCoordsOnlyMapsUrl(raw)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const isMapsHost =
      /maps\.google/.test(host) ||
      /google\.[^/]*$/.test(host) ||
      host === 'maps.app.goo.gl' ||
      host === 'goo.gl';
    if (!isMapsHost && !/\/maps\b/i.test(u.pathname)) return false;
    if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && /\/maps\b/i.test(u.pathname))) {
      return true;
    }
    const placeId =
      u.searchParams.get('query_place_id') ||
      u.searchParams.get('destination_place_id') ||
      u.searchParams.get('place_id');
    if (looksLikeGooglePlaceId(placeId)) return true;
    const qPlace = u.searchParams.get('q') || '';
    const qPlaceId = qPlace.match(/place_id:([A-Za-z0-9_-]+)/i)?.[1];
    if (looksLikeGooglePlaceId(qPlaceId)) return true;
    // /maps/place/Name ohne Place-ID ist Namenssuche (z. B. lokale
    // Eisenbahnbrücke → berühmte Hochbrücke gleichen Namens). Nur mit ID.
    const pathPlaceId = u.pathname.match(
      /\/maps\/place\/(?:.*\/)?(ChIJ[A-Za-z0-9_-]{10,}|GhIJ[A-Za-z0-9_-]{10,})/i,
    )?.[1];
    if (looksLikeGooglePlaceId(pathPlaceId)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Maps-Pin und Google-Place müssen am selben Ort liegen — nicht 60 km entfernt. */
export const NEARBY_LISTED_GOOGLE_PLACE_MAX_M = 220;

function foldPlaceName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeNameFitsMapsQuery(query: string, hitName: string): boolean {
  const q = foldPlaceName(query);
  const h = foldPlaceName(hitName);
  if (q.length < 3 || h.length < 3) return false;
  if (q === h) return true;
  const shorter = q.length <= h.length ? q : h;
  const longer = q.length <= h.length ? h : q;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const lockerQ = /\b(packstation|paketautomat|parcel\s*locker)\b/.test(q);
  const lockerH = /\b(packstation|paketautomat|parcel\s*locker)\b/.test(h);
  const numQ = q.match(/\b(\d{2,4})\b/)?.[1];
  const numH = h.match(/\b(\d{2,4})\b/)?.[1];
  if (lockerQ && lockerH && (!numQ || !numH || numQ === numH)) return true;
  const tokens = (s: string) =>
    s.split(' ').filter((t) => t.length >= 5 && !/^(strasse|strasse|platz|gasse|kirche|brucke|bruecke)$/.test(t));
  const qt = tokens(q);
  const ht = tokens(h);
  if (!qt.length || !ht.length) return false;
  return qt.some((t) =>
    ht.some((x) => x === t || x.includes(t) || t.includes(x)),
  );
}

/**
 * Nimmt nur einen Google-Place, der wirklich am Pin liegt.
 * Berühmte Namensvettern (andere Stadt) fallen raus.
 */
export function pickNearbyListedGooglePlace(opts: {
  queryName?: string | null;
  hits: Array<{
    placeId?: string | null;
    name?: string | null;
    distanceM?: number | null;
  }>;
  maxDistanceM?: number;
}): { placeId: string; name: string } | null {
  const maxM = opts.maxDistanceM ?? NEARBY_LISTED_GOOGLE_PLACE_MAX_M;
  const query = String(opts.queryName ?? '').trim();
  const ranked = [...opts.hits].sort(
    (a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9),
  );
  for (const hit of ranked) {
    const id = hit.placeId;
    if (!looksLikeGooglePlaceId(id)) continue;
    const dist = Number(hit.distanceM);
    if (!Number.isFinite(dist) || dist > maxM) continue;
    const name = String(hit.name ?? '').trim() || query;
    if (placeNameFitsMapsQuery(query, name)) {
      return { placeId: String(id).replace(/^places\//, ''), name };
    }
  }
  return null;
}

/** Maps-URL nur mit belegter Google-Place-ID. */
export function mapsUrlForGooglePlace(opts: {
  placeName?: string | null;
  city?: string | null;
  placeId?: string | null;
}): string | null {
  if (!looksLikeGooglePlaceId(opts.placeId)) return null;
  const id = String(opts.placeId).trim().replace(/^places\//, '');
  const name =
    sanitizeMapsPlaceQuery(opts.placeName) ||
    sanitizeMapsPlaceQuery(opts.city) ||
    'place';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    name,
  )}&query_place_id=${encodeURIComponent(id)}`;
}

/**
 * Maps-Suchtext: nur konkreter Ortsname oder Adresse — kein Fließtext/Speech.
 * Optional trailing `@lat,lng` bleibt erhalten (Pin-Genauigkeit).
 */
export function sanitizeMapsPlaceQuery(
  raw: string | null | undefined,
): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    if (/%[0-9A-Fa-f]{2}/.test(s)) s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();

  // Optional Google-Pin-Suffix: "Name @53.5,10.0"
  let pinSuffix = '';
  const pin = s.match(/\s*@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (pin) {
    pinSuffix = `@${pin[1]},${pin[2]}`;
    s = s.slice(0, pin.index).trim();
  }

  // Labels / Emojis / Button-Prefix weg
  s = s
    .replace(/^[🗺️🗺📍🌐📄🎫]\s*/u, '')
    .replace(/^(?:maps?|karte|route|navigation|google\s*maps?)\s*[·|:–—-]\s*/iu, '')
    .replace(/\s*[·|]\s*(?:maps?|karte|route)\s*$/iu, '')
    .trim();

  // Erste Zeile / vor Satzende-Prosa
  s = s.split(/[\n\r]/)[0]!.trim();
  s = s.split(/\s+[–—]\s+/)[0]!.trim();

  // Fließtext / ganze Sätze → nur Name/Adresse davor
  if (
    s.length > 90 ||
    /[.!?].{12,}[.!?]/.test(s) ||
    /\b(ich|du|wir|bitte|soll(?:te)?n?|kannst|würden?|empfehl|hingehen|weil)\b/iu.test(
      s,
    ) ||
    /\b(ist|sind|war|liegt|bietet|hat)\s+(super|toll|mega|ein|eine|der|die|das)\b/iu.test(
      s,
    )
  ) {
    const cut = s.match(
      /^(.{3,55}?)(?:\s+(?:ist|sind|war|liegt|bietet|hat|und|weil|mit|für|bei|nach|zum|zur)\b)/iu,
    );
    if (cut?.[1]) {
      s = cut[1].trim();
    } else {
      const head = s.split(/[.!?]/)[0]!.split(/[·•|;]/)[0]!.trim();
      s = head;
    }
  }

  // Straße + Ort oft mit Komma — behalten, aber kürzen
  if (s.length > 72) {
    const cut = s.slice(0, 72);
    const atSpace = cut.replace(/\s+\S*$/, '').trim();
    s = atSpace.length >= 3 ? atSpace : cut.trim();
  }

  if (s.length < 3) return null;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s)) return null;
  if (/^(ort|venue|location|hier|place|ziel|adresse)$/i.test(s)) return null;

  return pinSuffix ? `${s}${pinSuffix}` : s;
}

/** Google-Maps-Link nur mit belegter Place-ID — Namenssuche allein reicht nicht. */
export function buildNamedPlaceMapsUrl(opts: {
  placeName?: string | null;
  city?: string | null;
  placeId?: string | null;
}): string | null {
  return mapsUrlForGooglePlace(opts);
}

/**
 * Maps-OPEN_URL: Query auf konkreten Ort/Adresse trimmen (destName bevorzugt).
 */
export function rewriteGoogleMapsOpenUrl(opts: {
  url: string;
  destName?: string | null;
  entityName?: string | null;
}): string {
  const raw = String(opts.url ?? '').trim();
  if (!raw || !/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(raw)) {
    return raw;
  }
  const preferred =
    sanitizeMapsPlaceQuery(opts.destName) ||
    sanitizeMapsPlaceQuery(opts.entityName);

  try {
    const u = new URL(raw);
    const key = u.searchParams.has('query')
      ? 'query'
      : u.searchParams.has('q')
        ? 'q'
        : null;
    if (!key) {
      return raw;
    }
    const current = sanitizeMapsPlaceQuery(u.searchParams.get(key));
    const next = preferred || current;
    if (!next) return raw;
    // Nur ersetzen wenn nötig (zu lang / unsauber) oder destName klar besser
    const rawQ = (u.searchParams.get(key) || '').replace(/\+/g, ' ');
    const dirty =
      rawQ.length > 72 ||
      /\b(ich|du|wir|bitte|soll|kannst)\b/iu.test(rawQ) ||
      /[.!?].{8,}/.test(rawQ) ||
      preferred != null;
    if (!dirty && current) return raw;
    u.searchParams.set(key, next);
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Gefundene Event-Seite 1:1 behalten (Tracking/www/en weg).
 * Keine Slug-Erfindung, kein Stadt-Prefix-Umbau.
 * Stadt-Kalender / Junk → null.
 */
export function keepFoundEventUrl(
  url: string | null | undefined,
): string | null {
  const raw = String(url ?? '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  if (isJunkEventInfoUrl(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  dropTrackingParams(parsed);
  if (rausgegangenHost(parsed.hostname)) {
    parsed.hostname = 'rausgegangen.de';
    parsed.pathname = canonicalizeRausgegangenPath(parsed.pathname);
    if (parsed.pathname.startsWith('/en/')) {
      parsed.pathname = parsed.pathname.slice(3) || '/';
    }
    if (/\.pdf$/i.test(parsed.pathname)) {
      parsed.search = '';
      return parsed.toString();
    }
    const detailSlug = rausgegangenEventDetailPath(parsed.pathname);
    if (!detailSlug) return null;
    parsed.search = '';
    return withTrailingSlash(`https://rausgegangen.de/events/${detailSlug}`);
  }
  if (isGenericEventListingUrl(raw)) return null;
  return parsed.toString();
}

const WEAK_SLUG_TOKENS = new Set([
  'club',
  'event',
  'events',
  'party',
  'live',
  'show',
  'ticket',
  'tickets',
  'heute',
  'abend',
  'night',
]);

function matchTokens(hints: EventInfoUrlHints): string[] {
  const blob = slugifyRausgegangen(
    `${hints.title ?? ''} ${hints.venue ?? ''}`,
  );
  return blob
    .split('-')
    .filter((t) => t.length >= 4 && !WEAK_SLUG_TOKENS.has(t));
}

/**
 * URL muss zum Event-Titel/Venue passen (wie „Link aus dem Browser kopieren“).
 * Ohne Namens-Treffer → false (keine Suchtprävention statt Weinfest).
 */
export function eventUrlMatchesHints(
  url: string,
  hints: EventInfoUrlHints,
): boolean {
  const kept = keepFoundEventUrl(url);
  if (!kept) return false;
  if (/\.pdf(\?|$)/i.test(kept)) return true;
  const tokens = matchTokens(hints);
  if (!tokens.length) {
    // Kein Titel-Stoff: nur klarer Event-Detail-Pfad auf bekannten Hosts
    try {
      const path = new URL(kept).pathname.toLowerCase();
      return /\/events\/[a-z0-9-]{8,}/i.test(path);
    } catch {
      return false;
    }
  }
  const hay = slugifyRausgegangen(kept);
  const hits = tokens.filter((t) => hay.includes(t));
  const strong = hits.filter((t) => t.length >= 5);
  if (strong.length >= 1) return true;
  if (hits.length >= 2) return true;
  // Ein kurzer aber eindeutiger Venue-Treffer (z. B. „walters“)
  if (hits.length === 1 && hits[0]!.length >= 6) return true;
  return false;
}

function scoreUrlAgainstHints(url: string, hints: EventInfoUrlHints): number {
  if (!eventUrlMatchesHints(url, hints)) return -1;
  let path = '';
  let host = '';
  try {
    const u = new URL(url);
    path = u.pathname.toLowerCase();
    host = u.hostname.toLowerCase();
  } catch {
    return -1;
  }
  const tokens = matchTokens(hints);
  const city = slugifyRausgegangen(hints.city ?? '');
  const hay = slugifyRausgegangen(url);
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += t.length >= 5 ? 4 : 3;
  }
  if (city && (path.includes(city) || host.includes(city))) score += 1;
  if (/\/events\//.test(path)) score += 2;
  if (/\.pdf(\?|$)/i.test(path)) score += 3;
  // Spielplan/Fixtures/Tickets tiefer als Club-Homepage (analog Speisekarte)
  try {
    const {
      scheduleUrlQualityScore,
      isClubOrActHomepageUrl,
    } = require('../actionBoard/scheduleDeepLink') as {
      scheduleUrlQualityScore: (u: string) => number;
      isClubOrActHomepageUrl: (u: string) => boolean;
    };
    const schedQ = scheduleUrlQualityScore(url);
    if (schedQ > 0) score += Math.min(8, Math.floor(schedQ / 10));
    if (isClubOrActHomepageUrl(url)) score -= 4;
  } catch {
    if (
      /\/(spielplan|fixtures?|schedule|tickets?|heimspiele?)(\/|\.|\?|#|$)/i.test(
        path,
      )
    ) {
      score += 5;
    }
    if (path === '/' || path === '') score -= 4;
  }
  if (/rausgegangen\.de|eventim|ticketmaster|facebook\.com\/events/i.test(host)) {
    score += 1;
  }
  return score;
}

/**
 * Suchtreffer-URL, die zu diesem Event gehört — 1:1 aus Grounding/Browser.
 * Nie die einzige irrelevante URL „durchwinken“.
 */
export function pickGroundingEventUrl(
  urls: string[],
  hints: EventInfoUrlHints,
): string | null {
  const kept = [
    ...new Set(urls.map((u) => keepFoundEventUrl(u)).filter(Boolean)),
  ] as string[];
  if (!kept.length) return null;
  let best: { url: string; score: number } | null = null;
  for (const url of kept) {
    const score = scoreUrlAgainstHints(url, hints);
    if (score < 0) continue;
    if (!best || score > best.score) best = { url, score };
  }
  if (!best) return null;
  // Mindestens ein Titel-/Venue-Treffer (scoreUrl verlangt Matches)
  return best.score >= 2 ? best.url : null;
}

/**
 * LLM-/Grounding-URL nur behalten wenn sie zum Event passt.
 */
export function resolveEventInfoUrl(opts: {
  candidate?: string | null;
  groundingUrls?: string[] | null;
  hints: EventInfoUrlHints;
}): string | null {
  const grounding = opts.groundingUrls?.length
    ? pickGroundingEventUrl(opts.groundingUrls, opts.hints)
    : null;
  if (grounding) return grounding;
  const cand = keepFoundEventUrl(opts.candidate);
  if (cand && eventUrlMatchesHints(cand, opts.hints)) return cand;
  return null;
}

/**
 * Garantierter Such-Link — immer gültiges https, öffnet Browser mit Event-Query.
 * Kein erfundener Detail-Slug.
 */
export function buildEventInfoSearchFallbackUrl(
  hints: EventInfoUrlHints,
): string {
  const bits = [hints.title, hints.venue, hints.city, 'Programm']
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length >= 2);
  const q = (bits.join(' ') || 'Event Programm')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export type EventProgramLink = {
  url: string;
  /** Direkte Event-Seite/PDF vs. immer-funktionierende Suche */
  kind: 'page' | 'search';
  label: string;
};

/**
 * Programm-Link-Kette (SSOT):
 * 1) Grounding-/LLM-Detailseite (nur wenn Name passt, kein Junk)
 * 2) Ticket-URL wenn sie zum Event passt
 * 3) Google-Suche Titel+Venue+Stadt — immer klickbar
 *
 * Niemals erfundene Rausgegangen-Slugs. Niemals null (Button braucht URL).
 */
export function resolveEventProgramLink(opts: {
  candidate?: string | null;
  ticketUrl?: string | null;
  groundingUrls?: string[] | null;
  hints: EventInfoUrlHints;
  hasPdf?: boolean;
}): EventProgramLink {
  const page = resolveEventInfoUrl({
    candidate: opts.candidate,
    groundingUrls: opts.groundingUrls,
    hints: opts.hints,
  });
  if (page) {
    const pdf =
      opts.hasPdf === true || /\.pdf(\?|$)/i.test(page);
    let scheduleLabel = false;
    let hollowHome = false;
    try {
      const {
        isScheduleDeepPath,
        isClubOrActHomepageUrl,
      } = require('../actionBoard/scheduleDeepLink') as {
        isScheduleDeepPath: (u: string) => boolean;
        isClubOrActHomepageUrl: (u: string) => boolean;
      };
      scheduleLabel = isScheduleDeepPath(page);
      hollowHome = isClubOrActHomepageUrl(page);
    } catch {
      scheduleLabel =
        /\/(spielplan|fixtures?|schedule|tickets?)(\/|\.|\?|#|$)/i.test(page);
      hollowHome = false;
    }
    // Venue-/Club-Home nie als „Programm“ — analog Speisekarte
    if (!hollowHome) {
      return {
        url: page,
        kind: 'page',
        label: pdf
          ? '📄 Programm'
          : scheduleLabel
            ? '📅 Spielplan'
            : '🌐 Programm',
      };
    }
  }

  const ticket = keepFoundEventUrl(opts.ticketUrl);
  if (ticket && eventUrlMatchesHints(ticket, opts.hints)) {
    return {
      url: ticket,
      kind: 'page',
      label: '🌐 Programm',
    };
  }

  return {
    url: buildEventInfoSearchFallbackUrl(opts.hints),
    kind: 'search',
    label: '🔍 Infos',
  };
}

/** Detail-URLs: 404/410/Soft-404 verwerfen (erfundene Slugs). Netz weg → behalten. */
export async function dropDeadEventPageUrl(
  url: string | null | undefined,
): Promise<string | null> {
  const kept = keepFoundEventUrl(url);
  if (!kept) return null;
  try {
    const { probeUrlAlive } = require('./liveDeepLink') as {
      probeUrlAlive: (u: string) => Promise<{ ok: boolean; finalUrl: string }>;
    };
    const probe = await probeUrlAlive(kept);
    if (!probe.ok) return null;
    return probe.finalUrl && /^https?:/i.test(probe.finalUrl)
      ? probe.finalUrl
      : kept;
  } catch {
    return kept;
  }
}

export function extractHttpUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s"'<>)\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) {
    const cleaned = m[0].replace(/[.,;:]+$/, '');
    if (/^https?:\/\//i.test(cleaned)) out.push(cleaned);
  }
  return out;
}

export function overlayGroundingEventUrls<
  T extends { title: string; venue: string; infoUrl: string | null; ticketUrl: string | null },
>(events: T[], groundingUrls: string[], city?: string | null): T[] {
  const used = new Set<string>();
  return events.map((e) => {
    const hints = { title: e.title, venue: e.venue, city };
    const pool = groundingUrls.filter((u) => !used.has(u));
    const info = resolveEventInfoUrl({
      candidate: e.infoUrl,
      groundingUrls: pool,
      hints,
    });
    if (info) used.add(info);
    const ticketRaw = keepFoundEventUrl(e.ticketUrl);
    const ticket =
      ticketRaw && eventUrlMatchesHints(ticketRaw, hints) ? ticketRaw : null;
    return {
      ...e,
      infoUrl: info,
      ticketUrl: ticket && ticket !== info ? ticket : ticket || null,
    };
  });
}

/**
 * Gefundene Detail-URL 1:1; Stadt-Kalender nicht als Event-Link.
 * Erfindet keine Rausgegangen-Slugs aus Titel/Stadt.
 */
export function canonicalizeEventInfoUrl(
  url: string | null | undefined,
  _hints?: EventInfoUrlHints,
): string | null {
  return keepFoundEventUrl(url);
}
