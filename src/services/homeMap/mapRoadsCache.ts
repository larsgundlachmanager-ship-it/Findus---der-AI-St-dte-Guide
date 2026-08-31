/**
 * Offline Straßennetz pro Stadt — einmal laden/cachen, nie beim Pan.
 */

import * as FileSystem from 'expo-file-system';
import {
  fetchOsmRoadsInBbox,
  type MapRoad,
} from '../navigation/osmRoadNetwork';
import {
  resolveCityCoverageBoundsSync,
  type CityCoverageBounds,
} from '../discovery/cityCoverageBounds';

const DIR = `${FileSystem.documentDirectory}findus-map-roads/`;

const memory = new Map<string, MapRoad[]>();

function pathFor(cityId: string): string {
  return `${DIR}${cityId.toLowerCase()}.json`;
}

export async function loadCachedMapRoads(
  cityId: string | null | undefined,
): Promise<MapRoad[]> {
  if (!cityId) return [];
  const id = cityId.toLowerCase();
  const hit = memory.get(id);
  if (hit) return hit;
  try {
    const raw = await FileSystem.readAsStringAsync(pathFor(id));
    const parsed = JSON.parse(raw) as { roads?: MapRoad[] };
    const roads = Array.isArray(parsed.roads) ? parsed.roads : [];
    memory.set(id, roads);
    return roads;
  } catch {
    return [];
  }
}

async function persist(cityId: string, roads: MapRoad[]): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      pathFor(cityId),
      JSON.stringify({ roads, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Einmalig für Stadt holen (Pack-Install / erster Map-Open).
 * Nicht beim Verschieben der Karte aufrufen.
 */
export async function ensureCityMapRoads(
  cityId: string | null | undefined,
  bounds?: CityCoverageBounds | null,
): Promise<MapRoad[]> {
  if (!cityId) return [];
  const id = cityId.toLowerCase();
  const cached = await loadCachedMapRoads(id);
  if (cached.length > 0) return cached;

  const b = bounds ?? resolveCityCoverageBoundsSync(id);
  if (!b) return [];
  const spanM = Math.hypot(
    (b.latMax - b.latMin) * 111_320,
    (b.lngMax - b.lngMin) *
      111_320 *
      Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180),
  );
  // Mega-Städte: Live-Overpass für die ganze BBox lohnt nicht — Pack-Extract.
  if (spanM > 20_000) return [];

  try {
    const roads = await fetchOsmRoadsInBbox({
      south: b.latMin,
      west: b.lngMin,
      north: b.latMax,
      east: b.lngMax,
      zoom: 15,
    });
    memory.set(id, roads);
    await persist(id, roads);
    return roads;
  } catch {
    return [];
  }
}
