/**
 * SSOT: Action-Button-URLs — tiefster aktueller Deep-Link, der live erreichbar ist.
 *
 * Pipeline:
 *   Kandidaten sammeln → Tiefe/Aktualität scoren → Live-Probe (404/Soft-404)
 *   → besten lebenden Link in den Button, sonst ehrliche Suche statt toter Seite.
 *
 * Nie erfundene Slugs durchwinken. Hollow-Homepages nie als Buchung.
 */

import type { QuickAction } from '../../types/concierge';
import {
  isHollowPartnerUrl,
  unwrapPartnerLandingUrl,
} from '../affiliate/hollowPartnerUrl';

export type DeepLinkIntent =
  | 'ticket'
  | 'booking'
  | 'menu'
  | 'program'
  | 'website'
  | 'form'
  | 'maps'
  | 'search'
  | 'generic';

export type DeepLinkCandidate = {
  url: string;
  title?: string | null;
  /** Schon erfolgreich geladen (Research-Fetch) — Probe kann entfallen. */
  verified?: boolean;
  kind?: 'html' | 'pdf' | 'search' | 'other';
};

export type UrlProbeResult = {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  reason:
    | 'ok'
    | 'skip'
    | 'http_404'
    | 'http_410'
    | 'soft_404'
    | 'redirect_home'
    | 'network';
};

const PROBE_TIMEOUT_MS = 1400;
const PROBE_CACHE_TTL_MS = 12 * 60 * 1000;
const MAX_PROBES_PER_TURN = 6;

const probeCache = new Map<string, { at: number; result: UrlProbeResult }>();

const LOCALE_SEGS = new Set([
  'de',
  'en',
  'fr',
  'it',
  'es',
  'nl',
  'da',
  'pl',
  'de-de',
  'en-gb',
  'en-us',
  'de_de',
]);

