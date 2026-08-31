/**
 * Geschichts-Stichpunkte: harte Jahres-Fakten — keine abgeschnittenen Satzfetzen.
 */

const YEAR_RE = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

function cleanChunk(raw: string): string {
  return raw
    .replace(/^[\s➔•\-–—*]+/u, '')
    .replace(/\s+/g, ' ')
    .replace(/[„“"']/g, '')
    .trim();
}

/** Nie enden mit Präposition/Artikel/Konjunktion — sonst „fiel hier“ / „das alte“. */
function looksIncomplete(rest: string): boolean {
  const t = rest.trim();
  if (t.length < 6) return true;
  if (
    /\b(und|oder|dass|weil|der|die|das|den|dem|des|ein|eine|einen|einem|einer|zum|zur|zu|von|mit|für|fuer|am|im|ab|als|nach|vor|über|ueber|unter|durch|ohne|bei|gegen|sowie|bzw)\s*$/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(fiel|kommt|wurde|waren|ist|sind|hat|haben)\s+(hier|dort)?\s*$/iu.test(t)) {
    return true;
  }
  return false;
}

function truncateComplete(rest: string, maxChars: number): string | null {
  let t = rest.trim();
  if (t.length <= maxChars) {
    return looksIncomplete(t) ? null : t;
  }
  // An Satzzeichen / Komma / „und“ vor Limit schneiden
  const slice = t.slice(0, maxChars);
  const cut =
    slice.match(/^(.+?)(?:[,:;]| — | – |\s+und\s+|\s+sowie\s+)[^.]*$/iu)?.[1] ??
    slice.replace(/\s+\S*$/u, '').trim();
  if (cut.length < 6 || looksIncomplete(cut)) return null;
  return cut;
}

function formatBullet(chunk: string): string | null {
  const t = cleanChunk(chunk);
  if (t.length < 12) return null;
  const ym = t.match(YEAR_RE);
  if (!ym) return null;
  const year = ym[1]!;
  // Schuljahr 2013/2014 o.ä. → kompaktes Label
  const schoolYear = t.match(
    /\bSchuljahr\s+(20\d{2})\s*[\/–-]\s*(20\d{2}|\d{2})\b/iu,
  );
  if (schoolYear) {
    const a = schoolYear[1]!;
    const b = schoolYear[2]!;
    const label =
      /\b(start|neubau|eröffnet|eroeffnet|betrieb|schule)\b/iu.test(t)
        ? 'Neubau / Schulstart'
        : 'Schuljahr';
    return `${a}/${b.length === 2 ? a.slice(0, 2) + b : b} · ${label}`;
  }

  let rest = t
    .replace(new RegExp(`\\bseit\\s+${year}\\b`, 'iu'), ' ')
    .replace(new RegExp(`\\bim\\s+Jahr\\s+${year}\\b`, 'iu'), ' ')
    .replace(new RegExp(`\\bab\\s+${year}\\b`, 'iu'), ' ')
    .replace(new RegExp(`\\b${year}\\b`, 'gu'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,:;.\-–—]\s*/u, '')
    .replace(/[,:;.\-–—]\s*$/u, '')
    .replace(/\b(von|seit|im|am|ab|um|bis|aus|nach)\s*$/iu, '')
    .trim();

  // Nominalisieren typischer Fließtext-Anfänge
  rest = rest
    .replace(/^(wurde|wurden|ist|sind|wurde\s+die|wurde\s+der)\s+/iu, '')
    .replace(/^(zum|zur)\s+/iu, '')
    .trim();

  if (rest.length < 4) return `${year} · belegt`;
  const compact = truncateComplete(rest, 72);
  if (!compact) return null;
  return `${year} · ${compact}`;
}

/**
 * Extrahiert bis zu `max` Jahres-Fakten aus Speech + Pack/Web-Block.
 * Nur vollständige Sätze/Klauseln — kein Zeichenfenster mitten im Satz.
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

  const parts = pool.split(/(?:[.!?]\s+|\n+|➔\s*)/u);
  for (const part of parts) {
    if (!YEAR_RE.test(part)) continue;
    const bullet = formatBullet(part);
    if (!bullet) continue;
    const year = Number(bullet.match(YEAR_RE)?.[1]);
    if (!Number.isFinite(year) || seenYears.has(year)) continue;
    seenYears.add(year);
    candidates.push({ year, bullet });
  }

  candidates.sort((a, b) => a.year - b.year);
  return candidates.slice(0, max).map((c) => c.bullet);
}
