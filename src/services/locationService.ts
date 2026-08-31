/**
 * GPS / Standort — Vordergrund + Hintergrund (Sperrbildschirm).
 * Meldet Status an den Store für die Entwickler-Diagnose.
 *
 * Wichtig für flüssige Fixes:
 * - Sofort Last-Known + Kickstart-Fix (kein 30–60s Warten auf High-GPS)
 * - Watcher zeitbasiert (nicht nur bei 5 m Bewegung)
 * - Background-Permission erst NACH dem Watcher (blockiert nicht den Start)
 * - AppState: bei Background/Resume Background-Updates & Watcher halten
 * - App wirklich geschlossen (Recents weg): GPS aus (killServiceOnDestroy +
 *   native FindusLocationShutdown) — Home/Sperrbildschirm behält Standort
 *
 * Android: ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE(_LOCATION) in Manifest.
 * iOS: UIBackgroundModes location (+ NSLocationAlways… Usage Descriptions).
 */

import * as Location from 'expo-location';
import type { LocationObject, LocationSubscription } from 'expo-location';
import { AppState, type AppStateStatus, Platform, Linking, Alert } from 'react-native';
import {
  FINDUS_LOCATION_TASK,
  setBackgroundLocationHandler,
} from './backgroundLocationTask';
import { useFinnusStore } from '../store/useFinnusStore';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import { pushGpsTrackFix, hydrateGpsTrackBuffer } from './navigation/gpsTrackBuffer';
import { startPedometerSleepMonitor } from './battery/pedometerSleep';
import { ensureLocationProminentDisclosure } from './location/locationProminentDisclosure';
import {
  headingFromExpoEvent,
  noteGpsCourse,
  noteHeadingAccuracy,
  noteExpoCompassHeading,
} from './navigation/liveDeviceHeading';
import { startFacingHeadingWatch, stopFacingHeadingWatch } from './navigation/facingHeadingWatch';
import {
  isNativeMapCompassActive,
  setNativeMapCompassFix,
} from './navigation/nativeMapCompass';
import {
  gpsIntervalMsForSpeedMs,
  resolveEffectiveSpeedMs,
} from '../runtime/gpsCadence';
import { noteSplashGpsLive } from './homeMap/splashReadyGate';

export type LocationUpdateHandler = (coords: {
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** m/s from GPS — null if unavailable. */
  speedMs?: number | null;
  headingDeg?: number | null;
}) => void;

export { FINDUS_LOCATION_TASK };

/** realtime = <100m / Nav; far = >500m sparsam; economy = Mittel; sleep = Pedometer-Ruhe; throttled = Audio */
export type GpsStreamProfile =
  | 'realtime'
  | 'realtime-bike'
  | 'economy'
  | 'far'
  | 'sleep'
  | 'throttled';

let subscription: LocationSubscription | null = null;
let headingSubscription: LocationSubscription | null = null;
let updateHandler: LocationUpdateHandler | null = null;
let backgroundStarted = false;

export function isLocationForegroundServiceActive(): boolean {
  return Platform.OS === 'android' && backgroundStarted;
}

/** Auch nach JS-Reload: Android-FGS kann noch laufen, Flag ist frisch false. */
export async function isLocationForegroundServiceActiveAsync(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (backgroundStarted) return true;
  try {
    return await Location.hasStartedLocationUpdatesAsync(FINDUS_LOCATION_TASK);
  } catch {
    return false;
  }
}

function syncPersistentNotifications(): void {
  try {
    const hf = require('./handsFree/handsFreeNotification') as {
      syncHandsFreeListenNotification?: () => Promise<void>;
    };
    void hf.syncHandsFreeListenNotification?.();
  } catch {
    /* soft */
  }
}
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastFixAtMs = 0;
let streamProfile: GpsStreamProfile = 'economy';
let cadenceIntervalMs = 4_000;
let cadenceApplyTimer: ReturnType<typeof setTimeout> | null = null;
let immediateFixInFlight = false;
let lastImmediateFixAt = 0;
let appStateSub: { remove: () => void } | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

/** Wenn länger kein Fix kommt: einmal nachstoßen (Netz/GPS). */
const WATCHDOG_MS = 8_000;
const STALE_FIX_MS = 10_000;

