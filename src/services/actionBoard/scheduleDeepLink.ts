/**
 * Spielplan / Fixtures / Tickets — tiefstmöglicher Direktlink (analog Speisekarte).
 * Keine Team-Hardcodes: Path/Label-Hints sind stadt-/vereins-agnostisch.
 */

import { fetchPublicDocument } from '../research/webFetch';

const SCHEDULE_LABEL_RE =
  /\b(spielplan|spielpl[aä]ne|fixtures?|schedule|heimspiele?|spiele|kalender|match(?:es)?|tickets?|kartenverkauf|ticketshop|anpfiff)\b/iu;

const SCHEDULE_PATH_RE =
  /\/(spielplan|spielplaene|fixtures?|schedule|heimspiele?|spiele|kalender|tickets?|ticketshop|games?)(\/|\.|\?|#|$)/i;

const ANCHOR_SCHEDULE_RE =
  /#+(?:spielplan|fixtures?|schedule|tickets?|heimspiele?)\b/i;

export type ScheduleLinkCand = { url: string; score: number; label: string };

export function isScheduleDeepPath(url: string): boolean {
  return SCHEDULE_PATH_RE.test(url) || ANCHOR_SCHEDULE_RE.test(url);
}

export function isClubOrActHomepageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') return true;
    if (/^\/(de|en|home|index|start)(\/|$)/i.test(path) && path.split('/').filter(Boolean).length <= 1) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function scoreScheduleCandidate(
  href: string,
  label: string,
): number {
  const blob = `${href} ${label}`;
  let score = 0;
  if (SCHEDULE_LABEL_RE.test(label) || SCHEDULE_LABEL_RE.test(href)) score += 50;
  if (SCHEDULE_PATH_RE.test(href)) score += 40;
  if (ANCHOR_SCHEDULE_RE.test(href)) score += 25;
  if (/\btickets?\b/iu.test(blob) && SCHEDULE_PATH_RE.test(href)) score += 10;
  if (/\.pdf(\?|$)/i.test(href) && SCHEDULE_LABEL_RE.test(blob)) score += 35;
  // Homepage / Impressum / Shop-Katalog ohne Termin → abwerten
  if (isClubOrActHomepageUrl(href)) score -= 40;
  if (/\/(impressum|datenschutz|privacy|contact|kontakt|shop\/?$)/i.test(href)) {
    score -= 30;
  }
  return score;
}

function absUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function collectScheduleLinkCandidates(opts: {
  baseUrl: string;
  links: Array<{ href: string; label: string }>;
  htmlOrText?: string | null;
}): ScheduleLinkCand[] {
  const seen = new Set<string>();
  const cands: ScheduleLinkCand[] = [];
  const push = (href: string, label: string) => {
    const abs = absUrl(opts.baseUrl, href);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    const score = scoreScheduleCandidate(abs, label);
    if (score <= 0) return;
    cands.push({ url: abs, score, label: label.slice(0, 80) });
  };
  for (const l of opts.links) {
    push(l.href, l.label || '');
  }
  const blob = String(opts.htmlOrText || '');
  const hrefRe =
    /href\s*=\s*["']([^"']+)["'][^>]*>\s*([^<]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(blob))) {
    push(m[1]!, (m[2] || '').trim());
  }
  cands.sort((a, b) => b.score - a.score);
  return cands;
}

export function pickBestScheduleCandidate(
  cands: ScheduleLinkCand[],
  baseUrl: string,
): ScheduleLinkCand | null {
  const usable = cands.filter(
    (c) => c.score >= 25 && !isClubOrActHomepageUrl(c.url),
  );
  if (usable[0]) return usable[0];
  // Fallback: deep path even if score soft
  return (
    cands.find((c) => isScheduleDeepPath(c.url) && c.url !== baseUrl) ?? null
  );
}

/**
 * Von Club-/Act-Seite den Spielplan-/Ticket-Deep-Link finden.
 * Schon tiefer Pfad → unverändert zurück.
 */
export async function findDeepestScheduleLink(opts: {
  websiteUrl: string;
  signal?: AbortSignal;
}): Promise<{ url: string; label: string } | null> {
  const base = opts.websiteUrl.trim();
  if (!/^https?:\/\//i.test(base)) return null;
  if (opts.signal?.aborted) return null;

  if (isScheduleDeepPath(base) && !isClubOrActHomepageUrl(base)) {
    return { url: base, label: 'Spielplan' };
  }

  const doc = await fetchPublicDocument(base);
  if (!doc.ok) return null;

  const extra: Array<{ href: string; label: string }> = [...(doc.links ?? [])];
  for (const p of [
    'spielplan',
    'schedule',
    'fixtures',
    'tickets',
    'heimspiele',
    'spiele',
    'kalender',
  ]) {
    const guess = absUrl(base, `/${p}`);
    if (guess) extra.push({ href: guess, label: p });
  }

  const htmlBlob = `${doc.text}\n${(doc.links ?? [])
    .map((l) => `${l.label} ${l.href}`)
    .join('\n')}`;
  const cands = collectScheduleLinkCandidates({
    baseUrl: base,
    links: extra,
    htmlOrText: htmlBlob,
  });
  const best = pickBestScheduleCandidate(cands, base);
  if (!best) return null;
  return {
    url: best.url,
    label: /ticket/i.test(best.label + best.url) ? 'Tickets' : 'Spielplan',
  };
}

/** Score-Boost für Grounding-Auswahl (ohne Netz). */
export function scheduleUrlQualityScore(url: string): number {
  if (!url || !/^https?:\/\//i.test(url)) return -10;
  let score = scoreScheduleCandidate(url, '');
  if (isClubOrActHomepageUrl(url)) score -= 20;
  if (isScheduleDeepPath(url)) score += 15;
  return score;
}
