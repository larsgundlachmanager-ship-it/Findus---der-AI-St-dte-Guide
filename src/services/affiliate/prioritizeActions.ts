/**
 * Priorisiert Concierge-Quick-Actions:
 * Navigation > Haupt-Intent-Partner > Uber > Rest.
 */

import type { QuickAction, QuickActionType } from '../../types/concierge';

const PRIORITY: Record<QuickActionType, number> = {
  START_NAVIGATION: 100,
  BOOK_STAY22: 90,
  BOOK_BOUNCE_LUGGAGE: 88,
  BOOK_CAR_RENTAL: 86,
  OPEN_GYG_WIDGET: 84,
  OPEN_URL: 82,
  BOOK_UBER: 70,
  CONFIRM_API_RESERVATION: 65,
  SEND_RESERVATION_EMAIL: 64,
  TRIGGER_AI_CALL: 63,
  DIAL_PHONE: 55,
  SHOW_MORE: 40,
};

/** Soft-Cap für Spickzettel-Buttons (horizontales Scrollen bleibt). */
export const MAX_QUICK_ACTIONS = 8;

export function prioritizeQuickActions(
  actions: QuickAction[],
  opts?: { primaryIntentTypes?: QuickActionType[] },
): QuickAction[] {
  const boost = new Set(opts?.primaryIntentTypes ?? []);
  const scored = actions.map((a, index) => {
    let score = PRIORITY[a.type] ?? 50;
    if (boost.has(a.type)) score += 15;
    // OPEN_URL zu Tour-Partnern leicht anheben
    if (
      a.type === 'OPEN_URL' &&
      /getyourguide|musement|viator|tripadvisor/i.test(a.payload.url ?? '')
    ) {
      score += 8;
    }
    return { a, score, index };
  });
  scored.sort((x, y) => y.score - x.score || x.index - y.index);

  const seen = new Set<string>();
  const out: QuickAction[] = [];
  for (const { a } of scored) {
    const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.targetPoiId ?? ''}:${a.payload.destination ?? ''}:${a.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= MAX_QUICK_ACTIONS) break;
  }
  return out;
}
