/**
 * Karten-Modell für Reisevorschläge — Struktur, kein Vorlese-Skript.
 */

import type { FactThumb, MustHaveId, ReiseLedger } from '../types';
import type { SeedPlace as Place } from './candidates';

export function matchScore(input: {
  gaps: number;
  wanted: number;
  met: number;
  budgetDeltaEur: number | null;
}): number {
  let score = 88;
  score += Math.min(10, input.met * 3);
  score -= input.gaps * 7;
  if (input.wanted > 0) {
    score += Math.round((input.met / input.wanted) * 8);
  }
  if (input.budgetDeltaEur != null) {
    if (input.budgetDeltaEur <= 0) score += 4;
    else score -= Math.min(18, Math.round(input.budgetDeltaEur / 40));
  }
  return Math.max(58, Math.min(99, score));
}

export function tripNickname(
  place: Place,
  stayName: string | null,
  ledger: ReiseLedger,
  overnight: boolean,
): string {
  const short = shortenPlace(place.name);
  if (!overnight) return `${short} Tagestrip`;
  const stay = (stayName || '').trim();
  const must = new Set(ledger.mustHaves?.value ?? []);
  if (/villa/i.test(stay)) return `${short} ${clipStay(stay, 'Villa')}`;
  if (/loft/i.test(stay)) return `${short} ${clipStay(stay, 'Loft')}`;
  if (must.has('pool') && (place.tags.includes('sand') || place.tags.includes('sea'))) {
    return `${short} Pool-Haus`;
  }
  if (must.has('ferienhaus')) return `${short} Ferienhaus`;
  if (place.tags.includes('sand')) return `${short} Strand-Haus`;
  if (stay) return `${short} ${clipStay(stay, 'Unterkunft')}`;
  return `${short} Unterkunft`;
}

function shortenPlace(name: string): string {
  const cut = name.replace(/\s*\(.*\)\s*/g, '').trim();
  if (cut.length <= 18) return cut;
  return cut.split(/[\s-]/)[0] || cut.slice(0, 16);
}

function clipStay(stay: string, fallback: string): string {
  const cleaned = stay.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const words = cleaned.split(' ').slice(0, 3).join(' ');
  return words.length <= 22 ? words : fallback;
}

const FACT_EMOJI: Record<MustHaveId, { emoji: string; label: string }> = {
  sand: { emoji: '🏖️', label: 'Sandstrand' },
  pool: { emoji: '🏊', label: 'Pool' },
  sea: { emoji: '🌊', label: 'Meer' },
  warm: { emoji: '☀️', label: 'Warm' },
  grill: { emoji: '🍖', label: 'Grill' },
  boat: { emoji: '🚤', label: 'Boot' },
  rental_car: { emoji: '🚗', label: 'Mietwagen' },
  padel: { emoji: '🎾', label: 'Padel' },
  paddle: { emoji: '🛶', label: 'Paddeln' },
  spikeball: { emoji: '🏐', label: 'Spikeball' },
  party: { emoji: '🍻', label: 'Kneipen' },
  ferienhaus: { emoji: '🏡', label: 'Ferienhaus' },
  apartment: { emoji: '🔑', label: 'Wohnung' },
  hotel: { emoji: '🏨', label: 'Hotel' },
  camping: { emoji: '⛺', label: 'Camping' },
  vegan: { emoji: '🌱', label: 'Vegan' },
  view: { emoji: '🌅', label: 'Ausblick' },
  no_carpet: { emoji: '🚫', label: 'Ohne Teppich' },
  spa: { emoji: '🧖', label: 'Spa' },
  sauna: { emoji: '♨️', label: 'Sauna' },
  massage: { emoji: '💆', label: 'Massage' },
  tennis: { emoji: '🎾', label: 'Tennis' },
  wine: { emoji: '🍷', label: 'Wein' },
  cruise: { emoji: '🛳️', label: 'Kreuzfahrt' },
  kids_club: { emoji: '🧒', label: 'Kids-Club' },
  adult_only: { emoji: '🔞', label: 'Adult-only' },
  riding: { emoji: '🐴', label: 'Reiten' },
  parking: { emoji: '🅿️', label: 'Parkplatz' },
  baby_bed: { emoji: '🍼', label: 'Babybett' },
  breakfast: { emoji: '🥐', label: 'Frühstück' },
  half_board: { emoji: '🍽️', label: 'Halbpension' },
  quiet: { emoji: '🤫', label: 'ruhig' },
  short_transfer: { emoji: '🚐', label: 'kurzer Transfer' },
  small_hotel: { emoji: '🏡', label: 'kleineres Hotel' },
};

