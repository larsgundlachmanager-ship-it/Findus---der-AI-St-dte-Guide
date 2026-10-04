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
  'Native Maps-Kompass zuerst (Android + iOS)',
);
assert(
  watch.includes("Platform.OS === 'android' || Platform.OS === 'ios'"),
  'Native Kompass auf Android und iOS',
);
assert(watch.includes('let started = false'), 'started-Flag deklariert');
assert(watch.includes('let lastMotionAt = 0'), 'lastMotionAt deklariert');
assert(
  watch.includes('startFallbackSensors') || watch.includes('DeviceMotion'),
  'Fallback wenn Native fehlt',
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
  loc.includes('if (isNativeMapCompassActive()) return'),
  'Expo-Heading entfällt sobald Native aktiv (Android+iOS)',
);
assert(
  loc.includes('setNativeMapCompassFix'),
  'GPS → Deklination (True North wie Maps)',
);

const nav = readFileSync(
  join(process.cwd(), 'src/services/navigation/navigationService.ts'),
  'utf8',
);
assert(
  !nav.includes('Location.watchHeadingAsync'),
  'Nav startet keinen eigenen Expo-Heading-Watch',
);
assert(
  nav.includes('subscribeMapHeading'),
  'Nav liest Heading nur aus dem SSOT',
);
assert(
  nav.includes('ensureHeadingWatch'),
  'Nav stößt den einen Facing/Native-Watch an',
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
assert(
  locJs.includes('isNativeMapCompassActive()) return'),
  'Expo-Heading no-op solange Native SSOT läuft',
);
assert(
  locJs.includes('COG nur klar in Bewegung') ||
    locJs.includes('gpsSpeedMs >= COG_PREF_MPS'),
  'COG-Display nur bei Tempo',
);
assert(
  locJs.includes('COG_ENTER_MPS') &&
    locJs.includes('COG_EXIT_MPS') &&
    locJs.includes('mapDisplayUsesCourse'),
  'Kompass/COG-Quelle wechselt mit Hysterese',
);

assert(js.includes('pauseNativeMapCompassForBackground'), 'Background pause API');
assert(js.includes('resumeNativeMapCompassFromBackground'), 'Background resume API');
assert(js.includes('AppState.addEventListener'), 'JS pausiert bei AppState');
assert(js.includes('sensorsOnly'), 'Android-Pause ohne wantListening-Clear');
assert(js.includes('Native?.pause') || js.includes('Native.pause'), 'Native pause()-Methode');

assert(
  watch.includes('pauseNativeMapCompassForBackground'),
  'Facing-Watch pausiert Native im Hintergrund',
);
assert(
  watch.includes('resumeNativeMapCompassFromBackground') ||
    watch.includes('restartAfterBackground'),
  'Facing-Watch resume nach Vordergrund',
);
assert(watch.includes('AppState.addEventListener'), 'Facing AppState-Pause');
assert(watch.includes('ensureFacingAppStatePause'), 'Facing AppState einmalig');

assert(kt.includes('wantListening'), 'Native Desire überlebt Pause');
assert(kt.includes('pauseSensorsOnly'), 'Sensoren-only Pause');
assert(kt.includes('onHostPause'), 'Activity-Pause stoppt Sensoren');
assert(kt.includes('onHostResume'), 'Activity-Resume meldet Sensoren neu an');
assert(kt.includes('fun pause'), 'ReactMethod pause für JS-Background');

console.log('nativeMapCompass.smoke.test.ts OK');
