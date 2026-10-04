/**
 * Vector-Karte ohne Pack: Nutzer zu Datensatz-Download führen (Settings / Switch-Card).
 * Nur bei echtem Stadtwechsel — nicht bei jedem Pan/Zoom.
 *
 * Browse-Zubringer: beim Swipe in eine Nachbarstadt Pack still auf Disk legen
 * (Orte/Icons), GPS-/Profil-Stadt unverändert.
 * Sticky-GPS ohne Pack (Profil ≠ GPS, z. B. Prisdorf gewählt / Pinneberg stehst):
 * Pack trotzdem still nachladen — sonst leere Icons-Karte.
 */

import { loadCityCatalog, type CityCatalogItem } from '../cityCatalogService';
import { getCachedUserProfile } from '../userProfileService';
import {
  listKnownCityCoverageBounds,
  smallestCityIdContainingPoint,
} from '../discovery/cityCoverageBounds';
import {
  isCityPackDownloaded,
  isVectorBasemapEnabled,
  isYorroMapContentAllowed,
  type MapViewBox,
  type YorroMapContentGateInput,
} from './mapPackGate';
import { MAP_BROWSE_PACK_SLOTS } from './mapPinIndex';
import type { CityCoverageBounds } from '../discovery/cityCoverageBounds';

const PROMPT_COOLDOWN_MS = 120_000;
const BROWSE_ENSURE_COOLDOWN_MS = 45_000;
const lastPromptAt = new Map<string, number>();
/** Letzte Stadt, für die ein Pack-Prompt sinnvoll war (Stadtwechsel-Gate). */
let lastEnteredCityId: string | null = null;
const lastBrowseEnsureAt = new Map<string, number>();
let lastBrowseEnsureCity: string | null = null;

function coverageOverlapsView(b: CityCoverageBounds, view: MapViewBox): boolean {
  return (
    b.latMin <= view.north &&
    b.latMax >= view.south &&
    b.lngMin <= view.east &&
    b.lngMax >= view.west
  );
}

function viewCenter(view: MapViewBox): { lat: number; lng: number } {
  return {
    lat: (view.south + view.north) / 2,
    lng: (view.west + view.east) / 2,
  };
}

function distToViewCenterM(b: CityCoverageBounds, view: MapViewBox): number {
  const c = viewCenter(view);
  const midLat = (b.latMin + b.latMax) / 2;
  const midLng = (b.lngMin + b.lngMax) / 2;
  const dLat = (midLat - c.lat) * 111_320;
  const dLng =
    (midLng - c.lng) * 111_320 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180));
  return Math.hypot(dLat, dLng);
}

function padViewBox(view: MapViewBox, factor: number): MapViewBox {
  const dLat = Math.max(0.004, (view.north - view.south) * factor);
  const dLng = Math.max(0.006, (view.east - view.west) * factor);
  return {
    south: view.south - dLat,
    north: view.north + dLat,
    west: view.west - dLng,
    east: view.east + dLng,
  };
}

function catalogHit(
  cityId: string,
  catalog: CityCatalogItem[],
): CityCatalogItem | null {
  const id = cityId.toLowerCase();
  return catalog.find((c) => c.id.toLowerCase() === id) ?? null;
}

function shouldPromptAgain(cityId: string): boolean {
  const prev = lastPromptAt.get(cityId.toLowerCase()) ?? 0;
  return Date.now() - prev >= PROMPT_COOLDOWN_MS;
}

function rememberPrompt(cityId: string): void {
  lastPromptAt.set(cityId.toLowerCase(), Date.now());
}

export type MapPackPromptInput = {
  viewportLat: number;
  viewportLng: number;
  cityId?: string | null;
  localPackIds: readonly string[];
  /**
   * true = GPS/Stadtwechsel hat neue Coverage betreten.
   * false/omit = Pan/Zoom — kein Popup (Manager-Verfassung).
   */
  cityEnter?: boolean;
};