function emitUpdate(coords: {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speedMs?: number | null;
  headingDeg?: number | null;
  altitudeM?: number | null;
}): void {
  lastFixAtMs = Date.now();
  try {
    const { noteLiveGpsOk, noteGpsAbsencePlaceLabel } = require('./location/gpsAbsence') as {
      noteLiveGpsOk: () => void;
      noteGpsAbsencePlaceLabel: (s: string | null) => void;
    };
    noteLiveGpsOk();
    try {
      const { getCachedUserProfile } = require('./userProfileService') as {
        getCachedUserProfile: () => { cityName?: string | null } | null;
      };
      const n = getCachedUserProfile()?.cityName;
      if (n) noteGpsAbsencePlaceLabel(n);
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }
  setNativeMapCompassFix(coords.lat, coords.lng, coords.altitudeM);
  useFinnusStore.getState().reportGpsFix({
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy,
    live: true,
  });
  noteSplashGpsLive();
  // Last-3 GPS track for vector-aware discovery (Masterbook V5)
  pushGpsTrackFix(coords.lat, coords.lng);
  try {
    const { getTrackSpeedMs } = require('./navigation/gpsTrackBuffer') as {
      getTrackSpeedMs: () => number | null;
    };
    const { pushSpeedSample, getSmoothedSpeedMs } = require('./navigation/transportMode') as {
      pushSpeedSample: (s: number | null | undefined) => number;
      getSmoothedSpeedMs: () => number;
    };
    pushSpeedSample(coords.speedMs);
    const effective = resolveEffectiveSpeedMs(
      coords.speedMs,
      getTrackSpeedMs(),
      getSmoothedSpeedMs(),
    );
    coords.speedMs = effective;
    void setGpsWatchInterval(gpsIntervalMsForSpeedMs(effective));
  } catch {
    void setGpsWatchInterval(gpsIntervalMsForSpeedMs(coords.speedMs));
  }
  void import('./mobility/paceProfile')
    .then(({ pushPaceSample, modeHintFromSessionTravel }) => {
      pushPaceSample({
        lat: coords.lat,
        lng: coords.lng,
        speedMs: coords.speedMs,
        modeHint: modeHintFromSessionTravel(),
      });
    })
    .catch(() => undefined);
  updateHandler?.(coords);
}

function emitFromLocation(location: LocationObject): void {
  const speed = location.coords.speed;
  const speedMs =
    typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
      ? speed
      : null;
  const courseDeg =
    typeof location.coords.heading === 'number' &&
    Number.isFinite(location.coords.heading) &&
    location.coords.heading >= 0
      ? location.coords.heading
      : null;
  const alt =
    typeof location.coords.altitude === 'number' &&
    Number.isFinite(location.coords.altitude)
      ? location.coords.altitude
      : null;
  if (courseDeg != null) noteGpsCourse(courseDeg, speedMs);
  emitUpdate({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy,
    speedMs,
    headingDeg: courseDeg,
    altitudeM: alt,
  });
}

async function startHeadingWatch(): Promise<void> {
  await startFacingHeadingWatch();
  // Android Maps-Kompass: Rotation-Vector. Expo magHeading würde dagegen arbeiten.
  if (Platform.OS === 'android' && isNativeMapCompassActive()) return;
  if (headingSubscription) return;
  try {
    headingSubscription = await Location.watchHeadingAsync((h) => {
      // Android-Genauigkeit kommt nur vom Rotation-Vector — Expo 0/1 nörgelt sonst dauernd.
      if (Platform.OS !== 'android' && typeof h.accuracy === 'number') {
        noteHeadingAccuracy(h.accuracy);
      }
      const raw = headingFromExpoEvent(h);
      if (raw != null) noteExpoCompassHeading(raw);
    });
  } catch (err) {
    if (__DEV__) console.warn('[location] heading watch failed:', err);
  }
}

/** Homescreen-Karte: Kompass auch ohne Nav-Watch anstoßen. */
export async function ensureHeadingWatch(): Promise<void> {
  await startHeadingWatch();
}

function stopHeadingWatch(): void {
  stopFacingHeadingWatch();
  if (headingSubscription) {
    headingSubscription.remove();
    headingSubscription = null;
  }
}

function profileFromInterval(intervalMs: number): GpsStreamProfile {
  if (intervalMs >= 60_000) return 'sleep';
  if (intervalMs >= 12_000) return 'far';
  if (intervalMs >= 6_000) return 'throttled';
  if (intervalMs >= 3_000) return 'economy';
  if (intervalMs <= 1_200) return 'realtime-bike';
  return 'realtime';
}

function watchOptionsForInterval(intervalMs: number) {
  const ms = Math.max(500, Math.min(120_000, Math.round(intervalMs)));
  const moving = ms <= 4_000;
  return {
    accuracy: moving
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.Balanced,
    timeInterval: ms,
    distanceInterval: ms >= 12_000 ? 8 : ms >= 6_000 ? 4 : ms >= 3_000 ? 2 : 1,
    mayShowUserSettingsDialog: true,
  };
}

function watchOptionsForProfile(profile: GpsStreamProfile) {
  if (profile === 'sleep') {
    return watchOptionsForInterval(120_000);
  }
  return watchOptionsForInterval(cadenceIntervalMs);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function startWatchdog(): void {
  stopWatchdog();
  watchdogTimer = setInterval(() => {
    if (!subscription) return;
    if (useFinnusStore.getState().isSimulationMode) return;
    if (Date.now() - lastFixAtMs < STALE_FIX_MS) return;
    void kickstartFix({ quiet: true });
  }, WATCHDOG_MS);
}

/** Schneller Fix: Cache zuerst, dann Balanced (nicht High = oft 30–60 s). */
async function kickstartFix(opts?: { quiet?: boolean }): Promise<void> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 15 * 60_000,
      requiredAccuracy: 250,
    });
    if (last) {
      emitUpdate({
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        accuracy: last.coords.accuracy,
      });
    }
  } catch {
    // ignore
  }

  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), opts?.quiet ? 6000 : 8000);
      }),
    ]);
    if (fresh) {
      emitUpdate({
        lat: fresh.coords.latitude,
        lng: fresh.coords.longitude,
        accuracy: fresh.coords.accuracy,
      });
    }
  } catch (err) {
    if (!opts?.quiet) {
      console.warn('[location] kickstart failed:', err);
    }
  }
}

