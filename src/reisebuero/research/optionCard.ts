/**
 * Karten-Modell für Reisevorschläge — Struktur, kein Vorlese-Skript.
 */

import type { FactThumb, MustHaveId, ReiseLedger } from '../types';
import type { SeedPlace as Place } from './candidates';

/** Echter Fit: Hard/Soft/Budget — unvollständige Pakete nicht auf 90–99% pushen. */
export function matchScore(input: {
  hardWanted: number;
  hardMet: number;
  softWanted: number;
  softMet: number;
  nogoHits: number;
  budgetDeltaEur: number | null;
  boost?: number;
  /** Overnight ohne Stay-Buy-in → starker Malus */
  incompletePackage?: boolean;
}): number {
  let score = 48;
  if (input.hardWanted > 0) {
    score += Math.round((input.hardMet / input.hardWanted) * 28);
  } else {
    score += 8;
  }
  if (input.softWanted > 0) {
    score += Math.round((input.softMet / input.softWanted) * 12);
  }
  score -= Math.min(20, input.nogoHits * 10);
  if (input.budgetDeltaEur != null) {
    if (input.budgetDeltaEur <= 0) score += 6;
    else score -= Math.min(22, Math.round(input.budgetDeltaEur / 35));
  }
  score += Math.max(-8, Math.min(8, input.boost ?? 0));
  if (input.incompletePackage) score -= 22;
  return Math.max(35, Math.min(96, Math.round(score)));
}

export function fitLine(input: {
  hardWanted: number;
  hardMet: number;
  softBits: string[];
  gaps: string[];
}): string {
  const bits: string[] = [];
  if (input.hardWanted > 0) {
    bits.push(
      input.hardMet >= input.hardWanted
        ? 'Pflicht erfüllt'
        : `${input.hardMet}/${input.hardWanted} Pflicht`,
    );
  }
  bits.push(...input.softBits.slice(0, 2));
  void input.gaps;
  return bits.join(' · ') || 'passt zum Brief';
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
  const stayBit = stay ? clipStay(stay, '') : '';
  const purpose = (ledger.purpose?.value || '').trim();
  if (purpose.length >= 3 && stay) {
    return `${clipStay(purpose, purpose)} · ${clipStay(stay, '')}`.slice(0, 44);
  }
  if (stay) return `${short} · ${stayBit}`.slice(0, 44);
  const must = new Set(ledger.mustHaves?.value ?? []);
  if (must.has('pool') && (place.tags.includes('sand') || place.tags.includes('sea'))) {
    return `${short} Pool-Haus`;
  }
  if (must.has('ferienhaus')) return `${short} Ferienhaus`;
  if (place.tags.includes('sand')) return `${short} Strand-Haus`;
  if (purpose.length >= 3) return `${clipStay(purpose, purpose)} · ${short}`.slice(0, 44);
  return `${short} Unterkunft`;
}

/** Jede Option bekommt einen eigenen Match-Score — keine Duplikate, Favorit bleibt oben. */
export function uniquifyMatchScores<T extends { matchScore: number }>(options: T[]): T[] {
  const used = new Set<number>();
  return options.map((o, i) => {
    let s = Math.max(35, Math.min(96, Math.round(o.matchScore)));
    if (i > 0) {
      while (used.has(s) && s > 36) s -= 1;
    }
    used.add(s);
    return { ...o, matchScore: s };
  });
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
  party: { emoji: '🎉', label: 'Party / Nightlife' },
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
  ferry: { emoji: '⛴️', label: 'Fähre' },
  river_cruise: { emoji: '🏞️', label: 'Flusskreuzfahrt' },
  water_slide: { emoji: '💦', label: 'Wasserrutsche' },
  paddle_board: { emoji: '🏄', label: 'Paddel an Bord' },
  culinary: { emoji: '🍽️', label: 'Kulinarik' },
  kids_club: { emoji: '🧒', label: 'Kids-Club' },
  teens_club: { emoji: '🧑', label: 'Teens-Club' },
  running_track: { emoji: '🏃', label: 'Laufbahn' },
  seniors: { emoji: '🧓', label: 'Senioren-Tempo' },
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
  stayName?: string;
}): FactThumb[] {
  const must = input.ledger.mustHaves?.value ?? [];
  const gapBlob = input.gaps.join(' ').toLowerCase();
  const amen = `${input.stayAmenities || ''} ${input.stayName || ''}`.toLowerCase();
  const tags = new Set(input.place.tags);
  const out: FactThumb[] = [];
  for (const id of must) {
    const meta = FACT_EMOJI[id];
    if (!meta) continue;
    out.push({
      id,
      emoji: meta.emoji,
      label: meta.label,
      met: factMet(id, tags, amen, gapBlob, input.ledger),
    });
  }
  return out;
}

