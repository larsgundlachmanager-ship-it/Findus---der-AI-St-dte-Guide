/**
 * Offline probe for the three live cases (no device).
 * Run: npx --yes --package tsx@4.19.4 tsx .cursor/live7/_probe_three_cases.ts
 */
import {
  tryLocalMathAnswer,
} from '../../src/services/speech/localInstantAnswer';
import {
  expandNavGeocodeQueries,
  looksLikeFitnessFabrikUtterance,
  repairNavDestLabel,
} from '../../src/services/navigation/navDestFuzzyRepair';

function assert(c: unknown, m: string): void {
  if (!c) throw new Error(`FAIL: ${m}`);
}

console.log('=== 1 MATH ===');
const m1 = tryLocalMathAnswer('Was ist 5 plus 5 plus 5?');
console.log(m1);
assert(m1?.lead === 'Das Ergebnis ist', 'long lead');
assert(m1?.speech === '15', '15');

const m2 = tryLocalMathAnswer('Rechne 10 mal 3 minus 2');
console.log(m2);
assert(m2?.speech === '28', '28');

console.log('=== 2 NAV FUZZY ===');
const u = 'navigiere mich zur fitting der Fabrik in Rellingen';
assert(looksLikeFitnessFabrikUtterance(u), 'fitness look');
assert(
  repairNavDestLabel('fitting der Fabrik', { userText: u }) ===
    'Fitnessfabrik Rellingen',
  'repair',
);
const alts = expandNavGeocodeQueries('fitting der Fabrik', { userText: u });
console.log(alts.slice(0, 4));
assert(alts.some((q) => /Fitnessfabrik\s+Rellingen/i.test(q)), 'alt');

const u2 = 'bring mich zu meiner Fitness in der Breklinger Hauptstrasse 39';
assert(looksLikeFitnessFabrikUtterance(u2), 'breklinger');
console.log(expandNavGeocodeQueries('Fitness', { userText: u2 }).slice(0, 4));

console.log('=== 3 WIRING ===');
const fs = require('fs') as typeof import('fs');
const turn = fs.readFileSync('src/module2/router/runConciergeTurn.ts', 'utf8');
assert(/kickCall1ParallelWork/.test(turn), 'parallel kick');
assert(/navPromise\s*=\s*hardOverrideNavigationTo/.test(turn), 'nav parallel');
assert(/buildWeatherFactChips|formatWeatherVoiceAnswer/.test(
  fs.readFileSync('src/services/ui/weatherDayPlanSpeech.ts', 'utf8'),
), 'weather chips');

console.log('three_cases probe OK (offline)');
