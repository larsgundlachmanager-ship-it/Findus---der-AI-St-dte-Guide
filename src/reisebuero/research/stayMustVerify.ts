/**
 * Hard-Must Verify für Stay-first / Route-Tour:
 * Amenities am Stay + Nähe-Musts (Supermarkt ≤Xm, Volleyballnetz…).
 * Nur belegte Treffer pitchen — Near-Miss als Gap, nicht als Perfect.
 */

import type { ReiseLedger } from '../types';
import { classifyConstraintText } from './researchPath';
import {
  parseSaunaCountFromText,
  scoreCountAmenity,
} from './amenityCountTolerance';

export type AmenityMustSpec = {
  kind: 'amenity';
  id: string;
  label: string;
  /** Regexes gegen Stay-Name + Amenities */
  patterns: RegExp[];
  hardness: 'hard' | 'nice';
  /** Exakte Zahl (Saunen) */
  wantedCount?: number;
};

export type ProximityMustSpec = {
  kind: 'proximity';
  id: string;
  label: string;
  hardness: 'hard' | 'nice';
  radiusM: number;
  /** Google Places type wenn möglich */
  placeType?: string;
  /** Text-Fallback */
  textQuery: string;
};

export type StayMustSpec = AmenityMustSpec | ProximityMustSpec;

export type AmenityVerifyHit = {
  id: string;
  label: string;
  hardness: 'hard' | 'nice';
  status: 'perfect' | 'near' | 'fail' | 'unknown';
  detail: string;
};

export type ProximityVerifyHit = {
  id: string;
  label: string;
  hardness: 'hard' | 'nice';
  status: 'perfect' | 'near' | 'fail' | 'unknown';
  distM: number | null;
  name: string | null;
  detail: string;
};

