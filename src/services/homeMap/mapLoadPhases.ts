/**
 * Karten-Ladephasen beim Boot / Stadtwechsel — genau 3 Releases, dann Freeze.
 *
 * R1 near: Straßen/Wasser/Bahn (5 km core)
 * R2 partial: Orte/Icons (kein Extract-Reload)
 * R3 final: volle Stadt + EU/World → extractFrozen
 *
 * Nach Freeze: kein Pan-Reclip, kein Force-Reload derselben Stadt.
 * Nur beginMapLoadPhases(andere Stadt) taut auf.
 */

export const MAP_NEAR_RADIUS_M = 5_000;
export const MAP_CITY_RADIUS_M = 10_000;
/** Spätestens dann R3 erzwingen, falls Pack noch zählt. */
export const MAP_CITY_PARTIAL_DEADLINE_MS = 60_000;

export type MapLoadPhase = 'idle' | 'near' | 'partial' | 'final';

/** 0 = noch kein Release; 1=R1 Straßen, 2=R2 Orte, 3=R3 Final. */
export type MapPaintRelease = 0 | 1 | 2 | 3;

type State = {
  phase: MapLoadPhase;
  cityId: string | null;
  nearReady: boolean;
  placesReady: boolean;
  worldAllowed: boolean;
  /** 1–3 während Stadtwechsel/Boot; 3 = alle Releases durch. */
  paintRelease: MapPaintRelease;
  /** Nach R3: Extract/Places dieser Stadt hart still. */
  extractFrozen: boolean;
  bootStartedAt: number;
};

const state: State = {
  phase: 'idle',
  cityId: null,
  nearReady: false,
  placesReady: false,
  worldAllowed: false,
  paintRelease: 0,
  extractFrozen: false,
  bootStartedAt: 0,
};

const worldListeners = new Set<() => void>();

export function resetMapLoadPhases(): void {
  state.phase = 'idle';
  state.cityId = null;
  state.nearReady = false;
  state.placesReady = false;
  state.worldAllowed = false;
  state.paintRelease = 0;
  state.extractFrozen = false;
  state.bootStartedAt = 0;
  worldListeners.clear();
}

export function beginMapLoadPhases(cityId: string | null, now = Date.now()): void {
  const id = (cityId || '').toLowerCase() || null;
  if (state.cityId && id && state.cityId !== id) {
    resetMapLoadPhases();
  }
  if (!state.bootStartedAt) state.bootStartedAt = now;
  if (id) state.cityId = id;
  // Neuer Lauf: Freeze + Release-Zähler weg (frischer Switch).
  state.extractFrozen = false;
  state.paintRelease = 0;
  if (state.phase === 'idle') state.phase = 'near';
}

export function peekMapPaintRelease(): MapPaintRelease {
  return state.paintRelease;
}

export function noteMapPaintRelease(release: 1 | 2 | 3): void {
  if (release > state.paintRelease) state.paintRelease = release;
}

export function noteMapNearReady(cityId?: string | null): void {
  const id = (cityId || state.cityId || '').toLowerCase() || null;
  if (id) state.cityId = id;
  state.nearReady = true;
  noteMapPaintRelease(1);
  if (state.phase === 'idle' || state.phase === 'near') state.phase = 'near';
}

/**
 * Release 2 — Icons + Story-Orte sichtbar.
 * Intern = partial (kein EU), damit Final/World erst danach kommt.
 */
export function noteMapPlacesReady(cityId?: string | null): void {
  const id = (cityId || state.cityId || '').toLowerCase() || null;
  if (id) state.cityId = id;
  state.placesReady = true;
  noteMapPaintRelease(2);
  if (state.phase === 'final') return;
  state.phase = 'partial';
}

/** Alias: Zwischenstand ohne EU (Legacy + Places-Release). */
export function noteMapCityPartial(cityId?: string | null): void {
  noteMapPlacesReady(cityId);
}

/** Finaler Stadt-Release (R3) — EU/World + Freeze (kein weiteres Nachladen). */
export function noteMapCityFinal(cityId?: string | null): void {
  const id = (cityId || state.cityId || '').toLowerCase() || null;
  if (id) state.cityId = id;
  state.phase = 'final';
  state.nearReady = true;
  noteMapPaintRelease(3);
  state.extractFrozen = true;
  releaseMapWorld();
}

/** @deprecated Nutze noteMapCityFinal nach R3-Inject. */
export function freezeMapExtract(cityId?: string | null): void {
  noteMapCityFinal(cityId);
}

export function isMapExtractFrozen(cityId?: string | null): boolean {
  if (!state.extractFrozen) return false;
  if (!cityId) return true;
  const id = cityId.toLowerCase();
  return !state.cityId || state.cityId === id;
}

export function releaseMapWorld(): void {
  if (state.worldAllowed) return;
  state.worldAllowed = true;
  for (const fn of [...worldListeners]) {
    try {
      fn();
    } catch {
      /* soft */
    }
  }
  worldListeners.clear();
}

export function isMapWorldReleaseAllowed(): boolean {
  return state.worldAllowed;
}

/** World-Layer erst mit Final (oder explizitem Release), nicht während Near-Boot. */
export function whenMapWorldAllowed(fn: () => void): () => void {
  if (state.worldAllowed) {
    fn();
    return () => undefined;
  }
  worldListeners.add(fn);
  return () => {
    worldListeners.delete(fn);
  };
}

export function peekMapLoadPhases(): Readonly<State> {
  return { ...state };
}

/**
 * Kein Viewport-Reclip / Force-Reload derselben Stadt nach Near oder Freeze.
 * Fremde cityId (echter Stadtwechsel) → false.
 */
export function shouldSkipSameCityReclip(cityId: string | null | undefined): boolean {
  const id = (cityId || '').toLowerCase();
  if (!id || !state.cityId) return false;
  if (id !== state.cityId) return false;
  if (state.extractFrozen) return true;
  if (!state.nearReady) return false;
  return state.phase === 'near' || state.phase === 'partial' || state.phase === 'final';
}
