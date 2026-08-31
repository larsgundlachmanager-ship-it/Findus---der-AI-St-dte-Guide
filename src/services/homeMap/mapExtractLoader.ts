/**
 * Viewport-basiertes Laden lokaler *.map.json — unabhängig von Profil-Stadt.
 */

import { InteractionManager } from 'react-native';
import { listLocalCityDatasets } from '../cityCatalogService';
import {
  isRegionPackCityId,
  listKnownCityCoverageBounds,
  smallestCityIdContainingPoint,
} from '../discovery/cityCoverageBounds';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import {
  buildAndPersistDisplaySnap,
  ensureCityMapExtract,
  hydrateDisplayExtract,
  peekCityMapExtract,
  peekDisplayExtract,
  prepareExtractForDisplay,
  rememberDisplayExtract,
  prefetchCityMapExtract,
  type CityMapExtract,
} from './cityMapExtract';

const RECLIP_M = 1_400;
/** Vorheriges Extract behalten, solange Viewport noch nahe am Clip-Zentrum (~10 km Umland + Puffer). */
const KEEP_EXTRACT_M = 14_000;
/** Außerhalb der Admin-Fläche: trotzdem Extract der nächsten lokalen Stadt (10 km Umland). */
const NEAR_CITY_EXTRACT_M = 10_000;
const VIEWPORT_SWITCH_RATIO = 0.6;

let loadGen = 0;
let localMapIds = new Set<string>();
let localMapLoadedAt = 0;

/** Nach Pack-Download / Install Index neu aufbauen. */
export function invalidateLocalMapIndex(): void {
  localMapLoadedAt = 0;
  localMapIds = new Set();
}

/** Sync-Peek für Viewport-City-Switch (leer bis erster ensureLocalMapIndex). */
export function peekLocalMapIds(): Set<string> {
  return localMapIds;
}

/** Beim Boot: lokale Pack/Map-IDs sofort für Viewport-Switch verfügbar machen. */
export async function warmLocalMapIndex(): Promise<Set<string>> {
  return ensureLocalMapIndex();
}

async function ensureLocalMapIndex(): Promise<Set<string>> {
  if (Date.now() - localMapLoadedAt < 60_000 && localMapIds.size > 0) {
    return localMapIds;
  }
  const rows = await listLocalCityDatasets();
  // Pack reicht: *.map.json wird on-demand per ensureCityMapExtract geholt.
  localMapIds = new Set(
    rows
      .filter((r) => r.hasMap || r.hasPack)
      .map((r) => r.id.toLowerCase()),
  );
  localMapLoadedAt = Date.now();
  return localMapIds;
}

