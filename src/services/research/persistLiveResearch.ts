/**
 * Live-Recherche (Places/OSM/Reviews) → lokales Overlay + Pack-Inbox.
 * Pack first; Lücke → Research; belegte Stadt-Treffer zurück ins Pack.
 * CI merget in den Stadt-Datensatz (neue Version) und lädt hoch.
 */

import { inferGastroFacetTags } from '../../module2/pitch/gastroFacetTags';
import { isParkingOrForestLotVenue } from '../../module2/pitch/nonFoodVenueGate';
import type { PitchCandidate, PitchRequest } from '../../module2/pitch/types';

const RECENT_TTL_MS = 12 * 60 * 60 * 1000;
const recentKeys = new Map<string, number>();

const META = new Set([
  'food',
  'bar',
  'hotel',
  'pack',
  'places',
  'osm',
  'learned',
  'directory',
  'story',
  'tier4',
  'offline_lookup',
  'cafe',
  'restaurant',
  'bakery',
]);

export type LiveResearchVenue = {
  name: string;
  lat: number;
  lng: number;
  category: string;
  tags: string[];
  facts: Array<{
    text: string;
    sourceUrl?: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;
};

function pruneRecent() {
  const now = Date.now();
  for (const [k, at] of recentKeys) {
    if (now - at > RECENT_TTL_MS) recentKeys.delete(k);
  }
}

function cityIdOf(req?: { cityHint?: string | null }): string | null {
  let profile: { cityId?: string | null } | null = null;
  try {
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    profile = getCachedUserProfile();
  } catch {
    profile = null;
  }
  const raw = String(profile?.cityId || '')
    .replace(/^soft_/, '')
    .trim()
    .toLowerCase();
  if (raw.length >= 2) return raw;
  const hint = String(req?.cityHint || '')
    .trim()
    .toLowerCase();
  if (hint.length >= 2 && !/\bhier\b/.test(hint)) {
    return hint.replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '');
  }
  return null;
}

function categoryFor(
  kind: PitchRequest['kind'] | undefined,
  name: string,
  extra: string,
): string {
  const blob = `${name} ${extra}`.toLowerCase();
  if (kind === 'cinema' || /\bkino\b|cinema/.test(blob)) return 'cinema';
  if (kind === 'sight' || kind === 'tour') {
    if (/museum|kirche|denkmal|park|strand|zoo|aquarium/.test(blob)) {
      return 'sight';
    }
  }
  if (/cafe|café|bäck|baeck|bakery|coffee/.test(blob)) return 'cafe';
  if (kind === 'bar' || /\bbar\b|pub|biergarten/.test(blob)) return 'bar';
  if (kind === 'hotel') return 'hotel';
  return 'restaurant';
}

export function buildLiveResearchVenue(
  c: Pick<
    PitchCandidate,
    | 'name'
    | 'lat'
    | 'lng'
    | 'softTags'
    | 'hookNotes'
    | 'hardEvidence'
    | 'websiteUrl'
  >,
  kind?: PitchRequest['kind'],
): LiveResearchVenue | null {
  const name = String(c.name || '').trim();
  if (name.length < 2) return null;
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
  if (isParkingOrForestLotVenue(name, (c.softTags ?? []).join(' '))) return null;
  const extra = [
    ...(c.softTags ?? []),
    ...(c.hookNotes ?? []),
    ...(c.hardEvidence ?? []),
  ].join(' ');
  const facets = inferGastroFacetTags(name, extra).filter((t) => !META.has(t));
  const tags = [
    ...new Set(['review_facet', 'from_live_research', ...facets]),
  ];
  const category = categoryFor(kind, name, extra);
  const facts: LiveResearchVenue['facts'] = [];
  if (facets.length) {
    facts.push({
      text: `Gäste/OSM erwähnen regelmäßig: ${facets.join(', ')}. (Facetten, keine Preise.)`,
      confidence: 'high',
    });
  } else {
    facts.push({
      text: `${name} — Live-Recherche, Directory-Katalog (Öffnung/Preise nur LIVE prüfen).`,
      confidence: 'medium',
    });
  }
  const site = String(c.websiteUrl || '').trim();
  if (site.startsWith('http')) {
    facts.push({
      text: `Website für Speisekarte/Öffnung live prüfen.`,
      sourceUrl: site,
      confidence: 'medium',
    });
  }
  return { name, lat: c.lat, lng: c.lng, category, tags, facts };
}

/**
 * Shortlist aus Places/OSM → Pack schreiben (nicht Pack-Hits erneut).
 * Alle Pitch-Kinds außer Hotel; Weltwissen-Guard bleibt aktiv.
 */
export async function persistLivePitchResearch(
  req: PitchRequest,
  venues: PitchCandidate[],
): Promise<number> {
  if (req.kind === 'hotel') return 0;
  const cityId = cityIdOf(req);
  if (!cityId) return 0;
  pruneRecent();

  const userText = `${req.title} ${req.context}`.trim();
  const live = venues.filter((v) => v.source === 'places' || v.source === 'osm');
  if (!live.length) return 0;

  let policyFn: ((o: {
    userText: string;
    packHit: boolean;
    researchedHit: boolean;
    placeName?: string | null;
  }) => string) | null = null;
  try {
    const mod = require('../../module2/reboot/pipeline/packFirstLearn') as {
      packLearnPolicy: NonNullable<typeof policyFn>;
    };
    policyFn = mod.packLearnPolicy;
  } catch {
    policyFn = null;
  }

  const drafts = live
    .slice(0, 5)
    .map((v) => {
      if (policyFn) {
        const policy = policyFn({
          userText,
          packHit: false,
          researchedHit: true,
          placeName: v.name,
        });
        if (policy !== 'write_pack') return null;
      }
      return buildLiveResearchVenue(v, req.kind);
    })
    .filter((d): d is LiveResearchVenue => Boolean(d));
  if (!drafts.length) return 0;

  let n = 0;
  try {
    const { persistDiscoveredPoiIntoDataset } = await import(
      './persistDiscoveredPoi'
    );
    for (const d of drafts) {
      const key = `${cityId}|${d.name.toLowerCase()}|${d.lat.toFixed(4)}|${d.lng.toFixed(4)}|${d.tags
        .slice()
        .sort()
        .join(',')}`;
      const prev = recentKeys.get(key);
      if (prev && Date.now() - prev < RECENT_TTL_MS) continue;
      recentKeys.set(key, Date.now());
      await persistDiscoveredPoiIntoDataset(
        {
          name: d.name,
          lat: d.lat,
          lng: d.lng,
          category: d.category,
          cityId,
          facts: d.facts,
          promptBlock: '',
        },
        { skipWiki: true, tags: d.tags, userText },
      );
      n += 1;
    }
  } catch (err) {
    if (__DEV__) console.warn('[liveResearch] persist failed', err);
  }
  return n;
}
