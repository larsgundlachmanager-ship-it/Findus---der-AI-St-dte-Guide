/**
 * Europa Inspiration-Katalog — Seeds + bezahlter Batch-Harvest (Gemini+Search).
 *
 * - Statische Bootstrap-Seeds (offline)
 * - Pack aus `npm run reisebuero:inspiration-batch` (committed snapshot)
 * - Runtime-Cache (Travel-Cache) + On-Demand-Refresh im Funnel
 * Keine Fake-Buchungslinks; Dest-Hints mit optionalen Koordinaten.
 */

import type { SeedPlace } from './candidates';
import harvestPack from './inspirationHarvest.pack.json';

export type InspirationVibe =
  | 'family'
  | 'kids'
  | 'date'
  | 'adventure'
  | 'spa_value'
  | 'menstrip'
  | 'ultra_cheap'
  | 'anti_party';

export type InspirationSeed = {
  vibe: InspirationVibe;
  destLabel: string;
  region: string;
  countryCode: string;
  tags: string[];
  /** ISO date tip — Season-Hinweis, kein Preis */
  seasonHint?: string;
  validUntilMs: number;
  lat?: number | null;
  lng?: number | null;
  iata?: string | null;
  whyFit?: string | null;
  /** seed | pack | grounded | cache */
  source?: 'seed' | 'pack' | 'grounded' | 'cache';
};

export const ALL_INSPIRATION_VIBES: readonly InspirationVibe[] = [
  'family',
  'kids',
  'date',
  'adventure',
  'spa_value',
  'menstrip',
  'ultra_cheap',
  'anti_party',
] as const;

const VIBE_BRIEF: Record<InspirationVibe, string> = {
  family: 'Familien-Urlaub Europa: ruhig, kinderfreundlich, Strand/Pool/Villa — keine Partyhochburgen',
  kids: 'Mit Kindern: Themenpark-Nähe, sanfte Ziele, gute Anreise Bahn/Flug aus DE',
  date: 'Paar-Trip: romantisch, Stadt+Aussicht oder Küste, nicht Massenparty',
  adventure: 'Abenteuer: Wandern, Rad, Hütten, Alpen/Mittelgebirge, Öko/Bahn wo möglich',
  spa_value: 'Spa/Thermal gutes Preis-Leistung, Sauna/Thermalbäder Europa',
  menstrip: 'Männertrip: Sport (Tennis/Padel/Pool), Stadt+Bier, oder aktive Villa — nicht Magaluf-Klischee',
  ultra_cheap: 'Schnäppchen-Korridore Europa: Off-Season, Secondary-Airports, belegte Deal-Regionen',
  anti_party: 'Anti-Party: ruhige Küste/Insel-Nordseite, Stille — explizit weg von Magaluf/Ballermann',
};

