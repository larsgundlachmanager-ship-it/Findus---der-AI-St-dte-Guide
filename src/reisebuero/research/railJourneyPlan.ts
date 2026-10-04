/**
 * Bahn / Nightjet — Blaupause auf tripPackageSpine.
 */

import type { ReiseLedger, ReiseOption, StayChoice } from '../types';
import {
  composePackageBuyIn,
  finalizeBuyInGate,
  legsToBookingChecklist,
  legsToPriceBreakdown,
  type AccessLeg,
} from './tripPackageSpine';
import {
  bookendStartDates,
  bookendStartCity,
  bookendStartFallbackUrl,
  needsBookendHotels,
  sameStayRef,
} from './bookendHotels';

function destEndStay(opt: ReiseOption): StayChoice | null {
  return (
    opt.stays?.find((s) => s.id === opt.selectedStayId) ||
    opt.stays?.[0] ||
    (opt.stayBookUrl || (opt.stayPriceEur != null && opt.stayPriceEur > 0)
      ? {
          id: 'bookend-end-dest',
          name: opt.stayName || 'Unterkunft am Ziel',
          priceEur: opt.stayPriceEur ?? null,
          bookUrl: opt.stayBookUrl ?? null,
          photoUrl: opt.photoUrl ?? null,
          why: 'Hotel nach Ankunft',
        }
      : null)
  );
}

