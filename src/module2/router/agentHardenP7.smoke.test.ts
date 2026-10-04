/**
 * P7 latency/research tier + bridge parallel doctrine.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/agentHardenP7.smoke.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  inferCall1ResearchTier,
  formatResearchTierHint,
} from './call1ResearchTier';
import { inferCall1JobShape } from './call1JobShape';

const instant = inferCall1ResearchTier({
  userText: 'Wie alt ist Angela Merkel?',
  jobShape: 'fact_lookup',
});
assert.equal(instant.tier, 'instant');
assert.ok(instant.bridgeMaxWords <= 24);

const cover = inferCall1ResearchTier({
  userText: 'Pizza mit Rucola in der Nähe',
  jobShape: 'place_dining',
});
assert.equal(cover.tier, 'cover');
assert.ok(cover.parallelWorkExpected);
assert.ok(formatResearchTierHint(cover).includes('cover'));

assert.equal(inferCall1JobShape('Pizza mit Rucola'), 'place_dining');

const contract = fs.readFileSync(
  path.join(process.cwd(), 'docs/rfc/agent-harden-contract.md'),
  'utf8',
);
assert.ok(/call1ResearchTier/.test(contract), 'contract documents tiers');
assert.ok(/kickCall1ParallelWork/.test(contract), 'contract documents parallel bridge');

console.log('agentHardenP7.smoke.test.ts OK');
