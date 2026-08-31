/**
 * Fähre / Reederei — Ticket- & Fahrplan-Seiten (stadt-agnostisch).
 * Bahn-Advisor bleibt draußen; Concierge + Web-Research liefern OPEN_URL.
 */

import type { QuickAction } from '../../types/concierge';
import { websiteActionLabel } from '../concierge/websiteActionLabel';
import { shortenActionLabel } from '../concierge/actionLabelShorten';

/** Komposita: Fähre, Fährtickets, Fährhafen, Fähranleger. */
export const FERRY_QUERY_RE =
  /fähr(?:e|anleger|hafen|ticket)|faehr(?:e|anleger|hafen|ticket)|ferry|überfahrt|ueberfahrt|watt\s*sprinter/iu;

export function isFerryQuery(text: string): boolean {
  return FERRY_QUERY_RE.test((text || '').replace(/\s+/g, ' '));
}

/** Tickets, Buchung, Fahrplan, Preis — Betreiber-Website Just-Do-It. */
export function wantsFerryOperatorSite(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || !isFerryQuery(t)) return false;
  return /ticket|fahrkarte|buch|fahrplan|abfahrt|preis|webseite|website|online|kaufen|wann\s+fährt|wann\s+faehrt/iu.test(
    t,
  );
}

export type FerryUrlHit = {
  url: string;
  title?: string | null;
  score: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-zäöüß0-9\-]+/i)
        .map((w) => w.trim())
        .filter((w) => w.length > 4),
    ),
  ].slice(0, 12);
}

/** Höher = eher offizielle Reederei-/Ticketseite, nicht Bahn-Tafel. */
export function scoreFerryOperatorUrl(
  url: string,
  title: string | null | undefined,
  query: string,
): number {
  if (!/^https?:\/\//i.test(url)) return -99;
  const host = hostOf(url);
  if (!host) return -99;
  const blob = `${url} ${title ?? ''}`.toLowerCase();
  let score = 0;

  if (/^ticket\./i.test(host) || /\/ticket/i.test(url)) score += 10;
  if (/ticket|buchung|booking|shop|fahrplan|timetable|eticket/i.test(blob)) {
    score += 8;
  }
  if (
    /reederei|schiff|faehr|fähre|ferry|anleger|dampfschiff|katamaran|inselbahn/i.test(
      blob,
    )
  ) {
    score += 6;
  }

  for (const tok of queryTokens(query)) {
    if (host.includes(tok) || blob.includes(tok)) score += 5;
  }

  if (
    /bahn\.de$|bahn\.com$|deutschebahn|reiseauskunft|int\.bahn/i.test(host) &&
    !/faehr|ferry|schiff/i.test(blob)
  ) {
    score -= 14;
  }
  if (
    /wikipedia|tripadvisor|booking\.com|expedia|facebook|instagram|google\.(com|de)$/i.test(
      host,
    )
  ) {
    score -= 12;
  }
  return score;
}

export function pickFerryOperatorUrls(opts: {
  query: string;
  sources?: Array<{ url: string; title?: string | null }>;
  extraUrls?: string[];
  minScore?: number;
  limit?: number;
}): FerryUrlHit[] {
  const seen = new Set<string>();
  const scored: FerryUrlHit[] = [];
  const push = (url: string, title?: string | null) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    const score = scoreFerryOperatorUrl(u, title, opts.query);
    if (score < (opts.minScore ?? 4)) return;
    scored.push({ url: u, title, score });
  };
  for (const s of opts.sources ?? []) push(s.url, s.title);
  for (const u of opts.extraUrls ?? []) push(u, null);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 2);
}

export function ferryTicketActionsFromHits(hits: FerryUrlHit[]): QuickAction[] {
  return hits.map((h) => {
    const ticketish =
      /ticket|buch|shop|fahrplan/i.test(h.url) ||
      /ticket|buch/i.test(h.title ?? '');
    return {
      type: 'OPEN_URL' as const,
      label: shortenActionLabel(
        ticketish ? '🎫 Fährtickets' : websiteActionLabel(h.title, h.url),
      ),
      payload: { url: h.url },
    };
  });
}

export function ferryTicketActionsFromResearch(opts: {
  query: string;
  sources?: Array<{ url: string; title?: string | null }>;
  facts?: Array<{ sourceUrl?: string | null }>;
}): QuickAction[] {
  const extra = (opts.facts ?? [])
    .map((f) => f.sourceUrl)
    .filter((u): u is string => Boolean(u));
  return ferryTicketActionsFromHits(
    pickFerryOperatorUrls({
      query: opts.query,
      sources: opts.sources,
      extraUrls: extra,
    }),
  );
}
