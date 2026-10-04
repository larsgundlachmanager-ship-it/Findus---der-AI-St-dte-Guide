/**
 * Gemeinsame Paket-Wirbelsäule: Legs → Buy-in → Breakdown → Checklist → DayHints.
 * Eine Math-SSOT für Cruise / Ferry / Rail / Fly-Stay / Compounds.
 */

import type {
  BookingCheckItem,
  DayPlan,
  PriceBreakdownLine,
  ReiseLedger,
} from '../types';
import { isCruiseLedger } from './cruisePlan';

export type AccessLegKind =
  | 'flight'
  | 'train'
  | 'bus'
  | 'ferry'
  | 'cruise'
  | 'transfer'
  | 'stay'
  | 'car'
  | 'drink_pkg'
  | 'other';

export type AccessLeg = {
  id: string;
  kind: AccessLegKind;
  label: string;
  /** Betrag in €; null = unbelegt. */
  amountEur: number | null;
  /** p.P. wird × adults; group/total bleibt. */
  scope: 'per_person' | 'group' | 'total';
  bookUrl?: string | null;
  departAt?: string | null;
  arriveAt?: string | null;
  latestBoardAt?: string | null;
  notes?: string | null;
  /** Wenn true: ohne diesen Leg kein fertiges Buy-in (z. B. Kabine). */
  requiredForBuyIn?: boolean;
};

export type PackageBlueprintId =
  | 'cruise'
  | 'ferry_island'
  | 'rail_day'
  | 'rail_night'
  | 'bus'
  | 'fly_stay'
  | 'fly_rail'
  | 'fly_ferry'
  | 'drive_ferry'
  | 'road'
  | 'camping'
  | 'route_tour';

export function composePackageBuyIn(
  legs: AccessLeg[],
  adults: number,
): {
  buyInEur: number | null;
  totalPackage: number | null;
  buyInLabel: string;
  missingRequired: string[];
} {
  const n = Math.max(1, adults);
  const missingRequired = legs
    .filter((l) => l.requiredForBuyIn && !(l.amountEur != null && l.amountEur > 0))
    .map((l) => l.label);

  let flightPp = 0;
  let groupSum = 0;
  for (const leg of legs) {
    if (leg.amountEur == null || !(leg.amountEur > 0)) continue;
    if (leg.scope === 'per_person') flightPp += leg.amountEur;
    else groupSum += leg.amountEur;
  }
  const viaLabel =
    'p.P. = (Anreise×Pers. + Unterkunft + Transfer + Mietwagen) ÷ Pers. — ohne Tickets/Extras';
  const total = Math.round(flightPp * n + groupSum);
  if (total <= 0 || missingRequired.length) {
    return {
      buyInEur: null,
      totalPackage: total > 0 ? total : null,
      buyInLabel:
        'p.P. = Summe belegter Zeilen ÷ Pers. — Hauptleg fehlt → kein fertiges Buy-in',
      missingRequired,
    };
  }
  return {
    buyInEur: Math.round(total / n),
    totalPackage: total,
    buyInLabel: viaLabel,
    missingRequired: [],
  };
}

/** Wenn required fehlen: buyIn null, partial total optional für Transparenz. */
export function finalizeBuyInGate(
  composed: ReturnType<typeof composePackageBuyIn>,
): ReturnType<typeof composePackageBuyIn> {
  if (composed.missingRequired.length) {
    return {
      ...composed,
      buyInEur: null,
      buyInLabel: `Buy-in offen — fehlt: ${composed.missingRequired.slice(0, 3).join(', ')}`,
    };
  }
  return composed;
}

export function legsToPriceBreakdown(
  legs: AccessLeg[],
  buyInEur: number | null,
): PriceBreakdownLine[] {
  const lines: PriceBreakdownLine[] = legs
    .filter((l) => l.amountEur != null && l.amountEur > 0)
    .map((l) => ({
      id: l.id,
      label: l.label,
      amountEur: l.amountEur,
      scope: l.scope === 'total' ? 'total' : l.scope,
    }));
  if (buyInEur != null && buyInEur > 0) {
    lines.push({
      id: 'buyin',
      label: 'Buy-in p.P.',
      amountEur: buyInEur,
      scope: 'total',
    });
  }
  return lines;
}

function bookingKindForLeg(
  kind: AccessLegKind,
): BookingCheckItem['kind'] {
  switch (kind) {
    case 'flight':
      return 'flight';
    case 'train':
      return 'train';
    case 'ferry':
      return 'ferry';
    case 'cruise':
      return 'cruise';
    case 'stay':
      return 'stay';
    case 'transfer':
      return 'transfer';
    case 'car':
      return 'car';
    case 'drink_pkg':
      return 'package';
    default:
      return 'other';
  }
}

export function legsToBookingChecklist(legs: AccessLeg[]): BookingCheckItem[] {
  const items: BookingCheckItem[] = [];
  for (const leg of legs) {
    if (!leg.bookUrl && leg.kind !== 'cruise' && leg.kind !== 'ferry') continue;
    items.push({
      id: `book-${leg.id}`,
      label: leg.label,
      url: leg.bookUrl ?? null,
      kind: bookingKindForLeg(leg.kind),
      clickedAtMs: null,
    });
  }
  return items;
}

/** Einfache Tagesblöcke aus Legs mit Zeit-Hinweisen (Adapter können reichere Days liefern). */
export function legsToSimpleDayPlans(
  legs: AccessLeg[],
  dayKey: string,
  title: string,
): DayPlan[] {
  return [
    {
      dayKey,
      title,
      blocks: legs.map((l) => ({
        id: l.id,
        title: l.label,
        detail: l.notes || l.latestBoardAt ? `Spätestens: ${l.latestBoardAt}` : l.kind,
        time: l.departAt || l.latestBoardAt || undefined,
        costEur: l.amountEur,
        bookUrl: l.bookUrl,
      })),
    },
  ];
}

export function packageGapMessage(blueprint: PackageBlueprintId, missing: string[]): string {
  if (!missing.length) return '';
  if (blueprint === 'cruise' || blueprint === 'fly_ferry') {
    return `Kreuzfahrt/Fähre: ${missing[0]} noch belegen`;
  }
  if (blueprint.startsWith('rail')) return `Bahn: ${missing[0]} noch belegen`;
  return `${missing[0]} noch belegen`;
}

export function incompleteBuyInUiHint(
  ledger: ReiseLedger,
  gaps: string[],
): string {
  if (isCruiseLedger(ledger) || ledger.tripShape?.value === 'ferry') {
    const hit = gaps.find((g) => /kreuzfahrt|fähre|kabine|einschiff/i.test(g));
    return hit || 'Kreuzfahrt-/Fährpreis oder Zeiten noch belegen — kein fertiges Buy-in.';
  }
  if (ledger.mode?.value === 'train' || ledger.railFlex) {
    return 'Bahnpreis noch belegen — Anreise allein ist kein Paketpreis.';
  }
  return 'Unterkunft fehlt noch — Flug/Transfer allein ist kein Paketpreis.';
}