/**
 * GPS schon während Intro/Splash — kein Permission-Dialog, kein Watcher.
 * Puck nur mit frischem Last-Known; älteres nur als Kamera-Seed.
 */
export async function warmupGpsDuringIntro(): Promise<void> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return;
  } catch {
    return;
  }

  try {
    const recent = await Location.getLastKnownPositionAsync({
      maxAge: 15 * 60_000,
      requiredAccuracy: 250,
    });
    if (recent) {
      useFinnusStore.getState().reportGpsFix({
        lat: recent.coords.latitude,
        lng: recent.coords.longitude,
        accuracy: recent.coords.accuracy,
        live: false,
      });
    } else {
      const older = await Location.getLastKnownPositionAsync({
        maxAge: 36 * 60 * 60_000,
        requiredAccuracy: 800,
      });
      if (older) {
        useFinnusStore.getState().reportGpsFix({
          lat: older.coords.latitude,
          lng: older.coords.longitude,
          accuracy: older.coords.accuracy,
          live: false,
        });
      }
    }
  } catch {
    /* Last-Known optional */
  }

  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 2_800);
      }),
    ]);
    if (fresh) {
      emitUpdate({
        lat: fresh.coords.latitude,
        lng: fresh.coords.longitude,
        accuracy: fresh.coords.accuracy,
      });
    } else {
      try {
        const { noteLiveGpsFail } = require('./location/gpsAbsence') as {
          noteLiveGpsFail: () => void;
        };
        noteLiveGpsFail();
        const again = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 2_400);
          }),
        ]);
        if (again) {
          emitUpdate({
            lat: again.coords.latitude,
            lng: again.coords.longitude,
            accuracy: again.coords.accuracy,
          });
        } else {
          noteLiveGpsFail();
        }
      } catch {
        try {
          const { noteLiveGpsFail } = require('./location/gpsAbsence') as {
            noteLiveGpsFail: () => void;
          };
          noteLiveGpsFail();
        } catch {
          /* soft */
        }
      }
    }
  } catch {
    try {
      const { noteLiveGpsFail } = require('./location/gpsAbsence') as {
        noteLiveGpsFail: () => void;
      };
      noteLiveGpsFail();
      noteLiveGpsFail();
    } catch {
      /* soft */
    }
  }

  try {
    if (!subscription) {
      void startWatchingLocation(() => undefined);
    }
  } catch {
    /* Watcher startet mit Home / useGeofencing */
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status: existing } =
      await Location.getForegroundPermissionsAsync();
    if (existing === 'granted') return true;
  } catch {
    /* weiter mit Disclosure + Request */
  }

  // Google Play: eigener Hinweis VOR dem Systemdialog
  const disclosed = await ensureLocationProminentDisclosure('foreground');
  if (!disclosed) {
    useFinnusStore.getState().setGpsStatus('denied', null);
    useFinnusStore.getState().setGpsWatching(false);
    return false;
  }

  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') {
    useFinnusStore.getState().setGpsStatus('denied', null);
    useFinnusStore.getState().setGpsWatching(false);
    showPermissionMissingAlert('location');
    return false;
  }
  return true;
}