/** Pack fehlt — nur bei Stadtwechsel (cityEnter) oder explizitem Call-1-Pfad. */
export async function promptCityPackDownloadIfNeeded(
  input: MapPackPromptInput,
): Promise<boolean> {
  if (!isVectorBasemapEnabled()) return false;
  if (!input.cityEnter) return false;

  const known = listKnownCityCoverageBounds();
  const gateInput: YorroMapContentGateInput = {
    cityId: input.cityId,
    localPackIds: input.localPackIds,
    viewportLat: input.viewportLat,
    viewportLng: input.viewportLng,
    locateCity: (la, ln) => smallestCityIdContainingPoint(la, ln, known),
  };
  if (isYorroMapContentAllowed(gateInput)) return false;

  const atViewport = smallestCityIdContainingPoint(
    input.viewportLat,
    input.viewportLng,
    known,
  );
  if (!atViewport) return false;

  const entered = atViewport.toLowerCase();
  if (lastEnteredCityId === entered) return false;
  if (!shouldPromptAgain(atViewport)) return false;

  lastEnteredCityId = entered;
  rememberPrompt(atViewport);

  const profile = getCachedUserProfile();
  const activeId = (input.cityId || profile?.cityId || '').trim();
  const activeName = profile?.cityName?.trim() || 'deiner Stadt';

  try {
    const catalog = await loadCityCatalog(null);
    const hit = catalogHit(atViewport, catalog);
    if (hit && !isCityPackDownloaded(hit.id, input.localPackIds)) {
      const { presentCityPackSwitchCard } = await import(
        '../cityProximityService'
      );
      void presentCityPackSwitchCard({
        target: hit,
        activeId,
        activeName,
      });
      return true;
    }
  } catch {
    /* soft */
  }

  // Kein Settings-Spam mehr bei fehlendem Katalog-Hit — still bleiben.
  return false;
}

export type EnsureBrowsePackInput = {
  viewportLat: number;
  viewportLng: number;
  /** Profil-/Modul-1-Stadt — wird nie gewechselt. */
  profileCityId?: string | null;
  /** GPS-Aufenthalt (sticky Slot 1). */
  stickyCityId?: string | null;
  localPackIds: readonly string[];
};

export type EnsureBrowsePacksViewInput = {
  view: MapViewBox;
  profileCityId?: string | null;
  stickyCityId?: string | null;
  localPackIds: readonly string[];
  /** Max. neue Downloads pro Aufruf (Default: Browse-Slots). */
  maxEnsure?: number;
};

async function ensureOneBrowsePack(opts: {
  cityId: string;
  profile: string;
  sticky: string;
  localPackIds: readonly string[];
  catalog: CityCatalogItem[];
}): Promise<{ cityId: string; ready: boolean; newlyFetched: boolean } | null> {
  const cityId = opts.cityId.trim().toLowerCase();
  if (!cityId) return null;
  // Profil-Stadt: nie als Browse nachladen / nicht wechseln.
  if (cityId === opts.profile) return null;

  try {
    const { isSoftCityId } = await import('../softWorkingCity');
    if (isSoftCityId(cityId)) return null;
  } catch {
    /* soft */
  }

  const { isCityPackCachedOnDevice, ensureBrowseCityPackOnDevice } = await import(
    '../cityCatalogService'
  );

  // Schon in localPackIds ODER nur Disk: Pin-Index + Coverage trotzdem warmen
  // (sonst Pinneberg-Icons fehlen ewig, obwohl .json da ist).
  const listed = isCityPackDownloaded(cityId, opts.localPackIds);
  let onDisk = listed;
  if (!onDisk) {
    try {
      onDisk = await isCityPackCachedOnDevice(cityId);
    } catch {
      onDisk = false;
    }
  }
  if (onDisk) {
    try {
      const { peekMapPinIndex, loadMapPinIndex } = await import('./mapPinIndex');
      // Pin-Index schon warm → kein Pack-Parse jedes Viewport-Tick.
      if ((peekMapPinIndex(cityId)?.length ?? 0) > 0) {
        return { cityId, ready: true, newlyFetched: false };
      }
      const pins = await loadMapPinIndex(cityId);
      if (pins.length > 0) {
        return { cityId, ready: true, newlyFetched: false };
      }
      const ok = await ensureBrowseCityPackOnDevice(cityId);
      return { cityId, ready: ok, newlyFetched: false };
    } catch {
      return { cityId, ready: listed, newlyFetched: false };
    }
  }

  // Sticky = GPS-Stadt: Pack trotzdem holen wenn Profil ≠ GPS
  // (Prisdorf gewählt, stehst in Pinneberg → Pinneberg muss runter).
  const isStickyGps = !!opts.sticky && cityId === opts.sticky;

  if (!isStickyGps) {
    const stickyOrProfile = new Set(
      [opts.sticky, opts.profile].filter(Boolean) as string[],
    );
    const browseLocal = opts.localPackIds
      .map((x) => x.trim().toLowerCase())
      .filter((id) => id && !stickyOrProfile.has(id));
    if (browseLocal.length >= MAP_BROWSE_PACK_SLOTS + 2) return null;
  }

  const now = Date.now();
  const prevAt = lastBrowseEnsureAt.get(cityId) ?? 0;
  if (now - prevAt < BROWSE_ENSURE_COOLDOWN_MS) return null;

  const hit = catalogHit(cityId, opts.catalog);
  if (!hit) return null;

  // Cooldown erst nach Catalog-Hit — sonst blockiert ein Miss 45 s Retries.
  lastBrowseEnsureAt.set(cityId, now);
  lastBrowseEnsureCity = cityId;

  const ok = await ensureBrowseCityPackOnDevice(cityId);
  return { cityId, ready: ok, newlyFetched: ok };
}

