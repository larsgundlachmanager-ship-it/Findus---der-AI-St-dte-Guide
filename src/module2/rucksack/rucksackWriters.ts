/**
 * Hintergrund-Writer für den Rucksack (niemals Turn-blockierend).
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import { useGpsStore } from '../../store/useGpsStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { isDeviceOffline } from '../../services/navigation/networkState';
import { useRucksackStore } from './rucksackStore';

let gpsUnsub: (() => void) | null = null;
let locationUnsub: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;
let connectivityTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Wetter von bestehendem Weather-Service spiegeln, falls verfügbar */
async function pullWeatherOnce(): Promise<void> {
  try {
    const mod = require('../../services/weatherService') as {
      getCachedWeatherSnapshot?: () => {
        summaryLine?: string | null;
        fetchedAtMs?: number;
        nextRainProb?: number | null;
        rainStartsInMin?: number | null;
      } | null;
      getCachedWeatherSummary?: () => string | null;
    };
    const snap = mod.getCachedWeatherSnapshot?.();
    if (snap) {
      const summary =
        snap.summaryLine ?? mod.getCachedWeatherSummary?.() ?? null;
      const tempMatch = summary?.match(/(-?\d+(?:[.,]\d+)?)\s*°?\s*C/i);
      const tempC = tempMatch
        ? Number(tempMatch[1]!.replace(',', '.'))
        : null;
      useRucksackStore.getState().setWeather({
        updatedAtMs: snap.fetchedAtMs ?? Date.now(),
        tempC: Number.isFinite(tempC) ? tempC : null,
        feelsLikeC: null,
        precipProbability:
          snap.nextRainProb != null ? snap.nextRainProb * 100 : null,
        summary,
        rainRadarHint:
          snap.rainStartsInMin != null
            ? `Regen in etwa ${snap.rainStartsInMin} Minuten`
            : null,
      });
      return;
    }
    const summary = mod.getCachedWeatherSummary?.();
    if (!summary) return;
    useRucksackStore.getState().setWeather({
      updatedAtMs: Date.now(),
      tempC: null,
      feelsLikeC: null,
      precipProbability: null,
      summary,
      rainRadarHint: null,
    });
  } catch {
    /* optional */
  }
}

export function startRucksackWriters(): void {
  if (started) return;
  started = true;

  gpsUnsub = useGpsStore.subscribe((state) => {
    if (state.lat == null || state.lng == null) return;
    useRucksackStore.getState().pushGps({
      lat: state.lat,
      lng: state.lng,
      atMs: state.atMs ?? Date.now(),
      accuracyM: state.accuracyM,
    });
  });

  // Live-Label aus dem UI-Store — nie User-Profil-Pack-Stadt
  locationUnsub = useFinnusStore.subscribe((state) => {
    const label = state.currentLocationName?.trim() || null;
    if (useRucksackStore.getState().bag.cityHint !== label) {
      useRucksackStore.getState().setCityHint(label);
    }
  });
  useRucksackStore
    .getState()
    .setCityHint(useFinnusStore.getState().currentLocationName?.trim() || null);

  // Uhr = Systemzeit: einmal beim Start, bei Foreground, und bei jedem Pipeline-Read
  // (readRucksackSync → tickClock). Kein 30s-Polling.
  useRucksackStore.getState().tickClock();
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') useRucksackStore.getState().tickClock();
  });

  const tickNet = () => {
    void isDeviceOffline().then((offline) => {
      useRucksackStore.getState().setConnectivity({
        offline,
        checkedAtMs: Date.now(),
      });
    });
  };
  tickNet();
  connectivityTimer = setInterval(tickNet, 20_000);

  void pullWeatherOnce();
}

export function stopRucksackWriters(): void {
  gpsUnsub?.();
  gpsUnsub = null;
  locationUnsub?.();
  locationUnsub = null;
  appStateSub?.remove();
  appStateSub = null;
  if (connectivityTimer) clearInterval(connectivityTimer);
  connectivityTimer = null;
  started = false;
}

export function refreshRucksackWeather(): void {
  void pullWeatherOnce();
}
