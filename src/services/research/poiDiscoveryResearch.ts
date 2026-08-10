/**
 * POI-Miss Research — Ort nicht im Pack → recherchieren, lokal ablegen, Nightly-Queue.
 */

import * as FileSystem from 'expo-file-system';
import { getAllPois, haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { reverseGeocodeStreet } from '../navigation/googleMapsNav';
import { runWebResearch } from './webResearchService';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { allSpokenTriggerIds } from '../../runtime/triggerEngine';

const DRAFT_PATH = `${FileSystem.documentDirectory}findus-poi-drafts.json`;

export type PoiDraftFact = {
  text: string;
  sourceUrl?: string | null;
  confidence: 'high' | 'medium' | 'low';
};

export type PoiDraft = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  facts: PoiDraftFact[];
  researchedAtMs: number;
  cityId: string | null;
  synced: boolean;
  promptBlock: string;
};

type DraftFile = { drafts: PoiDraft[] };

async function readDrafts(): Promise<PoiDraft[]> {
  try {
    const info = await FileSystem.getInfoAsync(DRAFT_PATH);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(DRAFT_PATH);
    const data = JSON.parse(raw) as DraftFile;
    return Array.isArray(data.drafts) ? data.drafts : [];
  } catch {
    return [];
  }
}

async function writeDrafts(drafts: PoiDraft[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      DRAFT_PATH,
      JSON.stringify({ drafts: drafts.slice(-40) }),
    );
  } catch {
    /* soft */
  }
}

export async function getUnsyncedPoiDrafts(): Promise<PoiDraft[]> {
  const all = await readDrafts();
  return all.filter((d) => !d.synced);
}

export async function markPoiDraftsSynced(ids: string[]): Promise<void> {
  const set = new Set(ids);
  const all = await readDrafts();
  await writeDrafts(
    all.map((d) => (set.has(d.id) ? { ...d, synced: true } : d)),
  );
}

export function isWhereAmIQuery(text: string): boolean {
  return /\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+(?:das|hier)|hier\s+(?:für\s+ein\s+ort|für\s+einen\s+ort)|was\s+ist\s+das\s+hier)\b/iu.test(
    text.replace(/\s+/g, ' ').trim(),
  );
}

/**
 * Find nearby pack POI within radius; null = miss.
 */
