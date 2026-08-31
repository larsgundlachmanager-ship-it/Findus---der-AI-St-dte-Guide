/**
 * Origin-Tafel ohne vorgetippten Flughafen: Wikidata → Website →
 * JSON oder HTML-Widget, nur der gebuchte Ident, max. eine Detailseite.
 * Kein Puppeteer, kein Dump aller Flüge.
 */

import { airportByIata } from './airportIata';
import { dateKeyFromMs } from '../../utils/dateKeys';
import { noteDiscoveredBoard } from './airportBoardCatalog';
import {
  identVariants,
  identsMatch,
  normalizeFlightIdent,
  splitFlightIdent,
} from './flightIdent';

export type DiscoveredBoardRow = {
  ident: string;
  dateKey: string;
  destIata: string | null;
  terminal: string | null;
  gate: string | null;
  checkinDesk: string | null;
  cancelled: boolean;
  plannedMs: number | null;
  expectedMs: number | null;
  status: string | null;
};

type Recipe = { iata: string; boardUrl: string; kind: 'json' | 'html' };
type FetchHit = { status: number; ct: string; text: string; url: string };

const recipes = new Map<string, Recipe>();
const missUntil = new Map<string, number>();
const MISS_MS = 6 * 3600_000;
const MAX_BODY = 420_000;
const MAX_FETCH = 16;
const TIMEOUT_MS = 12_000;

const SKIP_HOST =
  /bahnhof\.de|facebook\.|instagram\.|wikipedia\.|google\.|apple\.com|twitter\.|linkedin\./i;

export function resetOriginBoardDiscoverForTests(): void {
  recipes.clear();
  missUntil.clear();
}

export function identSearchNeedles(ident: string): string[] {
  const out = new Set<string>();
  for (const v of identVariants(ident)) {
    out.add(v);
    const p = splitFlightIdent(v);
    if (p) {
      out.add(`${p.prefix}${p.number}`);
      out.add(`${p.prefix} ${p.number}`);
      out.add(`${p.prefix}  ${p.number}`);
    }
  }
  return [...out];
}

