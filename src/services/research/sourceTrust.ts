/**
 * Quellen-Vertrauen 0–1 — Events, Öffnungszeiten, Web-Fakten (gleiche Logik).
 */

export type SourceTrustHints = {
  url?: string | null;
  ticketUrl?: string | null;
  hasPdf?: boolean;
  sourceHint?: string | null;
  /** structured time present */
  hasTime?: boolean;
  /** summary / value length */
  detailLen?: number;
  /** explicit LLM confidence */
  confidence?: 'high' | 'medium' | 'low' | null;
  /** place hours from Google/OSM live */
  liveOpenNow?: boolean | null;
};

export function scoreSourceTrust(h: SourceTrustHints): number {
  let score = 0.25;
  if (h.ticketUrl) score += 0.28;
  const url = h.url || '';
  if (h.hasPdf || /\.pdf(\?|$)/i.test(url)) score += 0.22;
  else if (url) score += 0.12;
  if (h.hasTime) score += 0.1;
  if ((h.detailLen ?? 0) >= 24) score += 0.06;
  if (h.liveOpenNow === true || h.liveOpenNow === false) score += 0.12;

  const hint = (h.sourceHint || '').toLowerCase();
  if (
    /pdf|flyer|wochenprogramm|kurverwaltung|tourismus|official|offiziell|venue|veranstalter|betreiber|google|maps|opening_hours|osm/.test(
      hint,
    )
  ) {
    score += 0.1;
  } else if (/facebook|instagram|gerücht|angeblich|hörensagen/.test(hint)) {
    score -= 0.12;
  }

  if (h.confidence === 'high') score += 0.12;
  else if (h.confidence === 'medium') score += 0.04;
  else if (h.confidence === 'low') score -= 0.1;

  return Math.max(0.1, Math.min(1, Math.round(score * 100) / 100));
}

/** Speech: harte Aussage vs. weicher Hinweis */
export function trustSpeechPrefix(trust: number): 'hard' | 'soft' {
  return trust >= 0.5 ? 'hard' : 'soft';
}

export function formatTrustedFactLine(opts: {
  label: string;
  value: string;
  trust: number;
}): string {
  if (trustSpeechPrefix(opts.trust) === 'hard') {
    return `${opts.label}: ${opts.value}`;
  }
  return `${opts.label} (laut Quelle, unsicher): ${opts.value}`;
}
