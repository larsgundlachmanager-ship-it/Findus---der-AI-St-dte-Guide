/**
 * Bare „Hauptbahnhof“ / „Hbf“ → regionaler Groß-Hbf (nicht Dorf-Bahnhof am GPS).
 * Stadt-agnostisch über GPS-Metro-Boxen + Suburb→Metro-Hint.
 */

const BARE_HBF_RE =
  /^(?:dem\s+|den\s+|zum\s+|zur\s+)?(?:hauptbahnhof|hbf)$/iu;

/** Kleine Orte → Metro-Hbf (kein Ortsname in Speech erzwingen — nur Geocode-Query). */
const SUBURB_TO_METRO_HBF: Record<string, string> = {
  prisdorf: 'Hamburg Hauptbahnhof',
  pinneberg: 'Hamburg Hauptbahnhof',
  uetersen: 'Hamburg Hauptbahnhof',
  tornesch: 'Hamburg Hauptbahnhof',
  elmshorn: 'Hamburg Hauptbahnhof',
  wedel: 'Hamburg Hauptbahnhof',
  ahrensburg: 'Hamburg Hauptbahnhof',
  norderstedt: 'Hamburg Hauptbahnhof',
  quickborn: 'Hamburg Hauptbahnhof',
  laboe: 'Kiel Hauptbahnhof',
  kronshagen: 'Kiel Hauptbahnhof',
  schwentinental: 'Kiel Hauptbahnhof',
};

type MetroBox = {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  hbf: string;
};

const METRO_BOXES: MetroBox[] = [
  { latMin: 53.2, latMax: 54.05, lngMin: 9.2, lngMax: 10.55, hbf: 'Hamburg Hauptbahnhof' },
  { latMin: 52.3, latMax: 52.75, lngMin: 12.9, lngMax: 13.8, hbf: 'Berlin Hauptbahnhof' },
  { latMin: 48.0, latMax: 48.3, lngMin: 11.3, lngMax: 11.8, hbf: 'München Hauptbahnhof' },
  { latMin: 50.85, latMax: 51.1, lngMin: 6.75, lngMax: 7.15, hbf: 'Köln Hauptbahnhof' },
  { latMin: 50.05, latMax: 50.2, lngMin: 8.5, lngMax: 8.85, hbf: 'Frankfurt (Main) Hauptbahnhof' },
  { latMin: 48.7, latMax: 48.9, lngMin: 8.95, lngMax: 9.35, hbf: 'Stuttgart Hauptbahnhof' },
  { latMin: 51.4, latMax: 51.6, lngMin: 6.9, lngMax: 7.2, hbf: 'Essen Hauptbahnhof' },
  { latMin: 53.05, latMax: 53.2, lngMin: 8.65, lngMax: 8.95, hbf: 'Bremen Hauptbahnhof' },
  { latMin: 54.25, latMax: 54.4, lngMin: 10.0, lngMax: 10.25, hbf: 'Kiel Hauptbahnhof' },
  { latMin: 53.8, latMax: 54.15, lngMin: 9.35, lngMax: 9.6, hbf: 'Neumünster' },
];

export function isBareHauptbahnhofLabel(name: string | null | undefined): boolean {
  const t = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  // Already city-qualified
  if (/\b(hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|stuttgart|bremen|kiel|essen)\b/iu.test(t)) {
    return false;
  }
  return BARE_HBF_RE.test(t);
}

/**
 * Expand bare Hbf label for geocode / journey dest.
 * Returns original if not bare or no region known.
 */
export function expandBareHauptbahnhofQuery(
  name: string,
  opts?: {
    lat?: number | null;
    lng?: number | null;
    cityHint?: string | null;
  },
): string {
  const raw = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isBareHauptbahnhofLabel(raw)) return raw;

  const hint = String(opts?.cityHint || '')
    .toLowerCase()
    .trim();
  if (hint && SUBURB_TO_METRO_HBF[hint]) {
    return SUBURB_TO_METRO_HBF[hint];
  }

  const lat = opts?.lat;
  const lng = opts?.lng;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    for (const box of METRO_BOXES) {
      if (
        lat >= box.latMin &&
        lat <= box.latMax &&
        lng >= box.lngMin &&
        lng <= box.lngMax
      ) {
        return box.hbf;
      }
    }
  }

  // Kein Rate — lieber ehrlich regional suchen als Dorf-Bahnhof
  return 'Hauptbahnhof';
}
