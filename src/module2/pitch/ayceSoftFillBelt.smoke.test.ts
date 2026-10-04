/**
 * Belt: AYCE never soft-fills plain restaurants (Goldschätzchen-style).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/ayceSoftFillBelt.smoke.test.ts
 */
import { scoreAyceEvidence } from './hardMatchVerify';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const goldBlob =
  'Goldschätzchen Wein- & Biergarten Abendessen Restaurant à la carte Biergarten Fairway Golf';
assert(scoreAyceEvidence(goldBlob) < 2, 'goldschaetzchen never ayce evidence');

const weakPack = 'Restaurant Peiner Hof Abendessen Fleisch Salatangebot';
assert(scoreAyceEvidence(weakPack) < 2, 'generic abendessen not ayce');

const real = 'Dubrovnik All you can eat Buffet Flatrate Grill';
assert(scoreAyceEvidence(real) >= 2, 'real ayce passes');

/** Simulate belt filter used in runPitchModule */
function beltFilter(
  shortlist: Array<{ name: string; softTags?: string[]; hardEvidence?: string[] }>,
): typeof shortlist {
  return shortlist.filter((c) => {
    const blob = `${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')}`;
    return scoreAyceEvidence(blob) >= 2;
  });
}

const leaked = beltFilter([
  { name: 'Goldschätzchen', softTags: ['restaurant', 'abendessen'], hardEvidence: [] },
  { name: 'Dubrovnik', softTags: ['buffet'], hardEvidence: ['all you can eat'] },
]);
assert(leaked.length === 1 && /dubrovnik/i.test(leaked[0].name), 'belt drops gold keeps ayce');
assert(
  beltFilter([{ name: 'Goldschätzchen', softTags: ['café'], hardEvidence: [] }]).length === 0,
  'belt empties pure soft-fill',
);

{
  const { looksLikeAsianCuisineVenue } = require('./specializedFoodMatch') as {
    looksLikeAsianCuisineVenue: (b: string) => boolean;
  };
  assert(
    looksLikeAsianCuisineVenue('Speisekontor asiatisches Buffet sushi'),
    'speisekontor-style asia is asian',
  );
}

console.log('ayceSoftFillBelt.smoke.test.ts OK');