const SOFT_404_RE =
  /\b(error\s*404|http\s*404|seite\s+(?:wurde\s+)?nicht\s+gefunden|diese\s+seite\s+existiert\s+nicht|page\s+not\s+found|not\s+found\s*<\/title>|404\s+not\s+found|couldn't\s+find\s+this\s+page|konnte\s+nicht\s+gefunden)\b/i;

function safeUrl(raw: string | null | undefined): URL | null {
  const s = String(raw ?? '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function landingUrl(url: string): string {
  const unwrapped = unwrapPartnerLandingUrl(url);
  return unwrapped || url;
}

/** Pfad-Segmente ohne Locale-Root — Maß für „wie weit der Deep-Link geht“. */
export function pathDepth(url: string): number {
  const parsed = safeUrl(landingUrl(url));
  if (!parsed) return 0;
  return parsed.pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && !LOCALE_SEGS.has(s.toLowerCase())).length;
}

export function isRedirectToHome(original: string, finalUrl: string): boolean {
  const a = safeUrl(landingUrl(original));
  const b = safeUrl(landingUrl(finalUrl));
  if (!a || !b) return false;
  if (a.hostname.replace(/^www\./i, '') !== b.hostname.replace(/^www\./i, '')) {
    return false;
  }
  const from = pathDepth(a.toString());
  const to = pathDepth(b.toString());
  return from >= 2 && to <= 0;
}

export function shouldSkipLiveProbe(url: string): boolean {
  const raw = String(url ?? '').trim();
  if (!raw) return true;
  if (/^(mailto|tel|geo|spotify):/i.test(raw)) return true;
  if (/findus\.local/i.test(raw)) return true;
  if (/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(raw)) {
    return true;
  }
  if (/google\.[^/\s]+\/search/i.test(raw)) return true;
  if (/m\.uber\.com|uber\.com\/ul/i.test(raw)) return true;
  // Travelpayouts-Click / Kiwi-Deep-Link: Tracker antwortet oft nicht auf HEAD
  if (
    /c111\.travelpayouts\.com|kiwi\.com\/(?:de\/)?search|kiwi\.com\/deep|aviasales\.(?:tpx\.li|com)|tpx\.li\/zk7udfoO/i.test(
      raw,
    )
  ) {
    return true;
  }
  return false;
}

export function classifyOpenUrlIntent(
  label: string,
  url: string,
  query?: string | null,
): DeepLinkIntent {
  const blob = `${label} ${url} ${query ?? ''}`.toLowerCase();
  if (/maps\.google|google\.[^/\s]+\/maps|🗺️|🗺/i.test(blob)) return 'maps';
  if (/google\.[^/\s]+\/search/i.test(url)) return 'search';
  if (
    /🍽|speisekarte|speise-?karte|menükarte|menuekarte|getränkekarte|getraenkekarte|\/menu\b|\/menue\b|speisen\.pdf/i.test(
      blob,
    )
  ) {
    return 'menu';
  }
  if (
    /🎫|🎟|ticket|eintritt|eventim|ticketmaster|konfetti|gokonfetti|tiqets|musement/i.test(
      blob,
    )
  ) {
    return 'ticket';
  }
  if (
    /🏨|buchen|buchung|reserv|opentable|quandoo|resmio|zimmer|checkout|mietrad|getyourguide|viator/i.test(
      blob,
    )
  ) {
    return 'booking';
  }
  if (/📝|formular|anmeld|mailto:/i.test(blob)) return 'form';
  if (/📄|programm|flyer|pdf|infos/i.test(blob)) return 'program';
  if (/🌐|webseite|website|homepage/i.test(blob)) return 'website';
  return 'generic';
}

function yearFromUrl(url: string): number | null {
  const m = landingUrl(url).match(/(?:^|[^\d])(20[1-3]\d)(?:[^\d]|$)/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 2015 && y <= 2035 ? y : null;
}

function intentTokenScore(url: string, intent: DeepLinkIntent): number {
  const u = landingUrl(url).toLowerCase();
  if (intent === 'menu') {
    if (/speisekarte|speise-karte|food[\-_]?menu|menuekarte|getraenkekarte/.test(u)) {
      return 22;
    }
    if (/\/(menu|menue|speisen|karte)(\/|\.pdf|$|\?)/i.test(u)) return 16;
    if (/\/ugd\/|_files\/ugd/i.test(u)) return 18;
    if (/\.pdf(\?|$)/i.test(u)) return 12;
    return 0;
  }
  if (intent === 'ticket') {
    if (/\/(tickets?|eintritt|checkout|kaufen)\b/.test(u)) return 18;
    if (/eventim|ticketmaster|gokonfetti|tiqets\.com\/.+-p\d+/i.test(u)) return 16;
    if (/\/events\/[a-z0-9-]{8,}/.test(u)) return 12;
    return 0;
  }
  if (intent === 'booking') {
    if (/\/(book|booking|reserv|checkout|tisch)/.test(u)) return 18;
    if (/opentable|quandoo|resmio|bookatable/.test(u)) return 16;
    if (/\/go\/hotel\/info\/\d+/.test(u)) return 20;
    return 0;
  }
  if (intent === 'program') {
    if (/\.pdf(\?|$)/i.test(u)) return 14;
    if (/\/events\/[a-z0-9-]{8,}|programm|flyer/.test(u)) return 12;
    return 0;
  }
  return 0;
}

function listingPenalty(url: string): number {
  const u = landingUrl(url).toLowerCase();
  if (/\/(search|suche|veranstaltungen|events|kalender)\/?(\?|$)/.test(u)) {
    return 16;
  }
  if (/google\.[^/\s]+\/search/.test(u)) return 8;
  return 0;
}

export type ScoreDeepLinkOpts = {
  intent: DeepLinkIntent;
  nowYear?: number;
  hints?: { title?: string | null; venue?: string | null; city?: string | null };
  /** Bevorzuge denselben Host (Speisekarte/Web der Location, nicht fremde Portale). */
  preferHost?: string | null;
};

/** Höher = besserer Button-Link. Negativ = unbrauchbar. */
export function scoreDeepLink(url: string, opts: ScoreDeepLinkOpts): number {
  const raw = String(url ?? '').trim();
  if (!raw || /^(mailto|tel):/i.test(raw)) {
    return /^(mailto|tel):/i.test(raw) ? 40 : -100;
  }
  if (!safeUrl(raw)) return -100;
  if (shouldSkipLiveProbe(raw) && opts.intent !== 'maps' && opts.intent !== 'search') {
    if (/google\.[^/\s]+\/search/i.test(raw)) return 4;
  }
  if (isHollowPartnerUrl(raw)) return -80;

  const landing = landingUrl(raw);
  const depth = pathDepth(landing);
  let score = Math.min(depth, 7) * 5;
  score += intentTokenScore(landing, opts.intent);

  const year = yearFromUrl(landing);
  const now = opts.nowYear ?? new Date().getFullYear();
  if (year != null) {
    if (year === now) score += 12;
    else if (year === now - 1) score += 3;
    else if (year < now - 1) score -= Math.min(14, (now - year) * 4);
  }

  if (/\.pdf(\?|$)/i.test(landing) && (opts.intent === 'menu' || opts.intent === 'program')) {
    score += 8;
  }

  try {
    const parsed = new URL(landing);
    const qs = parsed.searchParams;
    if (
      qs.get('selected') ||
      qs.get('hotelid') ||
      qs.get('eventId') ||
      qs.get('product_id') ||
      /\/p\d+(\/|$)/i.test(parsed.pathname)
    ) {
      score += 10;
    }
  } catch {
    /* ignore */
  }

  if (depth <= 0) {
    if (opts.intent === 'website' || opts.intent === 'generic') score += 2;
    else score -= 18;
  }
  score -= listingPenalty(landing);

  if (opts.preferHost) {
    try {
      const host = new URL(landing).hostname.replace(/^www\./i, '').toLowerCase();
      const prefer = opts.preferHost.replace(/^www\./i, '').toLowerCase();
      if (host === prefer || host.endsWith(`.${prefer}`) || prefer.endsWith(`.${host}`)) {
        score += opts.intent === 'ticket' || opts.intent === 'booking' ? 8 : 18;
      } else if (opts.intent === 'menu' || opts.intent === 'website') {
        score -= 10;
      }
    } catch {
      /* ignore */
    }
  }

  const hints = opts.hints;
  if (hints) {
    const hay = landing.toLowerCase();
    for (const bit of [hints.title, hints.venue, hints.city]) {
      const t = String(bit ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, '');
      if (t.length >= 5 && hay.replace(/[^a-z0-9äöüß]/gi, '').includes(t.slice(0, 12))) {
        score += 6;
      }
    }
  }

  return score;
}

export function pickBestScoredUrl(
  urls: Array<string | null | undefined>,
  opts: ScoreDeepLinkOpts,
): string | null {
  let best: { url: string; score: number } | null = null;
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw ?? '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const score = scoreDeepLink(url, opts);
    if (score < 0) continue;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

export function looksSoft404Html(html: string): boolean {
  const head = String(html ?? '').slice(0, 5000);
  if (SOFT_404_RE.test(head)) return true;
  const title = head.match(/<title[^>]*>([\s\S]{0,180})<\/title>/i)?.[1] ?? '';
  return /404|not\s+found|nicht\s+gefunden/i.test(title);
}

function cacheGet(url: string): UrlProbeResult | null {
  const hit = probeCache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > PROBE_CACHE_TTL_MS) {
    probeCache.delete(url);
    return null;
  }
  return hit.result;
}

function cacheSet(url: string, result: UrlProbeResult): UrlProbeResult {
  probeCache.set(url, { at: Date.now(), result });
  return result;
}

async function fetchProbe(
  url: string,
  timeoutMs: number,
): Promise<UrlProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const isPdf = /\.pdf(\?|$)/i.test(url);
  try {
    const res = await fetch(url, {
      method: isPdf ? 'HEAD' : 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        Accept: isPdf
          ? 'application/pdf,*/*'
          : 'text/html,application/xhtml+xml,*/*',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
      },
    });
    const finalUrl = String(res.url || url);
    const status = res.status;
    if (status === 404) {
      return { url, finalUrl, ok: false, status, reason: 'http_404' };
    }
    if (status === 410) {
      return { url, finalUrl, ok: false, status, reason: 'http_410' };
    }
    if (status === 401 || status === 403 || status === 429) {
      return { url, finalUrl, ok: true, status, reason: 'ok' };
    }
    if (isPdf && (status === 405 || status === 501)) {
      return { url, finalUrl, ok: true, status, reason: 'ok' };
    }
    if (status >= 500) {
      return { url, finalUrl, ok: true, status, reason: 'network' };
    }
    if (isRedirectToHome(url, finalUrl)) {
      return { url, finalUrl, ok: false, status, reason: 'redirect_home' };
    }
    if (!isPdf && status >= 200 && status < 400) {
      try {
        const text = await res.text();
        if (looksSoft404Html(text)) {
          return { url, finalUrl, ok: false, status, reason: 'soft_404' };
        }
      } catch {
        /* status reicht */
      }
    }
    return { url, finalUrl, ok: true, status, reason: 'ok' };
  } catch {
    return { url, finalUrl: url, ok: true, status: 0, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Live-Check. Netz weg → URL behalten (kein Massen-Drop). 404/410/Soft-404 → tot. */
export async function probeUrlAlive(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<UrlProbeResult> {
  const raw = String(url ?? '').trim();
  if (!raw) {
    return { url: raw, finalUrl: raw, ok: false, status: 0, reason: 'http_404' };
  }
  if (shouldSkipLiveProbe(raw) || /^(mailto|tel):/i.test(raw)) {
    return { url: raw, finalUrl: raw, ok: true, status: 0, reason: 'skip' };
  }
  const cached = cacheGet(raw);
  if (cached) return cached;
  const result = await fetchProbe(raw, timeoutMs);
  return cacheSet(raw, result);
}

export function buildIntentSearchFallback(opts: {
  intent: DeepLinkIntent;
  name?: string | null;
  city?: string | null;
  extra?: string | null;
}): string {
  const intentWord =
    opts.intent === 'menu'
      ? 'Speisekarte'
      : opts.intent === 'ticket'
        ? 'Tickets'
        : opts.intent === 'booking'
          ? 'buchen'
          : opts.intent === 'program'
            ? 'Programm'
            : 'offizielle Seite';
  const q = [opts.name, opts.city, opts.extra, intentWord]
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length >= 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  return `https://www.google.com/search?q=${encodeURIComponent(q || intentWord)}`;
}

export async function pickBestLiveDeepLink(opts: {
  candidates: DeepLinkCandidate[];
  intent: DeepLinkIntent;
  hints?: ScoreDeepLinkOpts['hints'];
  preferHost?: string | null;
  nowYear?: number;
  timeoutMs?: number;
}): Promise<{ url: string; score: number; probed: boolean } | null> {
  const ranked = opts.candidates
    .map((c) => ({
      ...c,
      url: String(c.url ?? '').trim(),
      score: scoreDeepLink(c.url, {
        intent: opts.intent,
        nowYear: opts.nowYear,
        hints: opts.hints,
        preferHost: opts.preferHost,
      }),
    }))
    .filter((c) => c.url && c.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;

  const toProbe = ranked.slice(0, MAX_PROBES_PER_TURN);
  const probes = await Promise.all(
    toProbe.map(async (c) => {
      if (c.verified) {
        return { c, probe: { ok: true, finalUrl: c.url } as UrlProbeResult };
      }
      const probe = await probeUrlAlive(c.url, opts.timeoutMs);
      return { c, probe };
    }),
  );

  for (const { c, probe } of probes) {
    if (!probe.ok) continue;
    const url = probe.finalUrl && probe.finalUrl.startsWith('http') ? probe.finalUrl : c.url;
    if (isHollowPartnerUrl(url) && opts.intent !== 'search') continue;
    return { url, score: c.score, probed: !c.verified };
  }
  return null;
}

function withBookingPrefill(a: QuickAction, userText?: string | null): QuickAction {
  if (a.type !== 'OPEN_URL' || !a.payload.url) return a;
  try {
    const { applyOpenUrlBookingPrefill } = require('../affiliate/openUrlBookingPrefill') as {
      applyOpenUrlBookingPrefill: (o: {
        url: string;
        label?: string;
        payload?: QuickAction['payload'];
        userText?: string | null;
      }) => {
        url: string;
        checkin?: string;
        checkout?: string;
        adults?: number;
      };
    };
    const next = applyOpenUrlBookingPrefill({
      url: a.payload.url,
      label: a.label,
      payload: a.payload,
      userText,
    });
    if (next.url === a.payload.url && !next.checkin) return a;
    return {
      ...a,
      payload: {
        ...a.payload,
        url: next.url,
        ...(next.checkin ? { checkin: next.checkin } : {}),
        ...(next.checkout ? { checkout: next.checkout } : {}),
        ...(next.adults != null ? { adults: next.adults } : {}),
      },
    };
  } catch {
    return a;
  }
}

function searchLabelForIntent(intent: DeepLinkIntent): string {
  if (intent === 'menu') return '🔍 Karte';
  if (intent === 'ticket') return '🔍 Tickets';
  if (intent === 'booking') return '🔍 Buchen';
  if (intent === 'program') return '🔍 Infos';
  return '🔍 Infos';
}

export async function resolveLiveOpenUrlActions(
  actions: QuickAction[],
  opts?: {
    extraCandidates?: DeepLinkCandidate[];
    userText?: string | null;
    city?: string | null;
    timeoutMs?: number;
    probe?: boolean;
  },
): Promise<{ actions: QuickAction[]; notes: string[] }> {
  const notes: string[] = [];
  const extras = opts?.extraCandidates ?? [];
  const probe = opts?.probe !== false;
  const hasWork = actions.some((a) => {
    if (a.type !== 'OPEN_URL' || a.payload.pending) return false;
    const url = (a.payload.url ?? '').trim();
    return (
      !!url &&
      /^https?:/i.test(url) &&
      !shouldSkipLiveProbe(url)
    );
  });
  if (!hasWork) {
    return {
      actions: actions.map((a) => withBookingPrefill(a, opts?.userText)),
      notes,
    };
  }

  const out: QuickAction[] = [];

  for (const a of actions) {
    if (a.type !== 'OPEN_URL' || a.payload.pending) {
      out.push(a);
      continue;
    }
    const url = (a.payload.url ?? '').trim();
    if (!url || /^(mailto|tel):/i.test(url) || shouldSkipLiveProbe(url)) {
      out.push(withBookingPrefill(a, opts?.userText));
      continue;
    }

    const intent = classifyOpenUrlIntent(a.label, url, opts?.userText);
    const hints = {
      title: a.payload.entityName ?? null,
      venue: a.payload.destName ?? null,
      city: opts?.city ?? null,
    };
    const pool: DeepLinkCandidate[] = [
      { url },
      ...extras.filter((c) => c.url && c.url !== url),
    ];

    if (!probe) {
      const best = pickBestScoredUrl(
        pool.map((c) => c.url),
        {
          intent,
          hints,
          preferHost: (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return null;
            }
          })(),
        },
      );
      if (best && best !== url) {
        notes.push(`ranked:${intent}`);
        out.push({ ...a, payload: { ...a.payload, url: best } });
      } else {
        out.push(a);
      }
      continue;
    }

    const live = await pickBestLiveDeepLink({
      candidates: pool,
      intent,
      hints,
      preferHost: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })(),
      timeoutMs: opts?.timeoutMs ?? PROBE_TIMEOUT_MS,
    });

    if (live) {
      if (live.url !== url) notes.push(`live-swap:${intent}`);
      out.push({ ...a, payload: { ...a.payload, url: live.url } });
      continue;
    }

    const fallback = buildIntentSearchFallback({
      intent,
      name: a.payload.entityName || a.payload.destName,
      city: opts?.city,
    });
    notes.push(`dead-fallback:${intent}`);
    out.push({
      ...a,
      label: searchLabelForIntent(intent),
      payload: { ...a.payload, url: fallback },
    });
  }

  return {
    actions: out.map((a) => withBookingPrefill(a, opts?.userText)),
    notes,
  };
}

/** Recherche-Quellen: tiefste passende URLs zuerst, keine unlesbaren Homepages. */
export function pickRankedSourceUrls(
  sources: Array<{
    url: string;
    title?: string | null;
    kind?: string;
  }>,
  query: string,
  max = 2,
): Array<{ url: string; intent: DeepLinkIntent }> {
  const intent = classifyOpenUrlIntent('', '', query);
  const usable = sources.filter((s) => {
    const url = (s.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    if (/nicht voll lesbar/i.test(s.title ?? '')) return false;
    if (s.kind === 'search' && /google\.[^/\s]+\/search/i.test(url)) return false;
    return scoreDeepLink(url, { intent }) >= 0;
  });
  const ranked = [...usable].sort(
    (a, b) =>
      scoreDeepLink(b.url, { intent }) - scoreDeepLink(a.url, { intent }),
  );
  const out: Array<{ url: string; intent: DeepLinkIntent }> = [];
  const seen = new Set<string>();
  for (const s of ranked) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, intent: classifyOpenUrlIntent(s.title ?? '', s.url, query) });
    if (out.length >= max) break;
  }
  return out;
}

