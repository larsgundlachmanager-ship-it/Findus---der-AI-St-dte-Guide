/**
 * Live Discover / Gem-Hunt → Inspiration-Katalog wachsen lassen.
 * Soft: Overlay + Travel-Cache; optional Inbox-Queue für späteren Pack-Merge.
 * Katalog bleibt Assist — kein Ersatz für Grounding.
 */

import type { ReiseLedger } from '../types';
import {
  getInspirationHarvestOverlay,
  mergeInspirationHarvest,
  setInspirationHarvestOverlay,
  type InspirationSeed,
  type InspirationVibe,
} from './inspirationCatalog';
import { primaryVibesFromLedger } from './inspirationPoolBrief';
import type { ProDestCandidate } from './proEnrichParse';

const INBOX_KEY = 'reisebuero_inspiration_writeback_inbox_v1';
const MAX_INBOX = 80;
const VALID_MS = 120 * 24 * 3600_000;

function pickVibe(ledger: ReiseLedger, tags: string[]): InspirationVibe {
  const primary = primaryVibesFromLedger(ledger)[0];
  const t = new Set(tags.map((x) => x.toLowerCase()));
  if (t.has('deal') || t.has('bargain') || t.has('ultra_cheap')) return 'ultra_cheap';
  if (t.has('spa') || t.has('thermal') || t.has('wellness')) return 'spa_value';
  if (t.has('kids')) return 'kids';
  if (t.has('family')) return 'family';
  if (t.has('quiet') || t.has('anti_party') || t.has('geheim')) {
    return t.has('date') ? 'date' : 'anti_party';
  }
  if (t.has('party') || t.has('padel') || t.has('tennis')) return 'menstrip';
  if (t.has('hike') || t.has('scenic') || t.has('adventure')) return 'adventure';
  if (t.has('date') || t.has('romance')) return 'date';
  return primary || 'adventure';
}

export function destinationsToInspirationSeeds(
  ledger: ReiseLedger,
  destinations: ProDestCandidate[],
): InspirationSeed[] {
  const validUntilMs = Date.now() + VALID_MS;
  const out: InspirationSeed[] = [];
  for (const d of destinations) {
    const name = (d.name || '').trim();
    if (name.length < 2) continue;
    const tags = [...new Set([...(d.tags || []), 'live_research'].map((t) => t.toLowerCase()))].slice(
      0,
      8,
    );
    const vibe = pickVibe(ledger, tags);
    out.push({
      vibe,
      destLabel: name.slice(0, 80),
      region: (d.wiki || name).slice(0, 80),
      countryCode: 'EU',
      tags,
      seasonHint: undefined,
      validUntilMs,
      lat: d.lat,
      lng: d.lng,
      iata: d.iata,
      whyFit: (d.whyFit || '').slice(0, 160) || null,
      source: 'grounded',
    });
  }
  return out;
}

async function persistOverlayCache(): Promise<void> {
  try {
    const { putTravelCache, buildTravelCacheKey } = await import('./travelResearchCache');
    const key = buildTravelCacheKey({ musts: ['inspiration_catalog'] });
    await putTravelCache({
      key,
      kind: 'inspiration_harvest',
      payload: {
        items: getInspirationHarvestOverlay(),
        vibes: ['live_writeback'],
        generatedAtMs: Date.now(),
      },
      validUntilMs: Date.now() + 14 * 24 * 3600_000,
    });
  } catch {
    /* soft */
  }
}

async function enqueueInbox(seeds: InspirationSeed[]): Promise<void> {
  if (!seeds.length) return;
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    const prev: InspirationSeed[] = raw ? JSON.parse(raw) : [];
    const map = new Map<string, InspirationSeed>();
    for (const s of [...(Array.isArray(prev) ? prev : []), ...seeds]) {
      map.set(`${s.vibe}:${s.destLabel.toLowerCase()}`, s);
    }
    const next = [...map.values()].slice(-MAX_INBOX);
    await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(next));
  } catch {
    /* soft — Node/Web ohne AsyncStorage */
  }
}

export type WriteBackReport = {
  added: number;
  vibes: InspirationVibe[];
};

/**
 * Nach erfolgreichem Discover/Gem-Hunt: Katalog lokal erweitern.
 */
export async function writeBackInspirationFromDiscover(opts: {
  ledger: ReiseLedger;
  destinations: ProDestCandidate[];
  sourceLabel?: string;
}): Promise<WriteBackReport> {
  const seeds = destinationsToInspirationSeeds(opts.ledger, opts.destinations);
  if (!seeds.length) return { added: 0, vibes: [] };

  const beforeKeys = new Set(
    mergeInspirationHarvest([]).map((s) => `${s.vibe}:${s.destLabel.toLowerCase()}`),
  );
  // Nur Overlay erweitern — Pack/Hardcoded-SEEDS bleiben in mergeInspirationHarvest
  setInspirationHarvestOverlay([...getInspirationHarvestOverlay(), ...seeds]);
  await persistOverlayCache();
  await enqueueInbox(seeds);

  const added = seeds.filter(
    (s) => !beforeKeys.has(`${s.vibe}:${s.destLabel.toLowerCase()}`),
  ).length;

  return {
    added,
    vibes: [...new Set(seeds.map((s) => s.vibe))],
  };
}

/** Inbox für späteren Pack-Merge / Debug. */
export async function peekInspirationWriteBackInbox(): Promise<InspirationSeed[]> {
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InspirationSeed[]) : [];
  } catch {
    return [];
  }
}
