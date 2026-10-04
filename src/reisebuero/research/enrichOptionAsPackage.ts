/**
 * Package-Enrich Dispatcher — nach Magazine zuletzt anwenden.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import { enrichOptionAsCruisePlan, isCruiseLedger } from './cruisePlan';
import { enrichOptionAsFerryPlan } from './ferryPlan';
import { enrichOptionAsRailPlan } from './railJourneyPlan';
import { resolvePackageBlueprint } from './packageBlueprint';
import { cruisePartnerSearchLinks } from './cruiseSearch';
import {
  buildAccessTransferLegs,
  mergeTransferLegsIntoOption,
} from './accessTransfer';

export function enrichOptionAsPackage(
  opt: ReiseOption,
  ledger: ReiseLedger,
): ReiseOption {
  const bp = resolvePackageBlueprint(ledger);
  let next = opt;
  if (bp === 'cruise' || isCruiseLedger(ledger)) {
    next = enrichOptionAsCruisePlan(opt, ledger);
    const partners = cruisePartnerSearchLinks(ledger);
    const checklist = [...(next.bookingChecklist ?? [])];
    for (const p of partners) {
      if (!checklist.some((c) => c.url === p.url)) {
        checklist.push({
          id: `partner-${p.id}`,
          label: p.label,
          url: p.url,
          kind: 'cruise',
          clickedAtMs: null,
        });
      }
    }
    next = { ...next, bookingChecklist: checklist };
    const hasCruisePrice =
      (next.extrasEur != null && next.extrasEur > 0) ||
      (next.priceBreakdown ?? []).some((l) => l.id === 'cruise' && (l.amountEur ?? 0) > 0);
    if (!hasCruisePrice) {
      next = {
        ...next,
        buyInEur: null,
        pricePerPerson: null,
        buyInLabel: 'Buy-in offen — Kreuzfahrtpreis noch belegen',
        gaps: [
          ...(next.gaps ?? []).filter((g) => !/Buy-in offen/i.test(g)),
          'Kreuzfahrt: Kreuzfahrtpreis noch belegen',
        ],
      };
    }
    const wantsDrinks =
      ledger.cruiseFareBundle?.value === 'drinks' ||
      ledger.cruiseFareBundle?.value === 'premium_ai' ||
      ledger.meals?.value === 'all';
    if (
      wantsDrinks &&
      !(next.priceBreakdown ?? []).some((l) => /getränk|drink|all.?in/i.test(l.label))
    ) {
      next = {
        ...next,
        gaps: [
          ...(next.gaps ?? []),
          'Kreuzfahrt: Getränkepaket/AI-Tarif noch belegen (wenn nicht im Kabinenpreis inkl.)',
        ],
      };
    }
  } else if (bp === 'ferry_island' || bp === 'fly_ferry' || bp === 'drive_ferry') {
    next = enrichOptionAsFerryPlan(opt, ledger);
  } else if (bp === 'rail_day' || bp === 'rail_night' || bp === 'fly_rail') {
    next = enrichOptionAsRailPlan(opt, ledger, {
      creditStayForNightTrain: bp === 'rail_night',
      startStay: opt.bookendStartStay,
    });
  } else if (bp === 'route_tour') {
    next = {
      ...opt,
      decisionNotes: [
        ...(opt.decisionNotes ?? []),
        opt.bookendStartStay
          ? 'Tour: Hotel vorn UND hinten — Start-Hotel live, Ziel-Stay getrennt'
          : 'Tour: Hotel vorn UND hinten einplanen',
      ],
    };
  }
  // Taxi/Zwischenstopp-Legs auf JEDEM Blueprint (auch fly_stay)
  next = mergeTransferLegsIntoOption(next, buildAccessTransferLegs(ledger, next));
  try {
    const { wireReisebueroTaxiPrefill } = require('./taxiPrefillWire') as typeof import('./taxiPrefillWire');
    next = wireReisebueroTaxiPrefill(next, ledger);
  } catch {
    /* soft */
  }
  return next;
}
