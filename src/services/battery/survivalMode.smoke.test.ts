/**
 * Survival GPS restore — Source-Vertrag.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/battery/survivalMode.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/battery/survivalMode.ts'),
  'utf8',
);
const pedo = readFileSync(
  join(process.cwd(), 'src/services/battery/pedometerSleep.ts'),
  'utf8',
);

assert(src.includes('maybeRestoreFromSurvival'), 'restore on recover');
assert(src.includes('profileBeforeSurvival'), 'remember prior profile');
assert(
  src.includes('charging') && src.includes('BatteryState.CHARGING'),
  'restore while charging',
);
assert(src.includes('pct > SURVIVAL_PCT'), 'restore when above 20%');
assert(src.includes('navOwnsGps'), 'do not fight nav');
assert(
  src.includes('addBatteryStateListener'),
  'listen battery state for plug-in',
);
assert(
  pedo.includes('profileBeforeSleep') && pedo.includes('wakeFromSleep'),
  'pedometer still restores (parity)',
);

console.log('survivalMode.smoke.test.ts OK');
