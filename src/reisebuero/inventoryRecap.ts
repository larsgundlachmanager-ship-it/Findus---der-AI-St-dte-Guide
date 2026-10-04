/**
 * Inventar-Recap nach langem Dump — Struktur, kein Wortlaut-Skript.
 */

import type { ReiseLedger } from './types';
import { deriveInventoryMode, inventoryGapLabels, inventoryHaveLabels } from './gapInventory';
import { weaveSpokenFacts } from './briefingSpeech';

/** Kurzer Recap: was schon da vs. was fehlt (für Speech/Flipchart-Hint). */
export function inventoryRecapHint(ledger: ReiseLedger): string | null {
  const mode = ledger.inventoryMode?.value ?? deriveInventoryMode(ledger);
  if (mode === 'full_discover') return null;
  const have = inventoryHaveLabels(ledger);
  const gaps = inventoryGapLabels(ledger);
  if (!have.length && !gaps.length) return null;
  const haveBit = have.length ? weaveSpokenFacts(have) : null;
  const gapBit = gaps.length ? weaveSpokenFacts(gaps) : null;
  if (haveBit && gapBit) return `${haveBit} steht — fehlt noch ${gapBit}`;
  if (haveBit) return `${haveBit} steht`;
  if (gapBit) return `Noch offen: ${gapBit}`;
  return null;
}

export function isInventoryGapFill(ledger: ReiseLedger): boolean {
  return (ledger.inventoryMode?.value ?? deriveInventoryMode(ledger)) === 'gap_fill';
}