/** Background: App-Hinweis → System-Popup („Immer zulassen“), Settings nur als Fallback. */
async function requestBackgroundPermissionLater(): Promise<void> {
  try {
    const { status: current } = await Location.getBackgroundPermissionsAsync();
    if (current === 'granted') return;

    const { status: fg } = await Location.getForegroundPermissionsAsync();
    if (fg !== 'granted') return;

    // Pflicht: Prominent Disclosure unmittelbar vor Background-Systemdialog
    const disclosed = await ensureLocationProminentDisclosure('background');
    if (!disclosed) return;

    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status === 'granted') return;

    if (Platform.OS !== 'android') return;

    Alert.alert(
      'Standort immer erlauben',
      'Damit Yorro mit gesperrtem Bildschirm weiter navigieren und Orte erkennen kann, tippe bitte auf „Immer zulassen“.\n\nIch öffne dir jetzt den passenden System-Dialog — dort reicht ein Tipp, ohne durch mehrere Einstellungs-Seiten zu klicken.',
      [
        { text: 'Später', style: 'cancel' },
        {
          text: 'Immer zulassen',
          onPress: () => {
            void (async () => {
              try {
                const againDisclosed =
                  await ensureLocationProminentDisclosure('background', {
                    force: true,
                  });
                if (!againDisclosed) return;
                const again =
                  await Location.requestBackgroundPermissionsAsync();
                if (again.status === 'granted') return;
              } catch {
                /* fall through */
              }
              try {
                await Linking.sendIntent(
                  'android.settings.APPLICATION_DETAILS_SETTINGS',
                  [
                    {
                      key: 'android.provider.extra.APP_PACKAGE',
                      value: 'de.findus.app',
                    },
                  ],
                );
              } catch {
                void Linking.openSettings();
              }
            })();
          },
        },
      ],
    );
  } catch (err) {
    console.warn('[location] Background permission request failed:', err);
  }
}

export async function refreshLocationDiagnostics(): Promise<void> {
  const store = useFinnusStore.getState();
  try {
    const enabled = await Location.hasServicesEnabledAsync();
    store.setGpsServicesEnabled(enabled);
    if (!enabled) {
      store.setGpsStatus('idle', null);
      return;
    }

    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      store.setGpsStatus('denied', null);
      store.setGpsWatching(!!subscription);
      return;
    }

    if (store.isSimulationMode) {
      store.setGpsWatching(false);
      store.setGpsStatus('idle', null);
      return;
    }

    if (subscription) {
      store.setGpsWatching(true);
      if (store.gpsStatus !== 'fix') {
        store.setGpsStatus('searching', store.gpsAccuracyM);
      }
    } else {
      store.setGpsWatching(false);
      store.setGpsStatus('idle', null);
    }
  } catch (err) {
    console.warn('[location] diagnostics failed:', err);
    store.setGpsServicesEnabled(null);
  }
}

