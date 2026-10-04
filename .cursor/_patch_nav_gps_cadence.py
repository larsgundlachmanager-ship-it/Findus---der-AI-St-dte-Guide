from pathlib import Path
import re

# --- gpsCadence.ts ---
cadence = Path(r"C:\Users\larsf\Findus 2.0\src\runtime\gpsCadence.ts")
ct = cadence.read_text(encoding="utf-8")
needle = """export function gpsCadenceReason(kmh: number): string {"""
insert = '''/**
 * Aktive Navigation: Cadence nutzen, aber Free-Roam-Stillstand (15 s) vermeiden
 * und Rad nicht dauerhaft auf 0,5 s festnageln (lange Touren / Akku).
 * - Still/Kriechen → max. 4 s
 * - Gehen → Cadence (typ. 2–4 s), nie schärfer als 2 s
 * - Rad → Cadence, nie schärfer als 1 s
 */
export function gpsIntervalMsWhileNavigating(
  speedMs: number | null | undefined,
  opts?: { preferBike?: boolean },
): number {
  const raw = gpsIntervalMsForSpeedMs(speedMs);
  const slowest = GPS_CADENCE.walkMs; // 4 s — Boarding/Abbiegen noch ok
  const fastest = opts?.preferBike ? 1_000 : GPS_CADENCE.briskMs; // 1 s / 2 s
  if (raw >= GPS_CADENCE.stillMs) return slowest;
  return Math.min(slowest, Math.max(fastest, raw));
}

'''
if "gpsIntervalMsWhileNavigating" not in ct:
    if needle not in ct:
        raise SystemExit("cadence needle missing")
    ct = ct.replace(needle, insert + needle, 1)
    tmp = cadence.with_suffix(".ts.new")
    tmp.write_text(ct, encoding="utf-8", newline="\n")
    tmp.replace(cadence)
    print("cadence ok")
else:
    print("cadence already")

# --- navigationService.ts ---
nav = Path(r"C:\Users\larsf\Findus 2.0\src\services\navigation\navigationService.ts")
nt = nav.read_text(encoding="utf-8")

old_imp = """import {
  ensureHeadingWatch,
  getGpsStreamProfile,
  isForegroundLocationWatchActive,
  requestLocationPermission,
  setGpsStreamProfile,
} from '../locationService';"""

new_imp = """import {
  ensureHeadingWatch,
  isForegroundLocationWatchActive,
  requestLocationPermission,
  setGpsStreamProfile,
  setGpsWatchInterval,
  startWatchingLocation,
} from '../locationService';
import { gpsIntervalMsWhileNavigating } from '../../runtime/gpsCadence';"""

if old_imp not in nt:
    raise SystemExit("import block missing")
nt = nt.replace(old_imp, new_imp, 1)

old_tick = """  lastTransportMode = transportMode;
  
  // Dynamic GPS throttling based on transport mode
  const currentProfile = getGpsStreamProfile();
  if (transportMode === 'bicycle' && currentProfile === 'realtime') {
    void setGpsStreamProfile('realtime-bike');
  } else if (transportMode !== 'bicycle' && currentProfile === 'realtime-bike') {
    void setGpsStreamProfile('realtime');
  }"""

new_tick = """  lastTransportMode = transportMode;

  // Shared GPS + Cadence-SSOT (kein Dauer-0,5-s-Bike-Watch auf langen Touren)
  void setGpsWatchInterval(
    gpsIntervalMsWhileNavigating(speedMs ?? getSmoothedSpeedMs(), {
      preferBike: transportMode === 'bicycle',
    }),
  );"""

if old_tick not in nt:
    raise SystemExit("tick throttle block missing")
nt = nt.replace(old_tick, new_tick, 1)

