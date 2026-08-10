/**
 * Kino / Film / Spielzeiten — weltweite Blaupause, kein Stadt-/Film-Hardcode.
 * Schnell: nahe Kinos (expanding). Parallel: Web-Recherche zu Zeiten + Ticket/Web.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { searchPlacesExpanding } from '../navigation/expandingPlaceSearch';
import {
  searchPlacesByText,
  type DiscoveredPlace,
} from '../navigation/googleMapsNav';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { Module2ActionButton } from '../../module2/types';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';

export type CinemaVenue = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  websiteUri: string | null;
  phoneNumber: string | null;
  openNow: boolean | null;
};

export type CinemaShowtimeHit = {
  filmTitle: string;
  cinemaName: string;
  /** z. B. „heute 17:30, 20:15“ oder „morgen ab 18:00“ */
  whenLabel: string;
  infoUrl: string | null;
  ticketUrl: string | null;
  /** Belegter Ticketpreis in Euro, sonst null */
  priceEur: number | null;
  /** YouTube-Trailer wenn belegt */
  trailerUrl: string | null;
  /** Snack/Popcorn-Preis wenn Crowd proaktiv will + Quelle belegt */
  snackPriceHint?: string | null;
};

/** Orient-Turn: Film-/Genre-Picks ohne Uhrzeiten-Salve */
export type CinemaFilmPick = {
  title: string;
  genreHint: string | null;
  oneLiner: string | null;
  cinemaNames: string[];
};

/** orient = Kinos+Filme zuerst; showtimes = konkreter Film / Uhrzeiten gewünscht */
export type CinemaPhase = 'orient' | 'showtimes';

export type CinemaResearchResult = {
  filmHint: string | null;
  cityHint: string | null;
  phase: CinemaPhase;
  venues: CinemaVenue[];
  filmPicks: CinemaFilmPick[];
  showtimes: CinemaShowtimeHit[];
  /** Faktenblock für Synthese — nicht wörtlich vorlesen */
  promptBlock: string;
  /** Sofort-Buttons (Nav + ggf. Web der Kinos) */
  fastButtons: Module2ActionButton[];
  /** Ticket/Programm-Links — dürfen später nachgereicht werden */
  deferredButtons: Module2ActionButton[];
  notes: string;
  /** Web-Recherche lief in Budget nicht fertig → Caller soll nachreichen */
  showtimesPending?: boolean;
};

const CINEMA_RE =
  /\b(kino|cinema|filmtheater|kinoprogramm|kinoticket|vorstellung|leinwand)\b/iu;

