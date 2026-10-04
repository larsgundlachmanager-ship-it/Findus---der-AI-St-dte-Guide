/**
 * Vector-Basiskarte (Protomaps / Cloudflare R2) — SSOT für Tile-/Style-URLs.
 * Yorro-Orte/Nav/Route bleiben ShapeSources darüber (mapPackGate.ts).
 *
 * Default: AN, sobald eine Quelle da ist.
 * Explizit aus: EXPO_PUBLIC_MAP_VECTOR_TILES=0 → Legacy Extract.
 *
 * Protomaps-Key → fertiges Style-JSON (v5) als Basiskarte — wie Maps:
 * Straßen/Gebäude aus dem Style, Yorro-Layer oben drauf.
 */

import { env } from '../../config/env';

function isVectorExplicitlyDisabled(): boolean {
  const v = env.get('EXPO_PUBLIC_MAP_VECTOR_TILES').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

export function isVectorBasemapEnabled(): boolean {
  if (isVectorExplicitlyDisabled()) return false;
  return isMapVectorSourceConfigured();
}

export type MapVectorSourceSpec =
  | { kind: 'xyz'; tiles: string[]; maxzoom?: number; minzoom?: number }
  | { kind: 'tilejson'; url: string }
  | { kind: 'pmtiles'; url: string }
  | { kind: 'style'; url: string };

/**
 * Fertiges Protomaps Style-JSON (v5) — Theme/Lang aus Env.
 * EXPO_PUBLIC_PROTOMAPS_THEME = light|dark|white|black|grayscale (Default: dark)
 * EXPO_PUBLIC_PROTOMAPS_LANG = en|de|… (Default: de)
 */
export function resolveProtomapsStyleUrl(): string | null {
  const key = env.get('EXPO_PUBLIC_PROTOMAPS_API_KEY').trim();
  if (!key) return null;
  const themeRaw = env.get('EXPO_PUBLIC_PROTOMAPS_THEME').trim().toLowerCase();
  const theme = ['light', 'dark', 'white', 'black', 'grayscale'].includes(themeRaw)
    ? themeRaw
    : 'dark';
  const lang = env.get('EXPO_PUBLIC_PROTOMAPS_LANG').trim() || 'de';
  return `https://api.protomaps.com/styles/v5/${theme}/${lang}.json?key=${encodeURIComponent(key)}`;
}

/**
 * Tile-Quelle (für Custom-Style / R2). Protomaps-Key → Style-URL bevorzugt.
 */
export function resolveMapVectorSource(): MapVectorSourceSpec | null {
  const xyz = env.get('EXPO_PUBLIC_MAP_TILES_URL').trim();
  if (xyz && xyz.includes('{z}') && xyz.includes('{x}') && xyz.includes('{y}')) {
    return { kind: 'xyz', tiles: [xyz], maxzoom: 15, minzoom: 0 };
  }

  const pmtiles = env.get('EXPO_PUBLIC_MAP_PMTILES_URL').trim();
  if (pmtiles) {
    const url = pmtiles.startsWith('pmtiles://') ? pmtiles : `pmtiles://${pmtiles}`;
    return { kind: 'pmtiles', url };
  }

  const styleUrl = resolveProtomapsStyleUrl();
  if (styleUrl) {
    return { kind: 'style', url: styleUrl };
  }

  return null;
}

export function isMapVectorSourceConfigured(): boolean {
  return resolveMapVectorSource() != null;
}