function ledgerBlob(ledger: ReiseLedger): string {
  return [
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.spaStyle?.value,
    ledger.partyStyle?.value,
    ledger.tripShape?.value,
    ledger.dealbreaker?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.niceHaves?.value ?? []),
    ...(ledger.mustActivities?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const AMENITY_PATTERNS: Record<
  string,
  { label: string; patterns: RegExp[] }
> = {
  tennis: {
    label: 'Tennis',
    patterns: [/tennis/, /tennis\s*court/, /tennisplatz/],
  },
  padel: {
    label: 'Padel',
    patterns: [/padel/, /paddle\s*court/],
  },
  pool: {
    label: 'Pool',
    patterns: [/pool/, /swimming\s*pool/, /schwimmbad/, /privat\w*\s*pool/],
  },
  spa: {
    label: 'Spa',
    patterns: [/spa\b/, /wellness/, /thermal/],
  },
  sauna: {
    label: 'Sauna',
    patterns: [/sauna/],
  },
  grill: {
    label: 'Grill',
    patterns: [/grill/, /bbq/, /barbecue/],
  },
  parking: {
    label: 'Parkplatz',
    patterns: [/parking/, /parkplatz/, /garage/, /stellplatz/],
  },
  pet: {
    label: 'Haustiere',
    patterns: [/pet\s*friendly/, /hund/, /dog\s*friendly/, /haustier/, /pets?\s*allowed/],
  },
  volleyball: {
    label: 'Volleyballnetz',
    patterns: [/volleyball/, /beach\s*volley/, /volley\s*netz/],
  },
};

/** Hard/Nice Must-Specs aus Ledger + Freitext. */
export function extractStayMustSpecs(ledger: ReiseLedger): StayMustSpec[] {
  const out: StayMustSpec[] = [];
  const seen = new Set<string>();
  const blob = ledgerBlob(ledger);
  const mustSet = new Set((ledger.mustHaves?.value ?? []).map(String));
  const wishSet = new Set([
    ...(ledger.wishHaves?.value ?? []).map(String),
    ...(ledger.niceHaves?.value ?? []).map(String),
  ]);

  const pushAmenity = (
    id: string,
    hardness: 'hard' | 'nice',
    wantedCount?: number,
  ) => {
    const meta = AMENITY_PATTERNS[id];
    if (!meta || seen.has(`a:${id}`)) return;
    seen.add(`a:${id}`);
    out.push({
      kind: 'amenity',
      id,
      label: wantedCount != null ? `${wantedCount}× ${meta.label}` : meta.label,
      patterns: meta.patterns,
      hardness,
      wantedCount,
    });
  };

  for (const id of Object.keys(AMENITY_PATTERNS)) {
    if (!mustSet.has(id) && !wishSet.has(id) && !blob.includes(id)) continue;
    // MustHave-Array = hard; Wish/Nice = nice; Freitext: Soft-Marker → nice, sonst hard
    let h: 'hard' | 'nice' = 'nice';
    if (mustSet.has(id)) h = 'hard';
    else if (wishSet.has(id)) h = 'nice';
    else if (blob.includes(id)) {
      h =
        classifyConstraintText(
          `${ledger.highlightWant?.value || ''} ${ledger.extraWishes?.value || ''}`,
        ) === 'nice'
          ? 'nice'
          : 'hard';
    }
    pushAmenity(id, h);
  }

  const saunaWanted = parseSaunaCountFromText(blob);
  if (saunaWanted != null) {
    // Replace plain sauna with counted
    const idx = out.findIndex((s) => s.kind === 'amenity' && s.id === 'sauna');
    if (idx >= 0) out.splice(idx, 1);
    seen.delete('a:sauna');
    pushAmenity('sauna', 'hard', saunaWanted);
  }

  // Nähe-Musts aus Freitext
  const proxPatterns: Array<{
    id: string;
    label: string;
    re: RegExp;
    defaultM: number;
    placeType?: string;
    textQuery: string;
  }> = [
    {
      id: 'supermarket_near',
      label: 'Supermarkt in der Nähe',
      re: /\b(supermarkt|supermarket|edeka|rewe|aldi|lidl)\b.{0,40}\b(\d{2,4})\s*m\b|\b(\d{2,4})\s*m\b.{0,40}\b(supermarkt|supermarket)\b|\bsupermarkt\s*(direkt|nah|nebenan|fu[sß]weg)/i,
      defaultM: 500,
      placeType: 'supermarket',
      textQuery: 'supermarket',
    },
    {
      id: 'volleyball_near',
      label: 'Volleyballnetz in der Nähe',
      re: /\b(volleyball|beach\s*volley|volley\s*netz)\b/i,
      defaultM: 400,
      textQuery: 'beach volleyball',
    },
    {
      id: 'bakery_near',
      label: 'Bäckerei in der Nähe',
      re: /\b(b[aä]ckerei|bakery)\b.{0,30}\b(\d{2,4})\s*m\b|\b(\d{2,4})\s*m\b.{0,30}\b(b[aä]ckerei)\b/i,
      defaultM: 400,
      placeType: 'bakery',
      textQuery: 'bakery',
    },
  ];

  for (const p of proxPatterns) {
    if (!p.re.test(blob) || seen.has(`p:${p.id}`)) continue;
    seen.add(`p:${p.id}`);
    const m = blob.match(/(\d{2,4})\s*m/);
    const radiusM = m ? Math.min(2000, Math.max(100, Number(m[1]))) : p.defaultM;
    const hardness =
      classifyConstraintText(
        `${ledger.highlightWant?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ) === 'nice'
        ? 'nice'
        : 'hard';
    out.push({
      kind: 'proximity',
      id: p.id,
      label: `${p.label} (≤${radiusM} m)`,
      hardness,
      radiusM,
      placeType: p.placeType,
      textQuery: p.textQuery,
    });
  }

  return out;
}

export function scoreAmenityAgainstStay(
  spec: AmenityMustSpec,
  stayName: string,
  amenities: string[] | null | undefined,
): AmenityVerifyHit {
  const blob = `${stayName} ${(amenities ?? []).join(' ')}`.toLowerCase();
  if (spec.wantedCount != null) {
    const found = parseSaunaCountFromText(blob);
    const grade = scoreCountAmenity({ wanted: spec.wantedCount, found });
    if (grade === 'perfect') {
      return {
        id: spec.id,
        label: spec.label,
        hardness: spec.hardness,
        status: 'perfect',
        detail: `${found} belegt`,
      };
    }
    if (grade === 'near') {
      return {
        id: spec.id,
        label: spec.label,
        hardness: spec.hardness,
        status: 'near',
        detail: found != null ? `${found} statt ${spec.wantedCount}` : 'nahe Zahl',
      };
    }
    if (grade === 'unknown') {
      // Fallback: Wort „sauna“ ohne Zahl
      const hasWord = spec.patterns.some((re) => re.test(blob));
      return {
        id: spec.id,
        label: spec.label,
        hardness: spec.hardness,
        status: hasWord ? 'near' : 'fail',
        detail: hasWord ? 'Sauna erwähnt, Zahl unklar' : 'Zahl nicht belegt',
      };
    }
    return {
      id: spec.id,
      label: spec.label,
      hardness: spec.hardness,
      status: 'fail',
      detail: found != null ? `nur ${found}` : 'fehlt',
    };
  }
  const hit = spec.patterns.some((re) => re.test(blob));
  return {
    id: spec.id,
    label: spec.label,
    hardness: spec.hardness,
    status: hit ? 'perfect' : 'fail',
    detail: hit ? 'in Amenities/Name' : 'nicht belegt',
  };
}

export function rankStaysByAmenityMusts<
  T extends { name?: string; amenities?: string[] | null },
>(stays: T[], amenitySpecs: AmenityMustSpec[]): T[] {
  if (!amenitySpecs.length || !stays.length) return stays;
  const hard = amenitySpecs.filter((s) => s.hardness === 'hard');
  const scored = stays.map((s) => {
    const hits = amenitySpecs.map((spec) =>
      scoreAmenityAgainstStay(spec, s.name || '', s.amenities),
    );
    const hardFails = hits.filter(
      (h) => h.hardness === 'hard' && h.status === 'fail',
    ).length;
    const hardNear = hits.filter(
      (h) => h.hardness === 'hard' && h.status === 'near',
    ).length;
    const hardPerfect = hits.filter(
      (h) => h.hardness === 'hard' && h.status === 'perfect',
    ).length;
    const nicePerfect = hits.filter(
      (h) => h.hardness === 'nice' && h.status === 'perfect',
    ).length;
    return { s, hardFails, hardNear, hardPerfect, nicePerfect, hits };
  });
  // Hard-Fails nach hinten — nicht löschen (Pool kann dünn sein), aber Perfect zuerst
  scored.sort((a, b) => {
    if (a.hardFails !== b.hardFails) return a.hardFails - b.hardFails;
    if (b.hardPerfect !== a.hardPerfect) return b.hardPerfect - a.hardPerfect;
    if (a.hardNear !== b.hardNear) return a.hardNear - b.hardNear;
    return b.nicePerfect - a.nicePerfect;
  });
  void hard;
  return scored.map((x) => x.s);
}

export function amenityHitsForStay(
  stayName: string,
  amenities: string[] | null | undefined,
  specs: AmenityMustSpec[],
): AmenityVerifyHit[] {
  return specs.map((s) => scoreAmenityAgainstStay(s, stayName, amenities));
}

export function gapsFromAmenityHits(hits: AmenityVerifyHit[]): string[] {
  const gaps: string[] = [];
  for (const h of hits) {
    if (h.status === 'perfect') continue;
    if (h.hardness === 'hard' && h.status === 'fail') {
      gaps.push(`Must-Fail: ${h.label} — ${h.detail}`);
    } else if (h.hardness === 'hard' && h.status === 'near') {
      gaps.push(`Must-Near: ${h.label} — ${h.detail}`);
    } else if (h.status === 'fail' || h.status === 'near') {
      gaps.push(`${h.label}: ${h.detail}`);
    }
  }
  return gaps;
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const lat1 = toR(a.lat);
  const lat2 = toR(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Live Places-Nähe für Hard-Proximity-Musts (soft bei API-Fehler). */
export async function verifyProximityMusts(opts: {
  lat: number;
  lng: number;
  specs: ProximityMustSpec[];
}): Promise<ProximityVerifyHit[]> {
  const out: ProximityVerifyHit[] = [];
  if (!opts.specs.length) return out;
  let searchNearby: typeof import('../../services/navigation/googleMapsNav').searchPlacesNearbyForType;
  let searchText: typeof import('../../services/navigation/googleMapsNav').searchPlacesByText;
  try {
    const mod = await import('../../services/navigation/googleMapsNav');
    searchNearby = mod.searchPlacesNearbyForType;
    searchText = mod.searchPlacesByText;
  } catch {
    return opts.specs.map((s) => ({
      id: s.id,
      label: s.label,
      hardness: s.hardness,
      status: 'unknown' as const,
      distM: null,
      name: null,
      detail: 'Places API nicht geladen',
    }));
  }

  for (const spec of opts.specs) {
    try {
      let places =
        spec.placeType != null
          ? await searchNearby({
              lat: opts.lat,
              lng: opts.lng,
              radiusM: Math.min(spec.radiusM * 1.5, 3000),
              includedType: spec.placeType,
            })
          : [];
      if (!places.length) {
        places = await searchText({
          query: spec.textQuery,
          lat: opts.lat,
          lng: opts.lng,
          radiusM: Math.min(spec.radiusM * 2, 4000),
        });
      }
      let best: { name: string; distM: number } | null = null;
      for (const p of places) {
        if (p.lat == null || p.lng == null) continue;
        const distM = Math.round(
          haversineM(
            { lat: opts.lat, lng: opts.lng },
            { lat: p.lat, lng: p.lng },
          ),
        );
        if (!best || distM < best.distM) {
          best = { name: p.name || spec.textQuery, distM };
        }
      }
      if (!best) {
        out.push({
          id: spec.id,
          label: spec.label,
          hardness: spec.hardness,
          status: 'fail',
          distM: null,
          name: null,
          detail: 'kein Treffer in Radius',
        });
        continue;
      }
      if (best.distM <= spec.radiusM) {
        out.push({
          id: spec.id,
          label: spec.label,
          hardness: spec.hardness,
          status: 'perfect',
          distM: best.distM,
          name: best.name,
          detail: `${best.name} · ${best.distM} m`,
        });
      } else if (best.distM <= spec.radiusM * 1.5) {
        out.push({
          id: spec.id,
          label: spec.label,
          hardness: spec.hardness,
          status: 'near',
          distM: best.distM,
          name: best.name,
          detail: `${best.name} · ${best.distM} m (über ${spec.radiusM} m)`,
        });
      } else {
        out.push({
          id: spec.id,
          label: spec.label,
          hardness: spec.hardness,
          status: 'fail',
          distM: best.distM,
          name: best.name,
          detail: `nächstes ${best.distM} m`,
        });
      }
    } catch {
      out.push({
        id: spec.id,
        label: spec.label,
        hardness: spec.hardness,
        status: 'unknown',
        distM: null,
        name: null,
        detail: 'Proximity-Check soft-fail',
      });
    }
  }
  return out;
}

export function gapsFromProximityHits(hits: ProximityVerifyHit[]): string[] {
  const gaps: string[] = [];
  for (const h of hits) {
    if (h.status === 'perfect') continue;
    if (h.hardness === 'hard' && h.status === 'fail') {
      gaps.push(`Must-Fail: ${h.label} — ${h.detail}`);
    } else if (h.hardness === 'hard' && h.status === 'near') {
      gaps.push(`Must-Near: ${h.label} — ${h.detail}`);
    } else if (h.status !== 'unknown') {
      gaps.push(`${h.label}: ${h.detail}`);
    }
  }
  return gaps;
}

/** Stay22 amenityHint aus Hard-Musts. */
export function amenityHintFromSpecs(specs: StayMustSpec[]): string | null {
  const hardAmen = specs.filter(
    (s): s is AmenityMustSpec => s.kind === 'amenity' && s.hardness === 'hard',
  );
  const order = ['tennis', 'padel', 'pool', 'sauna', 'spa', 'grill', 'parking'];
  for (const id of order) {
    if (hardAmen.some((s) => s.id === id)) return id === 'padel' ? 'tennis' : id;
  }
  return hardAmen[0]?.id ?? null;
}

/**
 * Stay-first: Hard-Amenity-Fails senken Score stark.
 * Near zählt als Teilerfüllung.
 */
export function hardMustScoreBoost(hits: AmenityVerifyHit[]): number {
  if (!hits.length) return 0;
  const hard = hits.filter((h) => h.hardness === 'hard');
  if (!hard.length) return 0;
  let boost = 0;
  for (const h of hard) {
    if (h.status === 'perfect') boost += 4;
    else if (h.status === 'near') boost += 1;
    else if (h.status === 'fail') boost -= 8;
  }
  return Math.max(-16, Math.min(12, boost));
}
