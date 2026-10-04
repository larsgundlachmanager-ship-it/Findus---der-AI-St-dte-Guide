/**
 * Hauptort vor dir: kein Open-Quiet, nach M2 schon nach 30 s.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/module1HauptortGate.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname);
const policy = readFileSync(join(root, 'modulePriorityPolicy.ts'), 'utf8');

assert.match(policy, /MODULE1_MAIN_AFTER_M2_MS\s*=\s*30_000/, '30s after M2 for main');
assert.match(policy, /canSpeakHauptort/, 'hauptort gate helper');
assert.match(
  policy,
  /kind === 'main'[\s\S]*canSpeakHauptort/,
  'main uses hauptort path',
);
assert.doesNotMatch(
  /function canSpeakHauptort[\s\S]*?^}/m.exec(policy)?.[0] ?? '',
  /isOpenQuietActive/,
  'hauptort path must not check open quiet',
);

const ambient = readFileSync(join(root, '../research/ambientEventPitch.ts'), 'utf8');
assert.match(ambient, /canSpeakExploreEvent\('other'/, 'ambient is not hauptort');

const walkBy = readFileSync(join(root, '../research/venueWalkByPitch.ts'), 'utf8');
assert.match(walkBy, /canSpeakExploreEvent\('other'/, 'walk-by is not hauptort');

const quiet = readFileSync(join(root, 'openQuietGate.ts'), 'utf8');
assert.match(quiet, /Hauptort/, 'quiet docs mention hauptort exemption');

console.log('module1HauptortGate.smoke.test.ts OK');