/** Statische Europa-Startliste (Bootstrap). */
const SEEDS: InspirationSeed[] = [
  {
    vibe: 'family',
    destLabel: 'Rügen',
    region: 'Ostsee-DE',
    countryCode: 'DE',
    tags: ['sand', 'kids', 'sea'],
    seasonHint: 'Jun–Aug',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 54.4,
    lng: 13.4,
    source: 'seed',
  },
  {
    vibe: 'anti_party',
    destLabel: 'Mallorca Nordost',
    region: 'Balearen',
    countryCode: 'ES',
    tags: ['sand', 'quiet', 'avoid_magaluf'],
    seasonHint: 'Mai–Jun, Sep',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 39.75,
    lng: 3.4,
    iata: 'PMI',
    source: 'seed',
  },
  {
    vibe: 'ultra_cheap',
    destLabel: 'Mallorca',
    region: 'Balearen',
    countryCode: 'ES',
    tags: ['deal', 'short_stay'],
    seasonHint: 'Nov–Mar Off-Peak',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 39.57,
    lng: 2.65,
    iata: 'PMI',
    source: 'seed',
  },
  {
    vibe: 'spa_value',
    destLabel: 'Budapest',
    region: 'Ungarn',
    countryCode: 'HU',
    tags: ['spa', 'sauna', 'thermal'],
    seasonHint: 'ganzjährig',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 47.5,
    lng: 19.04,
    iata: 'BUD',
    source: 'seed',
  },
  {
    vibe: 'adventure',
    destLabel: 'Allgäu',
    region: 'Alpen-DE',
    countryCode: 'DE',
    tags: ['hike', 'eco', 'train'],
    seasonHint: 'Jun–Sep',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 47.5,
    lng: 10.3,
    source: 'seed',
  },
  {
    vibe: 'date',
    destLabel: 'Lissabon',
    region: 'Portugal',
    countryCode: 'PT',
    tags: ['date', 'city', 'view'],
    seasonHint: 'Apr–Jun, Sep–Oct',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 38.72,
    lng: -9.14,
    iata: 'LIS',
    source: 'seed',
  },
  {
    vibe: 'menstrip',
    destLabel: 'Prag',
    region: 'Tschechien',
    countryCode: 'CZ',
    tags: ['city', 'train', 'beer'],
    seasonHint: 'ganzjährig',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 50.08,
    lng: 14.44,
    iata: 'PRG',
    source: 'seed',
  },
  {
    vibe: 'kids',
    destLabel: 'Disneyland Paris Region',
    region: 'Île-de-France',
    countryCode: 'FR',
    tags: ['kids', 'train'],
    seasonHint: 'Schulferien beachten',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 48.87,
    lng: 2.78,
    iata: 'CDG',
    source: 'seed',
  },
  {
    vibe: 'adventure',
    destLabel: 'Oberstdorf / Allgäu',
    region: 'Alpen-DE',
    countryCode: 'DE',
    tags: ['hike', 'eco', 'train', 'hut'],
    seasonHint: 'Jun–Sep',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 47.41,
    lng: 10.28,
    source: 'seed',
  },
  {
    vibe: 'adventure',
    destLabel: 'Moselradweg',
    region: 'Mosel-DE',
    countryCode: 'DE',
    tags: ['bike', 'eco', 'train', 'wine'],
    seasonHint: 'Mai–Sep',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 49.9,
    lng: 7.0,
    source: 'seed',
  },
  {
    vibe: 'spa_value',
    destLabel: 'Baden-Baden',
    region: 'Schwarzwald',
    countryCode: 'DE',
    tags: ['spa', 'sauna', 'train'],
    seasonHint: 'ganzjährig',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 48.76,
    lng: 8.24,
    source: 'seed',
  },
  {
    vibe: 'family',
    destLabel: 'Kreta Familienvilla',
    region: 'Griechenland',
    countryCode: 'GR',
    tags: ['pool', 'kids', 'warm', 'villa'],
    seasonHint: 'Mai–Jun, Sep',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 35.24,
    lng: 24.81,
    iata: 'HER',
    source: 'seed',
  },
  {
    vibe: 'menstrip',
    destLabel: 'Alcúdia Tennis+Pool',
    region: 'Balearen',
    countryCode: 'ES',
    tags: ['tennis', 'pool', 'villa', 'warm'],
    seasonHint: 'Apr–Jun, Sep–Oct',
    validUntilMs: Date.parse('2027-06-01'),
    lat: 39.85,
    lng: 3.12,
    iata: 'PMI',
    source: 'seed',
  },
];

/** Runtime overlay (Batch / Cache / merge). */
let harvestOverlay: InspirationSeed[] = [];

