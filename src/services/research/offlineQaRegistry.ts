/**
 * Stadtweite Offline-Q&A aus Stadt-Pack (`_offline_qa`).
 * Für Modul-2 Lookup ohne Netz — keine Live-Preise.
 */

export type PackOfflineQa = {
  q: string;
  a: string;
  tags?: string[];
};

let entries: PackOfflineQa[] = [];

export function clearOfflineQaPackConfig(): void {
  entries = [];
}

export function setOfflineQaPackConfig(
  list: PackOfflineQa[] | null | undefined,
): void {
  entries = Array.isArray(list)
    ? list.filter((e) => e?.q?.trim() && e?.a?.trim())
    : [];
}

export function getOfflineQaEntries(): PackOfflineQa[] {
  return [...entries];
}

function scoreQa(entry: PackOfflineQa, subject: string): number {
  const q = entry.q.toLowerCase();
  const a = entry.a.toLowerCase();
  const s = subject.trim().toLowerCase();
  if (!s) return 0;
  if (q === s || q.replace(/\?+$/, '') === s.replace(/\?+$/, '')) return 100;
  if (q.includes(s) || s.includes(q.replace(/\?+$/, '').slice(0, 24))) return 70;
  const tokens = s.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (q.includes(t) || a.includes(t)) hit += 1;
  }
  return Math.round((hit / tokens.length) * 55);
}

/** Beste Offline-QA-Treffer zum User-Subject / zur Frage. */
export function lookupOfflineQa(
  subject: string,
  limit = 4,
): PackOfflineQa[] {
  const ranked = entries
    .map((e) => ({ e, score: scoreQa(e, subject) }))
    .filter((x) => x.score >= 28)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map((x) => x.e);
}

export function formatOfflineQaForAgent(list: PackOfflineQa[]): string {
  if (!list.length) return '';
  return [
    'OFFLINE-Q&A aus Stadt-Pack (stabil — nutzen wenn passend; nichts erfinden):',
    ...list.map((e, i) => `${i + 1}. Q: ${e.q}\n   A: ${e.a}`),
  ].join('\n');
}
