/**
 * Shortlist-Trichter: Top~10 Orte → Budget-Gate → User-Taste → Final 4.
 * Struktur-Blaupause, keine Pflicht-Sätze / Orts-Scripts.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import type { SeedPlace } from './candidates';
import {
  isPartyLedger,
  isSpaLedger,
  metroKey,
  pickFinalOptions,
} from './diversity';

export type IntentArc =
  | 'party'
  | 'spa'
  | 'beach'
  | 'scenic'
  | 'city'
  | 'roadtrip'
  | 'event'
  | 'open';

export function intentArcFromLedger(ledger: ReiseLedger): IntentArc {
  if (
    ledger.discoverIntent?.value === 'event_compare' ||
    (ledger.intentNotes?.value ?? []).some((x) => /Event-Hook:/i.test(x))
  ) {
    return 'event';
  }
  if (isPartyLedger(ledger)) return 'party';
  if (isSpaLedger(ledger)) return 'spa';
  const must = new Set([
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]);
  if (must.has('sand') || must.has('sea')) return 'beach';
  if (
    ledger.discoverIntent?.value === 'lonely_beach' ||
    ledger.discoverIntent?.value === 'adventure_hike' ||
    /kulisse|aussicht|geheim|malerei|berge|natur/i.test(
      `${ledger.highlightWant?.value || ''} ${ledger.purpose?.value || ''}`,
    )
  ) {
    return 'scenic';
  }
  if (
    /indien|india|roadtrip|durch\s+\w+|rundreise|hop|multi/i.test(
      `${ledger.destinationHint?.value || ''} ${ledger.corridor?.value || ''} ${ledger.tripShape?.value || ''} ${ledger.purpose?.value || ''}`,
    )
  ) {
    return 'roadtrip';
  }
  if (must.has('party') === false && /stadt|city/i.test(ledger.purpose?.value || '')) {
    return 'city';
  }
  return 'open';
}

export function shortlistSearchBrief(ledger: ReiseLedger): string {
  const arc = intentArcFromLedger(ledger);
  const dest = (ledger.destinationHint?.value || ledger.corridor?.value || '').trim();
  const budget = ledger.budgetEur?.value;
  const budgetBit = budget != null ? `Budget ca. ${budget} €` : 'Budget offen';
  if (arc === 'party') {
    return `beste Party-/Nightlife-Destinationen ${dest} ${budgetBit} — diverse Städte, User-Fit vor „Weltbesten“`.trim();
  }
  if (arc === 'spa') {
    return `beste Spa-/Wellness-Hotels Orte ${dest} ${budgetBit}`.trim();
  }
  if (arc === 'beach') {
    return `beste Strand-/Beach-Destinationen ${dest} ${budgetBit}`.trim();
  }
  if (arc === 'scenic') {
    return `Geheimtipps Kulisse Aussicht Must-sees ${dest} ${budgetBit} — auch weniger bekannte Orte wenn belegt`.trim();
  }
  if (arc === 'roadtrip') {
    return `Must-have Stops Route ${dest || 'genannte Region'} günstige Reihenfolge Stopover ${budgetBit}`.trim();
  }
  if (arc === 'event') {
    return `Event-Orte vergleichen ${dest} ${budgetBit} — Flug+Stay je Host, Gesamtpaket`.trim();
  }
  return `passende Destinationen ${dest} ${budgetBit}`.trim();
}

/** User-Geschmack aus Inspiration/Highlight/Corridor — Malle-Fan ≠ Ibiza-Zwang. */
export function tasteTokens(ledger: ReiseLedger): string[] {
  const raw = [
    ledger.inspiration?.value,
    ledger.highlightWant?.value,
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.purpose?.value,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tokens: string[] = [];
  if (/malle|mallorca|magaluf|ballermann|palma/.test(raw)) tokens.push('mallorca');
  if (/ibiza/.test(raw)) tokens.push('ibiza');
  if (/budapest/.test(raw)) tokens.push('budapest');
  if (/prag|prague/.test(raw)) tokens.push('prag');
  if (/berlin/.test(raw)) tokens.push('berlin');
  if (/amsterdam/.test(raw)) tokens.push('amsterdam');
  if (/griechen|kreta|korfu|naxos|mykonos/.test(raw)) tokens.push('griechenland');
  if (/spa|wellness|thermal/.test(raw)) tokens.push('spa');
  if (/party|feier|club|disco/.test(raw)) tokens.push('party');
  if (/geheim|tipp|einsam|wenig tourist/.test(raw)) tokens.push('geheim');
  return tokens;
}

export function tasteAffinityScore(
  placeName: string,
  tags: string[] | undefined,
  ledger: ReiseLedger,
): number {
  const tokens = tasteTokens(ledger);
  if (!tokens.length) return 0;
  const metro = metroKey(placeName);
  const tagSet = new Set((tags || []).map((t) => t.toLowerCase()));
  let score = 0;
  for (const t of tokens) {
    if (t === metro) score += 14;
    if (t === 'mallorca' && metro === 'mallorca') score += 16;
    if (t === 'ibiza' && metro === 'ibiza') score += 16;
    // Explizit Malle-Fan → Ibiza nicht als „besser“ pushen
    if (t === 'mallorca' && metro === 'ibiza') score -= 18;
    if (t === 'ibiza' && metro === 'mallorca') score -= 10;
    if (tagSet.has(t)) score += 6;
  }
  return score;
}

export function applyTasteBoost(options: ReiseOption[], ledger: ReiseLedger): void {
  for (const o of options) {
    const boost = tasteAffinityScore(o.placeName, undefined, ledger);
    if (boost) {
      o.matchScore = Math.max(40, Math.min(99, o.matchScore + Math.round(boost / 2)));
      const notes = o.decisionNotes ?? (o.decisionNotes = []);
      if (boost >= 10) {
        notes.push('Passt zu deinem Geschmack / Inspiration');
      } else if (boost <= -8) {
        notes.push('Stark, aber weniger dein Stil — deshalb eher Alternative');
      }
    }
    if (o.dealHit) {
      o.matchScore = Math.min(99, o.matchScore + (ledger.dealHunt?.value ? 8 : 5));
      const notes = o.decisionNotes ?? (o.decisionNotes = []);
      if (!notes.some((n) => /Schnäppchen|Preisfehler|Deal/i.test(n))) {
        notes.push(
          ledger.dealHunt?.value
            ? 'Deal-Hunt: Preisfehler/Hit erkannt'
            : 'Schnäppchen vs. Vergleichspreise',
        );
      }
    }
    const gemBlob = `${o.whyBlurb || ''} ${(o.decisionNotes ?? []).join(' ')}`.toLowerCase();
    if (/geheim|exklusiv|exclusive/.test(gemBlob)) {
      o.matchScore = Math.min(99, o.matchScore + 3);
    }
  }
}

/**
 * Utopische Preise raus / ans Ende: über Budget-Cap klar → abwerten.
 * Soft: behalten für Transparenz, aber Final-4 bevorzugt Fit.
 */
export function budgetGateRank(options: ReiseOption[], ledger: ReiseLedger): ReiseOption[] {
  const budget = ledger.budgetEur?.value;
  if (budget == null || budget <= 0) {
    return [...options].sort((a, b) => b.matchScore - a.matchScore);
  }
  const adults = Math.max(1, ledger.adults?.value ?? 2);
  // budgetEur ist typisch p.P. im Brief — Buy-in vergleichen
  const cap = budget * 1.35;
  return [...options]
    .map((o) => {
      const pp = o.buyInEur ?? o.pricePerPerson ?? null;
      const total = o.totalEur;
      let delta: number | null = null;
      if (pp != null) delta = pp - budget;
      else if (total != null) delta = total / adults - budget;
      if (delta != null && delta > budget * 0.5) {
        o.matchScore = Math.max(38, o.matchScore - 18);
        const notes = o.decisionNotes ?? (o.decisionNotes = []);
        if (!notes.some((n) => /Budget/i.test(n))) {
          notes.push('Preis eher utopisch vs. Budget');
        }
      } else if (delta != null && delta <= 0) {
        o.matchScore = Math.min(99, o.matchScore + 4);
      }
      return { o, utopian: delta != null && delta > budget * 0.5, overCap: pp != null && pp > cap };
    })
    .sort((a, b) => {
      if (a.utopian !== b.utopian) return a.utopian ? 1 : -1;
      if (a.overCap !== b.overCap) return a.overCap ? 1 : -1;
      return b.o.matchScore - a.o.matchScore;
    })
    .map((x) => x.o);
}

export type ShortlistPick = {
  finalists: ReiseOption[];
  shortlist: ReiseOption[];
  cutReason: string;
};

/**
 * Alle Shortlist-Optionen durch — dann 4 Finalisten (divers + Taste + Budget).
 */
export function pickFromShortlist(
  options: ReiseOption[],
  ledger: ReiseLedger,
  n = 4,
): ShortlistPick {
  applyTasteBoost(options, ledger);
  const shortlist = budgetGateRank(options, ledger);
  const viable = shortlist.filter((o) => {
    const note = (o.decisionNotes ?? []).join(' ');
    return !/utopisch/i.test(note) || o.matchScore >= 70;
  });
  const pool = viable.length >= n ? viable : shortlist;
  const finalists = pickFinalOptions(pool, ledger, n);
  const arc = intentArcFromLedger(ledger);
  const constrained =
    ledger.discoverIntent?.value === 'event_compare' ||
    (ledger.intentNotes?.value ?? []).some((x) => /Event-Hook:/i.test(x));
  const cutReason =
    constrained
      ? shortlist.length <= n
        ? `${finalists.length} Event-Orte mit Flug+Stay verglichen`
        : `Aus ${shortlist.length} Event-Orten ${finalists.length} Gesamtpakete — Anreise+Stay entscheiden`
      : shortlist.length <= n
        ? `${finalists.length} starke Treffer — Shortlist war schon klein`
        : `Aus ${shortlist.length} geprüften Orten ${finalists.length} Finalisten (Preis-Leistung + ${arc}-Fit)`;
  for (let i = 0; i < finalists.length; i++) {
    const o = finalists[i]!;
    const notes = o.decisionNotes ?? (o.decisionNotes = []);
    notes.unshift(`Finalist ${i + 1}/${finalists.length} · Shortlist ${shortlist.length}`);
  }
  return { finalists, shortlist, cutReason };
}

export function prioritizeSeedsByTaste(
  places: SeedPlace[],
  ledger: ReiseLedger,
): SeedPlace[] {
  return [...places].sort((a, b) => {
    const ta = tasteAffinityScore(a.name, a.tags, ledger);
    const tb = tasteAffinityScore(b.name, b.tags, ledger);
    return tb - ta;
  });
}

export function isLongTrip(ledger: ReiseLedger): boolean {
  const nights = ledger.stayNights?.value ?? ledger.stayDays?.value ?? 0;
  const maxN = ledger.stayNightsMax?.value ?? 0;
  return nights >= 10 || maxN >= 14 || /wochen|3\s*wochen|rundreise/i.test(ledger.tripShape?.value || '');
}

/** Kurze Taste-Zeile für Pro-Prompts (kein Script). */
export function tastePromptBits(ledger: ReiseLedger): string {
  const bits = [
    ledger.inspiration?.value ? `Inspiration: ${ledger.inspiration.value}` : '',
    ledger.highlightWant?.value && ledger.highlightWant.value !== 'keine'
      ? `Highlight: ${ledger.highlightWant.value}`
      : '',
    ledger.destinationHint?.value ? `Genannt: ${ledger.destinationHint.value}` : '',
    ledger.partyStyle?.value ? `Party-Stil: ${ledger.partyStyle.value}` : '',
    tasteTokens(ledger).length ? `Taste-Keys: ${tasteTokens(ledger).join(',')}` : '',
  ].filter(Boolean);
  return bits.join(' · ').slice(0, 220);
}
