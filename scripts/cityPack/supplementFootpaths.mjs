#!/usr/bin/env node
/**
 * Ergänzt fehlende Fußwege/Pfade (k=2) in einem bestehenden *.map.json.
 *   node scripts/cityPack/supplementFootpaths.mjs --city prisdorf [--no-upload]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT,
  STAEDTE_DIR,
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  packCoverageBbox,
} from './lib.mjs';
import { fetchOverpass, sleep } from '../geo/osm.mjs';

loadEnvFile();

function expandBbox(b, padM) {
  const midLat = ((b.south + b.north) / 2) * (Math.PI / 180);
  const dLat = padM / 111_320;
  const dLng = padM / (111_320 * Math.max(0.2, Math.cos(midLat)));
  return {
    south: b.south - dLat,
    north: b.north + dLat,
    west: b.west - dLng,
    east: b.east + dLng,
  };
}

function ringFromGeom(el) {
  const g = el.geometry;
  if (!Array.isArray(g) || g.length < 2) return null;
  const pts = [];
  for (const p of g) {
    if (typeof p?.lat === 'number' && typeof p?.lon === 'number') {
      pts.push({ lat: p.lat, lng: p.lon });
    }
  }
  return pts.length >= 2 ? pts : null;
}

function simplify(pts, tolM) {
  if (pts.length <= 2 || tolM <= 0) return pts;
  // leicht: jeden n-ten Punkt behalten + Enden
  const out = [pts[0]];
  let last = pts[0];
  const minD = tolM / 111_320;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.hypot(p.lat - last.lat, p.lng - last.lng);
    if (d >= minD) {
      out.push(p);
      last = p;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function roadKey(c) {
  if (!c?.length) return '';
  const a = c[0];
  const b = c[c.length - 1];
  return `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}:${c.length}`;
}

async function fetchPaths(bbox) {
  const q = `
[out:json][timeout:90];
(
  way["highway"~"^(footway|path|cycleway|pedestrian|steps|track|service)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out geom;
`;
  const data = await fetchOverpass(q);
  return data.elements || [];
}

function tileBbox(b, tileM) {
  const tiles = [];
  const midLat = ((b.south + b.north) / 2) * (Math.PI / 180);
  const dLat = tileM / 111_320;
  const dLng = tileM / (111_320 * Math.max(0.2, Math.cos(midLat)));
  for (let s = b.south; s < b.north; s += dLat) {
    for (let w = b.west; w < b.east; w += dLng) {
      tiles.push({
        south: s,
        west: w,
        north: Math.min(b.north, s + dLat),
        east: Math.min(b.east, w + dLng),
      });
    }
  }
  return tiles.length ? tiles : [b];
}

async function main() {
  const cityId = (arg('city') || '').toLowerCase();
  if (!cityId) {
    console.error('Usage: --city <id>');
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) {
    console.error(`missing pack ${cityId}`);
    process.exit(1);
  }
  const extractPath = path.join(STAEDTE_DIR, `${cityId}.map.json`);
  if (!fs.existsSync(extractPath)) {
    console.error(`missing ${extractPath}`);
    process.exit(1);
  }
  const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
  const before = (extract.roads || []).filter((r) => r.k === 2).length;
  const existing = new Set((extract.roads || []).map((r) => roadKey(r.c)));
  const core = packCoverageBbox(pack);
  const bbox = expandBbox(core, 3500);
  const tiles = tileBbox(bbox, 4500);
  console.log(`[footpaths] ${cityId} tiles=${tiles.length} existingPaths=${before}`);
  const added = [];
  for (let i = 0; i < tiles.length; i++) {
    try {
      const els = await fetchPaths(tiles[i]);
      for (const el of els) {
        if (el.type !== 'way') continue;
        const pts = ringFromGeom(el);
        if (!pts) continue;
        const simp = simplify(pts, 3.2);
        const c = simp.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]);
        const key = roadKey(c);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        const name = String(el.tags?.name || el.tags?.['name:de'] || '')
          .trim()
          .slice(0, 48);
        added.push({ k: 2, c, ...(name ? { n: name } : {}) });
      }
      console.log(
        `[footpaths] tile ${i + 1}/${tiles.length} +${added.length} (raw ways so far)`,
      );
    } catch (e) {
      console.warn(`[footpaths] tile ${i + 1} fail: ${e.message || e}`);
    }
    await sleep(450);
  }
  extract.roads = [...(extract.roads || []), ...added];
  fs.writeFileSync(extractPath, JSON.stringify(extract));
  const after = (extract.roads || []).filter((r) => r.k === 2).length;
  const kb = Math.round(fs.statSync(extractPath).size / 1024);
  console.log(
    `[footpaths] ${cityId} paths ${before} → ${after} (+${added.length}) extract=${kb}kb`,
  );
  if (!hasFlag('no-upload')) {
    const up = path.join(ROOT, 'scripts', 'uploadCityPack.mjs');
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [up, path.join(STAEDTE_DIR, `${cityId}.json`)],
        { stdio: 'inherit', cwd: ROOT },
      );
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`upload exit ${code}`)),
      );
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
