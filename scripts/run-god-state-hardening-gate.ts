/**
 * Gott-Zustand Hardening Smoke — ohne RN-Importketten.
 * Run: npx --yes tsx scripts/run-god-state-hardening-gate.ts
 */

import { keepCityStickyForFollowUp } from '../src/module2/context/cityChatScope';
import { stripPermissionLookupAsks } from '../src/services/concierge/justDoItPolicy';
import { NAMED_BOOKING_PORTALS } from '../src/services/concierge/bookingPlatformActions';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const stripped = stripPermissionLookupAsks(
  'Soll ich das heraussuchen? Hier sind zwei Cafés.',
);
assert(!/soll ich/i.test(stripped), 'permission strip');

assert(NAMED_BOOKING_PORTALS.length >= 5, 'booking portals expanded');
assert(
  NAMED_BOOKING_PORTALS.some((p) => p.id === 'eventim'),
  'eventim portal',
);
assert(
  NAMED_BOOKING_PORTALS.some((p) => p.id === 'getyourguide'),
  'gyg portal',
);

assert(!keepCityStickyForFollowUp('Wo kann man gut essen?'), 'no sticky leak');
assert(keepCityStickyForFollowUp('wie teuer'), 'keep follow-up sticky');
assert(
  !keepCityStickyForFollowUp('Wo ist aktuell Bier im Angebot?'),
  'supermarket prospect drops sticky city',
);

assert(
  /\b(eintritt|ticketpreis|wie\s+teuer)\b/iu.test('wie teuer ist der Eintritt'),
  'ticket learn heuristic',
);

console.log('god-state-hardening: OK');
