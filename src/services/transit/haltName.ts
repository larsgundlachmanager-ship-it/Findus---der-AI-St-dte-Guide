/**
 * Haltestellen-Titel: kurz, ohne Nominatim-Müll (Kreis, PLZ, Bundesland).
 */

export function tidyHaltName(raw: string): string {
  let n = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  n = n.replace(/^haltestelle\s+/iu, '').trim();
  const parts = n
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const isAdmin = (p: string) =>
    /^(kreis|landkreis|stadt|bezirk|ortsteil|schleswig-holstein|schleswig|holstein|hamburg(-mitte|-nord|-süd|-altona|-eimsbüttel|-wandsbek|-bergedorf|-harburg)?|deutschland|germany|niedersachsen|mecklenburg.*|neustadt|altstadt)$/iu.test(
      p,
    );
  const isHaltBit =
    /\b(weg|straße|strasse|platz|allee|ring|damm|brücke|bruecke|zob|bhf|hbf|halt|markt|zentrum|schule|kirche|klinik|bahnhof)\b/iu;
  for (const p of parts) {
    if (isAdmin(p)) continue;
    if (/^\d{4,5}\b/.test(p)) continue;
    if (/^[A-Z]{1,3}$/.test(p)) continue;
    if (kept.length === 0) {
      kept.push(p);
      continue;
    }
    if (isHaltBit.test(p) || /\d/.test(p)) {
      kept.push(p);
    }
    break;
  }
  return (kept.join(', ') || parts[0] || n).trim();
}

const RAIL_MODES = /^(RAIL|TRANSIT|SUBWAY)$/i;
const HAS_STATION_WORD =
  /\b(bahnhof|bhf|hbf|haltepunkt|haltestelle|bahnhaltepunkt|hauptbahnhof)\b/iu;

/**
 * Ortsname-only am Gleis → „Bahnhof Prisdorf“.
 * S/U/Hbf bleibt. Bus/Tram nicht zum Bahnhof machen.
 */
export function stationDisplayName(
  raw: string,
  mode?: string | null,
): string {
  const n = tidyHaltName(raw);
  if (!n) return 'Haltestelle';
  if (HAS_STATION_WORD.test(n)) return n;
  if (/^(s\+|s\s|u\s)/iu.test(n) || /^(s|u)\b/iu.test(n)) return n;
  const rail = RAIL_MODES.test(String(mode || ''));
  if (!rail) return n;
  const short = n.replace(/\s*\([^)]*\)\s*$/u, '').trim();
  if (short.split(/\s+/).length > 2 || /\d/.test(short)) return n;
  try {
    const { cityCoordsFromName, fuzzyResolveCityName } = require('../navigation/fuzzyCityResolve') as {
      cityCoordsFromName: (s: string) => { name: string } | null;
      fuzzyResolveCityName: (s: string) => string | null;
    };
    const town =
      fuzzyResolveCityName(short) ||
      (cityCoordsFromName(short) ? short : null);
    if (town) return `Bahnhof ${n}`;
  } catch {
    /* Katalog optional */
  }
  return n;
}

/** Nur das Wort „Haltestelle“ / „Bahnhof“ — ohne Ortsnamen. */
export function isBareHaltLabel(raw: string): boolean {
  const n = String(raw || '').trim();
  if (!n) return true;
  return /^(die\s+)?(haltestelle|halt|stop|station|bahnhof|haltepunkt)(\s+\d+)?\.?$/iu.test(
    n,
  );
}

/**
 * Karten-Titel für einen Halt: Ortsname, sonst Linie/Richtung, nie nacktes „Haltestelle“.
 */
export function concreteHaltLabel(opts: {
  name?: string | null;
  mode?: string | null;
  line?: string | null;
  headsign?: string | null;
  role?: string | null;
}): string {
  const named = stationDisplayName(opts.name ?? '', opts.mode);
  if (named && !isBareHaltLabel(named)) return named;
  const line = String(opts.line ?? '').trim();
  const headRaw = String(opts.headsign ?? '').trim();
  const head = tidyHaltName(headRaw) || headRaw;
  if (line && head && !isBareHaltLabel(head)) return `${line} Richtung ${head}`;
  if (head && !isBareHaltLabel(head)) return head;
  if (line) {
    if (opts.role === 'alight') return `Ausstieg ${line}`;
    if (opts.role === 'board' || opts.role === 'walk' || opts.role === 'transfer') {
      return `Einstieg ${line}`;
    }
    return line;
  }
  if (opts.role === 'alight') return 'Ausstieg';
  if (opts.role === 'board') return 'Einstieg';
  return named || 'Halt';
}
