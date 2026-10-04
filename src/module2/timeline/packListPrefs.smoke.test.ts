/**
 * Pack-Prefs → LearnedRule tags + Packlisten-Filter.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListPrefs.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyPackListPrefs,
  draftPackPrefLearnedRule,
  looksLikePackPreference,
  parsePackPrefsFromText,
  prefsFromLearnedRules,
} from './packListPrefs';
import { buildPackListItems } from './packListBuilder';
import type { LearnedRule } from '../../types/learnedRules';
import type { PackListItem } from '../../store/usePackListStore';

assert.equal(looksLikePackPreference('Nie Pulli einpacken'), true);
assert.equal(looksLikePackPreference('Was geht heute?'), false);

const neverPulli = parsePackPrefsFromText('Merke dir: nie Pulli');
assert.deepEqual(neverPulli.avoid, ['pulli']);
assert.equal(neverPulli.prefer.length, 0);

const alwaysPb = parsePackPrefsFromText('Immer Powerbank mitnehmen');
assert.ok(alwaysPb.prefer.includes('powerbank'));

const draft = draftPackPrefLearnedRule(neverPulli);
assert.ok(draft);
assert.equal(draft!.intentFamily, 'packing');
assert.ok(draft!.tags.includes('pack_avoid:pulli'));
assert.ok(draft!.expect.includes('pack_prefs'));

const rule: LearnedRule = {
  id: 'lr_test',
  scope: 'user',
  intentFamily: 'packing',
  tags: ['pack_avoid:pulli', 'pack_prefer:powerbank', 'packing'],
  expect: ['pack_prefs'],
  avoid: ['pack_unwanted_items'],
  summary: 'Pack-Prefs: nie pulli, immer powerbank',
  strength: 0.7,
  hitCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const fromRules = prefsFromLearnedRules([rule]);
assert.deepEqual(fromRules.avoid, ['pulli']);
assert.deepEqual(fromRules.prefer, ['powerbank']);

const items: PackListItem[] = [
  {
    id: '1',
    label: 'Warme Jacke / Pulli',
    reason: 'Kühl',
    done: false,
    category: 'cold',
  },
  {
    id: '2',
    label: 'T-Shirt / Oberteil',
    reason: 'Basis',
    done: false,
    category: 'clothes',
  },
];
const applied = applyPackListPrefs(items, fromRules);
assert.equal(
  applied.items.some((i) => /pulli/i.test(i.label)),
  false,
  'pulli removed',
);
assert.ok(
  applied.items.some((i) => /powerbank/i.test(i.label)),
  'powerbank added',
);

const list = buildPackListItems({
  userText: 'Packliste 3 Tage Stadt — nie Pulli, immer Powerbank',
  tripDays: 3,
  tempC: 12,
  rainLikely: true,
});
assert.equal(
  list.items.some((i) => /pulli|pullover|sweater/i.test(i.label)),
  false,
  'builder removes pulli',
);
assert.ok(
  list.items.some((i) => /powerbank/i.test(i.label)),
  'builder keeps/adds powerbank',
);
assert.ok(list.evidenceNotes.some((n) => /prefs|nie /i.test(n)));

const viaCtx = buildPackListItems({
  userText: 'Packliste 2 Tage',
  tripDays: 2,
  tempC: 10,
  packPrefs: { avoid: ['anzug'], prefer: [], notes: ['nie Anzug'] },
});
assert.equal(
  viaCtx.items.some((i) => /anzug/i.test(i.label)),
  false,
);

console.log('packListPrefs.smoke.test.ts OK');