/** Film + Kino / dahin führen / Programm — Just-Do-It, keine Timeline. */
export function isCinemaMovieQuery(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (CINEMA_RE.test(t)) return true;
  if (
    /\b(film|movie)\b/iu.test(t) &&
    /\b(schauen|ansehen|laufen|spielt|neu(?:e[rn]?)?|rausgekommen|ticket|vorstellung|empfehl)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Turn-1-Orientierung vs. Zeiten/Tickets.
 * Empfehlungsfragen → zuerst Kinos + Genres/Filme, keine Uhrzeiten-Salve.
 */
export function detectCinemaPhase(text: string): CinemaPhase {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'orient';
  if (
    /\b(wann|um\s+wie\s*viel|uhrzeit(?:en)?|spielzeit(?:en)?|vorstellung(?:en)?|ticket(?:s)?\s+(?:für|zu)|karten\s+für|welche\s+uhr)\b/iu.test(
      t,
    )
  ) {
    return 'showtimes';
  }
  const { filmHint } = extractCinemaHints(t);
  if (
    /\b(welche\s+filme|was\s+(?:kannst|läuf|läuft|empfehl)|empfehlen|ins\s+kino|kino\s+gehen|kinobesuch|kinoabend)\b/iu.test(
      t,
    )
  ) {
    // „Welche Filme …“ bleibt Orient, auch wenn ein Genre genannt ist
    if (!filmHint) return 'orient';
    // Genre-Wörter sind keine Film-Titel
    if (
      filmHint &&
      /\b(komödie|comedy|action|drama|thriller|horror|familie|kinder)\b/iu.test(
        filmHint,
      )
    ) {
      return 'orient';
    }
  }
  if (filmHint && filmHint.length >= 3) return 'showtimes';
  if (CINEMA_RE.test(t) && !filmHint) return 'orient';
  return 'orient';
}

/** Struktur-Hint für Synthese — kein Zwangs-Wortlaut. */
export function venueCharacterHint(name: string): string {
  const n = name.toLowerCase();
  if (
    /\b(cineplex|uci|cinestar|cinemaxx|multiplex|pathé|pathe|kino\s*center)\b/u.test(
      n,
    )
  ) {
    return 'großes Multiplex / breite Auswahl';
  }
  if (
    /\b(burgkino|filmbühne|filmtheater|programmkino|atelier|lichtspiele|kino\s*treff)\b/u.test(
      n,
    )
  ) {
    return 'kleineres / heimisches Kino';
  }
  return 'Kino in Reichweite';
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
}

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Grober Film-/Ort-Hinweis aus der User-Frage — keine Produkt-Hardcodes. */
export function extractCinemaHints(text: string): {
  filmHint: string | null;
  cityHint: string | null;
} {
  const t = text.replace(/\s+/g, ' ').trim();
  let cityHint: string | null = null;
  const cityM = t.match(
    /\b(?:in|nach|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})?)/u,
  );
  if (cityM?.[1] && !/Kino|Film|Cinema/i.test(cityM[1])) {
    cityHint = cityM[1].trim();
  }

  let filmHint: string | null = null;
  const quoted = t.match(/[„""]([^„""]{2,60})[„""]/);
  if (quoted?.[1]) filmHint = quoted[1].trim();
  if (!filmHint) {
    const neu = t.match(
      /\b(?:neue[rn]?|neuen)\s+([A-ZÄÖÜ][\wÄÖÜäöüß'’\-]*(?:\s+\d+)?(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß'’\-]*){0,4})/u,
    );
    if (neu?.[1] && !/Kino|Filmtheater/i.test(neu[1])) {
      filmHint = neu[1].replace(/\s+/g, ' ').trim();
    }
  }
  if (!filmHint) {
    const titled = t.match(
      /\b([A-ZÄÖÜ][\wÄÖÜäöüß'’\-]*(?:\s*[:\-–]\s*)?(?:\s+[A-ZÄÖÜ\d][\wÄÖÜäöüß'’\-]*){0,5})\s+(?:im\s+Kino|im\s+Cinema|im\s+Filmtheater)/iu,
    );
    if (titled?.[1] && titled[1].length >= 3) {
      filmHint = titled[1].replace(/\s+/g, ' ').trim();
    }
  }
  return { filmHint, cityHint };
}

function toVenue(p: DiscoveredPlace): CinemaVenue {
  return {
    name: (p.name || 'Kino').trim(),
    lat: p.lat,
    lng: p.lng,
    distanceM: p.distanceM,
    websiteUri: p.websiteUri?.trim() || null,
    phoneNumber: p.phoneNumber?.trim() || null,
    openNow: typeof p.openNow === 'boolean' ? p.openNow : null,
  };
}

function navButton(v: CinemaVenue, i: number): Module2ActionButton {
  return {
    id: `cinema_nav_${i}`,
    label: shortenActionLabel(`📍 ${v.name}`),
    payload: {
      kind: 'navigate',
      lat: v.lat,
      lng: v.lng,
      label: v.name,
    },
  };
}

function urlButton(
  id: string,
  label: string,
  url: string,
): Module2ActionButton {
  return {
    id,
    label: shortenActionLabel(label),
    payload: { kind: 'deep_link', url, destName: label },
  };
}