export async function resolveTapOpenUrl(opts: {
  url: string;
  label: string;
  destName?: string | null;
  entityName?: string | null;
  payload?: QuickAction['payload'];
  userText?: string | null;
}): Promise<string> {
  let url = String(opts.url ?? '').trim();
  if (!url) return url;
  if (!shouldSkipLiveProbe(url) && !/^(mailto|tel):/i.test(url)) {
    const probe = await probeUrlAlive(url, 1800);
    if (probe.ok) {
      url =
        probe.finalUrl && /^https?:/i.test(probe.finalUrl) ? probe.finalUrl : url;
    } else {
      const intent = classifyOpenUrlIntent(opts.label, url);
      url = buildIntentSearchFallback({
        intent,
        name: opts.entityName || opts.destName,
      });
    }
  }
  try {
    const { applyOpenUrlBookingPrefill, upgradeHotelUrlOnTap } =
      require('../affiliate/openUrlBookingPrefill') as {
        applyOpenUrlBookingPrefill: (o: {
          url: string;
          label?: string;
          payload?: QuickAction['payload'];
          userText?: string | null;
        }) => PrefillShape;
        upgradeHotelUrlOnTap: (o: {
          url: string;
          label?: string;
          destName?: string | null;
          destination?: string | null;
          checkin?: string;
          checkout?: string;
          adults?: number;
          userText?: string | null;
        }) => Promise<string>;
      };
    const pre = applyOpenUrlBookingPrefill({
      url,
      label: opts.label,
      payload: opts.payload,
      userText: opts.userText,
    });
    url = pre.url;
    url = await upgradeHotelUrlOnTap({
      url,
      label: opts.label,
      destName: opts.destName || opts.payload?.destName,
      destination: opts.payload?.destination,
      checkin: pre.checkin ?? opts.payload?.checkin,
      checkout: pre.checkout ?? opts.payload?.checkout,
      adults: pre.adults ?? opts.payload?.adults,
      userText: opts.userText,
    });
  } catch {
    /* soft */
  }
  return url;
}

type PrefillShape = {
  url: string;
  checkin?: string;
  checkout?: string;
  adults?: number;
};
