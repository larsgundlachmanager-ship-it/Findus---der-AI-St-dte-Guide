/**
 * Run: npx --yes tsx src/services/ui/homeMapPause.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const pause = readFileSync(
  join(process.cwd(), 'src/services/ui/homeMapPause.ts'),
  'utf8',
);
const heading = readFileSync(
  join(process.cwd(), 'src/services/navigation/liveDeviceHeading.ts'),
  'utf8',
);
const fog = readFileSync(
  join(process.cwd(), 'src/services/homeMap/fogTrackEngine.ts'),
  'utf8',
);
const explore = readFileSync(
  join(process.cwd(), 'src/runtime/exploreModule.ts'),
  'utf8',
);
const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
const facing = readFileSync(
  join(process.cwd(), 'src/services/navigation/facingHeadingWatch.ts'),
  'utf8',
);
const gate = readFileSync(
  join(process.cwd(), 'src/services/boot/interactiveBootGate.ts'),
  'utf8',
);

assert(pause.includes('homeMapShouldPause'), 'Soft-Pause Export');
assert(pause.includes('isMicActive'), 'Mic → Soft-Pause');
assert(
  pause.includes('chromeHoldsLoad'),
  'Chrome-Hold (Mic/Zurück/Timeline/Settings) → Soft-Pause',
);
assert(pause.includes('noteHomeMapFollowState'), 'Follow-State für Fog/Throttle');
assert(!/return false;\s*\n\}/.test(pause.replace(/\s+/g, ' ')) || pause.includes('isMicActive()'), 'Pause nicht immer false');

assert(heading.includes('emitThrottleMs'), 'Heading-Emit gedrosselt');
assert(fog.includes('homeMapShouldPause'), 'Fog respektiert Soft-Pause');
assert(fog.includes('homeMapLocationFollowActive'), 'Fog pausiert unter Transit+Lock');
assert(explore.includes('homeMapShouldPause'), 'Ambient Soft-Pause');
assert(explore.includes('getSmoothedSpeedMs() >= 8.3'), 'Ambient Transit-Skip');
assert(
  view.includes('Heading nur über subscribeMapHeading') ||
    !view.includes('else if (headChanged)'),
  'Kein doppelter Heading-Pfad Store+SSOT',
);
assert(view.includes('minMs = 120'), 'Zug-Follow Kamera-Budget ≥120 ms');
assert(
  facing.includes('Kein Accel-Burst parallel') ||
    !/if \(native\) \{[\s\S]*?startMotionBurstWatch\(\)/.test(facing),
  'Kein Accel-Burst neben Native-Kompass',
);
assert(gate.includes('export function isOverlayBusy'), 'isOverlayBusy Export');

console.log('homeMapPause.smoke.test.ts OK');
