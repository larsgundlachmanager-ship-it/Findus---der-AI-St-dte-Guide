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
  /** perfect | near_miss | rejected — Pack-Learn inkl. Verworfene */
  constraintFit?: 'perfect' | 'near_miss' | 'rejected';
  rejectedReason?: string | null;
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
  if (/basketball/.test(blob)) return 'basketball';
  if (/tischtennis|ping[\s-]?pong/.test(blob)) return 'tischtennis';
  if (/trinkwasser|trinkbrunnen|drinking.?water/.test(blob)) return 'trinkwasser';
  if (/grillplatz|grillstelle|bbq|barbecue/.test(blob)) return 'grillplatz';
  if (/picknick|picnic/.test(blob)) return 'picknick';
  if (/\b(sup\b|stand[\s-]?up|paddle|verleih)/.test(blob)) return 'verleih';
  if (/cafe|café|bäck|baeck|bakery|coffee/.test(blob)) return 'cafe';
  if (kind === 'bar' || /\bbar\b|pub|biergarten/.test(blob)) return 'bar';
  if (kind === 'hotel') return 'hotel';
  if (kind === 'generic') return 'ort';
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
  meta?: {
    constraintFit?: LiveResearchVenue['constraintFit'];
    rejectedReason?: string | null;
  },
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
  const fit =
    meta?.constraintFit ??
    ((c.softTags ?? []).some((t) => /near_miss/i.test(t))
      ? 'near_miss'
      : 'perfect');
  const rejectedReason =
    meta?.rejectedReason ??
    (c.hardEvidence ?? [])
      .map((e) => e.replace(/^rejected:/i, '').trim())
      .find((e) => e.length > 2 && /weekday|cuisine|ayce|asia|dienstag|tuesday/i.test(e)) ??
    null;
  const scheduleTag = (c.softTags ?? []).find((t) =>
    /^ayce_schedule:/i.test(t),
  );
  const priceTag = (c.softTags ?? []).find((t) => /^ayce_price:/i.test(t));
  const tags = [
    ...new Set([
      'review_facet',
      'from_live_research',
      ...(fit === 'near_miss' ? ['near_miss', 'constraint_near_miss'] : []),
      ...(fit === 'rejected' ? ['constraint_rejected'] : []),
      ...facets,
    ]),
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
  if (scheduleTag) {
    facts.push({
      text: `AYCE-Zeitfenster (Recherche): ${scheduleTag.replace(/^ayce_schedule:/i, '')}`,
      confidence: 'medium',
    });
  }
  if (priceTag) {
    facts.push({
      text: `AYCE-Preis-Hinweis (Recherche): ${priceTag.replace(/^ayce_price:/i, '')}`,
      confidence: 'medium',
    });
  }
  if (fit === 'near_miss' || fit === 'rejected') {
    facts.push({
      text: `Constraint-Fit: ${fit}${rejectedReason ? ` — ${rejectedReason}` : ''}. Für passende Tage/Avoids speichern, nicht soft-füllen.`,
      confidence: 'high',
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
  return {
    name,
    lat: c.lat,
    lng: c.lng,
    category,
    tags,
    facts,
    constraintFit: fit,
    rejectedReason,
  };
}

/**
 * Alle Pitch-Kinds inkl. Hotel (Stay22); Weltwissen-Guard bleibt aktiv.
 * Near-Misses / ernsthafte Treffer → lokales Overlay + Spot-Inbox.
 */
export function isPersistableLiveSource(
  source: PitchCandidate['source'] | undefined,
  kind: PitchRequest['kind'],
): boolean {
  if (source === 'places' || source === 'osm') return true;
  if (kind === 'hotel' && source === 'stay22') return true;
  return false;
}

/** Pure Plan-Stufe (Smoke ohne Persist/RN). */
export function planLivePitchPersistDrafts(
  req: PitchRequest,
  venues: PitchCandidate[],
  opts?: { includeNearMisses?: PitchCandidate[] },
): LiveResearchVenue[] {
  const live = [
    ...venues.filter((v) => isPersistableLiveSource(v.source, req.kind)),
    ...(opts?.includeNearMisses ?? []).filter((v) =>
      isPersistableLiveSource(v.source, req.kind),
    ),
  ];
  const seenNames = new Set<string>();
  const unique = live.filter((v) => {
    const k = v.name.toLowerCase();
    if (seenNames.has(k)) return false;
    seenNames.add(k);
    return true;
  });
  if (!unique.length) return [];

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

  const userText = `${req.title} ${req.context}`.trim();
  return unique
    .slice(0, 8)
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
}

export async function persistLivePitchResearch(
  req: PitchRequest,
  venues: PitchCandidate[],
  opts?: {
    /** Auch Near-Misses / Verworfene aus Harvest mitschreiben */
    includeNearMisses?: PitchCandidate[];
  },
): Promise<number> {
  const cityId = cityIdOf(req);
  if (!cityId) return 0;
  pruneRecent();

  const drafts = planLivePitchPersistDrafts(req, venues, opts);
  if (!drafts.length) return 0;

  const userText = `${req.title} ${req.context}`.trim();
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

/** Activity/SUP-Verleiher → Spot-Inbox (auch nicht gewählte). */
export async function persistActivitySportHits(opts: {
  userText: string;
  cityHint?: string | null;
  venues: Array<{
    name: string;
    lat: number;
    lng: number;
    websiteUri?: string | null;
    priceLabel?: string | null;
  }>;
}): Promise<number> {
  const cityId = cityIdOf({ cityHint: opts.cityHint });
  if (!cityId) return 0;
  pruneRecent();
  const venues = (opts.venues ?? [])
    .filter(
      (v) =>
        String(v.name || '').trim().length >= 2 &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lng),
    )
    .slice(0, 4);
  if (!venues.length) return 0;

  let n = 0;
  try {
    const { persistDiscoveredPoiIntoDataset } = await import(
      './persistDiscoveredPoi'
    );
    for (const v of venues) {
      const key = `${cityId}|${v.name.toLowerCase()}|${v.lat.toFixed(4)}|${v.lng.toFixed(4)}|verleih`;
      const prev = recentKeys.get(key);
      if (prev && Date.now() - prev < RECENT_TTL_MS) continue;
      recentKeys.set(key, Date.now());
      const facts: LiveResearchVenue['facts'] = [
        {
          text: `${v.name} — Verleih/Aktivität aus Live-Recherche.`,
          sourceUrl: v.websiteUri ?? null,
          confidence: 'medium',
        },
      ];
      if (v.priceLabel) {
        facts.push({
          text: `Preis-Hinweis (belegt): ${v.priceLabel}`,
          sourceUrl: v.websiteUri ?? null,
          confidence: 'high',
        });
      }
      await persistDiscoveredPoiIntoDataset(
        {
          name: v.name,
          lat: v.lat,
          lng: v.lng,
          category: 'verleih',
          cityId,
          facts,
          promptBlock: '',
        },
        {
          skipWiki: true,
          tags: ['from_live_research', 'activity', 'verleih'],
          userText: opts.userText,
        },
      );
      n += 1;
    }
  } catch (err) {
    if (__DEV__) console.warn('[liveResearch] activity persist failed', err);
  }
  return n;
}
