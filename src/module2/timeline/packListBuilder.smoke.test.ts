/**
 * Packliste Builder + Mengen/Aktivitäten/Waschmaschine/Kids/Meds smokes (ohne Netz).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListBuilder.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildPackListItems,
  clothingQuantities,
  detectKidsPackProfile,
  detectLaundryAccess,
  detectMedNeeds,
  detectPackActivities,
  detectPackTripKinds,
  inferTripDays,
  looksLikePackListAsk,
} from './packListBuilder';
import { looksLikeTravelScheduleWriteJob } from './travelScheduleHarden';
import { inferCall1JobShape } from '../router/call1JobShape';

assert.equal(
  looksLikePackListAsk('Kannst du mir eine Packliste erstellen?'),
  true,
);
assert.equal(looksLikePackListAsk('Was geht heute Abend?'), false);
assert.equal(
  looksLikePackListAsk('Ja, Waschmaschine vor Ort — Packliste aktualisieren'),
  true,
);

assert.equal(detectLaundryAccess('Ja, Waschmaschine im Hotel'), 'yes');
assert.equal(detectLaundryAccess('Keine Waschmaschine'), 'no');
assert.equal(detectLaundryAccess('Packliste für 7 Tage'), 'unknown');

assert.equal(inferTripDays('7 Nächte Mein Schiff'), 8);
assert.equal(inferTripDays('Packliste für 5 Tage'), 5);
assert.equal(
  inferTripDays('Reise 2026-09-20 – 2026-09-27'),
  8,
);

const q = clothingQuantities({
  tripDays: 7,
  warm: true,
  cool: false,
  active: false,
});
assert.equal(q.tshirts, 8, '7+1 shirts');
assert.ok(q.pants >= 3 && q.pants <= 5, `pants ${q.pants}`);
assert.ok(q.shorts >= 1, 'shorts warm');
assert.equal(q.underwear, 8);

const qWash = clothingQuantities({
  tripDays: 8,
  warm: true,
  cool: false,
  active: false,
  laundry: true,
});
assert.ok(
  qWash.tshirts <
    clothingQuantities({
      tripDays: 8,
      warm: true,
      cool: false,
      active: false,
      laundry: false,
    }).tshirts,
  'laundry fewer shirts',
);

const shortTrip = buildPackListItems({
  userText: 'Packliste 5 Tage Strand',
  tripDays: 5,
  tempC: 24,
  sunnyOrWarm: true,
});
assert.equal(shortTrip.askLaundry, false, 'unter 7 Tagen nicht fragen');
assert.equal(shortTrip.laundryAccess, 'unknown');

const longAsk = buildPackListItems({
  userText: 'Packliste für 7 Nächte Kreuzfahrt',
  tripDays: 8,
  tempC: 22,
  sunnyOrWarm: true,
});
assert.equal(
  longAsk.askLaundry,
  false,
  'nie User nach Waschmaschine fragen',
);

const withLaundry = buildPackListItems({
  userText: 'Packliste aktualisieren: Ja, Waschmaschine vor Ort',
  tripDays: 8,
  laundryAccess: 'yes',
  tempC: 22,
  sunnyOrWarm: true,
});
assert.equal(withLaundry.askLaundry, false);
assert.equal(withLaundry.laundryAccess, 'yes');
const shirtsWash = withLaundry.items.find((i) =>
  /t-shirt|oberteil/i.test(i.label),
);
const shirtsFull = longAsk.items.find((i) => /t-shirt|oberteil/i.test(i.label));
assert.ok(shirtsWash && shirtsFull);
assert.ok(
  (shirtsWash!.qty ?? 99) < (shirtsFull!.qty ?? 0),
  'yes laundry → fewer shirts',
);
assert.ok(
  withLaundry.items.some((i) => /waschmittel|wäsch/i.test(i.label)),
);

const { reapplyLaundryQuantities } = require('./packListBuilder') as typeof import('./packListBuilder');
const recomputed = reapplyLaundryQuantities(longAsk.items, {
  tripDays: 8,
  laundry: true,
  warm: true,
});
const shirtRe = recomputed.find((i) => /t-shirt|oberteil/i.test(i.label));
assert.ok(shirtRe && (shirtRe.qty ?? 99) < (shirtsFull!.qty ?? 0), 'reapply laundry');
const noWash = reapplyLaundryQuantities(recomputed, {
  tripDays: 8,
  laundry: false,
  warm: true,
});
assert.ok(
  !noWash.some((i) => /waschmittel/i.test(i.label)),
  'detergent removed without laundry',
);

const cruise = buildPackListItems({
  userText: 'Packliste für die Mein Schiff Kreuzfahrt 7 Nächte nach Danzig',
  locationHint: 'Kiel',
  tempC: 24,
  rainLikely: false,
  sunnyOrWarm: true,
  timelineBlob: 'Hafen · Gdynia · Pool · Spa',
  activityHints: ['spa', 'swim'],
});
assert.equal(cruise.tripDays, 8);
assert.ok(cruise.tripKinds.includes('cruise'));
assert.ok(
  cruise.activities.includes('swim') || cruise.activities.includes('spa'),
);
assert.ok(
  cruise.items.some((i) => /reisepass|ausweis/i.test(i.label)),
  'passport',
);
assert.ok(cruise.items.some((i) => /badehose/i.test(i.label)), 'swim');
const shirt = cruise.items.find((i) => /t-shirt|oberteil/i.test(i.label));
assert.ok(shirt, 'shirt row');
assert.equal(shirt!.qty, 9, '8 Tage → 9 Shirts (+Puffer)');
assert.ok(
  cruise.items.some((i) => /lange hose/i.test(i.label) && (i.qty ?? 0) >= 3),
  'dynamic pants',
);
assert.ok(cruise.items.some((i) => /sonnencreme/i.test(i.label)), 'spf');
assert.ok(
  cruise.items.some((i) => /seekrank|übelkeit|uebelkeit/i.test(i.label)),
  'cruise soft seasick',
);
assert.ok(
  cruise.items.some(
    (i) => i.category === 'meds' && /schmerz|pflaster/i.test(i.label),
  ),
  'soft med kit',
);

const formal = buildPackListItems({
  userText: 'Packliste — Theaterpremiere, ich brauch den Anzug',
  tempC: 12,
  rainLikely: true,
  tripDays: 2,
});
assert.ok(formal.items.some((i) => /anzug/i.test(i.label)), 'suit');
assert.ok(
  formal.items.some((i) => /regen|jacke/i.test(i.label)),
  'rain gear',
);

assert.ok(detectPackTripKinds('Flug LH400', 'Boarding').includes('flight'));
assert.ok(
  detectPackActivities('Stadt', 'Museum Altstadt Wandern').includes('hike'),
);

const babyProf = detectKidsPackProfile({
  userText: 'Packliste mit Baby 8 Monate und 2 Kinder',
  childrenCount: 2,
});
assert.ok(babyProf.present);
assert.ok(babyProf.bands.includes('baby'), `bands ${babyProf.bands}`);

const kidsList = buildPackListItems({
  userText: 'Packliste 5 Tage Strand mit zwei Kindern — 2 und 8 Jahre',
  tripDays: 5,
  tempC: 26,
  sunnyOrWarm: true,
  childAgesYears: [2, 8],
  childrenCount: 2,
});
assert.ok(kidsList.activities.includes('kids'));
assert.ok(
  kidsList.items.some((i) => i.category === 'kids' && /windel/i.test(i.label)),
  'toddler diapers',
);
assert.ok(
  kidsList.items.some((i) => /beschäftigung|buch|spiel/i.test(i.label)),
  'child activity',
);
assert.ok(
  kidsList.items.some((i) => /kindersonnencreme/i.test(i.label)),
  'kids spf',
);
assert.ok(
  kidsList.items.some((i) => /fieberthermometer/i.test(i.label)),
  'young kids thermometer',
);
assert.equal(
  kidsList.items.some((i) => /epipen|antihistamin/i.test(i.label)),
  false,
  'no allergy invent',
);

const allergyList = buildPackListItems({
  userText:
    'Packliste 3 Tage — bitte Allergie-Notfallset und Asthma-Inhalator mitdenken',
  tripDays: 3,
});
assert.ok(
  allergyList.items.some((i) => /antihistamin|allergie/i.test(i.label)),
  'allergy kit',
);
assert.ok(
  allergyList.items.some((i) => /inhalator|asthma/i.test(i.label)),
  'asthma',
);
assert.ok(detectMedNeeds('meine Allergie und Asthma').allergy);
assert.ok(detectMedNeeds('meine Allergie und Asthma').asthma);

const kidsFromText = buildPackListItems({
  userText: 'Packliste 4 Tage — mit zwei Kindern 2 und 8 Jahre, Strand',
  tripDays: 4,
  tempC: 25,
  sunnyOrWarm: true,
});
assert.ok(kidsFromText.activities.includes('kids'));
assert.ok(
  kidsFromText.items.some((i) => /windel/i.test(i.label)),
  'ages from „2 und 8 Jahre“',
);

assert.equal(
  looksLikeTravelScheduleWriteJob(
    'Erstell mir eine Packliste für die Kreuzfahrt',
  ),
  true,
);
assert.equal(
  inferCall1JobShape('Packliste mit Reisepass und Badhose'),
  'schedule_write',
);

console.log('packListBuilder.smoke.test.ts OK');