function ensureAppStateListener(): void {
  if (appStateSub) return;
  lastAppState = AppState.currentState;
  appStateSub = AppState.addEventListener('change', (next) => {
    const prev = lastAppState;
    lastAppState = next;
    if (!updateHandler) return;
    if (useFinnusStore.getState().isSimulationMode) return;

    // In Hintergrund / Inactive: Background-Task sicherstellen (Sperrbildschirm)
    if (
      (next === 'background' || next === 'inactive') &&
      (prev === 'active' || prev === 'unknown')
    ) {
      void (async () => {
        await requestBackgroundPermissionLater();
        await startBackgroundUpdatesIfPossible();
      })();
      return;
    }

    // Zurück in den Vordergrund: Watcher + BG + Kickstart
    if (next === 'active' && prev !== 'active') {
      void (async () => {
        await startBackgroundUpdatesIfPossible();
        const handler = updateHandler;
        if (subscription) {
          await kickstartFix({ quiet: true });
        } else if (handler) {
          await startWatchingLocation(handler);
        }
      })();
    }
  });
}

/**
 * GPS läuft dauerhaft (Vordergrund-Watcher + Background-Updates).
 */
export async function startWatchingLocation(
  onUpdate: LocationUpdateHandler,
): Promise<boolean> {
  const store = useFinnusStore.getState();
  store.setGpsStatus('searching', null);

  try {
    const enabled = await Location.hasServicesEnabledAsync();
    store.setGpsServicesEnabled(enabled);
    if (!enabled) {
      store.setGpsWatching(false);
      store.setGpsStatus('idle', null);
      console.warn('[location] Location services disabled');
      showPermissionMissingAlert('locationServices');
      return false;
    }
  } catch {
    store.setGpsServicesEnabled(null);
  }

  const granted = await requestLocationPermission();
  if (!granted) {
    console.warn('[location] Permission denied');
    store.setGpsWatching(false);
    return false;
  }

  updateHandler = onUpdate;
  setBackgroundLocationHandler(emitUpdate);
  await stopWatchingLocation({ keepHandler: true });

  // Sofort Position liefern (vermeidet 30–60 s „kein Abruf“ beim GPS-Kaltstart)
  await kickstartFix();

  try {
    await hydrateGpsTrackBuffer();
  } catch {
    /* optional */
  }

  try {
    startPedometerSleepMonitor();
  } catch {
    /* pedometer optional */
  }

  try {
    subscription = await Location.watchPositionAsync(
      watchOptionsForProfile(streamProfile),
      (location: LocationObject) => {
        emitFromLocation(location);
      },
    );
    useFinnusStore.getState().setGpsWatching(true);
    if (useFinnusStore.getState().gpsStatus !== 'fix') {
      useFinnusStore.getState().setGpsStatus('searching', null);
    }
    startWatchdog();
    ensureAppStateListener();
    void startHeadingWatch();
  } catch (err) {
    console.warn('[location] watchPosition failed:', err);
    useFinnusStore.getState().setGpsWatching(false);
    useFinnusStore.getState().setGpsStatus('idle', null);
    stopWatchdog();
    return false;
  }

  // BG-Permission + Updates nicht im kritischen Pfad
  void (async () => {
    await requestBackgroundPermissionLater();
    await startBackgroundUpdatesIfPossible();
  })();

  return true;
}

async function startBackgroundUpdatesIfPossible(): Promise<void> {
  try {
    // FGS-Benachrichtigung schon mit Vordergrund-Recht (Play-Video / „Bei Nutzung“).
    const { status: fg } = await Location.getForegroundPermissionsAsync();
    if (fg !== 'granted') return;

    const started = await Location.hasStartedLocationUpdatesAsync(
      FINDUS_LOCATION_TASK,
    ).catch(() => false);
    if (started) {
      backgroundStarted = true;
      syncPersistentNotifications();
      return;
    }

    await Location.startLocationUpdatesAsync(FINDUS_LOCATION_TASK, {
      accuracy:
        streamProfile === 'throttled'
          ? Location.Accuracy.Balanced
          : Location.Accuracy.BestForNavigation,
      timeInterval: cadenceIntervalMs >= 8_000 ? cadenceIntervalMs : 1_000,
      distanceInterval: cadenceIntervalMs >= 8_000 ? 8 : 1,
      deferredUpdatesInterval:
        cadenceIntervalMs >= 8_000 ? cadenceIntervalMs : 1_000,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      foregroundService: {
        notificationTitle: 'Yorro',
        notificationBody:
          'Standort für die Tour — tippen öffnet die App (Sprechen).',
        notificationColor: '#C4A35A',
        // Recents-Wisch / App beendet → FGS + Tracking stoppen (nicht bei Home/Lock)
        killServiceOnDestroy: true,
      },
    });
    backgroundStarted = true;
    syncPersistentNotifications();
    if (__DEV__) {
      console.log(`[location] background updates started (${Platform.OS})`);
    }
  } catch (err) {
    console.warn('[location] background updates failed:', err);
  }
}