/**
 * Swipe in Nachbarstadt → Pack still als Zubringer (Slots 2–3).
 * Kein Popup, kein Profil-/SQLite-Wechsel.
 * Punkt-API: deckt die Stadt unter dem Kamerazentrum ab.
 */
export async function ensureBrowsePackAtViewport(
  input: EnsureBrowsePackInput,
): Promise<{ cityId: string; ready: boolean } | null> {
  if (!isVectorBasemapEnabled()) return null;
  if (
    !Number.isFinite(input.viewportLat) ||
    !Number.isFinite(input.viewportLng)
  ) {
    return null;
  }
  // Kleine Box ums Zentrum — gleiche Pipeline wie Viewport-Overlap.
  const pad = 0.012;
  const rows = await ensureBrowsePacksOverlappingViewport({
    view: {
      south: input.viewportLat - pad,
      north: input.viewportLat + pad,
      west: input.viewportLng - pad,
      east: input.viewportLng + pad,
    },
    profileCityId: input.profileCityId,
    stickyCityId: input.stickyCityId,
    localPackIds: input.localPackIds,
    maxEnsure: 1,
  });
  return rows[0] ?? null;
}

/**
 * Alle sichtbaren (überlappenden) Städte im Kamera-Ausschnitt als Browse-Pack.
 * Tornesch/Pinneberg laden auch wenn das Zentrum noch in Prisdorf liegt.
 */
export async function ensureBrowsePacksOverlappingViewport(
  input: EnsureBrowsePacksViewInput,
): Promise<Array<{ cityId: string; ready: boolean; newlyFetched: boolean }>> {
  if (!isVectorBasemapEnabled()) return [];
  const view = input.view;
  if (
    !Number.isFinite(view.south) ||
    !Number.isFinite(view.north) ||
    !Number.isFinite(view.west) ||
    !Number.isFinite(view.east)
  ) {
    return [];
  }

  const profile = (input.profileCityId || '').trim().toLowerCase();
  const sticky = (input.stickyCityId || '').trim().toLowerCase();
  const padded = padViewBox(view, 0.2);
  const known = listKnownCityCoverageBounds();
  const candidates = known
    .filter((b) => coverageOverlapsView(b, padded))
    .sort((a, b) => distToViewCenterM(a, padded) - distToViewCenterM(b, padded));

  if (!candidates.length) return [];

  const maxEnsure = Math.max(
    1,
    Math.min(MAP_BROWSE_PACK_SLOTS, input.maxEnsure ?? MAP_BROWSE_PACK_SLOTS),
  );

  let catalog: CityCatalogItem[] = [];
  try {
    catalog = await loadCityCatalog(null);
  } catch {
    return [];
  }

  const out: Array<{ cityId: string; ready: boolean; newlyFetched: boolean }> =
    [];
  let fetched = 0;
  let localPackIds = [...input.localPackIds];

  for (const b of candidates) {
    if (fetched >= maxEnsure) break;
    const beforeReady = isCityPackDownloaded(b.cityId, localPackIds);
    try {
      const res = await ensureOneBrowsePack({
        cityId: b.cityId,
        profile,
        sticky,
        localPackIds,
        catalog,
      });
      if (!res) continue;
      out.push(res);
      if (res.ready && !beforeReady) {
        localPackIds = [...localPackIds, res.cityId];
        fetched += 1;
      } else if (res.newlyFetched) {
        fetched += 1;
      }
    } catch {
      /* soft — nächste Stadt */
    }
  }

  return out;
}

/** Tests / Stadtwechsel-Reset. */
export function __resetMapPackPromptStateForTests(): void {
  lastPromptAt.clear();
  lastEnteredCityId = null;
  lastBrowseEnsureAt.clear();
  lastBrowseEnsureCity = null;
}