function normalizeBoardHtml(html: string): string {
  return html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

export function htmlLooksLikeIdent(html: string, ident: string): boolean {
  const hay = normalizeBoardHtml(html).toUpperCase();
  return identSearchNeedles(ident).some((n) => hay.includes(n.toUpperCase()));
}

export function parseOpsFromHtml(
  html: string,
  ident: string,
): {
  terminal: string | null;
  gate: string | null;
  checkinDesk: string | null;
  destIata: string | null;
  cancelled: boolean;
  detailHref: string | null;
} | null {
  const prepared = html.replace(/&nbsp;/gi, ' ').replace(/&#160;/g, ' ');
  if (!htmlLooksLikeIdent(prepared, ident)) return null;
  const needles = identSearchNeedles(ident);
  let at = -1;
  const upper = prepared.toUpperCase();
  for (const n of needles) {
    const i = upper.indexOf(n.toUpperCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return null;
  const win = prepared.slice(Math.max(0, at - 900), at + 1800);
  const text = win
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const box = html.match(/flight-box-area">\s*([^<]+)/i)?.[1]?.trim();
  const area = box || text;
  const termGate = area.match(
    /\bT(?:erminal)?\s*([1-9])\s*[-–]\s*Gate\s*([A-Z]?\d{1,3}[A-Z]?)\b/,
  );
  const gateM =
    termGate?.[2] ||
    area.match(/\bGate\s*[:\-]?\s*([A-Z]?\d{1,3}[A-Z]?)\b/i)?.[1];
  const termM =
    termGate?.[1] ||
    area.match(/\bTerminal\s*([1-9A-Z])\b/i)?.[1] ||
    area.match(/\bT([1-9])\b/)?.[1] ||
    win.match(/fp-flight-area[\s\S]{0,120}nobr">\s*(T?\d)\s*</i)?.[1];
  const checkM = text.match(
    /\b(?:Check-?in|Schalter(?:area)?|Counter)\s*[:|]?\s*([A-Z]?\d{1,4}(?:\s*[-–/]\s*\d{1,4})?)/i,
  );
  const destM = text.match(/\(([A-Z]{3})\)/);
  const href =
    win.match(
      /href="([^"]*(?:flugdetail|flight.?detail|flight_id=)[^"]+)"/i,
    )?.[1] ||
    html
      .slice(Math.max(0, at - 1200), at + 400)
      .match(/href="([^"]*flight_id=[^"]+)"/i)?.[1] ||
    null;
  return {
    terminal: termM ? (/^\d+$/.test(termM) ? termM : termM.replace(/^T/i, '')) : null,
    gate: gateM ? gateM.toUpperCase() : null,
    checkinDesk: checkM?.[1]?.replace(/\s+/g, '') ?? null,
    destIata: destM?.[1] ?? null,
    cancelled: /cancel|gestrichen|annull/i.test(text),
    detailHref: href,
  };
}

export function collectBoardCandidateUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(raw.replace(/&amp;/g, '&'), baseUrl);
      if (!/^https?:$/i.test(u.protocol)) return;
      if (SKIP_HOST.test(u.hostname)) return;
      if (/alle-abfluege|all-departures/i.test(u.pathname)) return;
      if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(u.pathname)) return;
      if (/cloudfront\.net|facebook\.|instagram\./i.test(u.hostname)) return;
      u.hash = '';
      if (/tracker|autocomplete|login|identity/i.test(u.pathname)) return;
      const s = u.toString();
      if (!out.includes(s)) out.push(s);
    } catch {
      /* skip */
    }
  };
  const widget = html.match(/departuresUrl"\s*:\s*"([^"]+)"/i);
  push(widget?.[1]);
  const dataUrl = html.match(/data-url="([^"]+)"/i);
  push(dataUrl?.[1]);
  for (const m of html.matchAll(/https?:\/\/[^"' \s<>]+/gi)) {
    if (/flight|abflug|depart|fids|flightdata|\.json|api\.flights/i.test(m[0])) {
      push(m[0]);
    }
  }
  for (const m of html.matchAll(/["'`](\/[^"'`]{6,160})["'`]/g)) {
    if (/flight|abflug|depart|fids|flightdata|\.json|ankunft/i.test(m[1])) {
      push(m[1]);
    }
  }
  const rank = (u: string) => {
    if (/\.json(\?|$)/i.test(u) || /api\.flights|flightdata|flights_proxy/i.test(u))
      return 0;
    if (/flightsearch\/departures/i.test(u)) return 1;
    if (/abflug|departures/i.test(u)) return 2;
    return 3;
  };
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 10);
}

function pickJsonField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function walkJsonFlights(node: unknown, acc: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || acc.length > 400) return;
  if (Array.isArray(node)) {
    for (const x of node) walkJsonFlights(x, acc, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  const ident = pickJsonField(o, [
    'flightnumber',
    'flightNumber',
    'flight_number',
    'fnr',
    'ident',
    'flight',
  ]);
  if (ident && /[A-Z0-9]{2,}\d/.test(normalizeFlightIdent(ident))) {
    acc.push(o);
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') walkJsonFlights(v, acc, depth + 1);
  }
}

function jsonObjToRow(
  o: Record<string, unknown>,
  ident: string,
  dateKey: string,
): DiscoveredBoardRow | null {
  const rawId = pickJsonField(o, [
    'flightnumber',
    'flightNumber',
    'flight_number',
    'fnr',
    'ident',
    'flight',
  ]);
  if (!rawId || !identsMatch(rawId, ident)) {
    return null;
  }
  const dest = pickJsonField(o, [
    'destinationAirport3LCode',
    'arr_airport_iata',
    'iata',
    'destination',
    'dest',
  ]);
  const destIata = dest && /^[A-Z]{3}$/i.test(dest.trim()) ? dest.trim().toUpperCase() : null;
  const gate = pickJsonField(o, ['gate', 'gateNumber', 'departureGate']);
  const terminal = pickJsonField(o, ['terminal', 'departureTerminal', 'area']);
  const checkin = pickJsonField(o, [
    'checkinRow',
    'checkin_counter',
    'schalterarea',
    'schalter',
    'checkin',
    'counter',
  ]);
  const status = pickJsonField(o, ['status', 'flight_status_label', 'state']);
  return {
    ident: normalizeFlightIdent(rawId),
    dateKey,
    destIata,
    terminal: terminal?.replace(/^T(?:erminal)?\s*/i, '') ?? null,
    gate: gate && /[0-9]/.test(gate) ? gate : null,
    checkinDesk: checkin,
    cancelled: /cancel|gestrichen|annull/i.test(status || ''),
    plannedMs: null,
    expectedMs: null,
    status,
  };
}

async function fetchRaw(url: string, xhr: boolean): Promise<FetchHit> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8',
  };
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  try {
    headers.Referer = `${new URL(url).origin}/`;
  } catch {
    /* skip */
  }
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = (await res.text()).slice(0, MAX_BODY);
  return {
    status: res.status,
    ct: res.headers.get('content-type') || '',
    text,
    url: res.url,
  };
}

function looksJson(hit: FetchHit): boolean {
  if (/json/i.test(hit.ct)) return /^\s*[{\[]/.test(hit.text);
  return /^\s*[{\[]/.test(hit.text) && /"(flight|gate|fnr|ident)"/i.test(hit.text);
}

function scoreAirportSites(sites: string[]): string[] {
  return sites
    .filter((s) => {
      try {
        return !SKIP_HOST.test(new URL(s).hostname);
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const score = (u: string) =>
        /airport|flughafen|aeroport|aeropuerto|aeroporto/i.test(u) ? 0 : 1;
      return score(a) - score(b);
    })
    .slice(0, 3);
}

async function wikidataAirportSites(iata: string): Promise<string[]> {
  const headers = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  const q = `SELECT ?website WHERE { ?item wdt:P238 "${iata}" . ?item wdt:P856 ?website . }`;
  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}&format=json`,
      { headers: { ...headers, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (res.ok) {
      const j = (await res.json()) as {
        results?: { bindings?: Array<{ website?: { value?: string } }> };
      };
      const scored = scoreAirportSites(
        (j.results?.bindings || [])
          .map((b) => b.website?.value)
          .filter((s): s is string => Boolean(s)),
      );
      if (scored.length) return scored;
    }
  } catch {
    /* search fallback */
  }
  const name = airportByIata(iata)?.name || `${iata} Airport`;
  try {
    const search = new URL('https://www.wikidata.org/w/api.php');
    search.searchParams.set('action', 'wbsearchentities');
    search.searchParams.set('search', `${iata} ${name}`);
    search.searchParams.set('language', 'en');
    search.searchParams.set('type', 'item');
    search.searchParams.set('format', 'json');
    search.searchParams.set('origin', '*');
    const sr = await fetch(search.toString(), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!sr.ok) return [];
    const sj = (await sr.json()) as { search?: Array<{ id?: string }> };
    const id = sj.search?.[0]?.id;
    if (!id) return [];
    const ent = new URL('https://www.wikidata.org/w/api.php');
    ent.searchParams.set('action', 'wbgetentities');
    ent.searchParams.set('ids', id);
    ent.searchParams.set('props', 'claims');
    ent.searchParams.set('format', 'json');
    ent.searchParams.set('origin', '*');
    const er = await fetch(ent.toString(), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!er.ok) return [];
    const ej = (await er.json()) as {
      entities?: Record<string, { claims?: { P856?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> } }>;
    };
    const urls = (ej.entities?.[id]?.claims?.P856 || [])
      .map((c) => c.mainsnak?.datavalue?.value)
      .filter((s): s is string => Boolean(s));
    return scoreAirportSites(urls);
  } catch {
    return [];
  }
}

function expandBoardUrl(url: string, ident?: string): string[] {
  try {
    const u = new URL(url);
    if (!/flightsearch\/departures/i.test(u.pathname)) return [url];
    u.searchParams.set('per_page', '80');
    u.searchParams.set('allow_pagination', '1');
    const pages: string[] = [];
    if (ident) {
      const spaced =
        identSearchNeedles(ident).find((n) => /\s/.test(n)) || ident;
      const q = new URL(u.toString());
      q.searchParams.set('page', '1');
      q.searchParams.set('flight_search_presenter[flight_number]', spaced);
      pages.push(q.toString());
    }
    for (let p = 1; p <= 7; p++) {
      u.searchParams.set('page', String(p));
      pages.push(u.toString());
    }
    return pages;
  } catch {
    return [url];
  }
}

function commonPaths(origin: string): string[] {
  const o = origin.replace(/\/+$/, '');
  return [
    `${o}/flightsearch/departures?page=1&per_page=80&allow_pagination=1`,
    `${o}/service/flightdata/departures`,
    `${o}/api.flights.json`,
  ];
}

function withIdentQuery(boardUrl: string, ident: string, dateKey: string): string[] {
  const needles = identSearchNeedles(ident);
  const primary = needles[0] || ident;
  try {
    const u = new URL(boardUrl);
    if (/flightsearch\/departures/i.test(u.pathname) && !u.searchParams.has('per_page')) {
      u.searchParams.set('page', '1');
      u.searchParams.set('per_page', '60');
      u.searchParams.set('allow_pagination', '1');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      if (!u.searchParams.has('date')) u.searchParams.set('date', dateKey);
      const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey) || [];
      if (d && /flightsearch/i.test(u.pathname) && !u.searchParams.has('flight_search_presenter[flight_date_from_muc]')) {
        u.searchParams.set('flight_search_presenter[flight_date_from_muc]', `${d}.${mo}.${y}`);
      }
    }
    const base = u.toString();
    return [
      base,
      `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(primary)}`,
      `${base}${base.includes('?') ? '&' : '?'}flight=${encodeURIComponent(primary)}`,
    ];
  } catch {
    return [boardUrl];
  }
}

function rowFromHtml(
  html: string,
  ident: string,
  dateKey: string,
): { row: DiscoveredBoardRow; detailHref: string | null } | null {
  const ops = parseOpsFromHtml(html, ident);
  if (!ops) return null;
  return {
    row: {
      ident: normalizeFlightIdent(ident),
      dateKey,
      destIata: ops.destIata,
      terminal: ops.terminal,
      gate: ops.gate,
      checkinDesk: ops.checkinDesk,
      cancelled: ops.cancelled,
      plannedMs: null,
      expectedMs: null,
      status: null,
    },
    detailHref: ops.detailHref,
  };
}

async function parseHit(
  hit: FetchHit,
  ident: string,
  dateKey: string,
  fetches: { n: number },
): Promise<DiscoveredBoardRow | null> {
  if (hit.status < 200 || hit.status >= 400 || hit.text.length < 40) return null;
  if (looksJson(hit)) {
    try {
      const acc: Record<string, unknown>[] = [];
      walkJsonFlights(JSON.parse(hit.text), acc, 0);
      for (const o of acc) {
        const row = jsonObjToRow(o, ident, dateKey);
        if (row && (row.gate || row.terminal || row.checkinDesk)) return row;
      }
      for (const o of acc) {
        const row = jsonObjToRow(o, ident, dateKey);
        if (row) return row;
      }
    } catch {
      /* HTML fallback */
    }
  }
  const parsed = rowFromHtml(hit.text, ident, dateKey);
  if (!parsed) return null;
  if (!parsed.row.gate && !parsed.row.checkinDesk && !parsed.row.terminal && !parsed.detailHref) {
    return null;
  }
  if (parsed.row.gate || parsed.row.checkinDesk) return parsed.row;
  if (parsed.detailHref && fetches.n < MAX_FETCH) {
    fetches.n += 1;
    const abs = new URL(parsed.detailHref, hit.url).toString();
    const detail = await fetchRaw(abs, false);
    const deep = rowFromHtml(detail.text, ident, dateKey);
    if (deep?.row) {
      return {
        ...parsed.row,
        ...deep.row,
        terminal: deep.row.terminal || parsed.row.terminal,
        gate: deep.row.gate || parsed.row.gate,
        checkinDesk: deep.row.checkinDesk || parsed.row.checkinDesk,
      };
    }
  }
  return parsed.row.terminal ? parsed.row : parsed.row;
}

export async function discoverOriginBoardRows(opts: {
  originIata: string;
  ident: string;
  destIata?: string | null;
  dateKey?: string | null;
}): Promise<DiscoveredBoardRow[]> {
  const origin = opts.originIata.trim().toUpperCase();
  const ident = normalizeFlightIdent(opts.ident);
  const dateKey = opts.dateKey || dateKeyFromMs(Date.now());
  if (!/^[A-Z]{3}$/.test(origin) || !ident || ident.startsWith('CLK')) return [];
  const until = missUntil.get(origin) ?? 0;
  if (until > Date.now() && !recipes.has(origin)) return [];

  const fetches = { n: 0 };
  const tryUrls: string[] = [];
  const recipe = recipes.get(origin);
  if (recipe) tryUrls.push(...withIdentQuery(recipe.boardUrl, ident, dateKey));

  if (!recipe) {
    let sites: string[] = [];
    try {
      sites = await wikidataAirportSites(origin);
    } catch {
      sites = [];
    }
    const sniffed: string[] = [];
    const commons: string[] = [];
    const take = async (hit: FetchHit): Promise<DiscoveredBoardRow[] | null> => {
      const row = await parseHit(hit, ident, dateKey, fetches);
      if (!row) return null;
      const kind: 'json' | 'html' = looksJson(hit) ? 'json' : 'html';
      recipes.set(origin, { iata: origin, boardUrl: hit.url, kind });
      noteDiscoveredBoard(origin, kind);
      return [row];
    };
    for (const site of sites.slice(0, 2)) {
      if (fetches.n >= MAX_FETCH) break;
      fetches.n += 1;
      let home: FetchHit;
      try {
        home = await fetchRaw(site, false);
      } catch {
        continue;
      }
      const homeHit = await take(home);
      if (homeHit) return homeHit;
      sniffed.push(
        ...collectBoardCandidateUrls(home.text, home.url).flatMap((u) =>
          expandBoardUrl(u, ident),
        ),
      );
      commons.push(
        ...commonPaths(new URL(home.url).origin).flatMap((u) =>
          expandBoardUrl(u, ident),
        ),
      );
      const hops = collectBoardCandidateUrls(home.text, home.url).filter((u) => {
        try {
          return /airport|flughafen/i.test(new URL(u).hostname);
        } catch {
          return false;
        }
      });
      for (const hop of hops.slice(0, 1)) {
        if (fetches.n >= MAX_FETCH) break;
        fetches.n += 1;
        try {
          const hopHit = await fetchRaw(hop, false);
          const hopRow = await take(hopHit);
          if (hopRow) return hopRow;
          sniffed.push(
            ...collectBoardCandidateUrls(hopHit.text, hopHit.url).flatMap((u) =>
              expandBoardUrl(u, ident),
            ),
          );
          commons.push(
            ...commonPaths(new URL(hopHit.url).origin).flatMap((u) =>
              expandBoardUrl(u, ident),
            ),
          );
        } catch {
          /* skip hop */
        }
      }
    }
    tryUrls.push(...sniffed, ...commons);
  }

  const seen = new Set<string>();
  const queue = tryUrls.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  for (const url of queue) {
    if (fetches.n >= MAX_FETCH) break;
    fetches.n += 1;
    let hit: FetchHit;
    try {
      const wantXhr = /json|api\.flights|flightdata|flightsearch/i.test(url);
      hit = await fetchRaw(url, wantXhr);
      if (hit.text.length < 400 && /javascript/i.test(hit.ct)) {
        hit = await fetchRaw(url, false);
      }
      if (
        wantXhr &&
        /flightsearch/i.test(url) &&
        !htmlLooksLikeIdent(hit.text, ident)
      ) {
        hit = await fetchRaw(url, false);
      }
    } catch {
      continue;
    }
    const row = await parseHit(hit, ident, dateKey, fetches);
    if (!row) continue;
    const kind: 'json' | 'html' = looksJson(hit) ? 'json' : 'html';
    recipes.set(origin, { iata: origin, boardUrl: hit.url, kind });
    noteDiscoveredBoard(origin, kind);
    return [row];
  }

  missUntil.set(origin, Date.now() + MISS_MS);
  return [];
}
