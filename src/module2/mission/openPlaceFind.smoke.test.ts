/**
 * Open Place / Experience Find — dynamisch, kein Domänen-Hardcode.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/openPlaceFind.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  extractOpenPlaceType,
  extractOpenThemeNeed,
  isOpenPlaceFindQuery,
  isOpenExperienceQuery,
  isOpenNeedQuery,
  isRegionalOpenPlaceFind,
  openPlaceMustLabels,
  openPlaceTypeSoftScore,
  themeAttractionEvidenceScore,
  packHitTooWeakForThemeMust,
} from './openPlaceFind';
import {
  amenityPlaceMustLabels,
  isAmenityPlaceFindQuery,
} from './amenityPlaceFind';
import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import { detectLiveInventoryKind } from '../router/liveInventoryGate';
import { inferSearchPlan, inferAnswerSlot } from '../router/call1OpenWorldContract';

// Nearby-Typen
for (const [q, typ] of [
  ['Wo ist das nächste Fitnessstudio?', 'fitnessstudio'],
  ['Wo finde ich eine Kletterhalle?', 'kletterhalle'],
  ['Gibt es hier einen Schuhmacher?', 'schuhmacher'],
  ['Wo ist die nächste Waschstraße?', 'waschstraße'],
  ['Ich brauche einen Schlüsseldienst', 'schlüsseldienst'],
] as const) {
  assert.equal(extractOpenPlaceType(q), typ, `extract ${q}`);
  assert.equal(isOpenPlaceFindQuery(q), true, `open ${q}`);
  assert.ok(isAmenityPlaceFindQuery(q), `amenity gate ${q}`);
  assert.deepEqual(amenityPlaceMustLabels(q), [typ], `must ${q}`);
  assert.equal(shouldHandoffToPitchModule(q), true, `handoff ${q}`);
  assert.equal(detectLiveInventoryKind(q), 'pitch_choice', `live ${q}`);
}

// Umgangssprache Erlebnis — mehrere Beispiele, kein Domänen-Käfig
const dinoQ =
  'Boah, ich habe überlegt, irgendwie richtig geile Dinosaurier zu sehen. Wo kann ich das am besten machen?';
assert.equal(extractOpenThemeNeed(dinoQ), 'dinosaurier', 'dino theme');
assert.equal(isOpenExperienceQuery(dinoQ), true, 'dino experience');
assert.ok(isAmenityPlaceFindQuery(dinoQ), 'dino amenity gate');
assert.deepEqual(amenityPlaceMustLabels(dinoQ), ['dinosaurier'], 'dino must');
assert.equal(shouldHandoffToPitchModule(dinoQ), true, 'dino handoff');
assert.equal(inferAnswerSlot(dinoQ), 'venue_pitch', 'dino slot');

assert.equal(
  extractOpenThemeNeed('Lust auf richtig geile Schmetterlinge zu sehen'),
  'schmetterlinge',
);
assert.equal(
  extractOpenThemeNeed('Wo kann man Roboter erleben in der Nähe?'),
  'roboter',
);

// Schwache Pack-Hits verwerfen
assert.equal(
  themeAttractionEvidenceScore(
    'Souvenir Shop Dino Magnet Poster',
    'dinosaurier',
  ),
  0,
  'souvenir weak',
);
assert.ok(
  themeAttractionEvidenceScore(
    'Naturkundemuseum Dinosaurier Ausstellung Fossilien',
    'dinosaurier',
  ) >= 2,
  'museum strong',
);
assert.equal(
  packHitTooWeakForThemeMust('Café Dino Bild an der Wand', ['dinosaurier']),
  true,
  'pack too weak',
);
assert.equal(
  packHitTooWeakForThemeMust(
    'Dinosaurierpark Ausstellung Skelette Eintritt',
    ['dinosaurier'],
  ),
  false,
  'park ok',
);

// Whitelist eng lokal
assert.equal(
  isRegionalOpenPlaceFind('Wo ist die nächste Toilette?', ['toilette']),
  false,
);

// Gastro/Hotel nicht klauen
assert.equal(isOpenPlaceFindQuery('Wo ist das nächste Restaurant?'), false);

// Novel/Deep-Web Default
assert.ok(inferSearchPlan(dinoQ).preferDeepWebOnNovel, 'dino deep web');
assert.ok(
  inferSearchPlan('Wie alt ist der Papst?').preferDeepWebOnNovel,
  'papst deep web',
);
assert.equal(inferAnswerSlot('Wie alt ist der Papst?'), 'fact', 'papst fact slot');
assert.ok(isOpenNeedQuery(dinoQ), 'dino open need');

assert.ok(
  openPlaceTypeSoftScore('Fitness Park Pinneberg gym', 'fitnessstudio') >= 2,
);

console.log('openPlaceFind.smoke.test.ts OK');
