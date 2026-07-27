/**
 * GPS / Standort — Vordergrund + Hintergrund (Sperrbildschirm).
 * Meldet Status an den Store für die Entwickler-Diagnose.
 *
 * Wichtig für flüssige Fixes:
 * - Sofort Last-Known + Kickstart-Fix (kein 30–60s Warten auf High-GPS)
 * - Watcher zeitbasiert (nicht nur bei 5 m Bewegung)
 * - Background-Permission erst NACH dem Watcher (blockiert nicht den Start)
 * - AppState: bei Background/Resume Background-Updates & Watcher halten
 *
 * Android: ACCESS_BACKGROUND_LOCATION + FOREGROUND_SERVICE(_LOCATION) in Manifest.
 * iOS: UIBackgroundModes location (+ NSLocationAlways… Usage Descriptions).
 */

import * as Location from 'expo-location';
import type { LocationObject, LocationSubscription } from 'expo-location';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import {
  FINDUS_LOCATION_TASK,
  setBackgroundLocationHandler,
} from './backgroundLocationTask';
import { useFinnusStore } from '../store/useFinnusStore';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';

export type LocationUpdateHandler = (coords: {
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** m/s from GPS — null if unavailable. */
  speedMs?: number | null;
  headingDeg?: number | null;
}) => void;

export { FINDUS_LOCATION_TASK };

/** realtime = Nav/nah; economy = Fuß Free-Roam sparsam; throttled = während Audio */
export type GpsStreamProfile = 'realtime' | 'economy' | 'throttled';

let subscription: LocationSubscription | null = null;
let updateHandler: LocationUpdateHandler | null = null;
let backgroundStarted = false;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastFixAtMs = 0;
let streamProfile: GpsStreamProfile = 'realtime';
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
}): void {
  lastFixAtMs = Date.now();
  useFinnusStore.getState().reportGpsFix({
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy,
  });
  updateHandler?.(coords);
}

function watchOptionsForProfile(profile: GpsStreamProfile) {
  if (profile === 'throttled') {
    return {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      distanceInterval: 10,
      mayShowUserSettingsDialog: true,
    };
  }
  if (profile === 'economy') {
    // Fuß Free-Roam: ~3–5 s, größerer Abstand — Akku (#32A)
    return {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 4000,
      distanceInterval: 12,
      mayShowUserSettingsDialog: true,
    };
  }
  return {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 1,
    mayShowUserSettingsDialog: true,
  };
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
      maxAge: 60_000,
      requiredAccuracy: 200,
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

export async function requestLocationPermission(): Promise<boolean> {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') {
    useFinnusStore.getState().setGpsStatus('denied', null);
    useFinnusStore.getState().setGpsWatching(false);
    showPermissionMissingAlert('location');
    return false;
  }
  return true;
}

/** Background erst nach laufendem Watcher — Dialog blockiert sonst den Start. */
async function requestBackgroundPermissionLater(): Promise<void> {
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status === 'granted') return;
    await Location.requestBackgroundPermissionsAsync();
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
    subscription = await Location.watchPositionAsync(
      watchOptionsForProfile(streamProfile),
      (location: LocationObject) => {
        const speed = location.coords.speed;
        emitUpdate({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy,
          speedMs:
            typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
              ? speed
              : null,
          headingDeg:
            typeof location.coords.heading === 'number' &&
            Number.isFinite(location.coords.heading) &&
            location.coords.heading >= 0
              ? location.coords.heading
              : null,
        });
      },
    );
    useFinnusStore.getState().setGpsWatching(true);
    if (useFinnusStore.getState().gpsStatus !== 'fix') {
      useFinnusStore.getState().setGpsStatus('searching', null);
    }
    startWatchdog();
    ensureAppStateListener();
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
    const { status: bg } = await Location.getBackgroundPermissionsAsync();
    if (bg !== 'granted') return;

    const started = await Location.hasStartedLocationUpdatesAsync(
      FINDUS_LOCATION_TASK,
    ).catch(() => false);
    if (started) {
      backgroundStarted = true;
      return;
    }

    await Location.startLocationUpdatesAsync(FINDUS_LOCATION_TASK, {
      accuracy:
        streamProfile === 'throttled'
          ? Location.Accuracy.Balanced
          : Location.Accuracy.BestForNavigation,
      timeInterval: streamProfile === 'throttled' ? 5000 : 1000,
      distanceInterval: streamProfile === 'throttled' ? 10 : 1,
      deferredUpdatesInterval: streamProfile === 'throttled' ? 5000 : 1000,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      foregroundService: {
        notificationTitle: 'Findus Tour aktiv',
        notificationBody:
          'Standort läuft weiter — Navigation und Orte auch bei gesperrtem Display.',
        notificationColor: '#F59E0B',
      },
    });
    backgroundStarted = true;
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
}): Promise<{
  lat: number;
  lng: number;
} | null> {
  const timeoutMs = options?.timeoutMs ?? 8000;

  try {
    const granted = await requestLocationPermission();
    if (!granted) return null;

    useFinnusStore.getState().setGpsStatus('searching');

    // Cache zuerst — oft sofort verfügbar
    try {
      const last = await Location.getLastKnownPositionAsync({
        maxAge: 30_000,
        requiredAccuracy: 150,
      });
      if (last) {
        const coords = {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
          accuracy: last.coords.accuracy,
        };
        useFinnusStore.getState().reportGpsFix(coords);
        // Frischen Fix im Hintergrund nachziehen
        void Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
          .then((loc) => {
            useFinnusStore.getState().reportGpsFix({
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
            });
          })
          .catch(() => undefined);
        return { lat: coords.lat, lng: coords.lng };
      }
    } catch {
      // weiter mit frischem Fix
    }

    const location = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!location) {
      console.warn('[location] GPS Timeout');
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
 * High-frequency (1 Hz) vs. throttled while POI-Audio läuft.
 * Restartet den Watcher nur bei Profilwechsel.
 */
export async function setGpsStreamProfile(
  profile: GpsStreamProfile,
): Promise<void> {
  if (profile === streamProfile) return;
  streamProfile = profile;
  if (!subscription || !updateHandler) return;
  if (useFinnusStore.getState().isSimulationMode) return;

  const handler = updateHandler;
  try {
    subscription.remove();
    subscription = null;
    subscription = await Location.watchPositionAsync(
      watchOptionsForProfile(profile),
      (location: LocationObject) => {
        const speed = location.coords.speed;
        emitUpdate({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy,
          speedMs:
            typeof speed === 'number' && Number.isFinite(speed) && speed >= 0
              ? speed
              : null,
          headingDeg:
            typeof location.coords.heading === 'number' &&
            Number.isFinite(location.coords.heading) &&
            location.coords.heading >= 0
              ? location.coords.heading
              : null,
        });
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
      console.log(`[location] GPS profile → ${profile}`);
    }
  } catch (err) {
    console.warn('[location] setGpsStreamProfile failed:', err);
  }
}

export function getGpsStreamProfile(): GpsStreamProfile {
  return streamProfile;
}