export function buildSoftFacts(input: {
  place: Place;
  ledger: ReiseLedger;
  gaps: string[];
  stayAmenities?: string;
  stayName?: string;
}): FactThumb[] {
  const out: FactThumb[] = [];
  const tags = new Set(input.place.tags);
  const gapBlob = input.gaps.join(' ').toLowerCase();
  const amen = `${input.stayAmenities || ''} ${input.stayName || ''}`.toLowerCase();
  const stay = (input.stayName || '').toLowerCase();
  if (input.ledger.cheapDrinks?.value) {
    const cheapHint =
      tags.has('party') || tags.has('city') || /bier|drink|günstig/i.test(gapBlob);
    out.push({
      id: 'cheap_drinks',
      emoji: '🍺',
      label: 'günstiges Bier',
      met: cheapHint && !/teuer|partymeile/i.test(gapBlob),
    });
  }
  if (input.ledger.meals?.value === 'all') {
    const aiHint =
      /all[\s-]?inclusive|ultra\s*all|alles\s+inklusive|pauschal/.test(`${amen} ${stay}`) ||
      /all.?inclusive belegt/i.test(gapBlob);
    out.push({
      id: 'meals_ai',
      emoji: '🍽️',
      label: 'All Inclusive',
      met: aiHint,
    });
  }
  if (
    input.ledger.mustHaves?.value?.includes('spa') ||
    input.ledger.wishHaves?.value?.includes('spa') ||
    /spa|wellness/i.test(input.ledger.purpose?.value ?? '') ||
    input.ledger.spaStyle?.value
  ) {
    out.push({
      id: 'spa',
      emoji: '🧖',
      label: 'Spa',
      met: tags.has('spa') || /spa|wellness|thermal/i.test(amen),
    });
  }
  if (input.ledger.partyGrain?.value === 'private_house') {
    out.push({
      id: 'party_private',
      emoji: '🏡',
      label: 'Party privat',
      met: !tags.has('party') || Boolean(input.ledger.dealbreaker?.value?.match(/partymeile/i)),
    });
  }
  if (input.ledger.weatherWant?.value === 'warm') {
    out.push({
      id: 'warm',
      emoji: '☀️',
      label: 'Warm',
      met: tags.has('warm') || tags.has('griechenland') || tags.has('sea'),
    });
  }
  const wish = input.ledger.wishHaves?.value ?? [];
  for (const id of wish.slice(0, 4)) {
    if (id === 'spa' && out.some((f) => f.id === 'spa')) continue;
    const meta = FACT_EMOJI[id];
    if (!meta) continue;
    out.push({
      id: `wish_${id}`,
      emoji: meta.emoji,
      label: meta.label,
      met: factMet(id, tags, amen, gapBlob, input.ledger),
    });
  }
  return out;
}

