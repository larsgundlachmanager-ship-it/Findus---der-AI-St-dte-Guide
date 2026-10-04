/**
 * Pitch Deep-Append: Preise + Links für beide Top-Optionen.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/pitchDeepAppendBoth.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const deep = readFileSync(
  join(process.cwd(), 'src/module2/pitch/pitchDeepAppend.ts'),
  'utf8',
);
const cinema = readFileSync(
  join(process.cwd(), 'src/module2/pitch/runCinemaPitch.ts'),
  'utf8',
);
const gastro = readFileSync(
  join(process.cwd(), 'src/module2/agents/gastroMenuDeepResearch.ts'),
  'utf8',
);

assert.match(deep, /slice\(0,\s*2\)/, 'beide Optionen slice(0,2)');
assert.match(deep, /forceMenu = true/, 'Gastro immer Menü nachholen');
assert.match(deep, /forcePrice = true/, 'Gastro immer Preis nachholen');
assert.match(deep, /kind === 'cinema'/, 'Kino Deep-Append');
assert.match(deep, /kind === 'hotel'/, 'Hotel Deep-Append');
assert.match(deep, /usedPriceHints/, 'kein Preis-Doppel für Option 2');
assert.doesNotMatch(
  deep,
  /facts\.match\(\/\(\\d\+\[\.,\]\\d\{2\}\\s\*€\)\/\)/,
  'kein globaler Erst-Euro-Fallback',
);
assert.match(cinema, /priceEur/, 'Kino Preis aus Showtimes');
assert.match(cinema, /Ticket ~/, 'Kino Ticket-Preis Bullet');
assert.match(gastro, /buttons\.slice\(0,\s*8\)/, 'Buttons für beide Venues');

console.log('pitchDeepAppendBoth.smoke: ok');
