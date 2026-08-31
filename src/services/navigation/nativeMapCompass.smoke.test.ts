/**
 * Run: npx --yes tsx src/services/navigation/nativeMapCompass.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const watch = readFileSync(
  join(process.cwd(), 'src/services/navigation/facingHeadingWatch.ts'),
  'utf8',
);
assert(
  watch.includes('startNativeMapCompass'),
  'Android startet den nativen Maps-Kompass zuerst',
);
assert(
  watch.includes("Platform.OS === 'android'"),
  'Rotation-Vector nur nativ auf Android',
);

const loc = readFileSync(
  join(process.cwd(), 'src/services/locationService.ts'),
  'utf8',
);
assert(
  loc.includes('isNativeMapCompassActive'),
  'Kein Expo-magHeading gegen den Rotation-Vector',
);
assert(
  loc.includes("Platform.OS !== 'android'"),
  'Expo-Heading-Genauigkeit nicht auf Android (Rotation-Vector ist SSOT)',
);
assert(
  loc.includes('setNativeMapCompassFix'),
  'GPS → Deklination (True North wie Maps)',
);

const js = readFileSync(
  join(process.cwd(), 'src/services/navigation/nativeMapCompass.ts'),
  'utf8',
);
assert(js.includes('FindusMapCompass'), 'Native Module Name');
assert(js.includes('FindusMapCompassHeading'), 'Heading-Events');
assert(js.includes('resetNativeMapCompass'), 'Kalibrieren ruft Native reset');
assert(js.includes('lockNativeMapCompass'), 'Acht lockt den nativen Kompass');
assert(js.includes('nudgeNativeMapCompass'), 'GPS-Nudge nach der Acht');

const kt = readFileSync(
  join(
    process.cwd(),
    'android/app/src/main/java/de/findus/app/FindusMapCompassModule.kt',
  ),
  'utf8',
);
assert(kt.includes('TYPE_ROTATION_VECTOR'), 'Maps-Sensor');
assert(kt.includes('headingAccuracyStatus'), 'Heading-Fehler statt SENSOR_STATUS');
assert(kt.includes('values.size >= 5'), 'values[4] Heading-Genauigkeit in rad');
assert(kt.includes('return -1'), 'unbekannt = −1, nicht Status 0');
assert(kt.includes('MapCompassHeading'), 'Tilt-blend Heading, kein Display-90°');
assert(kt.includes('GeomagneticField'), 'True North');
assert(!kt.includes('remapCoordinateSystem'), 'Display-Remap kippt Portrait um 90°');
assert(!kt.includes('-orientation[0]'), 'Azimut nicht invertieren (Expo-Bug)');
assert(kt.includes('fun reset'), 'Kalibrieren setzt den Smoother zurück');
assert(kt.includes('TYPE_GAME_ROTATION_VECTOR'), 'Gyro-Lock ohne Magnet-Drift');
assert(kt.includes('fun lock'), 'Acht → Heading einfrieren');
assert(kt.includes('fun nudge'), 'GPS justiert den Lock beim Gehen');
assert(kt.includes('wantLock'), 'Lock überlebt Sensor-Restart');

const math = readFileSync(
  join(
    process.cwd(),
    'android/app/src/main/java/de/findus/app/MapCompassHeading.kt',
  ),
  'utf8',
);
assert(math.includes('worldEast'), 'Ost-Komponente aus der Matrix');
assert(math.includes('worldNorth'), 'Nord-Komponente aus der Matrix');
assert(math.includes('-t'), 'Aufrecht: Blick durchs Display (-Z)');

const pkg = readFileSync(
  join(
    process.cwd(),
    'android/app/src/main/java/de/findus/app/FindusDeviceAudioPackage.kt',
  ),
  'utf8',
);
assert(
  pkg.includes('FindusMapCompassModule'),
  'Kompass-Modul im ReactPackage',
);

const locJs = readFileSync(
  join(process.cwd(), 'src/services/navigation/liveDeviceHeading.ts'),
  'utf8',
);
assert(locJs.includes('applyCompassLockForCity'), 'Stadtwechsel lädt die gespeicherte Acht');
assert(locJs.includes('markCompassUserCalibrated(cityId'), 'Acht speichert die Stadt');
assert(
  locJs.includes('cityHeld: cityCompassIsHeld'),
  'Kalibrier-Button bleibt in der Stadt aus',
);

console.log('nativeMapCompass.smoke.test.ts OK');