function factMet(
  id: MustHaveId,
  tags: Set<string>,
  amen: string,
  gapBlob: string,
  ledger?: ReiseLedger,
): boolean {
  if (id === 'sand') return tags.has('sand');
  if (id === 'sea') return tags.has('sea') || tags.has('ostsee') || tags.has('nordsee');
  if (id === 'warm') return tags.has('warm') || tags.has('griechenland');
  if (id === 'pool') return /pool|schwimm/.test(amen) && !/pool nicht|must-fail:\s*pool/i.test(gapBlob);
  if (id === 'tennis') return /tennis/.test(amen) && !/must-fail:\s*tennis/i.test(gapBlob);
  if (id === 'padel') return /padel/.test(amen) && !/must-fail:\s*padel/i.test(gapBlob);
  if (id === 'sauna') return /sauna/.test(amen) && !/must-fail:\s*sauna/i.test(gapBlob);
  if (id === 'spa') return /spa|wellness|thermal/.test(amen) || tags.has('spa');
  if (id === 'parking') return /parking|parkplatz|garage|stellplatz/.test(amen);
  if (id === 'grill') return /grill|bbq|barbecue/.test(amen);
  if (id === 'ferienhaus' || id === 'apartment') return true;
  if (id === 'party') {
    if (ledger?.partyGrain?.value === 'private_house') return true;
    return tags.has('party') || tags.has('city');
  }
  if (id === 'paddle' || id === 'spikeball') {
    return !gapBlob.includes(id === 'paddle' ? 'paddeln' : id);
  }
  if (id === 'boat') return false;
  if (id === 'rental_car') return true;
  return !/must-fail:/i.test(gapBlob) || !gapBlob.includes(id);
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
  const hint = ledger.cheapDrinks?.value
    ? 'Bier / Abend'
    : (ledger.mustHaves?.value ?? []).includes('boat')
      ? 'Boot'
      : 'Puffer';
  return { eur: rest, hint };
}

export function priceIncludesLine(
  overnight: boolean,
  hasStayPrice: boolean,
  mode: string | undefined,
  parts?: { hasFlight?: boolean; hasTransfer?: boolean; hasCar?: boolean },
): string | null {
  if (overnight && hasStayPrice) {
    const bits = ['Unterkunft'];
    if (parts?.hasFlight || mode === 'fly') bits.unshift('Flug Hin+Rück');
    if (parts?.hasTransfer) bits.push('Transfer Hin+Rück');
    if (parts?.hasCar) bits.push('Mietwagen');
    return `inkl. ${bits.join(', ')}`;
  }
  if (!overnight) return 'Anfahrt grob';
  return null;
}

/** Speech: eine Empfehlung pitchen — kein Doppel-Brief, kein Listen-Dump. */
export function speechTopTwoSummary(
  options: Array<{
    id?: string;
    title: string;
    placeName: string;
    matchScore: number;
    whyBlurb?: string;
    whyMatch?: string[];
    fitLine?: string | null;
    buyInEur?: number | null;
    speechSummary?: string | null;
    experienceSummary?: string | null;
  }>,
): string {
  const top = options.slice(0, 4);
  if (!top.length) return 'Ich hab gerade keine starken Treffer.';
  const fav = top[0]!;
  if (fav.speechSummary && fav.speechSummary.length >= 40) {
    return fav.speechSummary.replace(/\bBuy-in\b/gi, 'Preis').trim().slice(0, 800);
  }
  if (fav.experienceSummary && fav.experienceSummary.length >= 40) {
    const price =
      fav.buyInEur != null ? ` Für etwa ${fav.buyInEur} € pro Person.` : '';
    const cta = ' Aber schau dir gerne den genauen Plan an.';
    return `${fav.experienceSummary}${price}${cta}`.slice(0, 800);
  }
  const reason =
    (fav.whyMatch && fav.whyMatch[0]) ||
    fav.fitLine ||
    fav.whyBlurb?.split(/[.!]/)[0] ||
    'fühlt sich stark an';
  const price =
    fav.buyInEur != null ? ` Für etwa ${fav.buyInEur} € pro Person.` : '';
  return `Für den Trip würde ich nach ${fav.placeName} fahren — ${reason}.${price} Aber schau dir gerne den genauen Plan an.`.slice(
    0,
    800,
  );
}
