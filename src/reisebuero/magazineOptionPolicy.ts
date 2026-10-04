/**
 * Magazin-Optionen final: Expand (Fenster/Stay) → Pool-Pad → Policy-Slice.
 * SSOT vor store.setOptions / Magazin-Grid.
 */

import type { ReiseLedger, ReiseOption } from './types';
import { expandFlightWindowOptions } from './flightWindowVariants';
import { expandLodgingTrackOptions } from './magazineOptionKind';
import {
  padOptionsFromPool,
  sliceOptionsToPolicy,
  targetOptionCount,
} from './optionPolicy';

/**
 * Stellt sicher: offen → bis 4, spez. → ≥2 (wenn Material da),
 * Prefer/Soft und Erst/Notfall als eigene Karten wo sinnvoll.
 */
export function finalizeMagazineOptions(
  options: ReiseOption[],
  ledger: ReiseLedger,
  pool: ReiseOption[] = [],
): ReiseOption[] {
  if (!options.length) return options;
  const target = targetOptionCount(ledger);

  let next = expandFlightWindowOptions(options, ledger);
  next = expandLodgingTrackOptions(next, ledger);

  if (next.length < target && pool.length) {
    next = padOptionsFromPool(next, pool, ledger);
    // Neu gepaddete Städte können noch Fenster/Stay brauchen
    next = expandFlightWindowOptions(next, ledger);
    next = expandLodgingTrackOptions(next, ledger);
  }

  return sliceOptionsToPolicy(next, ledger);
}