export async function findNearbyPackPoi(
  lat: number,
  lng: number,
  withinM = 120,
): Promise<{ id: number; name: string; distanceM: number } | null> {
  try {
    const pois = await getAllPois();
    let best: { id: number; name: string; distanceM: number } | null = null;
    for (const p of pois) {
      if (p.kind === 'approach') continue;
      const d = haversineMeters(lat, lng, p.lat, p.lng);
      if (d > withinM) continue;
      if (!best || d < best.distanceM) {
        best = { id: p.id, name: p.name, distanceM: Math.round(d) };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Nearby unvisited anchors for „was als Nächstes?“
 */
export async function suggestNearbyUnvisited(
  lat: number,
  lng: number,
  limit = 3,
): Promise<Array<{ name: string; distanceM: number; poiId: number }>> {
  const spoken = allSpokenTriggerIds();
  const visited = new Set(
    useFinnusStore.getState().visitedHistory.map((v) => v.poiId),
  );
  try {
    const pois = await getAllPois();
    const rows: Array<{ name: string; distanceM: number; poiId: number }> = [];
    for (const p of pois) {
      const kind = p.kind ?? 'legacy';
      if (kind !== 'area' && kind !== 'legacy' && kind !== 'approach') continue;
      if (spoken.has(p.id) || visited.has(p.id)) continue;
      const d = haversineMeters(lat, lng, p.lat, p.lng);
      if (d > 2500) continue;
      rows.push({
        name: p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
        distanceM: Math.round(d),
        poiId: p.id,
      });
    }
    return rows.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Research a place that is not (or poorly) covered in the pack.
 */
export async function researchAndDraftPoi(opts: {
  lat: number;
  lng: number;
  userText: string;
  hintName?: string | null;
}): Promise<PoiDraft | null> {
  const profile = getCachedUserProfile();
  const cityId = profile?.cityId ?? null;
  let name =
    opts.hintName?.trim() ||
    useFinnusStore.getState().currentLocationName?.trim() ||
    '';

  if (!name) {
    try {
      const street = await reverseGeocodeStreet(opts.lat, opts.lng);
      if (street) name = street;
    } catch {
      /* soft */
    }
  }
  if (!name) name = 'Unbekannter Ort';

  const researchQuery = `${name} ${profile?.cityName ?? ''} Geschichte besondere Personen Website Sehenswürdigkeit — Fakten recherchieren`;
  let facts: PoiDraftFact[] = [];
  let researchBlock = '';

  try {
    const web = await runWebResearch(researchQuery);
    if (web?.facts?.length) {
      facts = web.facts.slice(0, 8).map((f) => ({
        text: `${f.label}: ${f.value}`.slice(0, 280),
        sourceUrl: f.sourceUrl ?? null,
        confidence: f.confidence,
      }));
      researchBlock = web.promptBlock;
    }
  } catch {
    /* soft */
  }

  if (!facts.length && hasGeminiApiKey()) {
    try {
      const raw = await generateGeminiText(
        [
          'Du recherchierst einen Ort für einen Reise-Guide.',
          'Nenne NUR allgemein bekannte, prüfbare Fakten. Keine erfundenen Grabnamen oder Daten.',
          'Wenn unsicher: sag es ehrlich.',
          `Ort: ${name}`,
          `Koordinaten: ${opts.lat.toFixed(5)}, ${opts.lng.toFixed(5)}`,
          `Stadt: ${profile?.cityName ?? 'unbekannt'}`,
          'Antworte JSON: { "facts": ["...", "..."], "category": "cemetery|landmark|park|other" }',
        ].join('\n'),
        { task: 'generic', maxTokens: 500, temperature: 0.2, useFindusSystem: false },
      );
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const data = JSON.parse(m[0]) as {
          facts?: string[];
          category?: string;
        };
        facts = (data.facts ?? []).slice(0, 6).map((t) => ({
          text: String(t).slice(0, 280),
          confidence: 'medium' as const,
        }));
      }
    } catch {
      /* soft */
    }
  }

  const nearby = await suggestNearbyUnvisited(opts.lat, opts.lng, 3);
  const nextBlock = nearby.length
    ? `Als Nächstes in der Nähe: ${nearby.map((n) => `${n.name} (${n.distanceM} m)`).join(' · ')}`
    : 'Keine unbesuchten Anker in der Nähe.';

  const draft: PoiDraft = {
    id: `draft-${Date.now()}-${Math.round(opts.lat * 1e5)}`,
    name,
    lat: opts.lat,
    lng: opts.lng,
    category: /friedhof|cemetery|kirchhof/i.test(name)
      ? 'cemetery'
      : 'landmark',
    facts,
    researchedAtMs: Date.now(),
    cityId,
    synced: false,
    promptBlock: [
      '=== POI-RESEARCH (nicht im Pack / ergänzt) ===',
      `Ort: ${name}`,
      `Koordinaten: ${opts.lat.toFixed(5)}, ${opts.lng.toFixed(5)}`,
      facts.length
        ? `Fakten:\n${facts.map((f) => `· ${f.text}`).join('\n')}`
        : 'Keine verifizierten Fakten — ehrlich sagen, was unklar ist.',
      nextBlock,
      researchBlock ? `\n${researchBlock}` : '',
      'REGEL: Keine Halluzinationen. Quellen nur wenn vorhanden. Weitergehen-Vorschlag anbieten.',
    ]
      .filter(Boolean)
      .join('\n'),
  };

  const existing = await readDrafts();
  existing.push(draft);
  await writeDrafts(existing);

  try {
    const { contributeDiscoveredPlace } = await import(
      '../memory/collectiveLearning'
    );
    void contributeDiscoveredPlace({
      name,
      placeType: draft.category === 'cemetery' ? 'landmark' : draft.category || 'landmark',
      cityHint: profile?.cityName ?? null,
      lat: opts.lat,
      lng: opts.lng,
      factText: facts[0]?.text ?? null,
      sourceUrl: facts[0]?.sourceUrl ?? undefined,
      sourceTrust: facts.length ? 0.52 : 0.35,
    });
  } catch {
    /* soft */
  }

  return draft;
}
