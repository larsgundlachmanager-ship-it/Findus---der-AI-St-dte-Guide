/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planWalkOrder.smoke.test.ts
 */
import {
  looksLikeBreakfastWishText,
  looksLikeEveningMealWishText,
  looksLikeLandmarkPitchText,
  looksLikeLandmarkQaText,
  pitchWalkRank,
} from './planWalkOrder';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(looksLikeBreakfastWishText('Typisch hamburgerisch frühstücken'), 'breakfast');
assert(looksLikeEveningMealWishText('Pannfisch Elbblick Sonnenuntergang'), 'evening');
assert(looksLikeLandmarkPitchText('Michel raufgehen, wie teuer das Ticket'), 'michel');
assert(looksLikeLandmarkQaText('Michel raufgehen, wie teuer das Ticket'), 'michel qa');
assert(looksLikeLandmarkPitchText('Bahn Ticket nach Hamburg') === false, 'transit ticket is not landmark');

const breakfast = { title: 'Frühstück', context: 'typisch hamburgerisch', estimatedTime: '10:00' };
const evening = {
  title: 'Pannfisch',
  context: 'Elbblick Sonnenuntergang',
  estimatedTime: '19:30',
};
const michel = { title: 'Michel', context: 'raufgehen Eintritt', estimatedTime: null };
const rest = { title: 'Café-Meeting', context: 'laptop', estimatedTime: '14:00' };
const tour = { title: 'Hamburg erkunden', context: 'Must-Haves Tour', estimatedTime: '11:30' };

assert(pitchWalkRank(breakfast) === 0, `breakfast rank ${pitchWalkRank(breakfast)}`);
assert(pitchWalkRank(michel) === 1, `michel/landmark rank ${pitchWalkRank(michel)}`);
assert(pitchWalkRank(evening) === 2, `evening rank ${pitchWalkRank(evening)}`);
assert(pitchWalkRank(rest) === 3, `rest rank ${pitchWalkRank(rest)}`);
assert(pitchWalkRank(tour) === 3, `tour last rank ${pitchWalkRank(tour)}`);

const ordered = [evening, michel, rest, breakfast, tour].sort(
  (a, b) => pitchWalkRank(a) - pitchWalkRank(b),
);
assert(ordered[0] === breakfast, 'walk starts at breakfast');
assert(ordered[1] === michel, 'then landmark');
assert(ordered[2] === evening, 'then evening meal');
assert(
  ordered.slice(3).every((w) => pitchWalkRank(w) === 3),
  'rest/tour last',
);

console.log('planWalkOrder.smoke.test.ts ok');
