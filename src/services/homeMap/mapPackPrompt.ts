/**
 * Vector-Karte ohne Pack: Nutzer zu Datensatz-Download führen (Settings / Switch-Card).
 * Nur bei echtem Stadtwechsel — nicht bei jedem Pan/Zoom.
 *
 * Browse-Zubringer: beim Swipe in eine Nachbarstadt Pack still auf Disk legen
 * (Orte/Icons), GPS-/Profil-Stadt unverändert.
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
  type YorroMapContentGateInput,
} from './mapPackGate';
import { MAP_BROWSE_PACK_SLOTS } from './mapPinIndex';

const PROMPT_COOLDOWN_MS = 120_000;
const BROWSE_ENSURE_COOLDOWN_MS = 45_000;
const lastPromptAt = new Map<string, number>();
/** Letzte Stadt, für die ein Pack-Prompt sinnvoll war (Stadtwechsel-Gate). */
let lastEnteredCityId: string | null = null;
const lastBrowseEnsureAt = new Map<string, number>();
let lastBrowseEnsureCity: string | null = null;

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

/**
 * Swipe in Nachbarstadt → Pack still als Zubringer (Slots 2–3).
 * Kein Popup, kein Profil-/SQLite-Wechsel.
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

  const known = listKnownCityCoverageBounds();
  const at = smallestCityIdContainingPoint(
    input.viewportLat,
    input.viewportLng,
    known,
  );
  if (!at) return null;
  const cityId = at.toLowerCase();

  const profile = (input.profileCityId || '').trim().toLowerCase();
  const sticky = (input.stickyCityId || '').trim().toLowerCase();
  // Sticky/Profil = Slot 1 — nicht als Browse nachladen / nicht wechseln.
  if (cityId === profile || cityId === sticky) return null;

  try {
    const { isSoftCityId } = await import('../softWorkingCity');
    if (isSoftCityId(cityId)) return null;
  } catch {
    /* soft */
  }

  if (isCityPackDownloaded(cityId, input.localPackIds)) {
    return { cityId, ready: true };
  }

  // Browse-Budget: schon genug andere Packs lokal → kein Auto-Download-Sturm.
  const stickyOrProfile = new Set(
    [sticky, profile].filter(Boolean) as string[],
  );
  const browseLocal = input.localPackIds
    .map((x) => x.trim().toLowerCase())
    .filter((id) => id && !stickyOrProfile.has(id));
  if (browseLocal.length >= MAP_BROWSE_PACK_SLOTS) {
    // Ausnahme: Viewport-Stadt ist noch nicht dabei — ältesten Slot ersetzen
    // erst beim Paint; Download trotzdem erlauben wenn unter Soft-Cap 4.
    if (browseLocal.length >= MAP_BROWSE_PACK_SLOTS + 2) return null;
  }

  const now = Date.now();
  const prevAt = lastBrowseEnsureAt.get(cityId) ?? 0;
  if (now - prevAt < BROWSE_ENSURE_COOLDOWN_MS) return null;
  if (lastBrowseEnsureCity === cityId && now - prevAt < BROWSE_ENSURE_COOLDOWN_MS) {
    return null;
  }
  lastBrowseEnsureAt.set(cityId, now);
  lastBrowseEnsureCity = cityId;

  try {
    const catalog = await loadCityCatalog(null);
    const hit = catalogHit(cityId, catalog);
    // Kein Katalog-Eintrag → still (kein Soft-Pack erfinden).
    if (!hit) return null;

    const { ensureBrowseCityPackOnDevice } = await import(
      '../cityCatalogService'
    );
    const ok = await ensureBrowseCityPackOnDevice(cityId);
    return { cityId, ready: ok };
  } catch {
    return null;
  }
}

/** Tests / Stadtwechsel-Reset. */
export function __resetMapPackPromptStateForTests(): void {
  lastPromptAt.clear();
  lastEnteredCityId = null;
  lastBrowseEnsureAt.clear();
  lastBrowseEnsureCity = null;
}
