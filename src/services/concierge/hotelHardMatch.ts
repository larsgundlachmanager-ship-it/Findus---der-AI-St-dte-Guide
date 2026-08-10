/**
 * Hotel Hard-Match — Stadt, Amenities (Pool/Sauna…) und Ranking.
 * Keine Fake-Amenities: nur Stay22-Listen oder belegte Maps/Review-Hinweise.
 */

import type { HotelLiveStay } from './hotelAvailabilityService';

export type HotelAmenityNeed = {
  id: string;
  /** Kurzes Label für Speech/Bullets */
  label: string;
  /** Match gegen Amenity-Strings / Reviews / Editorial */
  evidence: RegExp;
  /** User-Trigger in der Frage */
  trigger: RegExp;
};

const AMENITY_NEEDS: HotelAmenityNeed[] = [
  {
    id: 'pool',
    label: 'Pool',
    trigger: /\b(pool|schwimmbad|schwimm\s*bad|innenpool|outdoor\s*pool|swimming)\b/i,
    evidence:
      /\b(pool|schwimmbad|schwimm\s*bad|swimming\s*pool|innenpool|outdoor\s*pool|rooftop\s*pool)\b/i,
  },
  {
    id: 'sauna',
    label: 'Sauna',
    trigger: /\b(sauna|dampfbad|steam\s*bath|finnische\s*sauna)\b/i,
    evidence: /\b(sauna|dampfbad|steam|finnisch\w*\s*sauna|hammam|hamam)\b/i,
  },
  {
    id: 'spa',
    label: 'Spa',
    trigger: /\b(spa|wellness|jacuzzi|whirlpool|hot\s*tub)\b/i,
    evidence: /\b(spa|wellness|jacuzzi|whirlpool|hot\s*tub|thermal)\b/i,
  },
  {
    id: 'breakfast',
    label: 'Frühstück',
    trigger: /\b(frühstück|fruehstueck|breakfast)\s*(inkl|inklusive|mit)?\b/i,
    evidence: /\b(frühstück|fruehstueck|breakfast|morgenbuffet)\b/i,
  },
  {
    id: 'parking',
    label: 'Parkplatz',
    trigger: /\b(parkplatz|parking|tiefgarage|garage)\b/i,
    evidence: /\b(parkplatz|parking|garage|tiefgarage)\b/i,
  },
  {
    id: 'fitness',
    label: 'Fitness',
    trigger: /\b(fitness|gym|fitnessraum)\b/i,
    evidence: /\b(fitness|gym|fitnessraum|fitness\s*center)\b/i,
  },
];

export function parseHotelAmenityNeeds(text: string): HotelAmenityNeed[] {
  const t = text || '';
  return AMENITY_NEEDS.filter((n) => n.trigger.test(t));
}

export function amenityEvidenceBlob(stay: HotelLiveStay): string {
  return [
    ...(stay.amenities ?? []),
    stay.name,
    stay.address ?? '',
  ]
    .join(' · ')
    .toLowerCase();
}

export function stayMatchesAmenity(
  stay: HotelLiveStay,
  need: HotelAmenityNeed,
): boolean {
  return need.evidence.test(amenityEvidenceBlob(stay));
}

export function stayMatchesAllAmenities(
  stay: HotelLiveStay,
  needs: HotelAmenityNeed[],
): boolean {
  if (!needs.length) return true;
  return needs.every((n) => stayMatchesAmenity(stay, n));
}

/** Merge zusätzliche Evidenz (Reviews/Editorial) in Stay-Amenities. */
export function mergeAmenityEvidence(
  stay: HotelLiveStay,
  evidenceText: string,
): HotelLiveStay {
  const found: string[] = [...(stay.amenities ?? [])];
  const blob = evidenceText.toLowerCase();
  for (const n of AMENITY_NEEDS) {
    if (n.evidence.test(blob) && !found.some((a) => n.evidence.test(a))) {
      found.push(n.label);
    }
  }
  // Extra Spa-Details aus Evidenz
  if (/\bjacuzzi|whirlpool|hot\s*tub\b/i.test(blob) && !found.some((a) => /jacuzzi|whirl/i.test(a))) {
    found.push('Jacuzzi');
  }
  if (/\bdampfbad|steam\b/i.test(blob) && !found.some((a) => /dampf|steam/i.test(a))) {
    found.push('Dampfbad');
  }
  return { ...stay, amenities: found.slice(0, 20) };
}

