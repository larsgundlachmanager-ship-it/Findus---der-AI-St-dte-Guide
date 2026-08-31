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

assert(pitchWalkRank(breakfast) === 0, `breakfast rank ${pitchWalkRank(breakfast)}`);
assert(pitchWalkRank(evening) === 1, `evening rank ${pitchWalkRank(evening)}`);
assert(pitchWalkRank(michel) === 2, `michel rank ${pitchWalkRank(michel)}`);
assert(pitchWalkRank(rest) === 3, `rest rank ${pitchWalkRank(rest)}`);

const ordered = [evening, michel, rest, breakfast].sort(
  (a, b) => pitchWalkRank(a) - pitchWalkRank(b),
);
assert(ordered[0] === breakfast, 'walk starts at breakfast');
assert(ordered[1] === evening, 'then evening');
assert(ordered[2] === michel, 'then landmark');

console.log('planWalkOrder.smoke.test.ts ok');
