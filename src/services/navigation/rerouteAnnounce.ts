/**
 * Ansagen bei Auto-Reroute: Delta statt Absolutzeit, Sackgasse hart.
 * Struktur-Blaupause — Wortlaut kurz und organisch halten.
 */

/** Ab so vielen Extra-Minuten: Delta nennen (nicht nur „neu berechnet“). */
export const REROUTE_LONGER_ETA_MIN = 10;
/** Ab so vielen Extra-Metern: ebenfalls als deutlicher Umweg behandeln. */
export const REROUTE_LONGER_DIST_M = 1_500;

export function rerouteEtaDeltaMin(opts: {
  previousEtaMin: number | null;
  newEtaMin: number | null;
}): number | null {
  const prev = opts.previousEtaMin;
  const next = opts.newEtaMin;
  if (
    prev == null ||
    next == null ||
    !Number.isFinite(prev) ||
    !Number.isFinite(next)
  ) {
    return null;
  }
  return Math.round(next - prev);
}

export function rerouteDistDeltaM(opts: {
  previousDistanceM: number | null;
  newDistanceM: number | null;
}): number | null {
  const prev = opts.previousDistanceM;
  const next = opts.newDistanceM;
  if (
    prev == null ||
    next == null ||
    !Number.isFinite(prev) ||
    !Number.isFinite(next)
  ) {
    return null;
  }
  return Math.round(next - prev);
}

export function isSignificantlyLongerReroute(opts: {
  etaDeltaMin: number | null;
  distDeltaM: number | null;
}): boolean {
  if (
    opts.etaDeltaMin != null &&
    opts.etaDeltaMin >= REROUTE_LONGER_ETA_MIN
  ) {
    return true;
  }
  if (
    opts.distDeltaM != null &&
    opts.distDeltaM >= REROUTE_LONGER_DIST_M
  ) {
    return true;
  }
  return false;
}

/** Delta-Ansage: wie viel länger — nicht die absolute neue Länge. */
export function buildLongerRerouteCue(etaDeltaMin: number): string {
  const mins = Math.max(1, Math.round(etaDeltaMin));
  return `Neue Route wäre etwa ${mins} Minuten länger. Willst du trotzdem so weiter, oder lieber den alten Weg?`;
}

export function buildDeadEndCue(): string {
  return `Wenn du so weiterläufst, ist das eine Sackgasse — da kommst du nicht durch, irgendwann musst du zurück.`;
}

export function buildShortWrongWayRerouteCue(): string {
  return `Kurz falsch — ich berechne jetzt eine neue Route von hier.`;
}

export const RESTORE_PREV_NAV_ROUTE_PROMPT = '__RESTORE_PREV_NAV_ROUTE__';
