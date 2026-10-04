/**
 * Blocker-Fragen im Reisebüro-Funnel — Reihenfolge härten (P5).
 */

import type { ReiseLedger } from './types';

const PACKAGE_MODES = new Set(['fly', 'fly_stay', 'rail', 'drive', 'daytrip']);

/** Transfer-Blocker nicht überspringen wenn Fly+Stay-Paket. */
export function shouldAskTransferBlocker(ledger: ReiseLedger): boolean {
  if (ledger.bookedTransfer?.value === true) return false;
  if (ledger.transferPref?.value) return false;
  const mode = ledger.mode?.value;
  if (mode && PACKAGE_MODES.has(mode)) return true;
  if (ledger.bookedFlight?.value === true && ledger.bookedStay?.value !== true) return true;
  if (ledger.bookedStay?.value === true && ledger.bookedFlight?.value !== true) return true;
  return Boolean(ledger.stayNights?.value || ledger.stayDays?.value);
}

/** Messe/Event-Paket: Event-Slot vor Wrap-up erzwingen. */
export function shouldAskEventBlocker(ledger: ReiseLedger): boolean {
  if (ledger.eventName?.value || ledger.mustEvent?.value) return false;
  const blob = [
    ledger.extraWishes?.value,
    ledger.highlightWant?.value,
    ledger.destinationHint?.value,
  ]
    .filter(Boolean)
    .join(' ');
  return /\bmesse|konferenz|kongress|buchmesse|trade\s*fair\b/iu.test(blob);
}
