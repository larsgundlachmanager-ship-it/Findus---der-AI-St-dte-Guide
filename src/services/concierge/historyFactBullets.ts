/**
 * Geschichts-Stichpunkte: 3 Fakten mit Jahreszahlen — keine Meta-Chips („Lebendig“).
 */

const YEAR_RE = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

function cleanChunk(raw: string): string {
  return raw
    .replace(/^[\s➔•\-–—*]+/u, '')
    .replace(/\s+/g, ' ')
    .replace(/[„“"']/g, '')
    .trim();
}

function formatBullet(chunk: string): string | null {
  const t = cleanChunk(chunk);
  if (t.length < 12) return null;
  const ym = t.match(YEAR_RE);
  if (!ym) return null;
  const year = ym[1];
  let rest = t
    .replace(new RegExp(`\\bseit\\s+${year}\\b`, 'iu'), ' ')
    .replace(new RegExp(`\\bim\\s+Jahr\\s+${year}\\b`, 'iu'), ' ')
    .replace(new RegExp(`\\b${year}\\b`, 'gu'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,:;.\-–—]\s*/u, '')
    .replace(/[,:;.\-–—]\s*$/u, '')
    .replace(/\b(von|seit|im|am|ab|um|bis|aus|nach)\s*$/iu, '')
    .trim();
  if (rest.length < 4) return `${year} · Meilenstein`;
  if (rest.length > 42) {
    rest = `${rest.slice(0, 40).replace(/\s+\S*$/u, '').trim()}…`;
  }
  return `${year} · ${rest}`;
}

/**
 * Extrahiert bis zu `max` Jahres-Fakten aus Speech + Pack/Web-Block.
 */
export function extractHistoryFactBullets(
  speech: string,
  factBlock?: string | null,
  max = 3,
): string[] {
  const pool = `${factBlock ?? ''}\n${speech}`.replace(/\s+/g, ' ').trim();
  if (!pool) return [];

  const candidates: Array<{ year: number; bullet: string }> = [];
  const seenYears = new Set<number>();

  // Sätze / Bullet-Zeilen mit Jahreszahl
  const parts = pool.split(/(?:[.!?]\s+|\n+|➔\s*)/u);
  for (const part of parts) {
    if (!YEAR_RE.test(part)) continue;
    const bullet = formatBullet(part);
    if (!bullet) continue;
    const year = Number(bullet.slice(0, 4));
    if (!Number.isFinite(year) || seenYears.has(year)) continue;
    seenYears.add(year);
    candidates.push({ year, bullet });
  }

  // Fallback: Jahr + ± Fenster aus dem Fließtext
  if (candidates.length < max) {
    const re = /(.{0,36}\b(1[0-9]{3}|20[0-2][0-9])\b.{0,48})/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pool)) && candidates.length < max + 2) {
      const year = Number(m[2]);
      if (seenYears.has(year)) continue;
      const bullet = formatBullet(m[1]);
      if (!bullet) continue;
      seenYears.add(year);
      candidates.push({ year, bullet });
    }
  }

  candidates.sort((a, b) => a.year - b.year);
  return candidates.slice(0, max).map((c) => c.bullet);
}
