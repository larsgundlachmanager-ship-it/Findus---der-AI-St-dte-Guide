/**
 * Erkennt, wenn der Nutzer näher an einer anderen Stadt ist als an der
 * aktuell gewählten — und bietet einen Wechsel mit kurzer Begrüßung an.
 * UI: CitySwitchPromptHost (Cover + Fakten), kein System-Alert.
 *
 * Pack-Download nur nach explizitem Accept — kein Warm-Prefetch
 * benachbarter Städte (Paywall: Städte einzeln kaufen).
 */

import {
  loadCityCatalog,
  installCityPack,
  type CityCatalogItem,
} from './cityCatalogService';
import { getCachedUserProfile } from './userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import { speakCityWelcomeForCity } from './cityWelcomeService';

const SWITCH_GAP_KM = 5;
const CHECK_INTERVAL_MS = 3 * 60_000;
const MIN_MOVE_KM = 0.5;

export type CitySwitchResult = {
  cityId: string;
  cityName: string;
};

export type CityProximityHandlers = {
  onCitySwitched: (result: CitySwitchResult) => void | Promise<void>;
};

export type CitySwitchPromptPayload = {
  nearest: CityCatalogItem;
  selected: CityCatalogItem;
  nearestKm: number;
  selectedKm: number;
  gapKm: number;
};

export type CitySwitchDecision = 'accept' | 'dismiss';

type CitySwitchPresenter = (
  payload: CitySwitchPromptPayload,
) => Promise<CitySwitchDecision>;

let handlers: CityProximityHandlers | null = null;
let presenter: CitySwitchPresenter | null = null;
let settledListener: (() => void) | null = null;
let catalogCache: CityCatalogItem[] | null = null;
let catalogFetchedAt = 0;
let lastCheckAt = 0;
let lastCheckLat: number | null = null;
let lastCheckLng: number | null = null;
let promptOpen = false;
let lastDismissedCityId: string | null = null;
let lastDismissedAt = 0;

const CATALOG_TTL_MS = 10 * 60_000;
const DISMISS_COOLDOWN_MS = 30 * 60_000;

export function registerCityProximityHandlers(h: CityProximityHandlers | null): void {
  handlers = h;
}

export function registerCitySwitchPresenter(
  p: CitySwitchPresenter | null,
): void {
  presenter = p;
}

/** UI schließt den Busy-State, wenn Wechsel/Dismiss durch ist. */
export function registerCitySwitchSettledListener(
  fn: (() => void) | null,
): void {
  settledListener = fn;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCatalog(): Promise<CityCatalogItem[]> {
  const now = Date.now();
  if (catalogCache && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const catalog = await loadCityCatalog(null);
  catalogCache = catalog;
  catalogFetchedAt = now;
  return catalog;
}

async function applyCitySwitch(city: CityCatalogItem): Promise<void> {
  await installCityPack(city.id);
  const result: CitySwitchResult = {
    cityId: city.id,
    cityName: city.name,
  };
  await handlers?.onCitySwitched(result);
  await speakCityWelcomeForCity(city, { preferSwitch: true });
}

function shouldThrottle(lat: number, lng: number): boolean {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) {
    if (lastCheckLat != null && lastCheckLng != null) {
      const moved = haversineKm(lastCheckLat, lastCheckLng, lat, lng);
      if (moved < MIN_MOVE_KM) return true;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Prüft GPS gegen Städtekatalog. Zeigt einmalig den Wechsel-Dialog,
 * wenn eine andere Stadt mindestens 5 km näher ist als die gewählte.
 */
export async function checkCityProximity(lat: number, lng: number): Promise<void> {
  if (promptOpen) return;
  if (useFinnusStore.getState().isSimulationMode) return;

  const profile = getCachedUserProfile();
  if (!profile?.cityId || !profile.setupComplete) return;

  if (shouldThrottle(lat, lng)) return;
  lastCheckAt = Date.now();
  lastCheckLat = lat;
  lastCheckLng = lng;

  const catalog = await getCatalog();
  if (catalog.length < 2) return;

  const withDistance = catalog.map((item) => {
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number') {
      return { ...item, distanceKm: null as number | null };
    }
    return {
      ...item,
      distanceKm: haversineKm(lat, lng, item.lat, item.lng),
    };
  });

  const sorted = [...withDistance].sort((a, b) => {
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    return da - db;
  });

  const nearest = sorted[0];
  const selected = withDistance.find((c) => c.id === profile.cityId);
  if (!nearest || !selected || nearest.id === selected.id) return;
  if (nearest.distanceKm == null || selected.distanceKm == null) return;

  const gap = selected.distanceKm - nearest.distanceKm;
  if (gap < SWITCH_GAP_KM) return;

  if (
    lastDismissedCityId === nearest.id &&
    Date.now() - lastDismissedAt < DISMISS_COOLDOWN_MS
  ) {
    return;
  }

  if (!presenter) {
    console.warn('[cityProximity] no UI presenter registered');
    return;
  }

  promptOpen = true;
  try {
    const decision = await presenter({
      nearest,
      selected,
      nearestKm: nearest.distanceKm,
      selectedKm: selected.distanceKm,
      gapKm: gap,
    });

    if (decision === 'accept') {
      try {
        await applyCitySwitch(nearest);
      } catch (err) {
        console.warn('[cityProximity] switch failed:', err);
      }
    } else {
      lastDismissedCityId = nearest.id;
      lastDismissedAt = Date.now();
    }
  } finally {
    promptOpen = false;
    settledListener?.();
  }
}
