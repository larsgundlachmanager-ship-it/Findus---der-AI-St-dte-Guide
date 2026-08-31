import type { Poi } from '../../db/types';

const TRANSIT_RE =
  /\b(bahnhof|haltepunkt|haltestelle|busbahnhof|bus\s*stop|bushaltestelle|s-?\s*bahn|u-?\s*bahn|tram|straßenbahn|strassenbahn|öpnv|oepnv|station|hbf|railway|zug)\b/i;

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

function poiBlob(poi: Poi): string {
  return `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`;
}

export function isTransitMapPoi(poi: Poi): boolean {
  if (TRANSIT_RE.test(poiBlob(poi))) return true;
  return tagsOf(poi.tags_json).some((t) =>
    /^(oepnv|transit|bus_stop|railway|station|bahnhof|halt|haltepunkt|public_transport)$/i.test(
      t,
    ),
  );
}