async function findNearbyCinemas(opts: {
  lat: number;
  lng: number;
  cityHint: string | null;
  signal?: AbortSignal;
}): Promise<CinemaVenue[]> {
  const expanding = await searchPlacesExpanding({
    lat: opts.lat,
    lng: opts.lng,
    placeType: 'movie_theater',
    keyword: 'Kino',
    openNow: false,
    minResults: 2,
    rings: [8_000, 15_000, 30_000, 50_000],
  });
  const byId = new Map<string, CinemaVenue>();
  for (const p of expanding.places) {
    const v = toVenue(p);
    const key = `${v.name.toLowerCase()}|${v.lat.toFixed(4)}|${v.lng.toFixed(4)}`;
    if (!byId.has(key)) byId.set(key, v);
  }

  // Textsuche mit Ortskontext (Nachbarorte / genannte Stadt)
  const queries = [
    opts.cityHint ? `Kino ${opts.cityHint}` : null,
    'Kino',
    'Filmtheater',
  ].filter(Boolean) as string[];
  for (const q of queries) {
    if (opts.signal?.aborted) break;
    try {
      const hits = await searchPlacesByText({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM: 50_000,
        includedType: 'movie_theater',
      });
      for (const p of hits) {
        const v = toVenue(p);
        const key = `${v.name.toLowerCase()}|${v.lat.toFixed(4)}|${v.lng.toFixed(4)}`;
        if (!byId.has(key)) byId.set(key, v);
      }
    } catch {
      /* soft */
    }
    if (byId.size >= 4) break;
  }

  return [...byId.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 4);
}

const WEEKDAY_DE = [
  'sonntag',
  'montag',
  'dienstag',
  'mittwoch',
  'donnerstag',
  'freitag',
  'samstag',
] as const;

type ParsedClock = { minutes: number; raw: string };

