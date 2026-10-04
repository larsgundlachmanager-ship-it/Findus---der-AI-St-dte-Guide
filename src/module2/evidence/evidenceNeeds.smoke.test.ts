/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/evidence/evidenceNeeds.smoke.test.ts
 */
import {
  deriveEvidenceNeeds,
  extractEvidenceItems,
  needsKey,
} from './evidenceNeeds';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const items = extractEvidenceItems('Wo gibt es die beste Rucola-Pizza?');
assert(
  items.some((i) => /rucola/i.test(i)),
  `rucola item expected, got ${JSON.stringify(items)}`,
);

const pizza = deriveEvidenceNeeds({
  userText: 'beste Rucola-Pizza heute Abend',
  jobId: 'dining_hard_match',
});
assert(needsKey(pizza, 'menu_deeplink'), 'menu');
assert(needsKey(pizza, 'item_price'), 'price');
assert(needsKey(pizza, 'review_item_evidence'), 'review');
assert(needsKey(pizza, 'two_options'), 'two opts');

const sup = deriveEvidenceNeeds({
  userText: 'SUP auf der Alster, wie teuer?',
  jobId: 'activity_sport',
});
assert(needsKey(sup, 'item_price'), 'sup price');
assert(needsKey(sup, 'two_options'), 'sup opts');

const learned = deriveEvidenceNeeds({
  userText: 'nochmal essen',
  jobId: 'dining_open',
  learnedExpects: ['menu', 'prices'],
});
assert(needsKey(learned, 'menu_deeplink'), 'learned menu');
assert(needsKey(learned, 'item_price'), 'learned price');

// Anderes Gericht ohne Hardcode-Liste
const bowl = deriveEvidenceNeeds({
  userText: 'Wo gibt es die beste Poke-Bowl?',
  jobId: 'dining_hard_match',
});
assert(
  bowl.items.some((i) => /poke|bowl/i.test(i)),
  `poke item, got ${JSON.stringify(bowl.items)}`,
);
assert(needsKey(bowl, 'review_item_evidence'), 'poke review need');

console.log('evidenceNeeds.smoke.test.ts ok');
