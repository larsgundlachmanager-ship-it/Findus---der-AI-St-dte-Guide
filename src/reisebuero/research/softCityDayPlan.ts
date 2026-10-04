/**
 * Soft-Stadt-Tagesplan (stadt-agnostisch): Anreise → mittlere Tage mit
 * groben Themenblöcken aus Brief-Vibe + optional Wish-Hints.
 * Keine Orts-Hardcodes — Titel/Detail aus Ledger + belegten Hints.
 */

import type { DayBlock, ReiseLedger } from '../types';

export type SoftDayTheme =
  | 'arrival_evening'
  | 'action'
  | 'explore'
  | 'party'
  | 'spa'
  | 'food'
  | 'wind_down';

function vibeBits(ledger: ReiseLedger): {
  party: boolean;
  spa: boolean;
  active: boolean;
  chill: boolean;
  food: boolean;
} {
  const blob = [
    ledger.purpose?.value,
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.energy?.value,
    ledger.partyGrain?.value,
    ledger.spaStyle?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ...(ledger.mustActivities?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return {
    party:
      ledger.partyGrain?.value === 'clubs' ||
      ledger.partyGrain?.value === 'bars' ||
      /\b(party|club|feier|nightlife|ruinenbar)\b/.test(blob),
    spa:
      Boolean(ledger.spaStyle?.value) ||
      /\b(spa|thermal|sauna|baden|whirl)\b/.test(blob),
    active:
      ledger.energy?.value === 'active_out' ||
      /\b(wandern|hike|klettern|action|sport|padel|boot)\b/.test(blob),
    chill:
      ledger.energy?.value === 'chill_pool' ||
      /\b(chill|pool|entspann|relax)\b/.test(blob),
    food: /\b(essen|food|kulinar|gastro|markt|street.?food)\b/.test(blob),
  };
}

/** Themen-Reihenfolge für mittlere Tage (ohne Anreise/Abreise). */
export function softThemesForTrip(ledger: ReiseLedger, middleCount: number): SoftDayTheme[] {
  const v = vibeBits(ledger);
  const cycle: SoftDayTheme[] = [];
  if (v.party) cycle.push('party');
  if (v.active) cycle.push('action');
  if (v.spa || v.chill) cycle.push('spa');
  if (v.food) cycle.push('food');
  cycle.push('explore');
  if (!v.party && v.chill) cycle.push('wind_down');
  if (!cycle.length) cycle.push('explore', 'action', 'food');
  const out: SoftDayTheme[] = [];
  for (let i = 0; i < Math.max(0, middleCount); i++) {
    out.push(cycle[i % cycle.length]!);
  }
  return out;
}

function hintTitle(hints: string[] | undefined, idx: number, fallback: string): string {
  const h = (hints ?? []).map((s) => String(s || '').trim()).filter(Boolean);
  return h[idx] || h[0] || fallback;
}

/**
 * Grobe Blöcke für einen Tag — keine Fake-Uhrzeiten außer Anreise-Hint.
 */
export function softBlocksForTheme(opts: {
  theme: SoftDayTheme;
  dayKey: string;
  placeName: string;
  ledger: ReiseLedger;
  wishHints?: string[];
  arriveHint?: string | null;
}): DayBlock[] {
  const place = (opts.placeName || 'Ziel').split(',')[0]!.trim();
  const hints = opts.wishHints;
  const id = (s: string) => `${opts.dayKey}-${s}`;

  switch (opts.theme) {
    case 'arrival_evening':
      return [
        {
          id: id('eve-food'),
          title: 'Abendessen lokal',
          detail: opts.arriveHint
            ? `Nach Ankunft (${opts.arriveHint}) — typisch vor Ort`
            : `Nach Check-in — typisch vor Ort in ${place}`,
          time: undefined,
        },
        {
          id: id('eve-warm'),
          title: vibeBits(opts.ledger).party ? 'Warm-up Bar / Club' : 'Stadtspaziergang am Abend',
          detail: vibeBits(opts.ledger).party
            ? hintTitle(hints, 0, 'Einstieg Nightlife — belegte Locations im Magazin')
            : hintTitle(hints, 0, `Erste Eindrücke in ${place}`),
        },
      ];
    case 'party':
      return [
        {
          id: id('day'),
          title: 'Tag: Stadt / Action',
          detail: hintTitle(hints, 0, `Tagsüber ${place} — leicht halten für den Abend`),
        },
        {
          id: id('night'),
          title: 'Abend: Feiern',
          detail: hintTitle(hints, 1, 'Club / Bar-Meile — Ticket nur wenn belegt'),
        },
      ];
    case 'action':
      return [
        {
          id: id('am'),
          title: 'Vormittag: Action',
          detail: hintTitle(hints, 0, 'Tour / Outdoor — nur belegte Angebote buchen'),
        },
        {
          id: id('pm'),
          title: 'Nachmittag / Abend',
          detail: hintTitle(
            hints,
            1,
            vibeBits(opts.ledger).spa
              ? 'Thermal / Bad oder entspannter Ausklang'
              : 'Freizeit nach Energie',
          ),
        },
      ];
    case 'spa':
      return [
        {
          id: id('spa'),
          title: 'Thermal / Spa',
          detail: hintTitle(hints, 0, 'Bad / Spa — Eintritt belegen'),
        },
        {
          id: id('eve'),
          title: 'Ruhiger Abend',
          detail: hintTitle(hints, 1, 'Essen in der Nähe, früher Schluss möglich'),
        },
      ];
    case 'food':
      return [
        {
          id: id('market'),
          title: 'Markt / Streetfood',
          detail: hintTitle(hints, 0, `Lokale Küche in ${place}`),
        },
        {
          id: id('view'),
          title: 'Aussicht oder Spaziergang',
          detail: hintTitle(hints, 1, 'Highlight-Punkt der Stadt'),
        },
      ];
    case 'wind_down':
      return [
        {
          id: id('slow'),
          title: 'Langsamer Tag',
          detail: hintTitle(hints, 0, 'Pool / Café / leichter Spaziergang'),
        },
        {
          id: id('dinner'),
          title: 'Abschluss-Essen',
          detail: hintTitle(hints, 1, 'Schönes Abendessen — kein Stress'),
        },
      ];
    case 'explore':
    default:
      return [
        {
          id: id('am'),
          title: 'Vormittag: Erkunden',
          detail: hintTitle(hints, 0, `Must-see / Altstadt in ${place}`),
        },
        {
          id: id('pm'),
          title: 'Nachmittag: Kontrast',
          detail: hintTitle(hints, 1, 'Park, Aussicht oder zweites Viertel'),
        },
        {
          id: id('eve'),
          title: 'Abend: Ausklang',
          detail: vibeBits(opts.ledger).party
            ? hintTitle(hints, 2, 'Bars / Nightlife dosiert')
            : hintTitle(hints, 2, 'Essen & früher Feierabend'),
        },
      ];
  }
}
