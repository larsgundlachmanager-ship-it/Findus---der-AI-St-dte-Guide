/**
 * Hotel Must-Haves hart: Pool / Sauna / Blick. Max 2 Optionen.
 */

export type StayMustHave = 'pool' | 'sauna' | 'view';

export function extractStayMustHaves(text: string): StayMustHave[] {
  const t = (text || '').toLowerCase();
  const out: StayMustHave[] = [];
  if (/\b(pool|schwimmbad|schwimmbecken)\b/i.test(t)) out.push('pool');
  if (/\b(sauna|spa|wellness)\b/i.test(t)) out.push('sauna');
  if (/\b(blick|aussicht|view|elbe|alster|förde|foerde|meer|see)\b/i.test(t)) {
    out.push('view');
  }
  return out;
}

export function venueMatchesMustHaves(
  venue: { name?: string | null; tags?: string[] | null; summary?: string | null },
  must: StayMustHave[],
): boolean {
  if (!must.length) return true;
  const blob = `${venue.name ?? ''} ${(venue.tags ?? []).join(' ')} ${venue.summary ?? ''}`.toLowerCase();
  const hit = (id: StayMustHave) => {
    if (id === 'pool') return /\b(pool|schwimmbad|indoor\s*pool|outdoor\s*pool)\b/i.test(blob);
    if (id === 'sauna') return /\b(sauna|spa|wellness)\b/i.test(blob);
    return /\b(blick|aussicht|view|elbe|alster|harbour|hafen|meer|see|rooftop)\b/i.test(
      blob,
    );
  };
  return must.every(hit);
}

export function filterStayOptions<T extends { name?: string | null; tags?: string[] | null; summary?: string | null }>(
  venues: T[],
  must: StayMustHave[],
  max = 2,
): T[] {
  const kept = must.length
    ? venues.filter((v) => venueMatchesMustHaves(v, must))
    : venues.slice();
  return kept.slice(0, max);
}
