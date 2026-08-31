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
    id: 'massage',
    label: 'Massage',
    // Spa allein reicht nicht — Massage muss belegt sein (Treatment/Menü).
    trigger: /\bmassagen?\b/i,
    evidence:
      /\b(massage|massagen|massageangebot|massagesalon|spa\s*massage|ayurveda\s*massage|thai\s*massage|hot\s*stone)\b/i,
  },
  {
    id: 'all_inclusive',
    label: 'All-inclusive',
    // Nicht „inklusive Frühstück“ — nur echte All-inclusive-Formulierungen.
    trigger:
      /\ball[\s-]*inclusive\b|\ballinclusive\b|\bai[\s-]*board\b|\bvollpension\s*\+\s*getränke|\ball\s+inklusi[vw]/i,
    evidence:
      /\ball[\s-]*inclusive\b|\ballinclusive\b|\bai[\s-]*board\b|\ball\s+inklusi[vw]|ultra\s*all[\s-]*inclusive|soft\s*all[\s-]*inclusive/i,
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
  {
    id: 'late_checkin',
    label: 'Spät-Check-in',
    trigger:
      /\b(spät[\s-]*check[\s-]*in|spaet[\s-]*check[\s-]*in|late[\s-]*check[\s-]*in|check[\s-]*in\s+(?:bis|nach|möglich)|24\s*h\s*(?:rezeption|reception)|nachtankunft)\b/i,
    evidence:
      /\b(24\s*h|24-hour|late\s*check[\s-]*in|spät[\s-]*check|spaet[\s-]*check|night\s*reception|rezeption\s*(?:rund\s*um|24)|check[\s-]*in\s*(?:until|bis)\s*\d)/i,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * User-Must-Haves inkl. dynamischer „*blick“/Aussicht (stadt-agnostisch aus dem Wunschtext).
 */
export function parseHotelAmenityNeeds(text: string): HotelAmenityNeed[] {
  const t = text || '';
  const out: HotelAmenityNeed[] = AMENITY_NEEDS.filter((n) => n.trigger.test(t));
  const seen = new Set(out.map((n) => n.id));
  for (const m of t.matchAll(
    /\b([A-Za-zÄÖÜäöüß]{2,16}blick|river\s*view|sea\s*view|lake\s*view|harbour\s*view|harbor\s*view)\b/giu,
  )) {
    const raw = String(m[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const id = `view_${raw.toLowerCase().replace(/\s+/g, '_')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const stem = raw.replace(/blick$/i, '').trim();
    const parts = [raw, stem, 'aussicht', 'blick', 'view']
      .filter((p) => p.length >= 2)
      .map(escapeRe);
    out.push({
      id,
      label: raw.replace(/\b\w/g, (c) => c.toUpperCase()),
      trigger: new RegExp(escapeRe(raw), 'i'),
      evidence: new RegExp(`\\b(${parts.join('|')})\\b`, 'i'),
    });
  }
  return out;
}

/**
 * Maps/Reviews nachziehen, wenn Stay22-Amenities dünn sind — nur Belege, nichts erfinden.
 */
export async function enrichHotelStaysForAmenityNeeds(
  stays: HotelLiveStay[],
  needs: HotelAmenityNeed[],
  city: string,
  signal?: AbortSignal,
): Promise<HotelLiveStay[]> {
  if (!needs.length || stays.length === 0) return stays;
  const thin = stays.filter(
    (s) =>
      !s.amenities?.length ||
      !needs.every((n) => n.evidence.test((s.amenities ?? []).join(' '))),
  );
  if (!thin.length) return stays;

  try {
    const { fetchPlacePitchDetails } = await import(
      '../navigation/placePitchDetails'
    );
    const sample = thin.slice(0, 12);
    const enriched = await Promise.all(
      sample.map(async (s) => {
        try {
          const lat = s.lat ?? undefined;
          const lng = s.lng ?? undefined;
          const details = await fetchPlacePitchDetails({
            query: `${s.name} ${city} hotel`.trim(),
            lat: lat ?? 0,
            lng: lng ?? 0,
            signal,
            includeAtmosphere: true,
          });
          if (!details) return s;
          const evidence = [
            details.editorialSummary,
            details.generativeSummary,
            ...details.reviews.map((r) => r.text),
            details.types.join(' '),
          ]
            .filter(Boolean)
            .join('\n');
          return mergeAmenityEvidence(s, evidence);
        } catch {
          return s;
        }
      }),
    );
    const byId = new Map(enriched.map((s) => [s.id, s]));
    return stays.map((s) => byId.get(s.id) ?? s);
  } catch {
    return stays;
  }
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
  // Extra Spa-/Board-Details aus Evidenz
  if (/\bjacuzzi|whirlpool|hot\s*tub\b/i.test(blob) && !found.some((a) => /jacuzzi|whirl/i.test(a))) {
    found.push('Jacuzzi');
  }
  if (/\bdampfbad|steam\b/i.test(blob) && !found.some((a) => /dampf|steam/i.test(a))) {
    found.push('Dampfbad');
  }
  if (/\bmassagen?\b/i.test(blob) && !found.some((a) => /massage/i.test(a))) {
    found.push('Massage');
  }
  if (
    /\ball[\s-]*inclusive\b|\ballinclusive\b/i.test(blob) &&
    !found.some((a) => /all[\s-]*inclusive|allinclusive/i.test(a))
  ) {
    found.push('All-inclusive');
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