export function enrichOptionAsRailPlan(
  opt: ReiseOption,
  ledger: ReiseLedger,
  extras?: {
    railPerPersonEur?: number | null;
    nightCabinEur?: number | null;
    /** Nightjet ersetzt eine Hotel-Nacht → Stay nicht doppelzählen wenn creditStay. */
    creditStayForNightTrain?: boolean;
    railUrl?: string | null;
    startStay?: StayChoice | null;
    endStay?: StayChoice | null;
  },
): ReiseOption {
  const adults = Math.max(1, ledger.adults?.value ?? 2);
  const isNight = ledger.railFlex?.value === 'overnight_ok';
  const tr = (opt.transports ?? []).find((t) => t.kind === 'train');
  const railPp =
    extras?.railPerPersonEur ??
    tr?.priceEur ??
    (opt.selectedTransportId &&
    opt.transports?.find((t) => t.id === opt.selectedTransportId)?.kind === 'train'
      ? opt.transports.find((t) => t.id === opt.selectedTransportId)?.priceEur
      : null) ??
    null;
  const railUrl = extras?.railUrl ?? tr?.bookUrl ?? opt.flightBookUrl ?? null;

  const legs: AccessLeg[] = [
    {
      id: 'rail',
      kind: 'train',
      label: isNight ? 'Nachtzug / Nightjet p.P.' : 'Bahn Hin+Rück p.P.',
      amountEur: railPp,
      scope: 'per_person',
      bookUrl: railUrl,
      requiredForBuyIn: true,
    },
  ];
  if (extras?.nightCabinEur != null && extras.nightCabinEur > 0) {
    legs.push({
      id: 'night_cabin',
      kind: 'other',
      label: 'Liege-/Cabin-Aufpreis',
      amountEur: extras.nightCabinEur,
      scope: 'group',
      bookUrl: railUrl,
    });
  }
  const creditStay = extras?.creditStayForNightTrain ?? isNight;
  const stay = opt.stayPriceEur;
  const bookend = needsBookendHotels(ledger);
  const startStay = extras?.startStay ?? opt.bookendStartStay ?? null;
  const endStay = extras?.endStay ?? destEndStay(opt);
  if (bookend) {
    const dates = bookendStartDates(
      tr?.departDateKey || ledger.dateStart?.value || null,
    );
    const startCity = bookendStartCity({ ledger, originCity: ledger.originCity?.value });
    const startUrl =
      startStay?.bookUrl ||
      (startCity && dates
        ? bookendStartFallbackUrl({
            city: startCity,
            checkin: dates.checkin,
            checkout: dates.checkout,
            adults,
          })
        : null);
    const startIsDestClone = sameStayRef(startStay, endStay) || startUrl === (endStay?.bookUrl || opt.stayBookUrl);
    const startBookUrl = startIsDestClone ? startUrl : startStay?.bookUrl || startUrl;
    const distinctStartUrl =
      startBookUrl && startBookUrl !== (endStay?.bookUrl || opt.stayBookUrl)
        ? startBookUrl
        : startCity && dates
          ? bookendStartFallbackUrl({
              city: startCity,
              checkin: dates.checkin,
              checkout: dates.checkout,
              adults,
            })
          : startBookUrl;
    legs.push({
      id: 'stay-start',
      kind: 'stay',
      label: isNight ? 'Hotel vor dem Nachtzug' : 'Hotel vor der Tour',
      amountEur:
        startStay?.priceEur != null && startStay.priceEur > 0 ? startStay.priceEur : null,
      scope: 'group',
      bookUrl: distinctStartUrl,
      notes: startStay?.name || 'Mehrtagestour: Bett am Start, nicht nur im Wagen',
    });
    const endPrice =
      endStay?.priceEur != null && endStay.priceEur > 0
        ? endStay.priceEur
        : stay != null && stay > 0
          ? stay
          : null;
    legs.push({
      id: 'stay-end',
      kind: 'stay',
      label: 'Hotel nach Ankunft',
      amountEur: endPrice,
      scope: 'group',
      bookUrl: endStay?.bookUrl || opt.stayBookUrl,
      notes: endStay?.name || 'Bett am Ziel, sobald die Tour/der Zug endet',
    });
  } else if (!creditStay && stay != null && stay > 0) {
    legs.push({
      id: 'stay',
      kind: 'stay',
      label: 'Unterkunft',
      amountEur: stay,
      scope: 'group',
      bookUrl: opt.stayBookUrl,
    });
  } else if (creditStay && stay != null && stay > 0) {
    // Night train = one night less; still add stay if multi-night remainder
    legs.push({
      id: 'stay',
      kind: 'stay',
      label: 'Unterkunft (ohne Zug-Nacht)',
      amountEur: stay,
      scope: 'group',
      bookUrl: opt.stayBookUrl,
      notes: 'Nachtzug ersetzt An-/Abreisenacht',
    });
  }

  const buy = finalizeBuyInGate(composePackageBuyIn(legs, adults));
  const gaps = [...(opt.gaps ?? [])];
  for (const m of buy.missingRequired) {
    if (!gaps.some((g) => g.includes(m))) gaps.push(`Bahn: ${m} noch belegen`);
  }
  if (bookend && (startStay?.priceEur == null || !(startStay.priceEur > 0))) {
    if (!gaps.some((g) => /Hotel vor/i.test(g))) {
      gaps.push('Hotel vor der Tour/Zug: Live-Preis noch offen — Link gesetzt');
    }
  }

  return {
    ...opt,
    bookendStartStay: startStay ?? opt.bookendStartStay,
    buyInEur: buy.buyInEur ?? opt.buyInEur,
    buyInLabel: buy.buyInLabel,
    totalEur: buy.totalPackage ?? opt.totalEur,
    pricePerPerson: buy.buyInEur ?? opt.pricePerPerson,
    priceBreakdown: legsToPriceBreakdown(legs, buy.buyInEur),
    bookingChecklist: legsToBookingChecklist(legs).length
      ? legsToBookingChecklist(legs)
      : opt.bookingChecklist,
    gaps,
    decisionNotes: [
      ...(opt.decisionNotes ?? []),
      bookend
        ? isNight
          ? 'Nightjet: Hotel vorn UND hinten — zweites Live-Hotel am Start'
          : 'Tour: Hotel vorn UND hinten — Start und Ziel getrennt'
        : isNight
          ? 'Nightjet-Plan: Zug-Nacht kann Hotel-Nacht ersetzen'
          : 'Bahn-Plan: Ticket p.P. + Stay',
    ],
  };
}