function normalizeSeed(raw: unknown, source: InspirationSeed['source']): InspirationSeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const vibe = String(o.vibe || '').trim() as InspirationVibe;
  if (!ALL_INSPIRATION_VIBES.includes(vibe)) return null;
  const destLabel = String(o.destLabel || o.name || '').trim();
  if (destLabel.length < 2) return null;
  const validUntilMs =
    typeof o.validUntilMs === 'number' && Number.isFinite(o.validUntilMs)
      ? o.validUntilMs
      : Date.now() + 90 * 24 * 3600_000;
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => String(t).toLowerCase()).filter(Boolean).slice(0, 10)
    : [];
  return {
    vibe,
    destLabel,
    region: String(o.region || '').trim().slice(0, 80) || 'Europa',
    countryCode: String(o.countryCode || 'EU').trim().slice(0, 4).toUpperCase(),
    tags,
    seasonHint:
      typeof o.seasonHint === 'string' && o.seasonHint.trim()
        ? o.seasonHint.trim().slice(0, 60)
        : undefined,
    validUntilMs,
    lat:
      typeof o.lat === 'number' && Number.isFinite(o.lat) ? o.lat : null,
    lng:
      typeof o.lng === 'number' && Number.isFinite(o.lng) ? o.lng : null,
    iata:
      typeof o.iata === 'string' && /^[A-Za-z]{3}$/.test(o.iata.trim())
        ? o.iata.trim().toUpperCase()
        : null,
    whyFit:
      typeof o.whyFit === 'string' && o.whyFit.trim()
        ? o.whyFit.trim().slice(0, 160)
        : null,
    source,
  };
}

function packSeeds(): InspirationSeed[] {
  const items = Array.isArray((harvestPack as { items?: unknown[] })?.items)
    ? (harvestPack as { items: unknown[] }).items
    : [];
  return items
    .map((x) => normalizeSeed(x, 'pack'))
    .filter((s): s is InspirationSeed => Boolean(s));
}

function catalogKey(s: InspirationSeed): string {
  return `${s.vibe}:${s.destLabel.toLowerCase()}`;
}

/** Merge seeds + pack + overlay; spätere Quellen gewinnen bei gleichem Key. */
export function mergeInspirationHarvest(
  incoming: InspirationSeed[],
  nowMs = Date.now(),
): InspirationSeed[] {
  const map = new Map<string, InspirationSeed>();
  for (const s of [
    ...SEEDS,
    ...packSeeds(),
    ...harvestOverlay,
    ...incoming,
  ]) {
    if (s.validUntilMs <= nowMs) continue;
    map.set(catalogKey(s), s);
  }
  return [...map.values()];
}

/** Setzt Runtime-Overlay (nach Batch/Cache). */
export function setInspirationHarvestOverlay(seeds: InspirationSeed[]): void {
  harvestOverlay = seeds
    .map((s) => ({ ...s, source: s.source ?? 'grounded' }))
    .filter((s) => s.validUntilMs > Date.now());
}

export function getInspirationHarvestOverlay(): InspirationSeed[] {
  return [...harvestOverlay];
}

export function listInspirationSeeds(
  vibe?: InspirationVibe,
  nowMs = Date.now(),
): InspirationSeed[] {
  return mergeInspirationHarvest([], nowMs).filter(
    (s) => !vibe || s.vibe === vibe,
  );
}

