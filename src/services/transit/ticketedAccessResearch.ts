/**
 * Ticketed place-access — operator site like ferry/ÖPNV, mode-agnostic.
 * Scores official ticket/timetable URLs; labels stay generic (Tickets/Fahrplan).
 */

import type { QuickAction } from '../../types/concierge';
import { websiteActionLabel } from '../concierge/websiteActionLabel';
import { shortenActionLabel } from '../concierge/actionLabelShorten';

export type TicketedAccessUrlHit = {
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
        .filter((w) => w.length > 3),
    ),
  ].slice(0, 12);
}

export function scoreTicketedAccessOperatorUrl(
  url: string,
  title: string | null | undefined,
  query: string,
): number {
  if (!/^https?:\/\//i.test(url)) return -99;
  const host = hostOf(url);
  if (!host) return -99;
  const blob = `${url} ${title ?? ''}`.toLowerCase();
  let score = 0;

  if (/ticket|buchung|booking|shop|fahrplan|timetable|tarif|precio|billete/i.test(blob)) {
    score += 10;
  }
  if (/\/(ticket|tickets|booking|shop|fahrplan|horario)/i.test(url)) score += 8;
  if (
    /wikipedia|tripadvisor|facebook|instagram|booking\.com|expedia|viator/i.test(
      host,
    )
  ) {
    score -= 16;
  }
  for (const tok of queryTokens(query)) {
    if (host.includes(tok) || blob.includes(tok)) score += 4;
  }
  return score;
}

export function pickTicketedAccessOperatorUrls(opts: {
  query: string;
  sources?: Array<{ url: string; title?: string | null }>;
  extraUrls?: string[];
  minScore?: number;
  limit?: number;
}): TicketedAccessUrlHit[] {
  const seen = new Set<string>();
  const scored: TicketedAccessUrlHit[] = [];
  const push = (url: string, title?: string | null) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    const score = scoreTicketedAccessOperatorUrl(u, title, opts.query);
    if (score < (opts.minScore ?? 4)) return;
    scored.push({ url: u, title, score });
  };
  for (const s of opts.sources ?? []) push(s.url, s.title);
  for (const u of opts.extraUrls ?? []) push(u, null);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 2);
}

export function ticketedAccessActionsFromHits(
  hits: TicketedAccessUrlHit[],
): QuickAction[] {
  return hits.map((h) => {
    const ticketish =
      /ticket|buch|shop|fahrplan|timetable|booking/i.test(h.url) ||
      /ticket|buch|fahrplan|horario/i.test(h.title ?? '');
    return {
      type: 'OPEN_URL' as const,
      label: shortenActionLabel(
        ticketish ? '🎫 Tickets' : websiteActionLabel(h.title, h.url),
      ),
      payload: { url: h.url },
    };
  });
}

export function ticketedAccessActionsFromResearch(opts: {
  query: string;
  sources?: Array<{ url: string; title?: string | null }>;
  facts?: Array<{ sourceUrl?: string | null }>;
}): QuickAction[] {
  const extra = (opts.facts ?? [])
    .map((f) => f.sourceUrl)
    .filter((u): u is string => Boolean(u));
  return ticketedAccessActionsFromHits(
    pickTicketedAccessOperatorUrls({
      query: opts.query,
      sources: opts.sources,
      extraUrls: extra,
    }),
  );
}
