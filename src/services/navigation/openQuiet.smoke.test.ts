/**
 * Open-Quiet: 5 Min nach App-Open keine ungefragten Automationen.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/openQuiet.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OPEN_QUIET_MS,
  bootstrapOpenQuietGate,
  getOpenQuietRemainingMs,
  isOpenQuietActive,
  noteAppOpenedQuiet,
  resetOpenQuietGateForTests,
} from './openQuietGate';

resetOpenQuietGateForTests();
assert.equal(isOpenQuietActive(1_000), false, 'quiet off before arm');

const t0 = 1_000_000;
noteAppOpenedQuiet(t0);
assert.equal(isOpenQuietActive(t0), true, 'quiet active at open');
assert.equal(isOpenQuietActive(t0 + OPEN_QUIET_MS - 1), true, 'quiet until 5min');
assert.equal(isOpenQuietActive(t0 + OPEN_QUIET_MS), false, 'quiet ends at 5min');
assert.equal(getOpenQuietRemainingMs(t0), OPEN_QUIET_MS, 'remaining full');

resetOpenQuietGateForTests();
bootstrapOpenQuietGate();
assert.equal(isOpenQuietActive(), true, 'bootstrap arms quiet');
assert.ok(getOpenQuietRemainingMs() > 0, 'bootstrap remaining > 0');
resetOpenQuietGateForTests();

const root = join(__dirname);
const policy = readFileSync(join(root, 'modulePriorityPolicy.ts'), 'utf8');
assert.match(policy, /isOpenQuietActive/, 'policy gates on open quiet');
assert.match(policy, /open_quiet/, 'policy reason open_quiet');
assert.match(policy, /from '\.\/openQuietGate'/, 'policy imports gate');

const wiring = [
  '../memory/welcomeBackService.ts',
  '../logistics/logisticsTriggerEngine.ts',
  '../research/ambientEventPitch.ts',
  '../ui/proactiveReminderEngine.ts',
  '../planning/tickDeadlineWatcher.ts',
  '../../runtime/mobilityModule.ts',
  '../../../App.tsx',
];
for (const rel of wiring) {
  const src = readFileSync(join(root, rel), 'utf8');
  assert.match(
    src,
    /isOpenQuietActive|bootstrapOpenQuietGate/,
    `wired: ${rel}`,
  );
}

console.log('openQuiet.smoke.test.ts OK');
