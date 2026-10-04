/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/dedupeReality.smoke.test.ts
 */
import assert from 'node:assert/strict';

// Isoliert: Dedup-Logik wie in buildDayTimeline (ohne RN-Imports)
type Node = {
  id: string;
  title: string;
  atMs: number | null;
  endMs: number | null;
  subtitle?: string;
  untilNow?: boolean;
};

function dedupeReality(nodes: Node[]): Node[] {
  const WINDOW_MS = 3 * 60 * 60_000;
  const sorted = [...nodes].sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  const out: Node[] = [];
  for (const n of sorted) {
    const key = n.title
      .replace(/^📍\s*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, '')
      .slice(0, 48);
    const sameTitleAs = (prev: Node): boolean => {
      const prevKey = prev.title
        .replace(/^📍\s*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, '')
        .slice(0, 48);
      return (
        (key.length >= 3 && key === prevKey) ||
        prev.title.replace(/^📍\s*/, '').toLowerCase() ===
          n.title.replace(/^📍\s*/, '').toLowerCase()
      );
    };
    const last = out[out.length - 1];
    let matchIdx = last && sameTitleAs(last) ? out.length - 1 : -1;
    if (matchIdx < 0) {
      matchIdx = out.findIndex((prev, idx) => {
        if (!sameTitleAs(prev)) return false;
        const closeInTime =
          prev.atMs != null &&
          n.atMs != null &&
          Math.abs(prev.atMs - n.atMs) <= WINDOW_MS;
        if (!closeInTime) return false;
        const between = out.slice(idx + 1);
        if (between.some((b) => !sameTitleAs(b))) return false;
        return true;
      });
    }
    if (matchIdx >= 0) {
      const prev = out[matchIdx]!;
      if (prev.atMs != null && n.atMs != null) {
        prev.atMs = Math.min(prev.atMs, n.atMs);
      }
      if (n.endMs != null) {
        prev.endMs =
          prev.endMs != null ? Math.max(prev.endMs, n.endMs) : n.endMs;
      }
      if (n.untilNow) prev.untilNow = true;
      continue;
    }
    out.push({ ...n });
  }
  return out;
}

const t0 = Date.parse('2026-09-06T14:09:00');
const t1 = Date.parse('2026-09-06T15:41:00'); // 92 Min später — altes 90-Min-Fenster knackte
const merged = dedupeReality([
  {
    id: 'visit_1',
    title: 'Heisterhoop 12',
    atMs: t0,
    endMs: t0 + 40 * 60_000,
    subtitle: 'Aufenthalt',
  },
  {
    id: 'visit_2',
    title: 'Heisterhoop 12',
    atMs: t1,
    endMs: t1 + 30 * 60_000,
    subtitle: 'Aufenthalt',
  },
]);
assert.equal(merged.length, 1, 'gleiche Adresse hintereinander → 1 Block');
assert.equal(merged[0]!.atMs, t0);
assert.equal(merged[0]!.endMs, t1 + 30 * 60_000);

const sandwich = dedupeReality([
  { id: 'a', title: 'Heisterhoop 12', atMs: t0, endMs: t0 + 20 * 60_000 },
  {
    id: 'b',
    title: 'Bäckerei',
    atMs: t0 + 30 * 60_000,
    endMs: t0 + 50 * 60_000,
  },
  {
    id: 'c',
    title: 'Heisterhoop 12',
    atMs: t0 + 60 * 60_000,
    endMs: t0 + 90 * 60_000,
  },
]);
assert.equal(
  sandwich.length,
  3,
  'Adresse → anderer Ort → Adresse bleibt getrennt',
);

console.log('dedupeReality.smoke.test.ts OK');
