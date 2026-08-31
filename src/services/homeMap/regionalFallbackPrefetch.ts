/**
 * Prefetch DE/EU regional map tiles after pack download or first online start.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../../config/env';
import {
  ensureRegionalFallback,
  loadRegionalTileIndex,
  tileIntersectsRadius,
  tierForLatLng,
  type RegionalTier,
} from './regionalFallbackLoader';

const DOC = FileSystem.documentDirectory;
const MAPS_DIR = DOC ? `${DOC}maps/` : null;
const TILE_RADIUS_M = 50_000;
const MAX_TILE_DOWNLOADS = 6;

function supabaseMapsUrl(tier: RegionalTier, file: string): string | null {
  const base = (env.supabaseUrl() || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/staedte/maps/${tier}/${encodeURIComponent(file)}`;
}

export async function syncRegionalFallbackIndex(
  tier: RegionalTier,
): Promise<boolean> {
  if (!MAPS_DIR || tier === 'none') return false;
  const destDir = `${MAPS_DIR}${tier}/`;
  const url = supabaseMapsUrl(tier, 'index.json');
  if (!url) return false;
  try {
    await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
    const tmp = `${MAPS_DIR}_tmp_${tier}_index.json`;
    const res = await FileSystem.downloadAsync(url, tmp);
    if (res.status < 200 || res.status >= 300) return false;
    await FileSystem.moveAsync({ from: tmp, to: `${destDir}index.json` });
    return true;
  } catch {
    return false;
  }
}

async function downloadRegionalTile(
  tier: RegionalTier,
  file: string,
): Promise<boolean> {
  if (!MAPS_DIR || tier === 'none') return false;
  const dest = `${MAPS_DIR}${tier}/${file}`;
  try {
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists) return true;
  } catch {
    /* continue */
  }
  const url = supabaseMapsUrl(tier, file);
  if (!url) return false;
  try {
    await FileSystem.makeDirectoryAsync(`${MAPS_DIR}${tier}/`, {
      intermediates: true,
    });
    const tmp = `${MAPS_DIR}_tmp_${tier}_${file}`;
    const res = await FileSystem.downloadAsync(url, tmp);
    if (res.status < 200 || res.status >= 300) return false;
    await FileSystem.moveAsync({ from: tmp, to: dest });
    return true;
  } catch {
    return false;
  }
}

export async function syncRegionalFallbackTilesForGps(
  lat: number,
  lng: number,
): Promise<number> {
  const tier = tierForLatLng(lat, lng);
  if (tier === 'none' || !MAPS_DIR) return 0;

  let index = await loadRegionalTileIndex(tier);
  if (!index?.tiles?.length) {
    await syncRegionalFallbackIndex(tier);
    index = await loadRegionalTileIndex(tier);
  }
  if (!index?.tiles?.length) return 0;

  const hits = index.tiles.filter((t) =>
    tileIntersectsRadius(t, lat, lng, TILE_RADIUS_M),
  );
  let downloaded = 0;
  for (const tile of hits.slice(0, MAX_TILE_DOWNLOADS)) {
    const ok = await downloadRegionalTile(tier, tile.file);
    if (ok) downloaded += 1;
  }
  return downloaded;
}

export async function prefetchRegionalFallbackAfterOnline(
  lat: number,
  lng: number,
): Promise<void> {
  await syncRegionalFallbackIndex('de');
  await syncRegionalFallbackIndex('eu');
  void syncRegionalFallbackTilesForGps(lat, lng).then(() =>
    ensureRegionalFallback(lat, lng),
  );
}
