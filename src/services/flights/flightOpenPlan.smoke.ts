/**
 * Smoke: open-plan Hotel-Kontext + Gepäck-Chip schließt pendingAsk.
 */
import assert from 'node:assert/strict';
import {
  enrichOpenWishFromFlight,
  lateCheckInFloorHm,
} from './flightOpenPlanContext';
import { resolveChoiceSlotFromPrompt } from '../../module2/router/choiceTurnContext';
import { parseHotelAmenityNeeds } from '../concierge/hotelHardMatch';

const late = lateCheckInFloorHm(new Date(2026, 7, 31, 21, 55, 0, 0).getTime(), 65);
assert.equal(late, '23:00', `late check-in floor ${late}`);

const wish = enrichOpenWishFromFlight(
  {
    id: 'ft:TEST:hotel',
    title: 'Hotel?',
    priority: 5,
    context: 'Noch offen — Hotel in Ziel.',
    estimatedTime: null,
  },
  'hotel',
);
assert.match(wish.title, /Hotel/i, 'hotel title kept/enriched');
// ohne Live-Watch: zumindest Basis-Kontext
assert.ok(wish.context && wish.context.length > 10, 'context present');

const withLate = enrichOpenWishFromFlight(
  {
    id: 'ft:X:hotel',
    title: 'Hotel?',
    priority: 5,
    context:
      'Ziel Athen · Ankunft Flughafen ~21:55; Transfer Flughafen zur Unterkunft; Spät-Check-in nötig (mind. bis ~23:00 Check-in möglich); late check-in 24h Rezeption',
    estimatedTime: null,
  },
  'hotel',
);
const needs = parseHotelAmenityNeeds(withLate.context || '');
assert.ok(
  needs.some((n) => n.id === 'late_checkin'),
  `late_checkin amenity from context: ${needs.map((n) => n.id).join(',')}`,
);

const bag = resolveChoiceSlotFromPrompt('Mit Aufgabegepäck', 'Aufgabegepäck');
assert.ok(bag && bag.slotKey === 'baggage_type', 'baggage slot');
assert.equal(bag?.inventoryPatch?.luggage, 'checked');

const carry = resolveChoiceSlotFromPrompt('Nur Handgepäck', 'Handgepäck');
assert.ok(carry && carry.slotKey === 'baggage_type', 'carry slot');
assert.equal(carry?.inventoryPatch?.luggage, 'carry');

console.log('flightOpenPlan.smoke: ok');
