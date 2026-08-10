/**
 * Community-Stimmen-Ranking: häufigste Auswahl oben.
 * Lokal persistiert + optional Supabase `voice_selection_counts`.
 */

import * as FileSystem from 'expo-file-system';
import type { VoiceId } from '../../types/userProfile';
import { CARTESIA_VOICES } from '../../constants/cartesiaVoices';
import { getSupabase, isSupabaseConfigured } from '../supabase';

const LOCAL_PATH = `${FileSystem.documentDirectory}findus-voice-stats.json`;

/** Startgewichte, bis echte Community-Daten da sind (Alina/Sebastian vorne). */
const SEED: Record<string, number> = {
  alina: 120,
  sebastian: 110,
  klaus: 40,
  leander: 35,
  lukas: 32,
  daniel: 30,
  alexander: 28,
  marlene: 45,
  lea: 42,
  rena: 38,
  viktoria: 36,
  jaqcline: 34,
  katie: 33,
  verini: 31,
  skylar: 29,
  varson: 27,
};

type StatsMap = Record<string, number>;

let cache: StatsMap | null = null;
let remoteFetchedAt = 0;
const REMOTE_TTL_MS = 10 * 60_000;

async function loadLocal(): Promise<StatsMap> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(LOCAL_PATH);
    if (info.exists) {
      const raw = JSON.parse(await FileSystem.readAsStringAsync(LOCAL_PATH)) as {
        counts?: StatsMap;
      };
      cache = { ...SEED, ...(raw.counts ?? {}) };
      return cache;
    }
  } catch {
    /* ignore */
  }
  cache = { ...SEED };
  return cache;
}

async function saveLocal(counts: StatsMap): Promise<void> {
  cache = counts;
  try {
    await FileSystem.writeAsStringAsync(
      LOCAL_PATH,
      JSON.stringify({ counts, updatedAt: new Date().toISOString() }),
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch (err) {
    console.warn('[voiceStats] persist failed:', err);
  }
}

async function fetchRemoteCounts(): Promise<StatsMap | null> {
  if (!isSupabaseConfigured()) return null;
  if (Date.now() - remoteFetchedAt < REMOTE_TTL_MS && cache) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('voice_selection_counts')
      .select('voice_id, selection_count');
    if (error || !data) return null;
    const map: StatsMap = {};
    for (const row of data as Array<{
      voice_id?: string;
      selection_count?: number;
    }>) {
      if (!row.voice_id) continue;
      map[row.voice_id] = Number(row.selection_count) || 0;
    }
    remoteFetchedAt = Date.now();
    return map;
  } catch {
    return null;
  }
}

async function pushRemoteIncrement(voiceId: VoiceId): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb
      .from('voice_selection_counts')
      .select('selection_count')
      .eq('voice_id', voiceId)
      .maybeSingle();
    const prev = Number(
      (data as { selection_count?: number } | null)?.selection_count ?? 0,
    );
    await sb.from('voice_selection_counts').upsert({
      voice_id: voiceId,
      selection_count: prev + 1,
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* Tabelle fehlt / offline — lokal reicht */
  }
}

/** Merged counts (remote überschreibt Seed, lokal addiert). */
export async function getVoiceSelectionCounts(): Promise<StatsMap> {
  const local = await loadLocal();
  const remote = await fetchRemoteCounts();
  if (!remote) return local;
  const merged: StatsMap = { ...SEED };
  for (const id of Object.keys({ ...local, ...remote })) {
    merged[id] = Math.max(local[id] ?? 0, remote[id] ?? 0, SEED[id] ?? 0);
  }
  cache = merged;
  return merged;
}

export async function recordVoiceSelection(voiceId: VoiceId): Promise<void> {
  const local = await loadLocal();
  local[voiceId] = (local[voiceId] ?? SEED[voiceId] ?? 0) + 1;
  await saveLocal(local);
  void pushRemoteIncrement(voiceId);
}

/** Sortiert Voice-IDs: häufigste zuerst. */
export async function sortVoiceIdsByPopularity(
  ids: readonly VoiceId[],
): Promise<VoiceId[]> {
  const counts = await getVoiceSelectionCounts();
  return [...ids].sort((a, b) => {
    const ca = counts[a] ?? 0;
    const cb = counts[b] ?? 0;
    if (cb !== ca) return cb - ca;
    // Stable tie-break: Cartesia-Reihenfolge
    const ia = CARTESIA_VOICES.findIndex((v) => v.id === a);
    const ib = CARTESIA_VOICES.findIndex((v) => v.id === b);
    return ia - ib;
  });
}
