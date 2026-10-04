/**
 * Run: npx --yes tsx src/services/homeMap/homeMapPlaceTone.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapPlaceTone.ts'),
  'utf8',
);
const style = readFileSync(
  join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
  'utf8',
);
const colors = readFileSync(
  join(process.cwd(), 'src/services/navigation/stampMapModul1.ts'),
  'utf8',
);

assert(src.includes("if (visited) return 'visited'"), 'Grün = besucht zuerst');
assert(src.includes("if (opts?.planned) return 'planned'"), 'Blau = geplant');
assert(src.includes("return 'liked'"), 'Lila = Modul-1-Trigger');
assert(src.includes("return 'neutral'"), 'Rot = kein Auto-Trigger');
assert(!src.includes("return 'transit'"), 'ÖPNV färbt nicht extra');
assert(!src.includes("return 'rest'"), 'kein Gelb über der Status-Legende');
assert(
  src.includes('return colorForHomeMapPlaceTone'),
  'keine Typ-Farbe über die Status-Legende',
);
assert(!src.includes('HOME_MAP_TYPE_COLORS'), 'Natur/Aussicht färbt keine Orte');
assert(colors.includes("liked: '#7A4FBF'"), 'Lila Trigger');
assert(colors.includes("neutral: '#C45B5B'"), 'Rot kein Trigger');
assert(colors.includes("visited: '#5FA88A'"), 'Grün besucht');
assert(colors.includes("planned: '#3B7DD8'"), 'Blau geplant');
assert(
  style.includes('HOME_MAP_FOG_MASK_ENABLED = false'),
  'Fog: kein dunkler Viewport-Kasten (nur Reveal)',
);
assert(
  style.includes("HOME_MAP_FOG_REVEAL = '#7AD4E8'"),
  'Fog: Eis-Cyan-Reveal behalten',
);
assert(
  /HOME_MAP_FOG_REVEAL_OPACITY\s*=\s*0\.3\b/.test(style),
  'Fog-Reveal-Deckkraft ~30 %',
);
assert(style.includes('HOME_MAP_FOG_REVEAL_EDGE'), 'weicher Reveal-Rand');

console.log('homeMapPlaceTone.smoke.test.ts OK');