old_watch = """    /**
     * Single GPS watcher (biggest bike/JS win):
     * locationService already owns foreground watchPositionAsync (~1 Hz bike via
     * realtime-bike). Nav consumes fixes via exploreModule → tickNavigation /
     * noteFreeRoamGpsFix — do NOT start a second watch in foreground.
     * Background: locationService FGS feeds the same emit path; no nav-only
     * duplicate watch required. Fallback watch only if locationService is idle.
     */
    if (!posSub) {
      if (isForegroundLocationWatchActive()) {
        if (__DEV__) {
          console.log('[nav] GPS via locationService only (no duplicate watch)');
        }
      } else {
        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: lastTransportMode === 'bicycle' ? 1 : 2,
            timeInterval: lastTransportMode === 'bicycle' ? 1000 : 3500,
          },
          (loc) => {
            if (!active || simulatedCoords) return;
            const speed = loc.coords.speed;
            const course = loc.coords.heading;
            if (
              typeof course === 'number' &&
              Number.isFinite(course) &&
              course >= 0 &&
              typeof speed === 'number' &&
              speed >= 0.6
            ) {
              movementBearingDeg = course;
            }
            tickNavigation(
              loc.coords.latitude,
              loc.coords.longitude,
              headingDeg,
              typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
                ? speed
                : null,
            );
          },
        );
      }
    }"""

new_watch = """    /**
     * Single GPS watcher (biggest tour/JS win):
     * Prefer locationService foreground watch + gpsCadence SSOT.
     * Nav consumes fixes via exploreModule → tickNavigation / noteFreeRoamGpsFix.
     * Fallback only if shared watch cannot start — still cadence-capped, never
     * a permanent 1 Hz BestForNavigation duplicate.
     */
    if (!posSub) {
      if (!isForegroundLocationWatchActive()) {
        try {
          await startWatchingLocation(() => undefined);
        } catch {
          /* soft — fallback below */
        }
      }
      if (isForegroundLocationWatchActive()) {
        if (__DEV__) {
          console.log('[nav] GPS via locationService only (no duplicate watch)');
        }
      } else {
        const intervalMs = gpsIntervalMsWhileNavigating(
          getSmoothedSpeedMs(),
          { preferBike: lastTransportMode === 'bicycle' },
        );
        const moving = intervalMs <= 4_000;
        posSub = await Location.watchPositionAsync(
          {
            accuracy: moving
              ? Location.Accuracy.BestForNavigation
              : Location.Accuracy.Balanced,
            timeInterval: intervalMs,
            distanceInterval:
              intervalMs >= 12_000 ? 8 : intervalMs >= 6_000 ? 4 : intervalMs >= 3_000 ? 2 : 1,
          },
          (loc) => {
            if (!active || simulatedCoords) return;
            const speed = loc.coords.speed;
            const course = loc.coords.heading;
            if (
              typeof course === 'number' &&
              Number.isFinite(course) &&
              course >= 0 &&
              typeof speed === 'number' &&
              speed >= 0.6
            ) {
              movementBearingDeg = course;
            }
            tickNavigation(
              loc.coords.latitude,
              loc.coords.longitude,
              headingDeg,
              typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
                ? speed
                : null,
            );
          },
        );
        if (__DEV__) {
          console.log(
            `[nav] GPS fallback watch cadence ${intervalMs}ms (locationService idle)`,
          );
        }
      }
    }"""

if old_watch not in nt:
    raise SystemExit("watch block missing")
nt = nt.replace(old_watch, new_watch, 1)

# Audio end: don't force realtime forever
old_audio = """/** Nach Audio wieder 1-Hz Free-Roam. */
export function notifyDestinationAudioEnded(): void {
  void setGpsStreamProfile('realtime');
}"""
new_audio = """/** Nach Audio: Cadence/Economy — nicht wieder auf Dauer-Realtime. */
export function notifyDestinationAudioEnded(): void {
  void setGpsStreamProfile('economy');
}"""
if old_audio in nt:
    nt = nt.replace(old_audio, new_audio, 1)
    print("audio end patched")
else:
    print("audio end block skip")

tmp = nav.with_suffix(".ts.new")
tmp.write_text(nt, encoding="utf-8", newline="\n")
tmp.replace(nav)
print("nav ok", nav.stat().st_size)

# sanity
nav2 = nav.read_text(encoding="utf-8")
assert "gpsIntervalMsWhileNavigating" in nav2
assert "startWatchingLocation" in nav2
assert "BestForNavigation,\n            distanceInterval: lastTransportMode" not in nav2
assert "setGpsWatchInterval" in nav2
print("sanity ok")
