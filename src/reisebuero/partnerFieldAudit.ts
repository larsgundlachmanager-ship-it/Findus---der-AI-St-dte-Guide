/**
 * Partner-Feld-Audit: welche Ledger-Slots die Partner-Prefills brauchen.
 * Smoke prüft, dass Keys im Ledger existieren (kein Live-Scraping).
 */

import type { ReiseLedger } from './types';
import { EMPTY_LEDGER } from './types';

export type PartnerFieldNeed = {
  partner: string;
  fields: { label: string; ledgerKeys: (keyof ReiseLedger)[] }[];
};

export const PARTNER_FIELD_MATRIX: PartnerFieldNeed[] = [
  {
    partner: 'flight_kiwi',
    fields: [
      { label: 'from/to', ledgerKeys: ['originCity', 'destinationHint', 'airportIata'] },
      { label: 'dates', ledgerKeys: ['dateStart', 'dateEnd', 'whenFlex'] },
      { label: 'pax', ledgerKeys: ['adults', 'children', 'infants', 'travelerAges'] },
      { label: 'bags', ledgerKeys: ['cabinBags', 'checkedBags'] },
      { label: 'stops', ledgerKeys: ['directFlight', 'maxFlightStops', 'maxLayoverHours'] },
    ],
  },
  {
    partner: 'bahn_de',
    fields: [
      { label: 'from/to', ledgerKeys: ['originCity', 'destinationHint'] },
      { label: 'date/time', ledgerKeys: ['dateStart', 'departAfterHour', 'whenFlex'] },
      { label: 'age/bc', ledgerKeys: ['travelerAges', 'bahncard'] },
      { label: 'flex/max', ledgerKeys: ['railFlex', 'maxRailHours', 'maxDriveHours'] },
    ],
  },
  {
    partner: 'flix',
    fields: [
      { label: 'from/to/date', ledgerKeys: ['originCity', 'destinationHint', 'dateStart'] },
      { label: 'pax', ledgerKeys: ['adults'] },
      { label: 'train_vs_bus', ledgerKeys: ['surfacePref'] },
    ],
  },
  {
    partner: 'stay',
    fields: [
      { label: 'place/dates', ledgerKeys: ['destinationHint', 'dateStart', 'dateEnd', 'stayNights'] },
      { label: 'pax/rooms', ledgerKeys: ['adults', 'children'] },
      { label: 'lodging', ledgerKeys: ['lodgingKind', 'lodgingFallback', 'meals'] },
      { label: 'amenities', ledgerKeys: ['mustHaves', 'wishHaves', 'niceHaves'] },
      { label: 'budget', ledgerKeys: ['budgetEur'] },
    ],
  },
  {
    partner: 'rental_car',
    fields: [
      { label: 'pickup', ledgerKeys: ['destinationHint', 'dateStart', 'dateEnd'] },
      { label: 'driver_age', ledgerKeys: ['travelerAges'] },
      { label: 'need', ledgerKeys: ['needCar', 'rentalCar'] },
    ],
  },
  {
    partner: 'cruise',
    fields: [
      { label: 'region/nights', ledgerKeys: ['destinationHint', 'stayNights', 'tripShape'] },
      { label: 'cabin/fare', ledgerKeys: ['cruiseCabinClass', 'cruiseFareBundle', 'meals'] },
      { label: 'embark', ledgerKeys: ['cruiseEmbarkBias', 'cruiseEmbarkPort'] },
      { label: 'sea/access', ledgerKeys: ['cruiseSeaDaysBias', 'accessNeeds'] },
    ],
  },
  {
    partner: 'events_tickets',
    fields: [
      { label: 'what/when', ledgerKeys: ['highlightWant', 'mustActivities', 'dateStart'] },
      { label: 'hop', ledgerKeys: ['hopStops', 'tripShape'] },
    ],
  },
];

/** Alle referenzierten Keys müssen im EMPTY_LEDGER existieren. */
export function auditPartnerLedgerKeys(): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const p of PARTNER_FIELD_MATRIX) {
    for (const f of p.fields) {
      for (const k of f.ledgerKeys) {
        if (!(k in EMPTY_LEDGER)) missing.push(`${p.partner}.${String(k)}`);
      }
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}
