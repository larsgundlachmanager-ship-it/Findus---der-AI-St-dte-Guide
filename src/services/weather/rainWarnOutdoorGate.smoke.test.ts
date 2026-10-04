/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/weather/rainWarnOutdoorGate.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/services/weather/rainWarnOutdoorGate.ts'),
  'utf8',
);
assert.match(src, /hotel\|pension/, 'indoor place hotel');
assert.match(src, /museum\|galerie\|kino/, 'indoor museum/kino');
assert.match(src, /requireContain:\s*true/, 'building contain');
assert.match(src, /RAIN_WARN_POOR_ACCURACY_M = 45/, 'poor accuracy');
assert.match(src, /export function isUserOutdoorsForRainWarn/, 'export');
assert.match(src, /getConfirmedHotel/, 'hotel proximity');

console.log('rainWarnOutdoorGate.smoke.test.ts OK');