function parseClocksInLabel(label: string): ParsedClock[] {
  const out: ParsedClock[] = [];
  const seen = new Set<number>();
  const push = (h: number, m: number, raw: string) => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return;
    const minutes = h * 60 + m;
    if (seen.has(minutes)) return;
    seen.add(minutes);
    out.push({ minutes, raw });
  };
  for (const m of label.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)) {
    push(Number(m[1]), Number(m[2]), m[0]);
  }
  for (const m of label.matchAll(/\b([01]?\d|2[0-3])\s*uhr\b/gi)) {
    push(Number(m[1]), 0, m[0]);
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

function labelRefersToFutureDay(label: string, now: Date): boolean {
  const l = label.toLowerCase();
  if (/\b(morgen|übermorgen|uebermorgen)\b/u.test(l)) return true;
  if (/\bnächste[nr]?\s+(woche|wochenende)\b/u.test(l)) return true;
  const todayIdx = now.getDay();
  for (let i = 0; i < WEEKDAY_DE.length; i++) {
    const name = WEEKDAY_DE[i]!;
    if (!new RegExp(`\\b${name}\\b`, 'u').test(l)) continue;
    if (i === todayIdx) return false;
    return true;
  }
  return false;
}

function labelIsClearlyPastPeriod(label: string, now: Date): boolean {
  const l = label.toLowerCase();
  const h = now.getHours();
  if (!/\bheute\b/u.test(l)) return false;
  if (/\b(vormittag|vormittags)\b/u.test(l) && h >= 13) return true;
  if (/\b(mittag|mittags)\b/u.test(l) && h >= 15) return true;
  if (/\b(nachmittag|nachmittags)\b/u.test(l) && h >= 18) return true;
  return false;
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Nur noch kommende Vorstellungen: heutige Uhrzeiten vor „jetzt“ streichen.
 * Morgen/Wochentage in der Zukunft bleiben. Rein vergangene Einträge → null.
 */
export function filterFutureWhenLabel(
  whenLabel: string,
  now: Date = new Date(),
): string | null {
  const raw = whenLabel.replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  if (labelRefersToFutureDay(raw, now)) return raw;
  if (labelIsClearlyPastPeriod(raw, now)) return null;

  const clocks = parseClocksInLabel(raw);
  if (clocks.length === 0) {
    // Qualitative Labels ohne Uhr („heute Abend“) — behalten wenn nicht klar vorbei
    return raw;
  }

  // Bare Zeiten / „heute …“ = heute → nur Startzeiten ab jetzt
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const future = clocks.filter((c) => c.minutes >= nowMin);
  if (future.length === 0) return null;

  const timeStr = future.map((c) => formatClock(c.minutes)).join(', ');
  if (/\bheute\b/iu.test(raw)) return `heute ${timeStr}`;
  if (/^\s*ab\b/iu.test(raw)) return `ab ${timeStr}`;
  return timeStr;
}

function keepFutureShowtimes(
  rows: CinemaShowtimeHit[],
  now: Date = new Date(),
): CinemaShowtimeHit[] {
  const out: CinemaShowtimeHit[] = [];
  for (const s of rows) {
    const whenLabel = filterFutureWhenLabel(s.whenLabel, now);
    if (!whenLabel) continue;
    out.push({ ...s, whenLabel });
  }
  return out;
}

async function researchShowtimesWeb(opts: {
  userText: string;
  filmHint: string | null;
  cityHint: string | null;
  venues: CinemaVenue[];
  signal?: AbortSignal;
}): Promise<{ showtimes: CinemaShowtimeHit[]; notes: string }> {
  if (!hasGeminiApiKey()) return { showtimes: [], notes: 'no_gemini' };
  const offline = await isDeviceOffline();
  if (offline) return { showtimes: [], notes: 'offline' };

  const now = new Date();
  const today = now.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const clockNow = now.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const venueList = opts.venues
    .slice(0, 4)
    .map((v) => `${v.name} (~${formatDist(v.distanceM)})`)
    .join('; ');

  const wantSnackPrices = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { hasPromotedFollowUpSlot } = require('../memory/collectiveLearning') as {
        hasPromotedFollowUpSlot: (o: {
          intentFamily?: string | null;
          slot: string;
          topic?: string | null;
        }) => boolean;
      };
      return (
        hasPromotedFollowUpSlot({
          intentFamily: 'events',
          slot: 'prices',
          topic: 'popcorn',
        }) ||
        hasPromotedFollowUpSlot({
          intentFamily: 'events',
          slot: 'prices',
          topic: 'snacks',
        }) ||
        hasPromotedFollowUpSlot({ intentFamily: 'events', slot: 'prices' })
      );
    } catch {
      return false;
    }
  })();

  const prompt = [
    'Du recherchierst Kinoprogramm / Spielzeiten (Google Search).',
    `HEUTE: ${today}.`,
    `JETZT (Uhrzeit): ${clockNow}.`,
    `User: „${opts.userText.trim().slice(0, 280)}“`,
    opts.filmHint ? `Film-Hinweis: ${opts.filmHint}` : 'Film: aus User-Frage ableiten.',
    opts.cityHint ? `Orts-Hinweis: ${opts.cityHint}` : '',
    venueList ? `Gefundene Kinos in der Nähe: ${venueList}` : 'Keine Kino-GPS-Treffer — suche regionale Kinos um den genannten Ort.',
    '',
    'AUFGABE: Finde belegte Spielzeiten für den genannten Film (heute/morgen) in erreichbaren Kinos.',
    'NUR ZUKUNFT: In whenLabel ausschließlich Startzeiten, die noch kommen (≥ JETZT). Schon begonnene/vergangene Vorstellungen weglassen.',
    'Wenn heute keine zukünftige Vorstellung mehr: nur morgen/nächste belegte Termine — oder ehrlich „heute keine mehr“.',
    'Pro Treffer: cinemaName, whenLabel (nur künftige Uhrzeiten), infoUrl (Programmseite), ticketUrl (Buchung), priceEur (Zahl oder null), trailerUrl (YouTube https oder null)' +
      (wantSnackPrices
        ? ', snackPriceHint (Popcorn/Snacks-Preis-Text wenn auf Kino-/Snack-Seite belegt, sonst null)'
        : '') +
      '.',
    'PFLICHT wenn belegbar: Ticket-URL, Preis in Euro, Trailer-Link — sonst null, nie erfinden.',
    wantSnackPrices
      ? 'CROWD-LERNEN: User fragen oft nach Popcorn-/Snack-Preisen — wenn belegt, snackPriceHint setzen und in der Antwort mitliefern; sonst null, nichts schätzen.'
      : '',
    'VERBOTEN: erfundene Uhrzeiten/Preise/URLs, vergangene Uhrzeiten von heute.',
    FINDUS_FEW_SHOT_DISCLAIMER,
    '',
    'Nur JSON:',
    '{',
    '  "researchNotes": "kurz",',
    '  "filmTitle": "…",',
    '  "showtimes": [',
    '    { "cinemaName":"…", "whenLabel":"heute 20:15", "infoUrl":"https://…"|null, "ticketUrl":"https://…"|null, "priceEur":12|null, "trailerUrl":"https://youtube.com/…"|null' +
      (wantSnackPrices ? ', "snackPriceHint":"Popcorn groß ca. 6€"|null' : '') +
      ' }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 900,
      temperature: 0.2,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { showtimes: [], notes: 'parse_fail' };
    }
    const root = parsed as Record<string, unknown>;
    const filmTitle =
      typeof root.filmTitle === 'string' && root.filmTitle.trim()
        ? root.filmTitle.trim()
        : opts.filmHint || 'Film';
    const notes =
      typeof root.researchNotes === 'string' ? root.researchNotes : '';
    const rows = Array.isArray(root.showtimes) ? root.showtimes : [];
    const showtimes: CinemaShowtimeHit[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const cinemaName = String(r.cinemaName ?? r.venue ?? '').trim();
      const whenLabel = String(r.whenLabel ?? r.times ?? '').trim();
      if (!cinemaName || !whenLabel) continue;
      const infoUrl =
        typeof r.infoUrl === 'string' && /^https?:\/\//i.test(r.infoUrl)
          ? r.infoUrl
          : null;
      const ticketUrl =
        typeof r.ticketUrl === 'string' && /^https?:\/\//i.test(r.ticketUrl)
          ? r.ticketUrl
          : null;
      const trailerRaw =
        typeof r.trailerUrl === 'string' ? r.trailerUrl.trim() : '';
      const trailerUrl =
        /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trailerRaw)
          ? trailerRaw
          : null;
      const priceRaw = r.priceEur ?? r.price;
      const priceEur =
        typeof priceRaw === 'number' && Number.isFinite(priceRaw) && priceRaw > 0
          ? Math.round(priceRaw)
          : typeof priceRaw === 'string' && /\d/.test(priceRaw)
            ? Math.round(Number(priceRaw.replace(/[^\d.,]/g, '').replace(',', '.')))
            : null;
      showtimes.push({
        filmTitle,
        cinemaName,
        whenLabel,
        infoUrl,
        ticketUrl,
        priceEur:
          priceEur != null && Number.isFinite(priceEur) && priceEur < 80
            ? priceEur
            : null,
        trailerUrl,
        snackPriceHint:
          typeof r.snackPriceHint === 'string' && r.snackPriceHint.trim().length > 3
            ? r.snackPriceHint.trim().slice(0, 120)
            : null,
      });
    }
    return {
      showtimes: keepFutureShowtimes(showtimes, now).slice(0, 4),
      notes,
    };
  } catch {
    return { showtimes: [], notes: 'research_fail' };
  }
}

