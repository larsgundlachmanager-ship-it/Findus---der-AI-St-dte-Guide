/**
 * Pitch clear räumt Concierge-Card mit ab (kein Doppel-✕).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/pitchUiExclusive.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const publish = readFileSync(join(root, 'src/module2/pitch/publishPitchUi.ts'), 'utf8');
const present = readFileSync(
  join(root, 'src/services/concierge/presentConcierge.ts'),
  'utf8',
);
const slot = readFileSync(join(root, 'src/components/PitchChoiceSlot.tsx'), 'utf8');
const stage = readFileSync(join(root, 'src/components/liveStage/LiveStage.tsx'), 'utf8');

assert.match(publish, /Pitch ersetzt Spickzettel/, 'setPitch clears card');
assert.match(publish, /nie nach Pitch-Close die Card wieder aufpoppen/, 'clear clears card');
assert.match(present, /pitchWasLive/, 'present remembers pitch before wait');
assert.match(present, /suppressCard/, 'present suppresses revive after pitch close');
assert.match(present, /Pitch-Auswahl ODER Stichpunkte/, 'present skips card while pitch live');
assert.match(slot, /dismissConciergeCard/, 'close stops voice + card');
assert.match(
  stage,
  /hasBullets && !hasPitch/,
  'LiveStage exclusive bullets vs pitch',
);

console.log('pitchUiExclusive.smoke: ok');
