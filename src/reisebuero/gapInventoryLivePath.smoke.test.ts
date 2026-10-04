/**
 * Live-Pfad Smoke: langer Dump → gap_fill → nur Lücken, keine Kern-Reasks.
 * (Device-QA prüft denselben Dump am Handy.)
 */
import { parseBriefSlots } from './parseBriefSlots';
import { mergeLedger, cloneEmptyLedger } from './slotLedger';
import { deriveInventoryMode, inventoryGapLabels, inventoryHaveLabels } from './gapInventory';
import { nextQuestionKey } from './completeness';
import { inventoryRecapHint, isInventoryGapFill } from './inventoryRecap';

const DUMP =
  'Also wir sind zu viert, Oktober, Budget so 400 Euro pro Person, Hotel in Lissabon haben wir schon gebucht, Flug fehlt noch, Transfer brauchen wir auch noch, und Mietwagen waere nice, Party und Pool waere cool';

const led = mergeLedger(cloneEmptyLedger(), parseBriefSlots(DUMP));
const next = nextQuestionKey(led, []);

const report = {
  adults: led.adults?.value,
  bookedStay: led.bookedStay?.value,
  bookedFlight: led.bookedFlight?.value,
  bookedTransfer: led.bookedTransfer?.value,
  needCar: led.needCar?.value,
  destinationHint: led.destinationHint?.value,
  lodgingKind: led.lodgingKind?.value,
  originCity: led.originCity?.value,
  mode: led.mode?.value,
  inventoryMode: led.inventoryMode?.value,
  derive: deriveInventoryMode(led),
  gapFill: isInventoryGapFill(led),
  have: inventoryHaveLabels(led),
  gaps: inventoryGapLabels(led),
  recap: inventoryRecapHint(led),
  nextKey: next.key,
  nextLabel: next.label,
};

console.log(JSON.stringify(report, null, 2));

if (!isInventoryGapFill(led) && deriveInventoryMode(led) !== 'gap_fill') {
  throw new Error('expected gap_fill');
}
if (led.bookedStay?.value !== true) throw new Error('stay booked');
if (led.bookedFlight?.value !== false) throw new Error('flight need');
if (['purpose', 'adults', 'when', 'budget', 'lodging'].includes(next.key)) {
  throw new Error(`should not reask core ${next.key}`);
}
if (!inventoryHaveLabels(led).includes('Unterkunft')) throw new Error('have Unterkunft');
if (!inventoryGapLabels(led).some((g) => /Flug/i.test(g))) {
  throw new Error(`gaps missing Flug ${inventoryGapLabels(led)}`);
}
if (!inventoryGapLabels(led).some((g) => /Transfer|Mietwagen/i.test(g))) {
  throw new Error(`gaps thin ${inventoryGapLabels(led)}`);
}
if (!/lissabon/i.test(led.destinationHint?.value || '')) {
  throw new Error(`dest expected Lissabon got ${led.destinationHint?.value}`);
}
if (led.bookedTransfer?.value !== false) {
  throw new Error(`transfer need expected false got ${led.bookedTransfer?.value}`);
}

console.log('gapInventoryLivePath.smoke.test.ts ok');