async function researchCinemaProgramWeb(opts: {
  userText: string;
  cityHint: string | null;
  venues: CinemaVenue[];
  signal?: AbortSignal;
}): Promise<{ filmPicks: CinemaFilmPick[]; notes: string }> {
  if (!hasGeminiApiKey()) return { filmPicks: [], notes: 'no_gemini' };
  const offline = await isDeviceOffline();
  if (offline) return { filmPicks: [], notes: 'offline' };

  const now = new Date();
  const today = now.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const venueList = opts.venues
    .slice(0, 4)
    .map(
      (v) =>
        `${v.name} (~${formatDist(v.distanceM)}; Charakter-Hint: ${venueCharacterHint(v.name)})`,
    )
    .join('; ');

  const prompt = [
    'Du recherchierst aktuelles Kinoprogramm in erreichbaren Kinos (Google Search).',
    `HEUTE: ${today}.`,
    `User: „${opts.userText.trim().slice(0, 280)}“`,
    opts.cityHint ? `Orts-Hinweis (nur Fallback): ${opts.cityHint}` : 'Ort: aus GPS/Kinos ableiten — Stadt NICHT nachfragen.',
    venueList
      ? `Gefundene Kinos: ${venueList}`
      : 'Keine GPS-Kinos — suche erreichbare Kinos um den User-Ort.',
    '',
    'AUFGABE (ORIENTIERUNG, keine Uhrzeiten-Salve):',
    'Finde 3–5 Filme, die in diesen Kinos aktuell / morgen Abend laufen.',
    'Pro Film: title, genreHint (z.B. Komödie/Action/Drama), oneLiner (1 Satz Spoiler-frei), cinemaNames (welche der genannten Kinos).',
    'OPTIONAL genresAvailable: kurze Liste der Genres im Angebot.',
    'VERBOTEN: erfundene Filme; lange whenLabel/Uhrzeiten-Listen (Zeiten kommen erst im Folgeturn).',
    FINDUS_FEW_SHOT_DISCLAIMER,
    '',
    'Nur JSON:',
    '{',
    '  "researchNotes": "kurz",',
    '  "genresAvailable": ["Komödie","Action"],',
    '  "films": [',
    '    { "title":"…", "genreHint":"Komödie"|null, "oneLiner":"…"|"null", "cinemaNames":["…"] }',
    '  ]',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 900,
      temperature: 0.25,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { filmPicks: [], notes: 'parse_fail' };
    }
    const root = parsed as Record<string, unknown>;
    const notes =
      typeof root.researchNotes === 'string' ? root.researchNotes : '';
    const rows = Array.isArray(root.films) ? root.films : [];
    const filmPicks: CinemaFilmPick[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = String(r.title ?? '').trim();
      if (title.length < 2) continue;
      const cinemaNames = Array.isArray(r.cinemaNames)
        ? r.cinemaNames
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
      filmPicks.push({
        title,
        genreHint:
          typeof r.genreHint === 'string' && r.genreHint.trim()
            ? r.genreHint.trim().slice(0, 40)
            : null,
        oneLiner:
          typeof r.oneLiner === 'string' && r.oneLiner.trim().length > 8
            ? r.oneLiner.trim().slice(0, 160)
            : null,
        cinemaNames,
      });
      if (filmPicks.length >= 5) break;
    }
    const genres = Array.isArray(root.genresAvailable)
      ? root.genresAvailable
          .map((g) => String(g ?? '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    return {
      filmPicks,
      notes: [notes, genres.length ? `Genres: ${genres.join(', ')}` : '']
        .filter(Boolean)
        .join(' · '),
    };
  } catch {
    return { filmPicks: [], notes: 'research_fail' };
  }
}