function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * 111_320 * Math.max(0.2, cos);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function resolveViewportCityId(
  lat: number,
  lng: number,
  localIds: Set<string>,
): string | null {
  const known = listKnownCityCoverageBounds().filter((b) =>
    localIds.has(b.cityId.toLowerCase()),
  );
  const hit = smallestCityIdContainingPoint(lat, lng, known);
  if (hit && localIds.has(hit.toLowerCase())) return hit.toLowerCase();
  for (const id of localIds) {
    const row = known.find((b) => b.cityId.toLowerCase() === id);
    if (!row) continue;
    if (
      lat >= row.latMin &&
      lat <= row.latMax &&
      lng >= row.lngMin &&
      lng <= row.lngMax
    ) {
      return id;
    }
  }
  // Umland: nächste heruntergeladene Stadt innerhalb ~18 km (Hamburg von außerhalb).
  let bestId: string | null = null;
  let bestD = NEAR_CITY_EXTRACT_M;
  for (const id of localIds) {
    const row = known.find((b) => b.cityId.toLowerCase() === id);
    if (!row) continue;
    const d = metersToCoverageBBox(lat, lng, row);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return bestId;
}

function metersToCoverageBBox(
  lat: number,
  lng: number,
  box: {
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
  },
): number {
  const cLat = Math.min(Math.max(lat, box.latMin), box.latMax);
  const cLng = Math.min(Math.max(lng, box.lngMin), box.lngMax);
  return metersBetween({ lat, lng }, { lat: cLat, lng: cLng });
}

/**
 * Viewport-Stadt für Extract-Switch.
 * 1) Kleinster lokaler Pack unter dem Mittelpunkt.
 * 2) Sonst lokaler Pack, der die View zu ≥ VIEWPORT_SWITCH_RATIO überdeckt
 *    (damit „über Tornesch wischen“ wechselt, auch wenn der Mid noch in HH liegt).
 * 3) Fallback: resolveViewportCityId (Umland-Gürtel).
 */
export function resolveViewportCityIdForView(
  view: {
    south: number;
    west: number;
    north: number;
    east: number;
  },
  localIds: Set<string>,
): string | null {
  const midLat = (view.south + view.north) / 2;
  const midLng = (view.west + view.east) / 2;
  const byCenter = resolveViewportCityId(midLat, midLng, localIds);
  const known = listKnownCityCoverageBounds().filter((b) =>
    localIds.has(b.cityId.toLowerCase()),
  );
  let bestId: string | null = byCenter;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const b of known) {
    const id = b.cityId.toLowerCase();
    const overlap = overlapRatio(view, b);
    if (overlap < VIEWPORT_SWITCH_RATIO) continue;
    const area =
      Math.max(1e-12, b.latMax - b.latMin) * Math.max(1e-12, b.lngMax - b.lngMin);
    // Kleinere Stadt gewinnt (Tornesch vor Hamburg).
    if (area < bestArea) {
      bestArea = area;
      bestId = id;
    }
  }
  return bestId ?? byCenter;
}

function overlapRatio(
  view: { south: number; west: number; north: number; east: number },
  box: { latMin: number; latMax: number; lngMin: number; lngMax: number },
): number {
  const latMin = Math.max(view.south, box.latMin);
  const latMax = Math.min(view.north, box.latMax);
  const lngMin = Math.max(view.west, box.lngMin);
  const lngMax = Math.min(view.east, box.lngMax);
  if (latMax <= latMin || lngMax <= lngMin) return 0;
  const inter = (latMax - latMin) * (lngMax - lngMin);
  const viewArea =
    Math.max(1e-12, view.north - view.south) *
    Math.max(1e-12, view.east - view.west);
  return inter / viewArea;
}

