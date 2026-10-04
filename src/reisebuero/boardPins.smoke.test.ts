import { pinUserAnswer, boardPinsEntry, structuredCoversAsk, shortOpenAskLabel } from './boardPins';
import { applyAskedContext, parseBriefSlots } from './parseBriefSlots';
import { buildFlipchartNotes } from './flipchartNotes';
import { cloneEmptyLedger, mergeLedger, entry } from './slotLedger';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(shortOpenAskLabel('locationBias', 'Eher zentral oder ruhig und abgeschieden?') === 'Lage?', 'short open');
assert(shortOpenAskLabel(null, 'Lange Speech-Frage hier?') === '?', 'no key → ?');

const openNotes = buildFlipchartNotes(cloneEmptyLedger(), {
  openQuestion: 'Ist euch eher zentral oder richtig ruhig und abgeschieden am liebsten?',
  openAskKey: 'locationBias',
});
const oq = openNotes.find((n) => n.id === 'openQ');
assert(oq?.emoji === '❓', 'open emoji');
assert(oq?.label === 'Lage?', `open short ${oq?.label}`);
assert(!/zentral oder/i.test(oq?.label || ''), 'no full question on sticker');

const pin = pinUserAnswer('locationBias', 'Restaurants in Gehweite wäre cool');
assert(pin && pin.id === 'ask:locationBias', `pin ${pin?.id}`);
assert(/^Lage:/i.test(pin!.label) && pin!.label.length <= 32, `short answer ${pin!.label}`);
const led = mergeLedger(cloneEmptyLedger(), {
  boardPins: boardPinsEntry([pin!]),
});
const notes = buildFlipchartNotes(led);
assert(
  notes.some((n) => n.id === 'ask:locationBias' || /Lage|Gehweite|Restaurant/i.test(n.label)),
  `board shows pin ${notes.map((n) => n.label).join('|')}`,
);

const withBias = mergeLedger(led, {
  locationBias: entry('near_activity' as const, 'user'),
});
assert(structuredCoversAsk('locationBias', withBias), 'structured covers');
const notes2 = buildFlipchartNotes(withBias);
assert(!notes2.some((n) => n.id === 'ask:locationBias'), 'preview pin hidden when structured');
assert(notes2.some((n) => n.id === 'bias'), 'bias sticker present');

const lage = applyAskedContext(
  'eher ruhig und abgeschieden',
  'locationBias',
  parseBriefSlots('eher ruhig und abgeschieden'),
);
assert(lage.locationBias?.value === 'quiet_outskirts', `bias ${lage.locationBias?.value}`);

const whirl = parseBriefSlots('unbedingt einen Whirlpool');
assert(whirl.mustHaves?.value?.includes('pool') || whirl.wishHaves?.value?.includes('pool'), 'pool from whirl');
assert((whirl.mustActivities?.value ?? []).some((a) => /Whirlpool/i.test(a)), 'whirl activity');

const ages = applyAskedContext(
  'ich 34, er 36, eine hat Bahncard',
  'ages',
  parseBriefSlots('ich 34, er 36, eine hat Bahncard'),
);
assert(ages.bahncard?.value === '25', `bc ${ages.bahncard?.value}`);
assert(
  (ages.travelerAges?.value ?? []).includes(34) && (ages.travelerAges?.value ?? []).includes(36),
  `ages ${ages.travelerAges?.value}`,
);
const ageBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), ages));
assert(ageBoard.some((n) => n.id === 'bahncard'), 'bahncard sticker');
assert(ageBoard.some((n) => n.id === 'ages'), 'ages sticker');

console.log('boardPins.smoke ok');