export function inspirationSeedsForLedgerTags(tags: string[]): InspirationSeed[] {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  const vibes: InspirationVibe[] = [];
  if (set.has('kids') || set.has('family')) vibes.push('family', 'kids');
  if (set.has('party')) {
    /* party → not anti_party */
  } else if (set.has('quiet') || set.has('anti_party')) {
    vibes.push('anti_party');
  }
  if (set.has('spa') || set.has('sauna')) vibes.push('spa_value');
  if (set.has('deal') || set.has('bargain')) vibes.push('ultra_cheap');
  if (set.has('hike') || set.has('adventure') || set.has('bike')) vibes.push('adventure');
  if (set.has('tennis') || set.has('pool') || set.has('padel')) vibes.push('menstrip', 'family');
  if (set.has('date')) vibes.push('date');
  if (!vibes.length) return listInspirationSeeds();
  const out: InspirationSeed[] = [];
  const seen = new Set<string>();
  for (const v of vibes) {
    for (const s of listInspirationSeeds(v)) {
      const k = catalogKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

function slugId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** Katalog → SeedPlace für Shortlist/Extras. */
export function inspirationSeedsToPlaces(seeds: InspirationSeed[]): SeedPlace[] {
  const out: SeedPlace[] = [];
  for (const s of seeds) {
    if (s.lat == null || s.lng == null || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) {
      continue;
    }
    out.push({
      id: `insp-${slugId(s.destLabel)}`,
      name: s.destLabel,
      lat: s.lat,
      lng: s.lng,
      tags: [
        ...new Set([
          'inspiration',
          s.vibe,
          s.source || 'pack',
          ...s.tags,
        ]),
      ],
      wiki: s.destLabel,
      iata: s.iata ?? undefined,
    });
  }
  return out;
}

export type InspirationBatchResult = {
  vibe: InspirationVibe;
  items: InspirationSeed[];
  notes: string;
};

/** Ein Vibe — bezahlter Grounded-Lauf. */
export async function harvestInspirationVibe(
  vibe: InspirationVibe,
  opts?: { usePro?: boolean },
): Promise<InspirationBatchResult> {
  const empty: InspirationBatchResult = { vibe, items: [], notes: '' };
  try {
    const { hasGroundedJsonKey, groundedJsonLite } = await import(
      './groundedJsonLite'
    );
    if (!hasGroundedJsonKey()) {
      // App-Pfad: geminiService (Proxy/Credits) falls Env nur dort
      try {
        const { hasGeminiApiKey, generateGeminiText } = await import(
          '../../services/geminiService'
        );
        if (!hasGeminiApiKey()) return empty;
        const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
          '../../services/concierge/findusResponsePolicy'
        );
        const usePro = opts?.usePro === true;
        const validUntilMs = Date.now() + 90 * 24 * 3600_000;
        const prompt = buildVibePrompt(vibe, FINDUS_FEW_SHOT_DISCLAIMER);
        const raw = await generateGeminiText(prompt, {
          task: 'generic',
          costModule: 'research',
          ...(usePro
            ? { tier: 'pro' as const, forcePro: true, allowProEscalate: false }
            : { tier: 'lite' as const, forcePro: false, allowProEscalate: false }),
          enableGoogleSearch: true,
          maxTokens: usePro ? 2000 : 1400,
          temperature: 0.25,
          useFindusSystem: false,
          responseJson: true,
          jsonMimeOnly: true,
        });
        return await parseVibeHarvest(vibe, raw || '', validUntilMs);
      } catch (e) {
        return {
          vibe,
          items: [],
          notes: `soft-fail ${String(e).slice(0, 120)}`,
        };
      }
    }

    const disclaimer =
      'Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an den aktuellen Kontext und die aktuelle Stadt an.';
    const validUntilMs = Date.now() + 90 * 24 * 3600_000;
    const raw = await groundedJsonLite({
      prompt: buildVibePrompt(vibe, disclaimer),
      maxTokens: opts?.usePro ? 2000 : 1400,
      temperature: 0.25,
      enableGoogleSearch: true,
    });
    if (!raw) {
      return { vibe, items: [], notes: 'empty model response' };
    }
    return await parseVibeHarvest(vibe, raw, validUntilMs);
  } catch (e) {
    return {
      vibe,
      items: [],
      notes: `soft-fail ${String(e).slice(0, 120)}`,
    };
  }
}

function buildVibePrompt(vibe: InspirationVibe, disclaimer: string): string {
  return [
    disclaimer,
    'Yorro Inspiration-Katalog Batch: Europa-Destinationen für ein Vibe.',
    'Google Search. Nur belegte Orte/Regionen. Nichts erfinden. Keine Buchungs-URLs.',
    `Vibe: ${vibe} — ${VIBE_BRIEF[vibe]}`,
    'Liefere 5–8 unterschiedliche Destinations (Städte/Regionen), lat/lng wenn bekannt, iata wenn Flughafen üblich.',
    'tags: vibe-passende Stichworte (kids, hike, spa, deal, quiet, tennis, …).',
    'JSON: {"items":[{"destLabel":"","region":"","countryCode":"DE","tags":["…"],"seasonHint":"","lat":0,"lng":0,"iata":null,"whyFit":"1 Satz belegt"}],"notes":"1 Satz"}',
  ].join('\n');
}

async function parseVibeHarvest(
  vibe: InspirationVibe,
  raw: string,
  validUntilMs: number,
): Promise<InspirationBatchResult> {
  const { extractJsonObject } = await import('./proEnrichParse');
  const parsed = extractJsonObject(raw || '');
  const rows = Array.isArray(parsed?.items) ? parsed!.items : [];
  const items: InspirationSeed[] = [];
  for (const row of rows) {
    const n = normalizeSeed(
      { ...(row as object), vibe, validUntilMs },
      'grounded',
    );
    if (n) items.push(n);
  }
  // Geocode missing coords — soft (Maps-Key); Batch darf auch ohne
  for (const item of items) {
    if (item.lat != null && item.lng != null) continue;
    try {
      const { geocodePlaceName } = await import(
        '../../services/navigation/googleMapsNav'
      );
      const geo = await geocodePlaceName(item.destLabel, {
        cityHint: item.destLabel,
      });
      if (geo) {
        item.lat = geo.lat;
        item.lng = geo.lng;
      }
    } catch {
      /* soft — RN/Maps in Node oft nicht verfügbar */
    }
  }
  const notes =
    typeof parsed?.notes === 'string' ? parsed.notes.trim().slice(0, 200) : '';
  return { vibe, items: items.slice(0, 8), notes };
}

export type InspirationCatalogBatchReport = {
  vibes: InspirationVibe[];
  items: InspirationSeed[];
  perVibe: InspirationBatchResult[];
  packPayload: {
    version: number;
    generatedAtMs: number;
    items: InspirationSeed[];
  };
};

/**
 * Bezahlter Full-/Teil-Batch über Vibes.
 * Schreibt Runtime-Overlay + Travel-Cache; Pack-Schreiben macht das CLI-Script.
 */
export async function runInspirationCatalogBatch(opts?: {
  vibes?: InspirationVibe[];
  usePro?: boolean;
  persistCache?: boolean;
}): Promise<InspirationCatalogBatchReport> {
  const vibes = opts?.vibes?.length
    ? opts.vibes
    : [...ALL_INSPIRATION_VIBES];
  const perVibe: InspirationBatchResult[] = [];
  for (const vibe of vibes) {
    const r = await harvestInspirationVibe(vibe, { usePro: opts?.usePro });
    perVibe.push(r);
  }
  const items = mergeInspirationHarvest(perVibe.flatMap((r) => r.items));
  setInspirationHarvestOverlay(
    items.filter((s) => s.source === 'grounded' || s.source === 'pack'),
  );

  if (opts?.persistCache !== false) {
    try {
      const { putTravelCache, buildTravelCacheKey } = await import(
        './travelResearchCache'
      );
      const key = buildTravelCacheKey({
        musts: ['inspiration_catalog'],
        vibe: vibes.join('+'),
      });
      await putTravelCache({
        key,
        kind: 'inspiration_harvest',
        payload: {
          items: getInspirationHarvestOverlay(),
          vibes,
          generatedAtMs: Date.now(),
        },
        validUntilMs: Date.now() + 14 * 24 * 3600_000,
      });
    } catch {
      /* soft — Node ohne AsyncStorage */
    }
  }

  return {
    vibes,
    items,
    perVibe,
    packPayload: {
      version: 1,
      generatedAtMs: Date.now(),
      items: getInspirationHarvestOverlay().map((s) => ({
        ...s,
        source: 'pack' as const,
      })),
    },
  };
}

const FRESH_MS = 14 * 24 * 3600_000;

/**
 * Funnel-Hook: Pack/Cache laden; bei Stale gezielter Lite-Batch (1–3 Vibes).
 */
export async function ensureInspirationCatalogFresh(opts?: {
  tags?: string[];
  maxAgeMs?: number;
  timedOut?: () => boolean;
  allowPaidRefresh?: boolean;
}): Promise<{
  seeds: InspirationSeed[];
  places: SeedPlace[];
  refreshed: boolean;
  source: string;
}> {
  const maxAge = opts?.maxAgeMs ?? FRESH_MS;
  let source = 'seed+pack';
  let refreshed = false;

  // 1) Pack
  const fromPack = packSeeds();
  if (fromPack.length) {
    setInspirationHarvestOverlay([
      ...getInspirationHarvestOverlay(),
      ...fromPack,
    ]);
    source = 'pack';
  }

  // 2) Travel-Cache
  try {
    const { getTravelCache, buildTravelCacheKey } = await import(
      './travelResearchCache'
    );
    const key = buildTravelCacheKey({ musts: ['inspiration_catalog'] });
    const hit = await getTravelCache(key, 'inspiration_harvest');
    if (hit && Array.isArray(hit.payload.items)) {
      const cached = (hit.payload.items as unknown[])
        .map((x) => normalizeSeed(x, 'cache'))
        .filter((s): s is InspirationSeed => Boolean(s));
      if (cached.length) {
        setInspirationHarvestOverlay(cached);
        source = 'cache';
        const age =
          typeof hit.payload.generatedAtMs === 'number'
            ? Date.now() - hit.payload.generatedAtMs
            : 0;
        if (age < maxAge) {
          const seeds = opts?.tags?.length
            ? inspirationSeedsForLedgerTags(opts.tags)
            : listInspirationSeeds();
          return {
            seeds,
            places: inspirationSeedsToPlaces(seeds),
            refreshed: false,
            source,
          };
        }
      }
    }
  } catch {
    /* soft */
  }

  // 3) Gezielter bezahlter Refresh (nicht Full-Batch im Funnel)
  if (
    opts?.allowPaidRefresh !== false &&
    !opts?.timedOut?.() &&
    (fromPack.length === 0 ||
      Date.now() - ((harvestPack as { generatedAtMs?: number }).generatedAtMs || 0) >
        maxAge)
  ) {
    const tagVibes = opts?.tags?.length
      ? inspirationSeedsForLedgerTags(opts.tags).map((s) => s.vibe)
      : (['ultra_cheap', 'adventure', 'family'] as InspirationVibe[]);
    const uniq = [...new Set(tagVibes)].slice(0, 3);
    try {
      await runInspirationCatalogBatch({
        vibes: uniq,
        usePro: false,
        persistCache: true,
      });
      refreshed = true;
      source = 'grounded';
    } catch {
      /* soft */
    }
  }

  const seeds = opts?.tags?.length
    ? inspirationSeedsForLedgerTags(opts.tags)
    : listInspirationSeeds();
  return {
    seeds,
    places: inspirationSeedsToPlaces(seeds),
    refreshed,
    source,
  };
}

/** Pack-Meta für Smokes/CLI. */
export function inspirationPackMeta(): {
  itemCount: number;
  generatedAtMs: number;
} {
  const p = harvestPack as { items?: unknown[]; generatedAtMs?: number };
  return {
    itemCount: Array.isArray(p.items) ? p.items.length : 0,
    generatedAtMs: typeof p.generatedAtMs === 'number' ? p.generatedAtMs : 0,
  };
}

/** Test helper */
export function _resetInspirationOverlayForTests(): void {
  harvestOverlay = [];
}
