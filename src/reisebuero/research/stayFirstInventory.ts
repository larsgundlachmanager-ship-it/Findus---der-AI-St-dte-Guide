/**
 * Stay-first Inventory: erst Amenity-Stays weltweit, dann Zugang.
 *
 * Lane A: Grounded Region-Discovery (Gemini + Google Search) — Orte/Regionen,
 *          keine erfundenen Hotels.
 * Lane B: Statische Welt-Korridore + Seeds als Bootstrap/Fallback.
 * Lane C: Stay22 nur für Live-Preise/Links in den gefundenen Regionen.
 *
 * Kein Booking-Site-Scraping.
 */

import type { ReiseLedger } from '../types';
import type { SeedPlace } from './candidates';
import { SEED_PLACES } from './candidates';
import {
  extractStayMustSpecs,
  rankStaysByAmenityMusts,
  amenityHintFromSpecs,
  type AmenityMustSpec,
} from './stayMustVerify';
import { inspirationSeedsForLedgerTags } from './inspirationCatalog';
import { parseProDiscoverJson, slugId, type ProDestCandidate } from './proEnrichParse';
import {
  stayLodgingSearchOrder,
  type StayLodgingType,
} from './stayLodgingSearchOrder';

export type StayInventoryHit = {
  regionId: string;
  regionName: string;
  lat: number;
  lng: number;
  iata?: string;
  stayName: string;
  stayPrice: number | null;
  bookUrl: string | null;
  amenities: string[];
  photoUrl: string | null;
  hardFit: number;
  source?: 'grounded' | 'seed' | 'corridor';
};

/** Weltweite Villa/Amenity-Korridore — Bootstrap wenn Grounding dünn. */
export const WORLD_AMENITY_CORRIDORS: readonly SeedPlace[] = [
  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['tennis', 'pool', 'villa', 'warm', 'fly'], wiki: 'Alcúdia', iata: 'PMI' },
  { id: 'pollenca', name: 'Pollença', lat: 39.876, lng: 3.016, tags: ['tennis', 'pool', 'villa', 'warm', 'fly'], wiki: 'Pollença', iata: 'PMI' },
  { id: 'calpe', name: 'Calp', lat: 38.645, lng: 0.045, tags: ['pool', 'villa', 'warm', 'fly', 'sea'], wiki: 'Calp', iata: 'ALC' },
  { id: 'algarve-lagos', name: 'Lagos', lat: 37.102, lng: -8.674, tags: ['pool', 'villa', 'warm', 'fly', 'tennis'], wiki: 'Lagos (Portugal)', iata: 'FAO' },
  { id: 'algarve-albufeira', name: 'Albufeira', lat: 37.088, lng: -8.25, tags: ['pool', 'villa', 'warm', 'fly'], wiki: 'Albufeira', iata: 'FAO' },
  { id: 'crete-chania', name: 'Chania', lat: 35.514, lng: 24.018, tags: ['pool', 'villa', 'warm', 'fly', 'tennis'], wiki: 'Chania', iata: 'CHQ' },
  { id: 'crete-rethymno', name: 'Rethymno', lat: 35.365, lng: 24.482, tags: ['pool', 'villa', 'warm', 'fly'], wiki: 'Rethymno', iata: 'HER' },
  { id: 'cyprus-paphos', name: 'Paphos', lat: 34.772, lng: 32.43, tags: ['pool', 'villa', 'warm', 'fly', 'tennis'], wiki: 'Paphos', iata: 'PFO' },
  { id: 'istria-rovinj', name: 'Rovinj', lat: 45.081, lng: 13.639, tags: ['pool', 'villa', 'warm', 'fly', 'sea'], wiki: 'Rovinj', iata: 'PUY' },
  { id: 'tuscany-lucca', name: 'Lucca', lat: 43.843, lng: 10.506, tags: ['pool', 'villa', 'fly', 'train'], wiki: 'Lucca', iata: 'PSA' },
  { id: 'provence-aix', name: 'Aix-en-Provence', lat: 43.529, lng: 5.447, tags: ['pool', 'villa', 'fly', 'train'], wiki: 'Aix-en-Provence', iata: 'MRS' },
  { id: 'antalya-kaş', name: 'Kaş', lat: 36.202, lng: 29.641, tags: ['pool', 'villa', 'warm', 'fly'], wiki: 'Kaş', iata: 'AYT' },
  { id: 'budapest', name: 'Budapest', lat: 47.4979, lng: 19.0402, tags: ['spa', 'sauna', 'city', 'fly', 'train'], wiki: 'Budapest', iata: 'BUD' },
  { id: 'baden-baden', name: 'Baden-Baden', lat: 48.7606, lng: 8.2397, tags: ['spa', 'sauna', 'train'], wiki: 'Baden-Baden' },
  { id: 'iceland-blue', name: 'Reykjavík', lat: 64.147, lng: -21.942, tags: ['spa', 'sauna', 'fly'], wiki: 'Reykjavík', iata: 'KEF' },
];

