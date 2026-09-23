/**
 * GPS-Lock: ein Map-Pfeil, Kamera gleitet — kein zweites Overlay (kein Pop/Größenwechsel).
 * Run: npx --yes tsx src/components/homeMap/GpsLockCenterPuck.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);

assert(view.includes("id=\"gps-arrow\""), 'ein GPS-Pfeil ShapeSource');
assert(view.includes('iconOpacity: 1'), 'Pfeil immer sichtbar (kein Overlay-Hide)');
assert(
  view.includes('iconOpacity: 1') &&
    view.includes("'interpolate'") &&
    view.includes("['zoom']") &&
    view.includes("id=\"gps-arrow-icon\""),
  'GPS-Pfeil skaliert mit Zoom (kleiner beim Rauszoomen)',
);
assert(
  !view.includes('<GpsLockCenterPuck') &&
    !/from\s*['"]\.\/GpsLockCenterPuck['"]/.test(view),
  'kein zweites Lock-Overlay',
);
assert(
  view.includes('animateMs: glide ? 560 : 0') &&
    view.includes('lockGlideUntil.current = Date.now() + 640'),
  'Lock gleitet weich auf GPS — derselbe Pfeil',
);
assert(
  view.includes('Immer echte GPS-Koordinaten') ||
    view.includes('nie Kamera-Center'),
  'Pfeil bleibt auf GPS, nie frei verschiebbar',
);
assert(
  view.includes('isPanUnlockWhileLocked') && view.includes('absorbLockZoom'),
  'Fix: Zoom frei, Pan unlockt',
);

console.log('GpsLockCenterPuck.smoke.test.ts OK');