export async function stopWatchingLocation(opts?: {
  keepHandler?: boolean;
}): Promise<void> {
  stopWatchdog();
  stopHeadingWatch();

  if (subscription) {
    subscription.remove();
    subscription = null;
  }

  if (backgroundStarted && !opts?.keepHandler) {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(
        FINDUS_LOCATION_TASK,
      ).catch(() => false);
      if (started) {
        await Location.stopLocationUpdatesAsync(FINDUS_LOCATION_TASK);
      }
    } catch (err) {
      console.warn('[location] stop background failed:', err);
    }
    backgroundStarted = false;
    syncPersistentNotifications();
  }

  if (!opts?.keepHandler) {
    updateHandler = null;
    setBackgroundLocationHandler(null);
    if (appStateSub) {
      appStateSub.remove();
      appStateSub = null;
    }
    const store = useFinnusStore.getState();
    store.setGpsWatching(false);
    if (!store.isSimulationMode && store.gpsStatus !== 'denied') {
      store.setGpsStatus('idle', store.gpsAccuracyM);
    }
  }
}

export async function getCurrentCoords(options?: {
  timeoutMs?: number;
  /** High = GPS genauer (Karte/Recenter). */
  accuracy?: 'balanced' | 'high';
  /** true = keinen LastKnown-Cache, frischen Fix abwarten. */
  preferFresh?: boolean;
}): Promise<{
  lat: number;
  lng: number;
} | null> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const preferFresh = options?.preferFresh === true;
  const accuracy =
    options?.accuracy === 'high'
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.Balanced;

  try {
    const granted = await requestLocationPermission();
    if (!granted) return null;

    useFinnusStore.getState().setGpsStatus('searching');

    // Cache zuerst — oft sofort verfügbar (außer preferFresh)
    if (!preferFresh) {
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 15 * 60_000,
          requiredAccuracy: 250,
        });
        if (last) {
          const coords = {
            lat: last.coords.latitude,
            lng: last.coords.longitude,
            accuracy: last.coords.accuracy,
          };
          useFinnusStore.getState().reportGpsFix({ ...coords, live: false });
          // Frischen Fix im Hintergrund nachziehen
          void Location.getCurrentPositionAsync({ accuracy })
            .then((loc) => {
              useFinnusStore.getState().reportGpsFix({
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
                accuracy: loc.coords.accuracy,
                live: true,
              });
            })
            .catch(() => undefined);
          return { lat: coords.lat, lng: coords.lng };
        }
      } catch {
        // weiter mit frischem Fix
      }
    }

    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!location) {
      console.warn('[location] GPS Timeout');
      // Fallback: LastKnown wenn Fresh fehlschlägt
      if (preferFresh) {
        try {
          const last = await Location.getLastKnownPositionAsync({
            maxAge: 120_000,
            requiredAccuracy: 500,
          });
          if (last) {
            const coords = {
              lat: last.coords.latitude,
              lng: last.coords.longitude,
              accuracy: last.coords.accuracy,
            };
            useFinnusStore.getState().reportGpsFix({ ...coords, live: false });
            return { lat: coords.lat, lng: coords.lng };
          }
        } catch {
          /* ignore */
        }
      }
      return null;
    }

    const coords = {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy,
    };
    useFinnusStore.getState().reportGpsFix(coords);
    return { lat: coords.lat, lng: coords.lng };
  } catch (err) {
    console.warn('[location] getCurrentCoords fehlgeschlagen:', err);
    return null;
  }
}

