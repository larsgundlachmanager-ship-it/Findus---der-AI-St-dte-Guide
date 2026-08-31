/**
 * Karten-Grün: Ort ≥10 Min / Stadt ≥30 Min Aufenthalt (dann dauerhaft).
 * Sofort-Grün „ich bin gerade hier“ lebt in homeMapCityTone (hereNow), nicht hier.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-city-dwell-v1.json`;

export const MAP_PLACE_DWELL_GREEN_MS = 10 * 60_000;
export const MAP_CITY_DWELL_GREEN_MS = 30 * 60_000;

type DwellState = {
  /** cityId → kumulierte ms in Stadt */
  cityMs: Record<string, number>;
  /** `${cityId}:${spotKey|poiId}` → kumulierte ms am Ort */
  placeMs: Record<string, number>;
  /** cityIds die schon grün sind (≥30 Min) */
  cityGreen: string[];
  /** place keys die schon grün sind (≥10 Min) */
  placeGreen: string[];
};

let state: DwellState = {
  cityMs: {},
  placeMs: {},
  cityGreen: [],
  placeGreen: [],
};
let hydrated = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void FileSystem.writeAsStringAsync(PATH, JSON.stringify(state)).catch(
      () => undefined,
    );
  }, 2_000);
}

export async function hydrateCityDwellTracker(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as Partial<DwellState>;
    state = {
      cityMs: parsed.cityMs ?? {},
      placeMs: parsed.placeMs ?? {},
      cityGreen: Array.isArray(parsed.cityGreen) ? parsed.cityGreen : [],
      placeGreen: Array.isArray(parsed.placeGreen) ? parsed.placeGreen : [],
    };
  } catch {
    /* empty */
  }
}

function placeKey(cityId: string, spotOrId: string): string {
  return `${cityId.toLowerCase()}:${spotOrId}`;
}

/**
 * Delta-Tick vom GPS (z. B. alle paar Sekunden).
 * Nur wenn User in Stadt / am Ort steht (Caller prüft Geofence).
 */
export function noteCityDwellDelta(
  cityId: string | null | undefined,
  deltaMs: number,
): boolean {
  if (!cityId || !(deltaMs > 0) || deltaMs > 120_000) return false;
  const id = cityId.toLowerCase();
  state.cityMs[id] = (state.cityMs[id] ?? 0) + deltaMs;
  let newly = false;
  if (
    (state.cityMs[id] ?? 0) >= MAP_CITY_DWELL_GREEN_MS &&
    !state.cityGreen.includes(id)
  ) {
    state.cityGreen.push(id);
    newly = true;
  }
  scheduleSave();
  return newly;
}

export function notePlaceDwellDelta(
  cityId: string | null | undefined,
  spotOrId: string | null | undefined,
  deltaMs: number,
): boolean {
  if (!cityId || !spotOrId || !(deltaMs > 0) || deltaMs > 120_000) {
    return false;
  }
  const key = placeKey(cityId, spotOrId);
  state.placeMs[key] = (state.placeMs[key] ?? 0) + deltaMs;
  let newly = false;
  if (
    (state.placeMs[key] ?? 0) >= MAP_PLACE_DWELL_GREEN_MS &&
    !state.placeGreen.includes(key)
  ) {
    state.placeGreen.push(key);
    newly = true;
  }
  scheduleSave();
  return newly;
}

export function isCityMapGreen(cityId: string | null | undefined): boolean {
  if (!cityId) return false;
  return state.cityGreen.includes(cityId.toLowerCase());
}

export function listCityMapGreenIds(): string[] {
  return [...state.cityGreen];
}

export function isPlaceMapGreenByDwell(
  cityId: string | null | undefined,
  spotOrId: string | null | undefined,
): boolean {
  if (!cityId || !spotOrId) return false;
  return state.placeGreen.includes(placeKey(cityId, spotOrId));
}

export function getCityDwellMs(cityId: string | null | undefined): number {
  if (!cityId) return 0;
  return state.cityMs[cityId.toLowerCase()] ?? 0;
}
