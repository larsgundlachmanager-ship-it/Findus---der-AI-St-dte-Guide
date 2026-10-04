/**
 * Run: npx --yes tsx src/services/homeMap/homeMapNavMobilityAsk.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapNavMobilityAsk.ts'),
  'utf8',
);

assert(src.includes('ohne Umstieg'), 'ohne Umstieg label');
assert(src.includes('× umsteigen'), 'Umstieg label');
assert(src.includes('zu Fuß'), 'Fuß klar getrennt');
assert(src.includes('speakAskWhenIdle'), 'Speech wartet auf Idle');
assert(src.includes('isFusedTurnLive'), 'Call-1 Fuse respektieren');
assert(src.includes('Alles klar'), 'Ziel-Bestätigung in Ask-Speech');
assert(
  !src.includes("bullets: [walkLabel, dest.name]"),
  'nicht mehr gleiche dest.name-Bullets',
);
assert(src.includes('transfer ·') || src.includes('${transfer}'), 'ÖPNV-Bullet mit Umstieg');

console.log('homeMapNavMobilityAsk.smoke.test.ts ok');
