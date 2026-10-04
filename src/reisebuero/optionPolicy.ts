/**
 * Optionen-Policy: offen → 4, spez. → mind. 2, mittel 2–4.
 */

import type { ReiseLedger } from './types';

export type OptionBriefGrain = 'open' | 'medium' | 'specific';

export function classifyOptionBrief(ledger: ReiseLedger): OptionBriefGrain {
  const dest =
    Boolean(ledger.destinationHint?.value) &&
    !/^(offen|egal|irgendwo|irgendwohin|surprise|egal\s+wohin)$/i.test(
      (ledger.destinationHint?.value || '').trim(),
    );
  const corridor = Boolean(ledger.corridor?.value);
  const exactWhen =
    ledger.dateFlex?.value === 'exact' ||
    (Boolean(ledger.dateStart?.value) && Boolean(ledger.dateEnd?.value));
  const openDiscover =
    ledger.dealHunt?.value === true ||
    /warm|günstig|guenstig|egal\s+wohin|irgendwo|surprise|deal/i.test(
      `${ledger.purpose?.value || ''} ${ledger.inspiration?.value || ''} ${ledger.discoverIntent?.value || ''} ${ledger.weatherWant?.value || ''}`,
    );

  if (dest && exactWhen) return 'specific';
  if (dest || (corridor && exactWhen)) return 'medium';
  if (openDiscover && !dest) return 'open';
  if (!dest && !corridor) return 'open';
  return 'medium';
}

/** Ziel-Anzahl Magazin-Pakete. */
export function targetOptionCount(ledger: ReiseLedger): number {
  const grain = classifyOptionBrief(ledger);
  if (grain === 'open') return 4;
  if (grain === 'specific') return 2;
  return 3;
}

/** Absolute Untergrenze — nie nur 1 Option verkaufen. */
export function minOptionCount(ledger: ReiseLedger): number {
  return Math.min(2, targetOptionCount(ledger));
}

/**
 * Slice finaler Options: mind. min, max. target (bis verfügbare Länge).
 */
export function sliceOptionsToPolicy<T>(options: T[], ledger: ReiseLedger): T[] {
  if (!options.length) return options;
  const target = targetOptionCount(ledger);
  const min = minOptionCount(ledger);
  const n = Math.max(min, Math.min(target, options.length));
  // Wenn nur 1 da: trotzdem 1 zurück (Research-Fail) — Policy gilt wenn ≥2 verfügbar
  if (options.length === 1) return options.slice(0, 1);
  return options.slice(0, Math.max(min, n));
}

/** Shortlist-Pool nachziehen bis Zielanzahl (ohne Duplikat-IDs). */
export function padOptionsFromPool<T extends { id: string }>(
  options: T[],
  pool: T[],
  ledger: ReiseLedger,
): T[] {
  const target = targetOptionCount(ledger);
  if (!options.length || options.length >= target || !pool.length) return options;
  const seen = new Set(options.map((o) => o.id));
  const out = [...options];
  for (const p of pool) {
    if (out.length >= target) break;
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Cover-Hinweis Magazin-Grid (kein Script — nur Struktur). */
export function magazineOptionsCoverHint(ledger: ReiseLedger, shown: number): string {
  const grain = classifyOptionBrief(ledger);
  const target = targetOptionCount(ledger);
  const n = Math.max(0, shown);
  if (grain === 'open') {
    if (n >= target) return `${n} Optionen — Städte & Deals`;
    if (n <= 0) return `Ziel ${target} Optionen — Städte & Deals`;
    return `${n} von ${target} Optionen — Städte & Deals`;
  }
  if (grain === 'specific') {
    return n >= 2
      ? `${n} Pakete — Hotels / Flugfenster`
      : n === 1
        ? `1 Paket — Ziel ≥2 (Hotels / Fenster)`
        : `Ziel ≥2 Pakete — Hotels / Flugfenster`;
  }
  return n > 0 ? `${n} Optionen` : `Ziel ${target} Optionen`;
}
