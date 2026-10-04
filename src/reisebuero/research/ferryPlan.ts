/**
 * Fähre / Insel — Blaupause auf tripPackageSpine.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import {
  composePackageBuyIn,
  finalizeBuyInGate,
  legsToBookingChecklist,
  legsToPriceBreakdown,
  type AccessLeg,
} from './tripPackageSpine';
import { isFerryLedger } from './packageBlueprint';

export function buildFerrySearchUrl(opts: {
  from?: string | null;
  to?: string | null;
  date?: string | null;
}): string {
  const q = ['Fähre', opts.from, opts.to ? `nach ${opts.to}` : '', opts.date || '']
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function enrichOptionAsFerryPlan(
  opt: ReiseOption,
  ledger: ReiseLedger,
  extras?: {
    ferryEur?: number | null;
    ferryUrl?: string | null;
    ferryReturnEur?: number | null;
    flightPerPersonEur?: number | null;
    stayEur?: number | null;
    carEur?: number | null;
  },
): ReiseOption {
  if (!isFerryLedger(ledger) && ledger.tripShape?.value !== 'ferry') {
    return opt;
  }
  const adults = Math.max(1, ledger.adults?.value ?? 2);
  const dest = ledger.destinationHint?.value || opt.placeName || 'Insel';
  const from = ledger.originCity?.value || 'Festland';
  const ferryUrl =
    extras?.ferryUrl ||
    buildFerrySearchUrl({
      from,
      to: dest,
      date: ledger.dateStart?.value,
    });

  const legs: AccessLeg[] = [];
  const flightPp = extras?.flightPerPersonEur ?? opt.flightPriceEur ?? null;
  if (flightPp != null && flightPp > 0) {
    legs.push({
      id: 'flight',
      kind: 'flight',
      label: 'Flug Hin+Rück',
      amountEur: flightPp,
      scope: 'per_person',
      bookUrl: opt.flightBookUrl,
    });
  }
  legs.push({
    id: 'ferry_out',
    kind: 'ferry',
    label: `Fähre ${from} → ${dest}`,
    amountEur: extras?.ferryEur ?? null,
    scope: 'group',
    bookUrl: ferryUrl,
    requiredForBuyIn: true,
  });
  if (extras?.ferryReturnEur != null && extras.ferryReturnEur > 0) {
    legs.push({
      id: 'ferry_ret',
      kind: 'ferry',
      label: `Fähre zurück`,
      amountEur: extras.ferryReturnEur,
      scope: 'group',
      bookUrl: ferryUrl,
    });
  }
  const stay = extras?.stayEur ?? opt.stayPriceEur ?? null;
  if (stay != null && stay > 0) {
    legs.push({
      id: 'stay',
      kind: 'stay',
      label: 'Unterkunft Insel',
      amountEur: stay,
      scope: 'group',
      bookUrl: opt.stayBookUrl,
    });
  }
  if (extras?.carEur != null && extras.carEur > 0) {
    legs.push({
      id: 'car',
      kind: 'car',
      label: 'Mietwagen / Autofähre-Anteil',
      amountEur: extras.carEur,
      scope: 'group',
      bookUrl: opt.carBookUrl,
    });
  }

  const buy = finalizeBuyInGate(composePackageBuyIn(legs, adults));
  const gaps = [...(opt.gaps ?? [])];
  for (const m of buy.missingRequired) {
    if (!gaps.some((g) => g.includes(m))) gaps.push(`Fähre: ${m} noch belegen`);
  }

  return {
    ...opt,
    title: opt.title?.includes('Fähre') ? opt.title : `Fähre · ${dest}`,
    buyInEur: buy.buyInEur,
    buyInLabel: buy.buyInLabel,
    totalEur: buy.totalPackage ?? opt.totalEur,
    pricePerPerson: buy.buyInEur ?? opt.pricePerPerson,
    priceBreakdown: legsToPriceBreakdown(legs, buy.buyInEur),
    bookingChecklist: [
      ...legsToBookingChecklist(legs),
      ...(opt.flightBookUrl
        ? [
            {
              id: 'ferry-flight',
              label: 'Flug buchen',
              url: opt.flightBookUrl,
              kind: 'flight' as const,
              clickedAtMs: null,
            },
          ]
        : []),
    ],
    gaps,
    packageBookUrl: opt.packageBookUrl || ferryUrl,
    decisionNotes: [
      ...(opt.decisionNotes ?? []),
      'Fähr-Plan: Überfahrt + Insel-Stay (+ ggf. Flug)',
    ],
  };
}
