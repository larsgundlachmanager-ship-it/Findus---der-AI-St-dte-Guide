/**
 * Deal-Anomalie: Stay/Flug weit unter Peer-Median → Preisfehler/Hit.
 */

import type { ReiseLedger } from '../types';

export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/** true wenn price ≤ ratio * median (Default 0.55 = starker Hit). */
export function isDealAnomaly(
  price: number | null | undefined,
  peers: number[],
  ratio = 0.55,
): boolean {
  if (price == null || !(price > 0)) return false;
  const m = median(peers.filter((p) => p !== price));
  if (m == null || m < 40) return false;
  return price <= m * ratio;
}

/** Soft-Schnäppchen: unter ~72 % vom Peer-Median. */
export function isSoftBargain(
  price: number | null | undefined,
  peers: number[],
): boolean {
  return isDealAnomaly(price, peers, 0.72);
}

/**
 * Aggressiver Deal-Hunt (User will Preisfehler) → 0.62;
 * sonst Soft-Hunt immer 0.72 für Stay/Flug-Peers.
 */
export function dealHuntRatio(ledger?: ReiseLedger | null): number {
  if (ledger?.dealHunt?.value) return 0.62;
  return 0.72;
}

export function dealLabel(hit: boolean, soft = false): string | null {
  if (!hit) return null;
  return soft ? 'Schnäppchen vs. Vergleichspreise' : 'Preisfehler / Hit — ungewöhnlich günstig';
}

/** Score-Bonus für Shortlist (hart > soft). */
export function dealScoreBoost(opts: {
  hardHit: boolean;
  softHit: boolean;
  dealHunt?: boolean;
}): number {
  if (opts.hardHit) return opts.dealHunt ? 12 : 9;
  if (opts.softHit) return opts.dealHunt ? 7 : 4;
  return 0;
}
