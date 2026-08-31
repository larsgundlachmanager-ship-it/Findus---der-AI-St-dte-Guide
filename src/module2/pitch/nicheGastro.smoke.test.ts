/**
 * Niche-Gastro — Rinderrasse + Zugrestaurant Detect/Score.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/nicheGastro.smoke.test.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const {
  looksLikeCattleBreed,
  looksLikeTrainRestaurant,
  canonicalCattleBreed,
  scoreSpecializedFoodWish,
  queryNeedsLiveFoodResearch,
} = require('./specializedFoodMatch') as typeof import('./specializedFoodMatch');

const { parseWishesFromText } = require('./parentBrief') as typeof import('./parentBrief');
const { classifyJob } = require('../jobs/classifyJob') as typeof import('../jobs/classifyJob');
const { inferGastroFacetTags } = require('./gastroFacetTags') as typeof import('./gastroFacetTags');

assert(looksLikeCattleBreed('Black Angus Steak bitte'), 'breed detect');
assert(canonicalCattleBreed('Wagyu vom Grill') === 'wagyu', 'wagyu canon');
assert(canonicalCattleBreed('Fleckvieh-Steak') === 'fleckvieh', 'fleckvieh');
assert(looksLikeTrainRestaurant('Zugrestaurant Speisewagen'), 'train dining');
assert(!looksLikeTrainRestaurant('letzter Zug nach Hamburg'), 'no transit steal');

const angusWish = parseWishesFromText('Restaurant mit Angus-Fleisch');
assert(
  angusWish.some((w) => w.kind === 'dish' && w.text === 'angus'),
  `angus wish got ${JSON.stringify(angusWish)}`,
);

const zugWish = parseWishesFromText('Essen im Speisewagen / Zugrestaurant');
assert(
  zugWish.some((w) => w.kind === 'amenity' && w.text === 'zugrestaurant'),
  `zug wish got ${JSON.stringify(zugWish)}`,
);

assert(
  scoreSpecializedFoodWish('Black Angus Grill Steakhouse', {
    text: 'angus',
    hardness: 'must',
    kind: 'dish',
  }) === 3,
  'angus hard hit',
);
assert(
  scoreSpecializedFoodWish('Landgasthof Steakhouse', {
    text: 'angus',
    hardness: 'must',
    kind: 'dish',
  }) === 1,
  'angus soft family',
);
assert(
  scoreSpecializedFoodWish('Vegan Bowl Hub', {
    text: 'angus',
    hardness: 'must',
    kind: 'dish',
  }) === 0,
  'angus not vegan',
);
assert(
  scoreSpecializedFoodWish('Restaurant Speisewagen Eisenbahn', {
    text: 'zugrestaurant',
    hardness: 'must',
    kind: 'amenity',
  }) === 3,
  'zug hard',
);
assert(
  scoreSpecializedFoodWish('Bahnhof Imbiss', {
    text: 'zugrestaurant',
    hardness: 'must',
    kind: 'amenity',
  }) === 0,
  'no bahnhof imbiss',
);

assert(queryNeedsLiveFoodResearch('Angus Steak Hamburg'), 'live angus');
assert(queryNeedsLiveFoodResearch('Zugrestaurant Kiel'), 'live zug');

const angusJob = classifyJob('Restaurant mit Angus-Steak');
assert(angusJob.jobId === 'dining_hard_match', `angus job ${angusJob.jobId}`);
assert(
  (angusJob.mustHaves ?? []).some((m) => /Angus/i.test(m)),
  'angus mustHave',
);

const zugJob = classifyJob('Gibt es ein Zugrestaurant oder Speisewagen?');
assert(zugJob.jobId === 'dining_hard_match', `zug job ${zugJob.jobId}`);
assert(zugJob.jobId !== 'transit_live', 'zug not transit');
assert(
  !(zugJob.secondaryJobIds ?? []).includes('transit_live'),
  'zug no transit secondary',
);

const transitJob = classifyJob('Wie komme ich mit dem Zug nach Hamburg?');
assert(transitJob.jobId === 'transit_live', 'plain zug stays transit');

const facets = inferGastroFacetTags('Black Angus Steakhouse', 'Wagyu auf der Karte');
assert(facets.includes('angus') || facets.includes('wagyu'), 'facet breed');

console.log('nicheGastro.smoke OK');