/**
 * Kinos schnell + Orient-Programm oder Showtimes (phasengesteuert).
 */
export async function researchCinemaAndShowtimes(opts: {
  userText: string;
  lat: number;
  lng: number;
  signal?: AbortSignal;
  /** Wenn true: nur Kinos, keine Web-Spielzeiten */
  venuesOnly?: boolean;
  /** Max. Wartezeit für Web-Recherche (Default 8s) */
  showtimeBudgetMs?: number;
  /** Override; sonst aus User-Text */
  phase?: CinemaPhase;
}): Promise<CinemaResearchResult> {
  const { filmHint, cityHint } = extractCinemaHints(opts.userText);
  const phase = opts.phase ?? detectCinemaPhase(opts.userText);
  const venues = await findNearbyCinemas({
    lat: opts.lat,
    lng: opts.lng,
    cityHint,
    signal: opts.signal,
  });

  const fastButtons: Module2ActionButton[] = [];
  for (let i = 0; i < Math.min(2, venues.length); i++) {
    fastButtons.push(navButton(venues[i]!, i));
  }
  for (let i = 0; i < venues.length && fastButtons.length < 4; i++) {
    const w = venues[i]!.websiteUri;
    if (w) {
      fastButtons.push(
        urlButton(`cinema_web_${i}`, `🌐 ${venues[i]!.name}`, w),
      );
    }
  }

  let showtimes: CinemaShowtimeHit[] = [];
  let filmPicks: CinemaFilmPick[] = [];
  let notes = '';
  let showtimesPending = false;

  if (!opts.venuesOnly) {
    const budget = Math.max(2_000, opts.showtimeBudgetMs ?? 8_000);
    if (phase === 'orient') {
      const webP = researchCinemaProgramWeb({
        userText: opts.userText,
        cityHint,
        venues,
        signal: opts.signal,
      });
      const raced = await Promise.race([
        webP.then((w) => ({ ok: true as const, w })),
        new Promise<{ ok: false }>((resolve) =>
          setTimeout(() => resolve({ ok: false }), budget),
        ),
      ]);
      if (raced.ok) {
        filmPicks = raced.w.filmPicks;
        notes = raced.w.notes;
      } else {
        notes = 'program_pending';
        void webP;
      }
    } else {
      const webP = researchShowtimesWeb({
        userText: opts.userText,
        filmHint,
        cityHint,
        venues,
        signal: opts.signal,
      });
      const raced = await Promise.race([
        webP.then((w) => ({ ok: true as const, w })),
        new Promise<{ ok: false }>((resolve) =>
          setTimeout(() => resolve({ ok: false }), budget),
        ),
      ]);
      if (raced.ok) {
        showtimes = keepFutureShowtimes(raced.w.showtimes);
        notes = raced.w.notes;
      } else {
        showtimesPending = true;
        notes = 'showtimes_pending';
        void webP;
      }
    }
  }

  const deferredButtons: Module2ActionButton[] = [];
  if (phase === 'showtimes') {
    for (let i = 0; i < showtimes.length && deferredButtons.length < 4; i++) {
      const s = showtimes[i]!;
      if (s.ticketUrl) {
        deferredButtons.push(
          urlButton(`cinema_tix_${i}`, `🎫 ${s.cinemaName}`, s.ticketUrl),
        );
      } else if (s.infoUrl) {
        deferredButtons.push(
          urlButton(`cinema_prog_${i}`, `🎬 Programm`, s.infoUrl),
        );
      }
    }
    const trailer = showtimes.find((s) => s.trailerUrl)?.trailerUrl;
    if (trailer && deferredButtons.length < 4) {
      deferredButtons.push(urlButton('cinema_trailer', '▶ Trailer', trailer));
    }
    if (
      !showtimes.some((s) => s.ticketUrl) &&
      filmHint &&
      deferredButtons.length < 4
    ) {
      const q = encodeURIComponent(`${filmHint} Kino Ticket`);
      deferredButtons.push(
        urlButton(
          'cinema_tix_search',
          '🎫 Ticket-Suche',
          `https://www.google.com/search?q=${q}`,
        ),
      );
    }
  }

  const filmLabel = filmHint || showtimes[0]?.filmTitle || filmPicks[0]?.title || 'Kino';
  const venueLines = venues.length
    ? `Kinos (GPS):\n${venues
        .slice(0, 3)
        .map(
          (v, i) =>
            `${i + 1}) ${v.name} · ${formatDist(v.distanceM)} · ${venueCharacterHint(v.name)}` +
            `${v.openNow === true ? ' · offen' : ''}` +
            `${v.websiteUri ? ` · Web: ${v.websiteUri}` : ''}`,
        )
        .join('\n')}`
    : 'Keine Kino-Treffer in Reichweite — ehrlich sagen, Region erweitern.';

  const promptBlock =
    phase === 'orient'
      ? [
          '=== KINO ORIENTIERUNG (Struktur-Hints, Wortlaut frei) ===',
          cityHint
            ? `Genannter Ort (nur Hint): ${cityHint}`
            : 'Ort: User-GPS — Stadt NICHT nachfragen.',
          notes ? `Research: ${notes}` : '',
          venueLines,
          filmPicks.length
            ? `Film-Picks (belegt):\n${filmPicks
                .slice(0, 4)
                .map(
                  (f) =>
                    `• ${f.title}` +
                    `${f.genreHint ? ` [${f.genreHint}]` : ''}` +
                    `${f.oneLiner ? ` — ${f.oneLiner}` : ''}` +
                    `${f.cinemaNames.length ? ` @ ${f.cinemaNames.join(', ')}` : ''}`,
                )
                .join('\n')}`
            : 'Film-Picks noch dünn — Kinos + typische Genres (Komödie/Action/Drama) nennen, ehrlich halten.',
          '',
          'ANTWORT-FLOW (Turn 1):',
          '1) Vorne: 2 Kinos mit Charakter (Multiplex vs. klein/heimisch) + grobe Distanz — User wird klüger.',
          '2) Dann: 2–3 Filmtitel mit Genre/One-Liner ODER Genres im Angebot — KEINE Uhrzeiten-Liste.',
          '3) Kurz offen: Kino-Vibe oder Genre — Zeiten/Tickets erst nach Wahl.',
          '4) Kein Stadt-Nachfragen, keine Timeline, keine dreifachen Bridge-Wiederholungen.',
          '5) Buttons: Route zu den Kinos / Web — nicht 8 Spielzeiten vorlesen.',
          FINDUS_FEW_SHOT_DISCLAIMER,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          '=== KINO / FILM ZEITEN (Struktur-Hints, Wortlaut frei) ===',
          `Film-Kontext: ${filmLabel}`,
          cityHint ? `Genannter Ort: ${cityHint}` : 'Ort: Umgebung vom User-GPS',
          notes ? `Research: ${notes}` : '',
          venueLines,
          showtimes.length
            ? `Spielzeiten (belegt):\n${showtimes
                .map(
                  (s) =>
                    `• ${s.filmTitle} @ ${s.cinemaName}: ${s.whenLabel}` +
                    `${s.priceEur != null ? ` · ${s.priceEur}€` : ''}` +
                    `${s.ticketUrl ? ` · Ticket ${s.ticketUrl}` : ''}`,
                )
                .join('\n')}`
            : showtimesPending
              ? 'Spielzeiten noch in Recherche — Kino/Film bestätigen, Zeiten als Buttons nach.'
              : 'Spielzeiten noch nicht belegt — ehrlich halten.',
          '',
          'ANTWORT-FLOW:',
          '1) Film + 1–2 passende Kinos + nur die relevanten künftigen Zeiten (nicht alles vorlesen).',
          '2) Preis/Ticket über Buttons wenn belegt.',
          '3) Nie vergangene heutige Vorstellungen.',
          FINDUS_FEW_SHOT_DISCLAIMER,
        ]
          .filter(Boolean)
          .join('\n');

  return {
    filmHint,
    cityHint,
    phase,
    venues,
    filmPicks,
    showtimes,
    promptBlock,
    fastButtons,
    deferredButtons,
    notes,
    showtimesPending,
  };
}
