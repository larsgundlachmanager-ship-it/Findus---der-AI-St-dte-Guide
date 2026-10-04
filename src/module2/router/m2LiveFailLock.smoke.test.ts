/**
 * Live-Fail-Lock static regression (Ideal Acceptance).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/m2LiveFailLock.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { looksLikeAyceQuery, normalizeAyceStt } from '../pitch/ayceIntent';
import { buildOpenWorldContract } from './call1OpenWorldContract';
import { diningExpandRingsFor } from '../pitch/searchBrief';

assert.ok(looksLikeAyceQuery('Ken Eat kein Asiatisch'));
assert.ok(normalizeAyceStt('Oyukin Eat').includes('all you can eat'));

const ow = buildOpenWorldContract({
  userText: 'Ken Eat heute Abend, kein Asiatisch',
});
assert.ok(ow.stopPolicy.forbidSoftFillOnMust);
assert.ok(ow.must.some((m) => /ayce|all_you_can_eat/i.test(m)));
assert.equal(ow.searchPlan.maxRadiusKm, 100);
assert.equal(ow.uiRequirements.openCalendar, false);

const rings = diningExpandRingsFor({
  wishes: [{ text: 'all_you_can_eat', kind: 'amenity', hardness: 'must' }],
});
assert.ok(rings.includes(100_000), 'expand to 100km');

const root = path.resolve(__dirname, '../..');
const dispatch = fs.readFileSync(
  path.join(root, 'module2/router/call1Dispatch.ts'),
  'utf8',
);
assert.ok(/ayce_blocks_events_soft|dining_blocks_events_soft/.test(dispatch));

const pub = fs.readFileSync(
  path.join(root, 'module2/pitch/publishPitchUi.ts'),
  'utf8',
);
assert.ok(/openCalendar === true/.test(pub), 'calendar gated');

const nav = fs.readFileSync(
  path.join(root, 'module2/pitch/pitchStartNav.ts'),
  'utf8',
);
assert.ok(/resolveActiveTravelMode/.test(nav), 'mode sync');

const hard = fs.readFileSync(
  path.join(root, 'module2/pitch/hardMatchVerify.ts'),
  'utf8',
);
assert.ok(/Kein belegtes All-you-can-eat/.test(hard), 'ayce hard empty');

console.log('m2LiveFailLock.smoke.test.ts OK');
