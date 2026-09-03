/**
 * Yorro-Karteninhalt (Orte, Icons, Nav-POIs) nur mit lokalem Stadt-Pack.
 * Basiskarte (Vector-Tiles) ist weltweit ohne Pack verfügbar.
 */

import { isVectorBasemapEnabled } from './mapTileConfig';

export function isCityPackDownloaded(
  cityId: string | null | undefined,
  localPackIds: readonly string[],
): boolean {
  const id = (cityId || '').trim().toLowerCase();
  if (!id) return false;
  return localPackIds.some((x) => x.toLowerCase() === id);
}

export type PackCoverageBox = {
  cityId: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

export type MapViewBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type YorroMapContentGateInput = {
  /** Modul-1 / Profil-Stadt */
  cityId: string | null | undefined;
  localPackIds: readonly string[];
  viewportLat?: number | null;
  viewportLng?: number | null;
  locateCity?: (lat: number, lng: number) => string | null;
  /** Viewport-Rechteck — Pack gilt wenn Coverage überlappt (Multi-Stadt). */
  view?: MapViewBox | null;
  coverageBounds?: readonly PackCoverageBox[] | null;
};

function coverageOverlapsView(
  b: PackCoverageBox,
  view: MapViewBox,
): boolean {
  return (
    b.latMin <= view.north &&
    b.latMax >= view.south &&
    b.lngMin <= view.east &&
    b.lngMax >= view.west
  );
}

/** Viewport-Stadt (falls locateCity) sonst Profil-Stadt — lowercase slug oder ''. */
export function resolveActivePackCityId(
  input: YorroMapContentGateInput,
): string {
  const { cityId, viewportLat, viewportLng, locateCity } = input;
  let active = (cityId || '').trim().toLowerCase();
  if (
    locateCity &&
    typeof viewportLat === 'number' &&
    typeof viewportLng === 'number' &&
    Number.isFinite(viewportLat) &&
    Number.isFinite(viewportLng)
  ) {
    const at = locateCity(viewportLat, viewportLng);
    if (at) active = at.toLowerCase();
  }
  return active;
}

/**
 * Legacy Extract-Modus: immer erlaubt (Pack steckte im Extract).
 * Vector-Modus: erlaubt wenn ein heruntergeladenes Pack den Viewport trifft
 * oder Profil-/Viewport-Stadt ein Pack hat.
 *
 * Wichtig: nie „leer“ bleiben nur weil Coverage noch nicht hydriert ist —
 * Profil-Pack reicht als Fallback (Boot-Race).
 */
export function isYorroMapContentAllowed(input: YorroMapContentGateInput): boolean {
  if (!isVectorBasemapEnabled()) return true;
  if (!input.localPackIds.length) return false;

  const packs = new Set(
    input.localPackIds.map((x) => x.trim().toLowerCase()).filter(Boolean),
  );
  if (!packs.size) return false;

  const profile = (input.cityId || '').trim().toLowerCase();
  const view = input.view;
  const bounds = input.coverageBounds;

  if (view && bounds && bounds.length > 0) {
    for (const b of bounds) {
      const id = (b.cityId || '').trim().toLowerCase();
      if (!id || !packs.has(id)) continue;
      if (coverageOverlapsView(b, view)) return true;
    }
  }

  const active = resolveActivePackCityId(input);
  if (active && packs.has(active)) return true;

  // Boot / Coverage noch leer: Profil-Pack nicht wegwischen.
  if (profile && packs.has(profile)) {
    if (
      !input.locateCity ||
      typeof input.viewportLat !== 'number' ||
      typeof input.viewportLng !== 'number'
    ) {
      return true;
    }
    const at = input.locateCity(input.viewportLat, input.viewportLng);
    // Unbekanntes Gebiet → Profil-Pack behalten statt Orte zu löschen.
    if (!at) return true;
    if (packs.has(at.toLowerCase())) return true;
    // Andere Stadt ohne Pack: nur erlauben wenn Profil-Coverage den View trifft
    // (oben schon geprüft) — sonst false (Download-Prompt).
  }

  return false;
}
