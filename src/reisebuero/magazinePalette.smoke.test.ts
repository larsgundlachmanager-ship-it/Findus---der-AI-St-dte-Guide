/**
 * Magazin-Palette pure — Node smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/magazinePalette.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { MAGAZINE_PALETTE_FALLBACK, paletteFromAverageRgb } from './magazinePalette';

const sea = paletteFromAverageRgb({ r: 40, g: 120, b: 180 });
assert.match(sea.paper, /^#[0-9a-f]{6}$/i);
assert.match(sea.frost, /^rgba\(/);
assert.notEqual(sea.paper, MAGAZINE_PALETTE_FALLBACK.paper);
// Meer-Blau → Papier sollte kühler/bläulicher sein als warmes Sand-Fallback
assert.ok(sea.paper.toLowerCase() !== '#f3ebe0');

const sand = paletteFromAverageRgb({ r: 210, g: 170, b: 110 });
assert.ok(sand.paper.toLowerCase() !== sea.paper.toLowerCase(), 'different hues → different paper');

const dark = paletteFromAverageRgb({ r: 20, g: 40, b: 30 });
assert.match(dark.ink, /^#/);
assert.match(dark.header, /^#/);

console.log('magazinePalette.smoke.test.ts: ok', { sea: sea.paper, sand: sand.paper });
