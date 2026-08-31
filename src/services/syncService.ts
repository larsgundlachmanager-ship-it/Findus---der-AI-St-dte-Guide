import {
  getSupabase,
  isSupabaseConfigured,
  type RemoteFact,
  type RemotePoi,
} from './supabase';
import { mapCityPackToRemote, type CityPack } from './cityPack';
import { loadCityPackCachedOrRemote } from './cityCatalogService';
import { replacePoisAndFacts, getAllPois } from '../db/database';
import { useFinnusStore } from '../store/useFinnusStore';
import { env } from '../config/env';
import { getCachedUserProfile } from './userProfileService';
import { parseAndCacheCityPronunciations } from './tts/cityPronunciationParser';
import { scanCityDatasetSafe } from './scanner/cityScanner';
import { scanPoiDatasetSafe } from './ai/poiDatasetScanner';
import { syncDictionaryAfterCityDownload } from './sync/dictionarySyncService';
import { isDeviceOffline } from './navigation/networkState';

/** Verhindert parallele Syncs → SQLite „transaction within a transaction“. */
let syncInFlight: Promise<{
  synced: boolean;
  poiCount: number;
  reason?: string;
}> | null = null;

/**
 * Offline-First: lädt Stadt-Pack aus Storage-Bucket `staedte`
 * (z. B. prisdorf.json) und schreibt POIs + Fakten in SQLite.
 * Fallback: Tabellen public.pois / public.facts.
 * Geofencing liest ausschließlich aus der lokalen DB.
 */
export async function syncPOIsFromSupabase(
  cityIdOverride?: string,
): Promise<{
  synced: boolean;
  poiCount: number;
  reason?: string;
}> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    try {
      return await runPoiSync(cityIdOverride);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

async function runPoiSync(cityIdOverride?: string): Promise<{
  synced: boolean;
  poiCount: number;
  reason?: string;
}> {
  console.log(
    '[Yorro Sync] URL vorhanden:',
    !!process.env.EXPO_PUBLIC_SUPABASE_URL,
  );
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL && env.supabaseUrl()) {
    console.log('[Yorro Sync] URL via Constants.extra vorhanden');
  }

  if (!isSupabaseConfigured()) {
    return { synced: false, poiCount: 0, reason: 'Supabase nicht konfiguriert' };
  }

  if (await isDeviceOffline()) {
    return { synced: false, poiCount: 0, reason: 'Offline' };
  }

  const profileCity = getCachedUserProfile()?.cityId;
  const cityId =
    cityIdOverride || profileCity || env.cityId() || 'prisdorf';
  let remotePois: RemotePoi[] = [];
  let remoteFacts: RemoteFact[] = [];
  let source = 'storage';
  let packForPronunciation: CityPack | null = null;

  try {
    const pack = await loadCityPackCachedOrRemote(cityId);
    packForPronunciation = pack;
    const mapped = mapCityPackToRemote(pack);
    remotePois = mapped.pois;
    remoteFacts = mapped.facts;
  } catch (storageErr) {
    console.warn(
      `[sync] Storage-Pack "${cityId}" fehlgeschlagen, Fallback Tabellen:`,
      storageErr,
    );
    source = 'tables';
    const fromTables = await fetchFromTables();
    remotePois = fromTables.pois;
    remoteFacts = fromTables.facts;
  }

  if (remotePois.length === 0) {
    return { synced: true, poiCount: 0, reason: 'Keine Remote-POIs' };
  }

  await replacePoisAndFacts(remotePois, remoteFacts);
  try {
    const { reapplyLearnedPoisForCity } = await import('../db/learnedPoiOverlay');
    await reapplyLearnedPoisForCity(cityId);
  } catch {
    /* soft */
  }

  if (packForPronunciation) {
    try {
      await parseAndCacheCityPronunciations(packForPronunciation);
    } catch (err) {
      console.warn('[sync] Aussprache-Parser:', err);
    }
    void (async () => {
      try {
        await scanCityDatasetSafe(packForPronunciation);
        await scanPoiDatasetSafe(packForPronunciation);
      } catch (err) {
        console.warn('[sync] Dictionary-Scanner:', err);
      }
    })();
    // Hintergrund: Cloud→Local Safe Merge + Scan-Delta Upload
    void syncDictionaryAfterCityDownload().catch((err) => {
      console.warn('[sync] Dictionary Cloud-Merge:', err);
    });
  }

  const localPois = await getAllPois();
  useFinnusStore.getState().setPois(localPois);
  void import('./homeMap/mapPinIndex')
    .then((m) => m.writeMapPinIndex(cityId, localPois))
    .catch(() => undefined);

  console.log(
    `[sync] ${remotePois.length} POIs, ${remoteFacts.length} Fakten → SQLite (${source}/${cityId})`,
  );

  return { synced: true, poiCount: remotePois.length };
}

async function fetchFromTables(): Promise<{
  pois: RemotePoi[];
  facts: RemoteFact[];
}> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Kein Client');
  }

  const { data: pois, error: poiError } = await supabase
    .from('pois')
    .select('id, name, lat, lng, radius_meters')
    .order('id', { ascending: true });

  if (poiError) {
    throw new Error(`Supabase POIs: ${poiError.message}`);
  }

  const { data: facts, error: factError } = await supabase
    .from('facts')
    .select('id, poi_id, fact_text')
    .order('id', { ascending: true });

  if (factError) {
    throw new Error(`Supabase Facts: ${factError.message}`);
  }

  return {
    pois: (pois ?? []) as RemotePoi[],
    facts: (facts ?? []) as RemoteFact[],
  };
}

/** Fire-and-forget Sync beim App-Start (blockiert UI nicht). */
export function syncPOIsInBackground(cityId?: string): void {
  void syncPOIsFromSupabase(cityId).catch((err) => {
    console.warn('[sync] Hintergrund-Sync fehlgeschlagen:', err);
  });
}