/** Einmaliger Probe-Fix für die Entwickler-Ansicht. */
export async function probeGpsFix(): Promise<boolean> {
  await refreshLocationDiagnostics();
  const store = useFinnusStore.getState();
  if (store.isSimulationMode) return false;
  if (store.gpsServicesEnabled === false) return false;

  const coords = await getCurrentCoords({ timeoutMs: 10000 });
  return coords != null;
}

/**
 * Speed-Leiter: Watcher-Intervall (1–15 s). Debounced, damit der Watcher nicht flattert.
 */
export async function setGpsWatchInterval(
  intervalMs: number,
): Promise<GpsStreamProfile> {
  const nextMs = Math.max(1_000, Math.min(120_000, Math.round(intervalMs)));
  const nextProfile = profileFromInterval(nextMs);
  const same =
    Math.abs(nextMs - cadenceIntervalMs) < 400 && nextProfile === streamProfile;
  cadenceIntervalMs = nextMs;
  streamProfile = nextProfile;
  if (same) return streamProfile;
  if (!subscription || !updateHandler) return streamProfile;
  if (useFinnusStore.getState().isSimulationMode) return streamProfile;
  if (cadenceApplyTimer) clearTimeout(cadenceApplyTimer);
  cadenceApplyTimer = setTimeout(() => {
    cadenceApplyTimer = null;
    void restartWatcherForCadence();
  }, 700);
  return streamProfile;
}

async function restartWatcherForCadence(): Promise<void> {
  if (!subscription || !updateHandler) return;
  const handler = updateHandler;
  try {
    subscription.remove();
    subscription = null;
    subscription = await Location.watchPositionAsync(
      watchOptionsForInterval(cadenceIntervalMs),
      (location: LocationObject) => {
        emitFromLocation(location);
      },
    );
    updateHandler = handler;
    if (backgroundStarted) {
      try {
        const started = await Location.hasStartedLocationUpdatesAsync(
          FINDUS_LOCATION_TASK,
        ).catch(() => false);
        if (started) {
          await Location.stopLocationUpdatesAsync(FINDUS_LOCATION_TASK);
        }
      } catch {
        /* ignore */
      }
      backgroundStarted = false;
      void startBackgroundUpdatesIfPossible();
    }
    if (__DEV__) {
      console.log(
        `[location] GPS cadence → ${cadenceIntervalMs}ms (${streamProfile})`,
      );
    }
  } catch (err) {
    console.warn('[location] setGpsWatchInterval failed:', err);
  }
}

/** Beschleunigungssensor: plötzlich Tempo → nicht auf den 15-s-Takt warten. */
export function noteMotionBurst(): void {
  const now = Date.now();
  if (now - lastFixAtMs < 1_200) return;
  if (now - lastImmediateFixAt < 2_000) return;
  if (cadenceIntervalMs <= 2_200) return;
  void requestImmediateGpsFix();
}

export async function requestImmediateGpsFix(): Promise<void> {
  if (immediateFixInFlight) return;
  if (useFinnusStore.getState().isSimulationMode) return;
  immediateFixInFlight = true;
  lastImmediateFixAt = Date.now();
  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    emitFromLocation(location);
    const speed = location.coords.speed;
    const speedMs =
      typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
        ? speed
        : null;
    await setGpsWatchInterval(gpsIntervalMsForSpeedMs(speedMs));
  } catch (err) {
    if (__DEV__) console.warn('[location] immediate fix failed:', err);
  } finally {
    immediateFixInFlight = false;
  }
}

/**
 * High-frequency (1 Hz) vs. throttled while POI-Audio läuft.
 * Restartet den Watcher nur bei Profilwechsel.
 */
export async function setGpsStreamProfile(
  profile: GpsStreamProfile,
): Promise<void> {
  const mapped =
    profile === 'sleep'
      ? 120_000
      : profile === 'far'
        ? 15_000
        : profile === 'throttled'
          ? 8_000
          : profile === 'economy'
            ? 4_000
            : profile === 'realtime-bike'
              ? 500
              : 2_000;
  await setGpsWatchInterval(mapped);
}

export function getGpsStreamProfile(): GpsStreamProfile {
  return streamProfile;
}