export async function loadExtractForViewport(
  lat: number,
  lng: number,
  opts?: {
    force?: boolean;
    radiusM?: number;
    /** Explizite Stadt (Viewport-Overlap) — sonst resolve am Punkt. */
    cityId?: string | null;
    /** Stadtwechsel / Pan: nicht hinter Geste + InteractionManager verstecken. */
    urgent?: boolean;
  },
): Promise<CityMapExtract | null> {
  const localIds = await ensureLocalMapIndex();
  let id = (opts?.cityId || '').toLowerCase();
  if (!id || !localIds.has(id)) {
    id = resolveViewportCityId(lat, lng, localIds) || '';
  }
  if (!id || !localIds.has(id)) {
    const prev = useMapExtractStore.getState();
    // Leicht nach Pinneberg panschen ≠ Prisdorf-Extract sofort killen.
    if (
      prev.extract &&
      prev.clipCenter &&
      metersBetween(prev.clipCenter, { lat, lng }) < KEEP_EXTRACT_M
    ) {
      return prev.extract;
    }
    useMapExtractStore.getState().clear();
    return null;
  }
  if (isRegionPackCityId(id) && id === 'berlin-umland') {
    /* Phase 6a: nur Display-Snap / Clip */
  }
  const st = useMapExtractStore.getState();
  const cityChanged = st.cityId != null && st.cityId !== id;
  const urgent = opts?.urgent === true || (opts?.force === true && cityChanged);
  if (
    !opts?.force &&
    !cityChanged &&
    st.cityId === id &&
    st.extract &&
    st.clipCenter &&
    metersBetween(st.clipCenter, { lat, lng }) < RECLIP_M
  ) {
    return st.extract;
  }

  // Sofort-Pfade: Display-Snap oder geparstes Pack in RAM — ohne Warten.
  const memSnap = peekDisplayExtract(id);
  if (memSnap?.extract) {
    const drift = metersBetween({ lat: memSnap.lat, lng: memSnap.lng }, { lat, lng });
    if (drift < KEEP_EXTRACT_M) {
      useMapExtractStore.getState().setExtract(id, memSnap.extract, {
        lat: memSnap.lat,
        lng: memSnap.lng,
      });
      if (!urgent && drift < RECLIP_M && st.cityId === id) {
        return memSnap.extract;
      }
    }
  }
  const fullMem = peekCityMapExtract(id);
  if (fullMem && (urgent || cityChanged)) {
    const clipped = prepareExtractForDisplay(
      fullMem,
      lat,
      lng,
      id,
      opts?.radiusM,
    );
    useMapExtractStore.getState().setExtract(id, clipped, { lat, lng });
    void prefetchCityMapExtract(id);
  } else {
    void prefetchCityMapExtract(id);
  }

  const gen = ++loadGen;
  useMapExtractStore.getState().setLoading(id);

  let snap = peekDisplayExtract(id);
  if (!snap) snap = await hydrateDisplayExtract(id);
  // Fremd-Stadt-Snap nie; bei Stadtwechsel immer neu clippen am Viewport.
  if (snap?.extract && !opts?.force && !cityChanged && !urgent) {
    if (metersBetween({ lat: snap.lat, lng: snap.lng }, { lat, lng }) < RECLIP_M) {
      if (gen !== loadGen) return null;
      useMapExtractStore.getState().setExtract(id, snap.extract, {
        lat: snap.lat,
        lng: snap.lng,
      });
      return snap.extract;
    }
  }

  const runLoad = async (): Promise<CityMapExtract | null> => {
    try {
      if (gen !== loadGen) {
        return null;
      }
      const full = peekCityMapExtract(id) ?? (await ensureCityMapExtract(id));
      if (!full || gen !== loadGen) {
        // Fehlgeschlagen: cityId nicht auf Ziel stehen lassen ohne Geometrie.
        const prev = useMapExtractStore.getState();
        if (prev.cityId === id && prev.status === 'loading' && !prev.extract) {
          useMapExtractStore.getState().clear();
        }
        return null;
      }
      const clipped = await buildAndPersistDisplaySnap(
        id,
        full,
        lat,
        lng,
        opts?.radiusM,
      );
      if (gen !== loadGen) {
        return null;
      }
      useMapExtractStore.getState().setExtract(id, clipped, { lat, lng });
      return clipped;
    } catch {
      const prev = useMapExtractStore.getState();
      if (!prev.extract) useMapExtractStore.getState().clear();
      return null;
    }
  };

  if (urgent || cityChanged) {
    return runLoad();
  }

  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      void runLoad().then(resolve);
    });
  });
}

export function reclipExtractIfNeeded(lat: number, lng: number): void {
  const st = useMapExtractStore.getState();
  if (!st.extract || !st.cityId || !st.clipCenter) return;
  if (metersBetween(st.clipCenter, { lat, lng }) < RECLIP_M) return;
  const full = peekCityMapExtract(st.cityId);
  if (!full) return;
  const clipped = prepareExtractForDisplay(full, lat, lng, st.cityId);
  rememberDisplayExtract({
    cityId: st.cityId,
    lat,
    lng,
    atMs: Date.now(),
    extract: clipped,
  });
  useMapExtractStore.getState().setExtract(st.cityId, clipped, { lat, lng });
}

export { RECLIP_M, KEEP_EXTRACT_M, VIEWPORT_SWITCH_RATIO };