export function buildFacts(input: {
  place: Place;
  ledger: ReiseLedger;
  gaps: string[];
  stayAmenities?: string;
}): FactThumb[] {
  const must = input.ledger.mustHaves?.value ?? [];
  const gapBlob = input.gaps.join(' ').toLowerCase();
  const amen = (input.stayAmenities || '').toLowerCase();
  const tags = new Set(input.place.tags);
  const out: FactThumb[] = [];
  for (const id of must) {
    const meta = FACT_EMOJI[id];
    if (!meta) continue;
    out.push({
      id,
      emoji: meta.emoji,
      label: meta.label,
      met: factMet(id, tags, amen, gapBlob),
    });
  }
  return out;
}

function factMet(
  id: MustHaveId,
  tags: Set<string>,
  amen: string,
  gapBlob: string,
): boolean {
  if (id === 'sand') return tags.has('sand');
  if (id === 'sea') return tags.has('sea') || tags.has('ostsee') || tags.has('nordsee');
  if (id === 'warm') return tags.has('warm') || tags.has('griechenland');
  if (id === 'pool') return /pool/.test(amen) && !/pool/.test(gapBlob);
  if (id === 'ferienhaus' || id === 'apartment') return true;
  if (id === 'party') return tags.has('party') || tags.has('city');
  if (id === 'padel' || id === 'paddle' || id === 'spikeball') return !gapBlob.includes(id === 'paddle' ? 'padel' : id);
  if (id === 'grill' || id === 'boat') return false;
  if (id === 'rental_car') return true;
  return !gapBlob.includes(id);
}

export function whyBlurb(facts: FactThumb[], place: Place, hours: number): string {
  const met = facts.filter((f) => f.met).map((f) => f.label);
  const missed = facts.filter((f) => !f.met).map((f) => f.label);
  const bits: string[] = [];
  if (met.length) bits.push(met.slice(0, 3).join(' + '));
  if (place.tags.includes('sand') && !met.includes('Sandstrand')) bits.push('Strandlage');
  if (!bits.length) bits.push(`erreichbar in ca. ${hours.toFixed(1)} h`);
  let text = bits.join(', ');
  if (missed.length) text += ` — Abstrich: ${missed.slice(0, 2).join(', ')}`;
  return text;
}

export function perPersonPrice(totalEur: number | null, adults: number): number | null {
  if (totalEur == null || adults < 1) return null;
  return Math.round(totalEur / adults);
}

export function restBudget(
  budgetEur: number | null,
  totalEur: number | null,
  ledger: ReiseLedger,
): { eur: number; hint: string } | null {
  if (budgetEur == null || totalEur == null) return null;
  const rest = Math.round(budgetEur - totalEur);
  if (rest <= 0) return { eur: 0, hint: 'Budget ausgereizt' };
  const must = new Set(ledger.mustHaves?.value ?? []);
  const hint = must.has('party') ? 'Kneipen' : must.has('boat') ? 'Boot' : 'Puffer';
  return { eur: rest, hint };
}

export function priceIncludesLine(overnight: boolean, hasStayPrice: boolean, mode: string | undefined): string | null {
  if (overnight && hasStayPrice) {
    if (mode === 'fly') return 'inkl. Unterkunft (Flug extra)';
    if (mode === 'drive' || mode === 'daytrip') return 'inkl. Unterkunft';
    return 'inkl. Unterkunft';
  }
  if (!overnight) return 'Anfahrt grob';
  return null;
}
