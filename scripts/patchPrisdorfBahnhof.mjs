#!/usr/bin/env node
/**
 * Safe Prisdorf Bahnhof patch — delegates to OSM halt coords.
 * DO NOT geocode "Bahnhofstraße" (that put the station ~175m too far north).
 *
 * Prefer: node scripts/cityPack/fixPrisdorfBahnPins.mjs
 *          node scripts/cityPack/fixPrisdorfOsmPins.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fix = path.join(__dirname, 'cityPack', 'fixPrisdorfBahnPins.mjs');
const r = spawnSync(process.execPath, [fix], { stdio: 'inherit' });
process.exit(r.status ?? 1);
