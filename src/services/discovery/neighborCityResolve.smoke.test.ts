/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/discovery/neighborCityResolve.smoke.test.ts
 *
 * Prisdorf-Builtin darf Pinneberg-/Tornesch-Mitte nicht auffressen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/discovery/cityCoverageBounds.ts'),
  'utf8',
);

function builtinBlock(id: string): string {
  const m = src.match(
    new RegExp(`${id}:\\s*\\{[\\s\\S]*?latMin:\\s*([\\d.]+)[\\s\\S]*?latMax:\\s*([\\d.]+)[\\s\\S]*?lngMin:\\s*([\\d.]+)[\\s\\S]*?lngMax:\\s*([\\d.]+)`),
  );
  assert(m, `${id} builtin block`);
  return m![0];
}

function parseBox(id: string): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  const block = builtinBlock(id);
  const num = (k: string) => {
    const m = block.match(new RegExp(`${k}:\\s*([\\d.]+)`));
    assert(m, `${id}.${k}`);
    return Number(m![1]);
  };
  return {
    latMin: num('latMin'),
    latMax: num('latMax'),
    lngMin: num('lngMin'),
    lngMax: num('lngMax'),
  };
}

function contains(
  b: { latMin: number; latMax: number; lngMin: number; lngMax: number },
  lat: number,
  lng: number,
): boolean {
  return (
    lat >= b.latMin &&
    lat <= b.latMax &&
    lng >= b.lngMin &&
    lng <= b.lngMax
  );
}

function area(b: {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}): number {
  return (b.latMax - b.latMin) * (b.lngMax - b.lngMin);
}

function smallest(
  lat: number,
  lng: number,
  boxes: Record<string, ReturnType<typeof parseBox>>,
): string | null {
  let best: string | null = null;
  let bestA = Infinity;
  for (const [id, b] of Object.entries(boxes)) {
    if (!contains(b, lat, lng)) continue;
    const a = area(b);
    if (a < bestA) {
      bestA = a;
      best = id;
    }
  }
  return best;
}

const boxes = {
  prisdorf: parseBox('prisdorf'),
  pinneberg: parseBox('pinneberg'),
  tornesch: parseBox('tornesch'),
  hamburg: parseBox('hamburg'),
};

assert(
  !contains(boxes.prisdorf, 53.661, 9.7966),
  'Prisdorf-Builtin ohne Pinneberg-Mitte',
);
assert(
  smallest(53.661, 9.7966, boxes) === 'pinneberg',
  'Pinneberg-Mitte → pinneberg',
);
assert(
  smallest(53.6973, 9.7124, boxes) === 'tornesch',
  'Tornesch-Mitte → tornesch',
);
assert(
  smallest(53.68, 9.7607, boxes) === 'prisdorf',
  'Prisdorf-Mitte → prisdorf',
);

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(
  host.includes('jumpTo(lat, lng, 13.2, true)'),
  'Stadtwechsel springt zur Stadt',
);
assert(
  host.includes('injectOfflineMapExtract(true, { lat, lng }, undefined, cityId, true)'),
  'Stadtwechsel lädt Offline-Extract der Stadt',
);

const loader = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapExtractLoader.ts'),
  'utf8',
);
assert(
  /VIEWPORT_SWITCH_RATIO\s*=\s*0\.28/.test(loader),
  'Viewport wechselt früher zu Nachbarstadt',
);

console.log('neighborCityResolve.smoke.test.ts OK');
