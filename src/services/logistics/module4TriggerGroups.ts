/**
 * Modul-4 Trigger-Gruppen (SSOT-Dokumentation + Hilfen).
 *
 * LIVE   — Bus/Bahn/Flug/Fähre (Verspätung möglich) · Check 3h/1h/35/30/10/leave
 * GEO    — Einkauf/Restaurant-Wunsch · ~150 m Radius
 * TIME   — „Erinnere mich um 18 Uhr“
 * FREE   — Gutschein/Anruf/Wecker · kontextuell wenn ruhig oder vor Abreise
 */

export type Module4TriggerGroup = 'live' | 'geo' | 'time' | 'free';

export function classifyLogisticsEventKind(
  kind: string,
): Module4TriggerGroup {
  if (
    kind === 'flight' ||
    kind === 'train' ||
    kind === 'bus' ||
    kind === 'ferry'
  ) {
    return 'live';
  }
  if (kind === 'geo') return 'geo';
  if (kind === 'reminder' || kind === 'alarm') return 'time';
  return 'free';
}

/** Default Geo-Radius für Shopping/Restaurant-Wünsche. */
export const MODULE4_GEO_RADIUS_M = 150;

/** Ab dieser Verspätung sofort User informieren. */
export const MODULE4_DELAY_NOTIFY_MIN = 15;
