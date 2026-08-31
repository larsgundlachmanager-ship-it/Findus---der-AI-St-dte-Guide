/**
 * Tagesplan vs. Wecker/Leave-by — SSOT.
 * „um 9 Uhr los, dann frühstücken, abends essen“ ist Abfahrt, kein Wecker um 9.
 */

import { looksLikeModul5PlanUtterance } from './planUtteranceGate';

export function clockIntentYieldsToDayPlan(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return looksLikeModul5PlanUtterance(t);
}
