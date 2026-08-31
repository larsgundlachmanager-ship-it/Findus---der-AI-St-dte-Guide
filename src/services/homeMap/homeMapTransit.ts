import type { Poi } from '../../db/types';

const TRANSIT_NAME_RE =
  /\b(haltepunkt|haltestelle|bushaltestelle|busbahnhof|bahnhof|hbf|bus\s*stop|s-?\s*bahn|u-?\s*bahn|tram|straßenbahn|strassenbahn)\b/i;

const TRANSIT_CATEGORY_RE =
  /\b(bahnhof|haltepunkt|haltestelle|busbahnhof|öpnv|oepnv|station|railway|zug)\b/i;

/** Praxis/Laden — nie ÖPNV, auch wenn tags „bahnhof“ (Viertel) enthalten. */
const NON_TRANSIT_NAME_RE =
  /zahnarzt|zahnärztin|zahnaerztin|arztpraxis|\barzt\b|ärztin|aerztin|\bpraxis\b|frisör|friseur|bäcker|baecker|apotheke|restaurant|café|cafe|hotel|kita|kindergarten|parkplatz|p\+r/i;

function tagsOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch {
    return String(raw)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
}

export function isTransitMapPoi(poi: Poi): boolean {
  const name = poi.name ?? '';
  if (NON_TRANSIT_NAME_RE.test(name)) return false;

  // „Bahnhofstraße …“ ohne Halt-Wort ≠ Station
  if (
    /straße|strasse|str\./i.test(name) &&
    !/\b(haltepunkt|haltestelle|bushaltestelle|busbahnhof|hbf)\b/i.test(name)
  ) {
    /* nur Category/Tags unten */
  } else if (TRANSIT_NAME_RE.test(name)) {
    return true;
  }

  if (TRANSIT_CATEGORY_RE.test(poi.category ?? '')) return true;

  // Tag „bahnhof“ allein = oft District-Noise — nicht genug für ÖPNV-Icon
  return tagsOf(poi.tags_json).some((t) =>
    /^(oepnv|transit|bus_stop|railway|station|haltepunkt|public_transport)$/i.test(
      t,
    ),
  );
}