function ledgerAmenityBlob(ledger: ReiseLedger): string {
  return [
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.spaStyle?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function amenityQueryBits(ledger: ReiseLedger): string[] {
  const must = new Set((ledger.mustHaves?.value ?? []).map(String));
  const blob = ledgerAmenityBlob(ledger);
  const bits: string[] = [];
  if (must.has('tennis') || /tennis/.test(blob)) bits.push('tennis court');
  if (must.has('padel') || /padel/.test(blob)) bits.push('padel');
  if (must.has('pool') || /pool/.test(blob)) bits.push('private pool');
  if (must.has('sauna') || /\d+\s*sauna|sauna/.test(blob)) bits.push('sauna');
  if (must.has('spa') || /spa|wellness/.test(blob)) bits.push('spa wellness');
  if (must.has('grill') || /grill|bbq/.test(blob)) bits.push('bbq grill');
  if (/villa|ferienhaus|finca|cottage/.test(blob) || must.has('ferienhaus')) {
    bits.push('villa holiday home');
  }
  if (!bits.length) bits.push('holiday villa amenities');
  return bits;
}

/** Regionen wo Stay-Amenities typischerweise existieren (Seeds + Korridore). */
export function stayFirstRegionSeeds(ledger: ReiseLedger): SeedPlace[] {
  const must = new Set((ledger.mustHaves?.value ?? []).map(String));
  const blob = ledgerAmenityBlob(ledger);
  const out: SeedPlace[] = [];
  const push = (p: SeedPlace | undefined | null) => {
    if (!p || out.some((x) => x.id === p.id || x.name.toLowerCase() === p.name.toLowerCase())) {
      return;
    }
    out.push(p);
  };

  const tags = [...must, ...blob.split(/\s+/)].filter(Boolean);
  for (const s of inspirationSeedsForLedgerTags(tags)) {
    const hit =
      SEED_PLACES.find(
        (p) =>
          p.name.toLowerCase().includes(s.destLabel.toLowerCase().slice(0, 5)) ||
          s.destLabel.toLowerCase().includes(p.name.toLowerCase().slice(0, 5)),
      ) ||
      WORLD_AMENITY_CORRIDORS.find(
        (p) =>
          p.name.toLowerCase().includes(s.destLabel.toLowerCase().slice(0, 5)) ||
          s.destLabel.toLowerCase().includes(p.name.toLowerCase().slice(0, 5)),
      );
    push(hit);
  }

  const needTennis = must.has('tennis') || must.has('padel') || /tennis|padel/.test(blob);
  const needSpa = must.has('sauna') || must.has('spa') || /\d+\s*sauna|spa|wellness/.test(blob);
  const needVilla = must.has('pool') || /villa|ferienhaus|pool/.test(blob);

  for (const c of WORLD_AMENITY_CORRIDORS) {
    if (needTennis && c.tags.some((t) => t === 'tennis' || t === 'padel')) push(c);
    else if (needSpa && c.tags.some((t) => t === 'spa' || t === 'sauna')) push(c);
    else if (needVilla && c.tags.some((t) => t === 'villa' || t === 'pool')) push(c);
  }

  if (needTennis) {
    push(SEED_PLACES.find((p) => p.id === 'palma'));
    push(SEED_PLACES.find((p) => p.id === 'naxos'));
    push(SEED_PLACES.find((p) => p.id === 'kreta'));
    push(SEED_PLACES.find((p) => p.id === 'korfu'));
  }

  const named = (ledger.destinationHint?.value || '').trim();
  if (named.length >= 3) {
    const hit =
      SEED_PLACES.find((p) => named.toLowerCase().includes(p.name.toLowerCase().slice(0, 4))) ||
      WORLD_AMENITY_CORRIDORS.find((p) =>
        named.toLowerCase().includes(p.name.toLowerCase().slice(0, 4)),
      );
    push(hit);
    if (!hit) {
      out.unshift({
        id: `named-${slugId(named)}`,
        name: named,
        lat: SEED_PLACES.find((p) => p.id === 'palma')?.lat ?? 39.57,
        lng: SEED_PLACES.find((p) => p.id === 'palma')?.lng ?? 2.65,
        tags: ['named', 'villa', 'stay_first'],
        wiki: named,
      });
    }
  }

  if (!out.length) {
    return WORLD_AMENITY_CORRIDORS.filter((p) => p.tags.includes('villa')).slice(0, 6);
  }
  return out.slice(0, 12);
}

export function proDestToStayRegion(d: ProDestCandidate): SeedPlace | null {
  if (!d.name || d.lat == null || d.lng == null) return null;
  if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return null;
  return {
    id: `gnd-${d.id}`,
    name: d.name,
    lat: d.lat,
    lng: d.lng,
    tags: [...new Set(['stay_first', 'villa', 'grounded', ...d.tags])],
    wiki: d.wiki || d.name,
    iata: d.iata ?? undefined,
  };
}

/**
 * Weltweite Region-Discovery per Search-Grounding.
 * Liefert Städte/Regionen mit Beleg-Hinweis — keine Hotel-Erfindungen.
 */
export async function discoverStayRegionsGrounded(
  ledger: ReiseLedger,
): Promise<{ regions: SeedPlace[]; notes: string; usedGrounding: boolean }> {
  try {
    const { hasGeminiApiKey, generateGeminiText } = await import(
      '../../services/geminiService'
    );
    if (!hasGeminiApiKey()) {
      return { regions: [], notes: '', usedGrounding: false };
    }
    const { FINDUS_FEW_SHOT_DISCLAIMER } = await import(
      '../../services/concierge/findusResponsePolicy'
    );
    const bits = amenityQueryBits(ledger);
    const named = (ledger.destinationHint?.value || '').trim();
    const corridor = (ledger.corridor?.value || '').trim();
    const prompt = [
      FINDUS_FEW_SHOT_DISCLAIMER,
      'Du recherchierst WELTWELT Regionen/Städte für Ferienhäuser/Villas mit harten Amenities.',
      'Nutze Google Search. Nur belegte Regionen. Keine Hotel-/Villa-Namen erfinden.',
      'Output = Orte/Towns/Islands wo solche Unterkünfte typischerweise existieren.',
      `Must-Amenities / Suche: ${bits.join(', ')}`,
      named && !/^offen$/iu.test(named)
        ? `User-Ziel genannt: ${named} — priorisiere diese Region + nahe Alternativen.`
        : 'Ziel offen — diverse Länder/Korridore (Europa + ggf. 1–2 weitere wenn Fit).',
      corridor ? `Korridor-Hinweis: ${corridor}` : '',
      'Diversität: verschiedene Metros/Inseln, nicht 5× dieselbe Stadt.',
      'JSON: {"destinations":[{"name":"Stadt oder Region","lat":0,"lng":0,"iata":null,"wiki":"","tags":["villa","tennis","pool"],"whyFit":"warum Amenities hier belegt"}],"notes":"1 Satz"}',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      tier: 'lite',
      forcePro: false,
      allowProEscalate: false,
      enableGoogleSearch: true,
      maxTokens: 1400,
      temperature: 0.2,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const dests = parseProDiscoverJson(raw || '');
    const regions: SeedPlace[] = [];
    for (const d of dests) {
      let place = proDestToStayRegion(d);
      if (!place) {
        // Geocode wenn Koordinaten fehlen
        try {
          const { geocodePlaceName } = await import(
            '../../services/navigation/googleMapsNav'
          );
          const geo = await geocodePlaceName(d.name, { cityHint: d.name });
          if (geo) {
            place = {
              id: `gnd-${d.id}`,
              name: d.name,
              lat: geo.lat,
              lng: geo.lng,
              tags: [...new Set(['stay_first', 'villa', 'grounded', ...d.tags])],
              wiki: d.wiki || d.name,
              iata: d.iata ?? undefined,
            };
          }
        } catch {
          /* soft */
        }
      }
      if (place) regions.push(place);
    }
    const notesMatch = (raw || '').match(/"notes"\s*:\s*"([^"]{0,200})"/);
    return {
      regions: regions.slice(0, 10),
      notes: notesMatch?.[1] || `${regions.length} grounded regions`,
      usedGrounding: regions.length > 0,
    };
  } catch {
    return { regions: [], notes: '', usedGrounding: false };
  }
}

export function mergeStayRegions(
  grounded: SeedPlace[],
  seeds: SeedPlace[],
  max = 10,
): SeedPlace[] {
  const out: SeedPlace[] = [];
  const seen = new Set<string>();
  for (const p of [...grounded, ...seeds]) {
    const key = p.name.toLowerCase().slice(0, 12);
    if (seen.has(key) || seen.has(p.id)) continue;
    seen.add(key);
    seen.add(p.id);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parallel Stay22 über weltweite Regionen — Hard-Amenity-Fit sortiert.
 */
export async function harvestStayFirstInventory(opts: {
  ledger: ReiseLedger;
  checkin: string;
  checkout: string;
  adults: number;
  maxRegions?: number;
  timedOut?: () => boolean;
  /** Skip grounding (tests / offline) */
  skipGrounding?: boolean;
}): Promise<StayInventoryHit[]> {
  const specs = extractStayMustSpecs(opts.ledger).filter(
    (s): s is AmenityMustSpec => s.kind === 'amenity',
  );
  const hint = amenityHintFromSpecs(specs) || 'pool';
  const seeds = stayFirstRegionSeeds(opts.ledger);
  let grounded: SeedPlace[] = [];
  let groundedNote = '';

  if (!opts.skipGrounding && !opts.timedOut?.()) {
    // Cache
    try {
      const { getTravelCache, putTravelCache, buildTravelCacheKey } = await import(
        './travelResearchCache'
      );
      const key = buildTravelCacheKey({
        musts: [...(opts.ledger.mustHaves?.value ?? [])].map(String),
        lodgingType: 'apartment',
        vibe: amenityQueryBits(opts.ledger).join('+'),
        origin: opts.ledger.originCity?.value,
        monthBand: opts.ledger.dateMonth?.value,
      });
      const cached = await getTravelCache(key);
      if (cached?.kind === 'stay_harvest' && Array.isArray(cached.payload.regions)) {
        grounded = (cached.payload.regions as SeedPlace[]).slice(0, 8);
        groundedNote = 'cache';
      } else {
        const disc = await discoverStayRegionsGrounded(opts.ledger);
        grounded = disc.regions;
        groundedNote = disc.notes;
        if (grounded.length) {
          await putTravelCache({
            key,
            kind: 'stay_harvest',
            payload: { regions: grounded, notes: groundedNote },
            validUntilMs: Date.now() + 7 * 24 * 3600_000,
          });
        }
      }
    } catch {
      const disc = await discoverStayRegionsGrounded(opts.ledger);
      grounded = disc.regions;
      groundedNote = disc.notes;
    }
  }

  void groundedNote;
  const regions = mergeStayRegions(grounded, seeds, opts.maxRegions ?? 8);
  const hits: StayInventoryHit[] = [];
  const { searchStay22HotelsInCity } = await import(
    '../../services/concierge/hotelAvailabilityService'
  );
  const amenBits = amenityQueryBits(opts.ledger).slice(0, 3).join(' ');

  await Promise.all(
    regions.map(async (region) => {
      if (opts.timedOut?.()) return;
      const source: StayInventoryHit['source'] = region.tags.includes('grounded')
        ? 'grounded'
        : WORLD_AMENITY_CORRIDORS.some((c) => c.id === region.id)
          ? 'corridor'
          : 'seed';
      try {
        // Widen before empty: apartment → hotel fallback → any (sequential to save API)
        const fbKind = opts.ledger.lodgingFallback?.value;
        const fb: StayLodgingType | null =
          fbKind === 'hotel' || fbKind === 'apartment' ? fbKind : 'hotel';
        const lodgingTypes = stayLodgingSearchOrder({
          preferred: 'apartment',
          fallback: fb,
          researchPath: 'stay_first',
          preferAllInclusive: opts.ledger.meals?.value === 'all',
        });
        let ranked: Awaited<ReturnType<typeof searchStay22HotelsInCity>>['stays'] = [];
        let lodgingUsed: StayLodgingType = 'apartment';
        for (const lt of lodgingTypes) {
          const live = await searchStay22HotelsInCity({
            city: region.name,
            checkin: opts.checkin,
            checkout: opts.checkout,
            adults: opts.adults,
            lodgingType: lt,
            lat: region.lat,
            lng: region.lng,
            pageSize: 24,
            amenityHint: hint,
          });
          if (live.stays.length) {
            ranked = live.stays;
            lodgingUsed = lt;
            break;
          }
        }
        // 2) Zusätzlich gezielte Address-Query wenn Amenities hart
        if (amenBits && specs.filter((s) => s.hardness === 'hard').length >= 1) {
          try {
            const targeted = await searchStay22HotelsInCity({
              city: `${amenBits} ${region.name}`.slice(0, 80),
              checkin: opts.checkin,
              checkout: opts.checkout,
              adults: opts.adults,
              lodgingType: lodgingUsed,
              lat: region.lat,
              lng: region.lng,
              pageSize: 16,
              amenityHint: hint,
            });
            const seen = new Set(ranked.map((s) => s.id || s.name));
            for (const s of targeted.stays) {
              const key = s.id || s.name;
              if (seen.has(key)) continue;
              seen.add(key);
              ranked.push(s);
            }
          } catch {
            /* soft */
          }
        }
        if (specs.length) ranked = rankStaysByAmenityMusts(ranked, specs);
        for (const s of ranked.slice(0, 3)) {
          const amen = s.amenities ?? [];
          const blob = `${s.name} ${amen.join(' ')}`.toLowerCase();
          let hardFit = 0;
          for (const spec of specs) {
            if (spec.patterns.some((re) => re.test(blob))) hardFit += 1;
          }
          hits.push({
            regionId: region.id,
            regionName: region.name,
            lat: s.lat ?? region.lat,
            lng: s.lng ?? region.lng,
            iata: region.iata,
            stayName: s.name,
            stayPrice: s.priceTotal,
            bookUrl: s.bookUrl,
            amenities: amen,
            photoUrl: s.photoUrl ?? null,
            hardFit,
            source,
          });
        }
      } catch {
        /* soft per region */
      }
    }),
  );

  return hits.sort((a, b) => {
    if (b.hardFit !== a.hardFit) return b.hardFit - a.hardFit;
    const gA = a.source === 'grounded' ? 1 : 0;
    const gB = b.source === 'grounded' ? 1 : 0;
    if (gB !== gA) return gB - gA;
    return (a.stayPrice ?? 9e9) - (b.stayPrice ?? 9e9);
  });
}

/** Inventory-Hits → SeedPlaces für Funnel-Shortlist (beste Region/Stay). */
export function inventoryHitsToSeeds(hits: StayInventoryHit[]): SeedPlace[] {
  const byRegion = new Map<string, StayInventoryHit>();
  for (const h of hits) {
    const prev = byRegion.get(h.regionId);
    if (!prev || h.hardFit > prev.hardFit) byRegion.set(h.regionId, h);
  }
  return [...byRegion.values()].map((h) => ({
    id: `stayinv-${h.regionId}`,
    name: h.regionName,
    lat: h.lat,
    lng: h.lng,
    tags: [
      'named',
      'villa',
      'stay_first',
      ...(h.hardFit > 0 ? ['amenity_fit'] : []),
      ...(h.source === 'grounded' ? ['grounded'] : []),
    ],
    wiki: h.regionName,
    iata: h.iata,
  }));
}

export function bestStayHintForRegion(
  hits: StayInventoryHit[],
  regionName: string,
): StayInventoryHit | null {
  return (
    hits.find((h) => h.regionName.toLowerCase() === regionName.toLowerCase()) ||
    hits[0] ||
    null
  );
}
