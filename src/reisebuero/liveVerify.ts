/**
 * Live-Verify nach Ergebnis-Änderungen (Personen, Direktflug, Mietwagen…).
 */

import { searchStay22HotelsInCity } from '../services/concierge/hotelAvailabilityService';
import { getCarRentalUrl } from '../services/affiliate/affiliateService';
import { offsetDateKey, todayDateKey } from '../utils/dateKeys';
import { hasUserBudget } from './completeness';
import {
  applySelectedStayTransport,
  buyInFromParts,
  budgetDeltaVsBuyIn,
  enrichOptionMagazine,
  estimateRentalCarGroupEur,
  isCrediblePackageBuyIn,
  sharedCarEurFromOption,
} from './research/composePlan';
import { useReisebueroStore } from './store';
import type { ReiseOption } from './types';

function stayWindow() {
  const ledger = useReisebueroStore.getState().trip.ledger;
  const nights =
    ledger.stayNights?.value ??
    (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2);
  const start = ledger.dateStart?.value || todayDateKey();
  return {
    checkin: start,
    checkout: offsetDateKey(nights, Date.parse(`${start}T12:00:00`)),
    nights,
  };
}

export async function runLiveVerify(reason: string): Promise<string> {
  const store = useReisebueroStore.getState();
  store.setThinking(true, 0.15);
  store.setPhase('verify');
  store.appendDecision('verify', reason);
  store.appendAssistant('Ich check das live nochmal — einen Moment…', 'Live-Check');

  const trip = store.trip;
  const ledger = trip.ledger;
  const adults = ledger.adults?.value ?? 2;
  const { checkin, checkout, nights } = stayWindow();
  const options = [...trip.options];
  const notes: string[] = [];

  try {
    for (let i = 0; i < options.length; i += 1) {
      const o = options[i]!;
      store.setThinking(true, 0.2 + (i / Math.max(1, options.length)) * 0.7);
      const lodging =
        (ledger.mustHaves?.value ?? []).includes('hotel')
          ? 'hotel'
          : (ledger.mustHaves?.value ?? []).includes('apartment') ||
              (ledger.mustHaves?.value ?? []).includes('ferienhaus')
            ? 'apartment'
            : 'any';

      try {
        const live = await searchStay22HotelsInCity({
          city: o.placeName,
          checkin,
          checkout,
          adults,
          lodgingType: lodging,
          lat: o.lat,
          lng: o.lng,
          pageSize: 12,
        });
        const pick = live.stays[0] ?? null;
        if (pick) {
          o.stayName = pick.name;
          o.stayBookUrl = pick.bookUrl;
          o.stayPriceEur = pick.priceTotal;
        } else {
          notes.push(`${o.placeName}: keine passende Unterkunft für ${adults}`);
          o.gaps = [...o.gaps, `Keine freie Unterkunft für ${adults} Pers.`];
        }
      } catch {
        notes.push(`${o.placeName}: Stay-Check soft-fail`);
      }

      if (ledger.rentalCar?.value === false && ledger.needCar?.value !== true) {
        o.carBookUrl = null;
        o.carPriceEur = null;
        o.transferBookUrl =
          o.transferBookUrl ||
          `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}&travelmode=transit`;
        notes.push(`${o.placeName}: ÖPNV/Transfer statt Mietwagen`);
        store.appendDecision(
          'transfer',
          `${o.placeName}: kein Mietwagen — ÖPNV-Link gesetzt`,
        );
      } else if (ledger.rentalCar?.value === true || ledger.needCar?.value === true) {
        o.carBookUrl = getCarRentalUrl({
          pickupLocation: o.placeName,
          pickupDate: checkin,
          dropoffDate: checkout,
        });
        if (!(o.carPriceEur != null && o.carPriceEur > 0) && !sharedCarEurFromOption(o)) {
          o.carPriceEur = estimateRentalCarGroupEur(nights);
        }
        notes.push(`${o.placeName}: Mietwagen-Link gesetzt`);
      }

      if (ledger.directFlight?.value) {
        o.decisionNotes = [
          ...(o.decisionNotes ?? []).filter((d) => !/Direktflug/i.test(d)),
          'Direktflug gewünscht — Links prüfen, ggf. Aufpreis',
        ];
        store.appendDecision('directFlight', `${o.placeName}: Direktflug-Filter aktiv`);
      }

      const carEur = sharedCarEurFromOption(o);
      const overnight = nights >= 1;
      const credible = isCrediblePackageBuyIn({
        overnight,
        stayEur: o.stayPriceEur,
        flightPerPersonEur: o.flightPriceEur,
        hasSurfaceTravel: carEur != null,
      });
      const buy = buyInFromParts({
        flightPerPersonEur: o.flightPriceEur ?? null,
        stayEur: o.stayPriceEur ?? null,
        transferEur: o.transferEur ?? null,
        carEur,
        extrasEur: o.extrasEur ?? null,
        adults,
      });
      o.carPriceEur = carEur;
      o.totalEur = credible ? buy.totalPackage : null;
      o.buyInEur = credible ? buy.buyInEur : null;
      o.buyInLabel = buy.buyInLabel;
      o.pricePerPerson = credible ? buy.buyInEur : null;
      const budget = hasUserBudget(ledger) ? ledger.budgetEur?.value ?? null : null;
      o.budgetDeltaEur = budgetDeltaVsBuyIn(
        o.buyInEur ?? null,
        budget,
        ledger.budgetScope?.value ?? 'per_person',
        credible ? o.totalEur : null,
      );
      if (budget != null && o.buyInEur != null && o.buyInEur > budget && (ledger.budgetScope?.value ?? 'per_person') !== 'total') {
        notes.push(`${o.placeName}: über Budget`);
        o.gaps = [...o.gaps.filter((g) => !/Budget/i.test(g)), 'Über Budget nach Live-Check'];
      }

      const mag = enrichOptionMagazine({ ...o }, ledger, {
        transferMinutes: o.transferMinutes,
        destPhotoUrl: o.photoUrl,
        wishEvidence: o.wishEvidence,
      });
      // Checklist inkl. alreadyBooked / Mietwagen-CTA neu ziehen
      options[i] = applySelectedStayTransport(mag, adults, ledger);
    }

    store.setOptions(options, [
      ...trip.funnelLog,
      { stage: 'verify', detail: notes.join(' · ') || 'Live-Verify ok' },
    ]);
    store.setThinking(false, null);
    store.setPhase('results');

    const speech =
      ledger.needCar?.value === true && notes.some((n) => /Mietwagen/i.test(n))
        ? 'Mietwagen ist drin — Link steht in der Checkliste, Rest bleibt wie gebucht.'
        : notes.length > 0
          ? `Hab’s nachgezogen: ${notes.slice(0, 2).join('; ')}. Schau dir die Karten nochmal an.`
          : 'Passt weiterhin — Preise und Links sind frisch.';
    store.appendAssistant(speech, 'Live-Check fertig');
    return speech;
  } catch (e) {
    store.setThinking(false, null);
    store.setPhase('results');
    const msg = 'Live-Check hat gehakt — Links bleiben, bitte nochmal tippen.';
    store.appendAssistant(msg, 'Fehler');
    return msg;
  }
}

export function looksLikeVerifyRequest(text: string): boolean {
  const t = (text || '').toLowerCase();
  let gapAddOn = false;
  try {
    const { looksLikeGapAddOn } = require('./gapInventory') as typeof import('./gapInventory');
    gapAddOn = looksLikeGapAddOn(text);
  } catch {
    gapAddOn = false;
  }
  return (
    /\b(jetzt|doch|stattdessen|ändern|aendern|lieber|kein\s+mietwagen|direktflug|wir\s+sind\s+\d|zu\s+\d)\b/iu.test(
      t,
    ) ||
    /\b(\d{1,2})\s*(leute|personen|mann|jungs)\b/iu.test(t) ||
    gapAddOn
  );
}

export { looksLikeGapAddOn } from './gapInventory';

export function pickSelectedOrTop(): ReiseOption | null {
  const trip = useReisebueroStore.getState().trip;
  if (trip.selectedOptionId) {
    return trip.options.find((o) => o.id === trip.selectedOptionId) ?? trip.options[0] ?? null;
  }
  return trip.options[0] ?? null;
}
