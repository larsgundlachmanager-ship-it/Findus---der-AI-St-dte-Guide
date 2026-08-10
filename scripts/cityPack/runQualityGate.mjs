#!/usr/bin/env node
/**
 * CLI: run Module-1 quality gate on a city pack.
 *
 *   node scripts/cityPack/runQualityGate.mjs --city wangerooge
 *   node scripts/cityPack/runQualityGate.mjs --city prisdorf --strict
 */

import { arg, hasFlag, loadPack } from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

const cityId = arg('city');
if (!cityId) {
  console.error('Usage: node scripts/cityPack/runQualityGate.mjs --city <id> [--strict]');
  process.exit(1);
}
const pack = loadPack(cityId);
if (!pack) {
  console.error(`Pack not found: ${cityId}`);
  process.exit(1);
}

const strict = hasFlag('strict');
const gate = runQualityGate(pack, { strict });
console.log(JSON.stringify({ city_id: cityId, ...gate }, null, 2));
process.exit(gate.ok ? 0 : 2);
