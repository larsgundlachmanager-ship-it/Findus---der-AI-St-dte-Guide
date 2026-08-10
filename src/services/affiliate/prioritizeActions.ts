/**
 * Priorisiert Concierge-Quick-Actions:
 * Navigation > Haupt-Intent-Partner > Uber > Rest.
 * Voice-first: wenige, scannbare Buttons — Rest per Stimme.
 */

import type { QuickAction, QuickActionType } from '../../types/concierge';

const PRIORITY: Record<QuickActionType, number> = {
  START_NAVIGATION: 100,
  SET_DEPARTURE_REMINDER: 99,
  SET_WAKE_ALARM: 98,
  SET_TIMER: 97,
  COMPLETE_SHOPPING_TASK: 96,
  SNOOZE_SHOPPING_TASK: 50,
  BOOK_STAY22: 90,
  BOOK_ESIM: 89,
  BOOK_BOUNCE_LUGGAGE: 88,
  BOOK_CAR_RENTAL: 86,
  OPEN_GYG_WIDGET: 84,
  OPEN_URL: 82,
  BOOK_UBER: 70,
  CONFIRM_API_RESERVATION: 65,
  SEND_RESERVATION_EMAIL: 64,
  TRIGGER_AI_CALL: 63,
  DIAL_PHONE: 75,
  SHOW_STREET_VIEW: 72,
  SHOW_MORE: 40,
};

/** Hard-Cap für Spickzettel — default 3; Event-Turns bis 4. */
export const MAX_QUICK_ACTIONS = 4;
export const MAX_EVENT_QUICK_ACTIONS = 4;

/** Mehrere Routen-Chips — Events dürfen bis 3 Nav-Buttons. */
const MAX_NAV_ACTIONS = 2;
const MAX_EVENT_NAV_ACTIONS = 3;

export function prioritizeQuickActions(
  actions: QuickAction[],
  opts?: {
    primaryIntentTypes?: QuickActionType[];
    maxActions?: number;
    maxNavActions?: number;
  },
): QuickAction[] {
  const maxActions = opts?.maxActions ?? MAX_QUICK_ACTIONS;
  const maxNav = opts?.maxNavActions ?? MAX_NAV_ACTIONS;
  const boost = new Set(opts?.primaryIntentTypes ?? []);
  const scored = actions.map((a, index) => {
    let score = PRIORITY[a.type] ?? 50;
    if (boost.has(a.type)) score += 15;
    // OPEN_URL zu Tour-Partnern / PDF leicht anheben
    if (
      a.type === 'OPEN_URL' &&
      /getyourguide|musement|viator|tripadvisor|tpx\.li|c111\.travelpayouts|kiwi\.com|klook|tiqets|kkday|wegotrip|gocity|airalo|saily|welcomepickups|gettransfer|kiwitaxi|aviasales|radicalstorage|airhelp|compensair|awin1\.com|travelsecure|\.pdf|programm|flyer|ticket|speise|menu|🍽|expedia|stay22|booking\.com|hotels\.com|vrbo/i.test(
        `${a.payload.url ?? ''} ${a.label}`,
      )
    ) {
      score += 20;
    }
    // Hotel-Live-Deeplinks (vor Maps/generisch)
    if (
      a.type === 'OPEN_URL' &&
      /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate/i.test(
        a.payload.url ?? '',
      )
    ) {
      score += 18;
    }
    return { a, score, index };
  });
  scored.sort((x, y) => y.score - x.score || x.index - y.index);

  const seen = new Set<string>();
  const out: QuickAction[] = [];
  let navCount = 0;
  for (const { a } of scored) {
    const key = `${a.type}:${a.payload.url ?? ''}:${a.payload.targetPoiId ?? ''}:${a.payload.destination ?? ''}:${a.label}`;
    if (seen.has(key)) continue;
    if (a.type === 'START_NAVIGATION') {
      if (navCount >= maxNav) continue;
      navCount += 1;
    }
    seen.add(key);
    out.push(a);
    if (out.length >= maxActions) break;
  }
  return out;
}
