/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/navDestFuzzyRepair.smoke.test.ts
 */
import {
  expandNavGeocodeQueries,
  looksLikeFitnessFabrikUtterance,
  repairNavDestLabel,
} from './navDestFuzzyRepair';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// STT-Garnitur: „fitting der Fabrik“ + Stadt → Multi-Signal, kein Blind-Rewrite
assert(
  looksLikeFitnessFabrikUtterance('navigiere mich zur fitting der Fabrik in Rellingen'),
  'fitting+fabrik+city',
);
assert(
  !looksLikeFitnessFabrikUtterance('zeig mir die alte Fabrik'),
  'bare fabrik alone = no',
);
assert(
  looksLikeFitnessFabrikUtterance(
    'bring mich zu meiner Fitness in der Breklinger Hauptstraße 39',
  ),
  'fitness + Breklinger Hauptstraße 39',
);

const fittingAlts = expandNavGeocodeQueries('fitting der Fabrik', {
  userText: 'navigiere mich zur fitting der Fabrik in Rellingen',
});
assert(
  fittingAlts.some((q) => /Fitnessfabrik\s+Rellingen/i.test(q)),
  'expands Fitnessfabrik Rellingen',
);
assert(
  /Fitnessfabrik\s+Rellingen/i.test(fittingAlts[0] || ''),
  'brand candidate first for latency',
);
assert(
  fittingAlts.some((q) => /Hauptstraße\s*39/i.test(q)),
  'expands Hauptstraße 39 Rellingen',
);
assert(
  fittingAlts.some((q) => q === 'fitting der Fabrik'),
  'original kept as fallback',
);

const repaired = repairNavDestLabel('fitting der Fabrik', {
  userText: 'zur fitting der Fabrik in Rellingen bitte',
});
assert(repaired === 'Fitnessfabrik Rellingen', `label repair got ${repaired}`);

// Ohne Stadt: Label nicht erzwingen — Expand sucht trotzdem
const noCity = repairNavDestLabel('fitting der Fabrik', {
  userText: 'navigiere zur fitting der Fabrik',
});
assert(noCity === 'fitting der Fabrik', 'no city → keep original label');
const noCityAlts = expandNavGeocodeQueries('fitting der Fabrik', {
  userText: 'navigiere zur fitting der Fabrik',
});
assert(
  noCityAlts.some((q) => /Fitnessfabrik\s+Tornesch/i.test(q)),
  'no city → still brand candidates',
);

// Prefetch-Hook + Parallel-Nav in Concierge verdrahtet
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
const turnSrc = fs.readFileSync(
  path.join(__dirname, '../../module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert(/kickCall1ParallelWork/.test(turnSrc), 'parallel work kicked with Call-1');
assert(
  /navPromise\s*=\s*hardOverrideNavigationTo/.test(turnSrc),
  'route starts parallel to bridge speech',
);
const kickSrc = fs.readFileSync(
  path.join(__dirname, '../concierge/kickCall1ParallelWork.ts'),
  'utf8',
);
assert(/kickNavDestPrefetch/.test(kickSrc), 'nav prefetch via parallel kick');

console.log('navDestFuzzyRepair.smoke.test.ts OK');
