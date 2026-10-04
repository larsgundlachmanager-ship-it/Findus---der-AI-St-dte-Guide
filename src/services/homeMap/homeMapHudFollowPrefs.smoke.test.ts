/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/homeMapHudFollowPrefs.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  noteHomeMapHudFollowPrefs,
  peekHomeMapHudFollowPrefs,
} from './homeMapHudFollowPrefs';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

noteHomeMapHudFollowPrefs({ locationFollow: true, headingFollow: true });
const a = peekHomeMapHudFollowPrefs();
assert(a.locationFollow && a.headingFollow, 'beide Locks merken');
noteHomeMapHudFollowPrefs({ locationFollow: false });
const b = peekHomeMapHudFollowPrefs();
assert(!b.locationFollow && b.headingFollow, 'GPS-Prefs partial');

const native = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(
  native.includes('locationFollowRef.current = true') &&
    native.includes('reattachFollow()'),
  'reattachFollow setzt GPS-Lock-Ref',
);
assert(
  native.includes('live ? 16 : 24') ||
    native.includes('fingerDown.current || userGesturing.current'),
  'Kompass-Nadel schneller während Geste',
);

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(host.includes('applyHudFollowPrefs'), 'GPS-/Kompass-Tap nutzt HUD-Follow Prefs');
assert(host.includes('hydrateHomeMapHudFollowPrefs'), 'HUD-Prefs hydrieren');
assert(
  host.includes('Cold start: Karte immer frei') ||
    host.includes('locationFollow: false, headingFollow: false'),
  'Cold start ohne Auto-GPS-Lock',
);
assert(
  host.includes('noteHomeMapHudFollowPrefs({ locationFollow:'),
  'GPS-Button speichert Pref',
);
assert(
  host.includes('headingFollowRef.current = false') &&
    host.includes('setHeadingFollow(false)') &&
    host.includes('onNativeUserPan'),
  'Pan löst Standort- und Kompass-Follow',
);
assert(
  host.includes('Kein delayed jumpTo'),
  'Nav-Start ohne delayed Zoom-16/Follow-Snap',
);
assert(
  host.includes('Mindestspanne'),
  'kurze Nav-Routen mit Überblick-Padding',
);

console.log('homeMapHudFollowPrefs.smoke.test.ts OK');
