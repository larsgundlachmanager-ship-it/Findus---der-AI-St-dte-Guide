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
  deleteCityMapExtractFile,
  ensureCityMapExtract,
  hydrateDisplayExtract,
  peekCityMapExtract,
  peekDisplayExtract,
  prepareExtractForDisplayAsync,
  rememberDisplayExtract,
  prefetchCityMapExtract,
  mergeCityMapExtracts,
  type CityMapExtract,
} from './cityMapExtract';
import { isMapExtractRoadsSane } from './mapExtractSanity';
import {
  shouldSkipSameCityReclip,
  isMapExtractFrozen,
  peekMapLoadPhases,
} from './mapLoadPhases';
import { isMapUserGesturing } from './mapGestureLane';

/** Weniger Reclips = weniger ShapeSource-Stürme (Kamera-Snap nach pickRoads). */
const RECLIP_M = 2_200;
/** Vorheriges Extract behalten, solange Viewport noch nahe am Clip-Zentrum (~10 km Umland + Puffer). */
const KEEP_EXTRACT_M = 14_000;
/** Außerhalb der Admin-Fläche: trotzdem Extract der nächsten lokalen Stadt (10 km Umland). */
const NEAR_CITY_EXTRACT_M = 10_000;
/** Ab diesem Anteil sichtbarer Stadtfläche → Extract wechseln (Tornesch/Pinneberg). */
const VIEWPORT_SWITCH_RATIO = 0.28;

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
  const preferId = (opts?.cityId || '').toLowerCase();
  // Mic / Modul-2: Extract-Nachladen pausieren — Chrome/Mic zuerst.
  // Urgent Stadtwechsel darf trotzdem, sonst leere Karte nach Switch.
  if (!opts?.urgent && opts?.force !== true) {
    try {
      const { isVoiceLaneBusy } = require('../boot/interactiveBootGate') as {
        isVoiceLaneBusy: () => boolean;
      };
      if (isVoiceLaneBusy()) {
        const stBusy = useMapExtractStore.getState();
        return stBusy.extract;
      }
    } catch {
      /* soft */
    }
  }
  // Freeze: dieselbe Stadt nie nachladen — auch force/urgent (nur R3 während 3-Release).
  {
    const st0 = useMapExtractStore.getState();
    const wantId = preferId || (st0.cityId || '').toLowerCase();
    const phases = peekMapLoadPhases();
    const inSwitchRun =
      phases.paintRelease > 0 && phases.paintRelease < 3;
    const switchingCity =
      !!preferId &&
      !!(st0.cityId || '').toLowerCase() &&
      preferId !== (st0.cityId || '').toLowerCase();
    if (
      wantId &&
      isMapExtractFrozen(wantId) &&
      !inSwitchRun &&
      !switchingCity
    ) {
      return st0.extract;
    }
  }

  if (isMapUserGesturing() && !opts?.urgent && opts?.force !== true) {
    const stG = useMapExtractStore.getState();
    if (stG.extract) return stG.extract;
  }

  const localIds = await ensureLocalMapIndex();
  let id = preferId;
  const explicit = !!id;
  if (!id || !localIds.has(id)) {
    if (explicit && id) {
      // Expliziter Stadtwechsel: Map ggf. erst jetzt laden — Index invalidieren.
      try {
        await prefetchCityMapExtract(id);
      } catch {
        /* soft */
      }
      invalidateLocalMapIndex();
      const refreshed = await ensureLocalMapIndex();
      if (!refreshed.has(id)) {
        refreshed.add(id); // Pack kann schon da sein; Extract holt Map on-demand.
        localMapIds = refreshed;
      }
    } else {
      id = resolveViewportCityId(lat, lng, localIds) || '';
    }
  }
  // Near/Partial/Final: kein Pan-Reclip in derselben Stadt (Kamera-Snap).
  if (
    id &&
    !opts?.force &&
    !opts?.urgent &&
    shouldSkipSameCityReclip(id)
  ) {
    const st = useMapExtractStore.getState();
    if (st.cityId === id && st.extract) return st.extract;
  }
  if (!id || (!localMapIds.has(id) && !explicit)) {
    const prev = useMapExtractStore.getState();
    // Leicht nach Pinneberg panschen ≠ Prisdorf-Extract sofort killen.
    if (
      prev.extract &&
      prev.clipCenter &&
      metersBetween(prev.clipCenter, { lat, lng }) < KEEP_EXTRACT_M
    ) {
      return prev.extract;
    }
    // Expliziter Switch: nie blank clearen bevor neues Extract da ist.
    if (!explicit) {
      useMapExtractStore.getState().clear();
    }
    return explicit ? useMapExtractStore.getState().extract : null;
  }
  if (isRegionPackCityId(id) && id === 'berlin-umland') {
    /* Phase 6a: nur Display-Snap / Clip */
  }
  const st = useMapExtractStore.getState();
  const cityChanged = st.cityId != null && st.cityId !== id;
  const explicitSwitch =
    !!preferId && (opts?.force === true || opts?.urgent === true);
  const mergeBase =
    st.extract &&
    (cityChanged ||
      (explicitSwitch && peekMapLoadPhases().paintRelease < 3))
      ? st.extract
      : null;
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
    if (!isMapExtractRoadsSane(memSnap.extract)) {
      await deleteCityMapExtractFile(id).catch(() => undefined);
    } else {
    const drift = metersBetween({ lat: memSnap.lat, lng: memSnap.lng }, { lat, lng });
    if (drift < KEEP_EXTRACT_M) {
      useMapExtractStore.getState().setExtract(id, memSnap.extract, {
        lat: memSnap.lat,
        lng: memSnap.lng,
      });
      // Cold-Start / urgent Boot: Snap sofort paint — kein Full-Parse.
      // force / Stadtwechsel clippen weiter neu.
      if (!opts?.force && !cityChanged) {
        if (drift < RECLIP_M || urgent) {
          return memSnap.extract;
        }
      }
    }
    }
  }
  const fullMem = peekCityMapExtract(id);
  if (fullMem && (urgent || cityChanged)) {
    let clipped = await prepareExtractForDisplayAsync(
      fullMem,
      lat,
      lng,
      id,
      opts?.radiusM,
    );
    if (mergeBase) {
      clipped = mergeCityMapExtracts(mergeBase, clipped, id);
    }
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
    if (
      isMapExtractRoadsSane(snap.extract) &&
      metersBetween({ lat: snap.lat, lng: snap.lng }, { lat, lng }) < RECLIP_M
    ) {
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
      const painted =
        mergeBase != null
          ? mergeCityMapExtracts(mergeBase, clipped, id)
          : clipped;
      useMapExtractStore.getState().setExtract(id, painted, { lat, lng });
      return painted;
    } catch {
      const prev = useMapExtractStore.getState();
      if (!prev.extract) useMapExtractStore.getState().clear();
      return null;
    }
  };

  if (urgent || cityChanged) {
    return runLoad();
  }

  // Nie ewig hinter Map-Gesten/TTS hängen — Mic/Settings brauchen den JS-Thread.
  return new Promise((resolve) => {
    let settled = false;
    const go = () => {
      if (settled) return;
      settled = true;
      void runLoad().then(resolve);
    };
    InteractionManager.runAfterInteractions(go);
    setTimeout(go, 80);
  });
}

export function reclipExtractIfNeeded(lat: number, lng: number): void {
  const st = useMapExtractStore.getState();
  if (!st.extract || !st.cityId || !st.clipCenter) return;
  if (isMapUserGesturing()) return;
  if (isMapExtractFrozen(st.cityId) || shouldSkipSameCityReclip(st.cityId)) return;
  if (metersBetween(st.clipCenter, { lat, lng }) < RECLIP_M) return;
  const full = peekCityMapExtract(st.cityId);
  if (!full) return;
  const cityId = st.cityId;
  void (async () => {
    try {
      const { prepareExtractForDisplayAsync } = await import('./cityMapExtract');
      const clipped = await prepareExtractForDisplayAsync(
        full,
        lat,
        lng,
        cityId,
      );
      rememberDisplayExtract({
        cityId,
        lat,
        lng,
        atMs: Date.now(),
        extract: clipped,
      });
      useMapExtractStore.getState().setExtract(cityId, clipped, { lat, lng });
    } catch {
      /* soft */
    }
  })();
}

export { RECLIP_M, KEEP_EXTRACT_M, VIEWPORT_SWITCH_RATIO };