export type HotelHardFilterResult = {
  /** Voller Match aller Hard-Needs */
  matched: HotelLiveStay[];
  /** Kein voller Match — beste Teil-Treffer (für ehrlichen Fallback) */
  partial: HotelLiveStay[];
  missingLabels: string[];
  hard: boolean;
};

export function filterHotelsByAmenityNeeds(
  stays: HotelLiveStay[],
  needs: HotelAmenityNeed[],
): HotelHardFilterResult {
  if (!needs.length) {
    return { matched: stays, partial: [], missingLabels: [], hard: false };
  }
  const matched = stays.filter((s) => stayMatchesAllAmenities(s, needs));
  if (matched.length) {
    return { matched, partial: [], missingLabels: [], hard: true };
  }
  // Teil-Match: möglichst viele Needs, dann Preis
  const scored = stays
    .map((s) => {
      const hit = needs.filter((n) => stayMatchesAmenity(s, n));
      return { s, hit, n: hit.length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => {
      if (b.n !== a.n) return b.n - a.n;
      return (a.s.priceTotal ?? 1e9) - (b.s.priceTotal ?? 1e9);
    });
  const bestN = scored[0]?.n ?? 0;
  const partial = scored.filter((x) => x.n === bestN).map((x) => x.s);
  const covered = new Set(
    (scored[0]?.hit ?? []).map((h) => h.id),
  );
  const missingLabels = needs
    .filter((n) => !covered.has(n.id))
    .map((n) => n.label);
  return { matched: [], partial, missingLabels, hard: true };
}

/** Immer bis zu 2 — bei „günstigste“ die zwei günstigsten. */
export function pickTwoHotelStays(
  stays: HotelLiveStay[],
  opts: { wantCheap: boolean; wantQuality: boolean },
): HotelLiveStay[] {
  if (stays.length === 0) return [];
  const byPrice = [...stays].sort(
    (x, y) => (x.priceTotal ?? 1e9) - (y.priceTotal ?? 1e9),
  );
  const byQuality = [...stays].sort((x, y) => {
    const r = (y.rating ?? 0) - (x.rating ?? 0);
    if (Math.abs(r) > 0.05) return r;
    const s = (y.stars ?? 0) - (x.stars ?? 0);
    if (s !== 0) return s;
    return (x.priceTotal ?? 1e9) - (y.priceTotal ?? 1e9);
  });

  const out: HotelLiveStay[] = [];
  const push = (s: HotelLiveStay | null | undefined) => {
    if (!s) return;
    if (out.some((x) => x.id === s.id)) return;
    out.push(s);
  };

  if (opts.wantCheap) {
    push(byPrice[0]);
    push(byPrice[1]);
  } else if (opts.wantQuality) {
    push(byQuality[0]);
    push(byQuality.find((s) => s.id !== byQuality[0]?.id) ?? byPrice[0]);
  } else {
    const best = byQuality[0] ?? byPrice[0]!;
    push(best);
    push(
      byPrice.find((s) => s.id !== best.id) ??
        byQuality.find((s) => s.id !== best.id),
    );
  }

  for (const s of byPrice) {
    if (out.length >= 2) break;
    push(s);
  }
  return out.slice(0, 2);
}

export function nightsBetween(checkin: string, checkout: string): number {
  const a = new Date(checkin + 'T12:00:00').getTime();
  const b = new Date(checkout + 'T12:00:00').getTime();
  const n = Math.round((b - a) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function pricePerNight(stay: HotelLiveStay, nights: number): number | null {
  if (stay.priceTotal == null || nights < 1) return null;
  return stay.priceTotal / nights;
}
