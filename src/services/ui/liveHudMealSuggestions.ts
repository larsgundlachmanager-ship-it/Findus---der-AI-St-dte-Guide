/**
 * Live-HUD Gastro-Vorschläge: echte Orte in der Nähe + Fuß-Minuten.
 * Slot: morgens Bäckerei · mittags Lunch · abends Dinner.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import { walkMinutesForDistanceM } from '../navigation/travelEta';
import { fitHudMeta } from './hudTextFit';

export type MealSlotKind = 'bakery' | 'lunch' | 'dinner';

export type MealHudSuggestion = {
  name: string;
  walkMin: number;
  distanceM: number;
  openNow: boolean | null;
};

export type MealHudCache = {
  slot: MealSlotKind;
  atMs: number;
  lat: number;
  lng: number;
  items: MealHudSuggestion[];
  title: string;
  meta: string;
  tellMorePrompt: string;
};

const TTL_MS = 25 * 60_000;
const CELL_M = 180;

let cache: MealHudCache | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function subscribeMealHud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function resolveMealSlot(nowMs = Date.now()): MealSlotKind {
  const h = new Date(nowMs).getHours() + new Date(nowMs).getMinutes() / 60;
  if (h >= 6 && h < 11) return 'bakery';
  if (h >= 11 && h < 16) return 'lunch';
  return 'dinner';
}

function slotLabel(slot: MealSlotKind): string {
  if (slot === 'bakery') return 'Bäckerei';
  if (slot === 'lunch') return 'Mittagessen';
  return 'Abendessen';
}

function placeTypeFor(slot: MealSlotKind): string {
  if (slot === 'bakery') return 'bakery';
  if (slot === 'lunch') return 'restaurant';
  return 'restaurant';
}

function cellKey(lat: number, lng: number): string {
  return `${(lat / (CELL_M / 111_000)).toFixed(0)},${(
    lng /
    (CELL_M / (111_000 * Math.cos((lat * Math.PI) / 180)))
  ).toFixed(0)}`;
}

export function getMealHudCache(): MealHudCache | null {
  if (!cache) return null;
  if (Date.now() - cache.atMs > TTL_MS) return null;
  return cache;
}

export async function ensureMealHudFresh(opts?: {
  nowMs?: number;
  force?: boolean;
}): Promise<MealHudCache | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return getMealHudCache();
  }

  const slot = resolveMealSlot(nowMs);
  const existing = getMealHudCache();
  if (
    !opts?.force &&
    existing &&
    existing.slot === slot &&
    cellKey(existing.lat, existing.lng) === cellKey(lat, lng)
  ) {
    return existing;
  }

  if (inFlight) {
    await inFlight;
    return getMealHudCache();
  }

  inFlight = (async () => {
    try {
      const type = placeTypeFor(slot);
      const hits = await searchOpenPlacesAhead({
        lat,
        lng,
        placeType: type,
        radiusM: slot === 'bakery' ? 900 : 1400,
        openNow: true,
      });
      const items: MealHudSuggestion[] = hits.slice(0, 2).map((h) => ({
        name: h.name.trim() || 'Lokal',
        walkMin: walkMinutesForDistanceM(h.distanceM),
        distanceM: Math.round(h.distanceM),
        openNow: h.openNow ?? null,
      }));

      if (items.length === 0) {
        cache = null;
        notify();
        return;
      }

      const lines = items.map(
        (it) => `${it.name} · ${it.walkMin} Min zu Fuß`,
      );
      const title = slotLabel(slot);
      cache = {
        slot,
        atMs: nowMs,
        lat,
        lng,
        items,
        title,
        meta: fitHudMeta(lines.join('\n')),
        tellMorePrompt:
          `Zwei konkrete ${title}-Tipps in meiner Nähe mit Öffnungszeiten und Route: ` +
          items.map((i) => i.name).join(' und ') +
          '.',
      };
      notify();
    } catch {
      /* soft */
    } finally {
      inFlight = null;
    }
  })();

  await inFlight;
  return getMealHudCache();
}
