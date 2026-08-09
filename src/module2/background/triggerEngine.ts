/**
 * Background Trigger Engine — Time-to-Leave, Weather, Live-Mobility, Geofence bridge.
 * Batterieschonend; Rucksack-Wetter-Writer Intervalle.
 */

import { useRucksackStore } from '../rucksack/rucksackStore';
import { refreshRucksackWeather } from '../rucksack/rucksackWriters';
import {
  useHistoricalTimelineStore,
} from '../timeline/historicalTimelineState';
import { simplifyPlaceName } from '../../services/timeline/placeLabelClean';
import { dateKeyFromMs } from '../../utils/dateKeys';
import { shouldAppendDwellPlace } from '../../services/timeline/dwellPlaceDedupe';

type EngineState = {
  started: boolean;
  lastWeatherPollMs: number;
  leaveByTimers: ReturnType<typeof setTimeout>[];
  tickTimer: ReturnType<typeof setInterval> | null;
  dwellTimer: ReturnType<typeof setInterval> | null;
  dwellSinceMs: number | null;
  lastDwellLat: number | null;
  lastDwellLng: number | null;
};

const state: EngineState = {
  started: false,
  lastWeatherPollMs: 0,
  leaveByTimers: [],
  tickTimer: null,
  dwellTimer: null,
  dwellSinceMs: null,
  lastDwellLat: null,
  lastDwellLng: null,
};

/** Registrierte native Geofences (Bridge — OS wake später) */
export type NativeGeofenceReg = {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
  label: string;
};

const geofences: NativeGeofenceReg[] = [];

export function registerNativeGeofence(reg: NativeGeofenceReg): void {
  const idx = geofences.findIndex((g) => g.id === reg.id);
  if (idx >= 0) geofences[idx] = reg;
  else geofences.push(reg);
  // Hook für native Module (iOS/Android) — kein App-GPS-Polling
  try {
    const native = require('../../services/backgroundLocationTask') as {
      registerGeofenceRegion?: (r: NativeGeofenceReg) => void;
    };
    native.registerGeofenceRegion?.(reg);
  } catch {
    /* JS bridge optional until native wires */
  }
}

export function listGeofences(): NativeGeofenceReg[] {
  return [...geofences];
}

function weatherPollIntervalMs(precip: number | null): number | null {
  if (precip == null || precip < 30) return null;
  if (precip >= 80) return 60 * 60 * 1000;
  if (precip >= 50) return 3 * 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

export function scheduleLeaveByChecks(): void {
  for (const t of state.leaveByTimers) clearTimeout(t);
  state.leaveByTimers = [];
  // Progressive Leave-/Wake-Rhythmen laufen über logisticsTriggerStore
  // (Mikro still, Warnung 30/35 Min, Hard am Anker). Hier nur Fallback-Tick.
  try {
    const { tickLogisticsTriggerEngine } = require('../../services/logistics/logisticsTriggerEngine') as {
      tickLogisticsTriggerEngine: (o?: { force?: boolean }) => Promise<unknown>;
    };
    void tickLogisticsTriggerEngine({ force: true });
  } catch {
    /* soft */
  }
}

/** 2-Minuten-Dwell → Historie (OSM → Google → Straße+Nr.) */
function tickDwell(): void {
  const bag = useRucksackStore.getState().bag;
  const last = bag.gpsHistory[bag.gpsHistory.length - 1];
  if (!last) return;
  const same =
    state.lastDwellLat != null &&
    Math.abs(state.lastDwellLat - last.lat) < 0.00005 &&
    Math.abs(state.lastDwellLng! - last.lng) < 0.00005;
  if (!same) {
    // Ort verlassen → offenen Visit schließen
    if (state.lastDwellLat != null && state.lastDwellLng != null) {
      void (async () => {
        try {
          const { getVisitLogSnapshot, recordVisitDeparture } = await import(
            '../../services/timeline/visitLog'
          );
          const open = getVisitLogSnapshot()
            .filter((e) => e.leftAtMs == null)
            .sort((a, b) => b.arrivedAtMs - a.arrivedAtMs)[0];
          if (open) {
            recordVisitDeparture({ name: open.name, poiId: open.poiId });
          }
        } catch {
          /* soft */
        }
      })();
    }
    state.lastDwellLat = last.lat;
    state.lastDwellLng = last.lng;
    state.dwellSinceMs = Date.now();
    return;
  }
  if (state.dwellSinceMs == null) state.dwellSinceMs = Date.now();
  if (Date.now() - state.dwellSinceMs < 120_000) return;

  // Cooldown sofort, damit parallele Ticks nicht doppelt resolven
  state.dwellSinceMs = Date.now() + 600_000;
  const lat = last.lat;
  const lng = last.lng;
  void (async () => {
    try {
      const { resolveDwellPlace } = await import(
        '../../services/timeline/resolveDwellPlace'
      );
      const { recordDwellVisit } = await import(
        '../../services/timeline/recordDwellVisit'
      );
      const pick = await resolveDwellPlace(lat, lng);
      // Dedup + kein Vibrieren — recordDwellVisit regelt beides
      recordDwellVisit({
        hit: pick,
        lat,
        lng,
        arrivedAtMs: Date.now() - 120_000,
        dwellMin: 2,
      });
    } catch {
      try {
        const { recordDwellVisit } = await import(
          '../../services/timeline/recordDwellVisit'
        );
        const { formatStreetPin } = await import(
          '../../services/timeline/placeLabelClean'
        );
        recordDwellVisit({
          hit: {
            title: formatStreetPin('Unbekannte Straße'),
            confidence: 0.2,
            via: 'address',
          },
          lat,
          lng,
          arrivedAtMs: Date.now() - 120_000,
          dwellMin: 2,
        });
      } catch {
        /* soft */
      }
    }
  })();
}

export function startBackgroundTriggerEngine(): void {
  if (state.started) return;
  state.started = true;
  scheduleLeaveByChecks();
  try {
    const { startParkingCareWatch } = require('../../services/timeline/parkingCareEngine') as {
      startParkingCareWatch: () => void;
    };
    startParkingCareWatch();
  } catch {
    /* soft */
  }

  state.tickTimer = setInterval(() => {
    const precip =
      useRucksackStore.getState().bag.weather?.precipProbability ?? null;
    const interval = weatherPollIntervalMs(precip);
    const now = Date.now();
    if (interval != null && now - state.lastWeatherPollMs >= interval) {
      state.lastWeatherPollMs = now;
      refreshRucksackWeather();
    }
    scheduleLeaveByChecks();
  }, 60_000);

  state.dwellTimer = setInterval(tickDwell, 15_000);
}

export function stopBackgroundTriggerEngine(): void {
  state.started = false;
  for (const t of state.leaveByTimers) clearTimeout(t);
  state.leaveByTimers = [];
  if (state.tickTimer) clearInterval(state.tickTimer);
  state.tickTimer = null;
  if (state.dwellTimer) clearInterval(state.dwellTimer);
  state.dwellTimer = null;
  try {
    const { stopParkingCareWatch } = require('../../services/timeline/parkingCareEngine') as {
      stopParkingCareWatch: () => void;
    };
    stopParkingCareWatch();
  } catch {
    /* soft */
  }
}

/** Modul-1 Stempel → Historie */
export function stampModule1Visit(opts: {
  title: string;
  lat: number;
  lng: number;
}): void {
  const title = simplifyPlaceName(opts.title) || opts.title;
  const atMs = Date.now();
  const prev = useHistoricalTimelineStore
    .getState()
    .entriesForDay(dateKeyFromMs(atMs))
    .map((e) => ({ title: e.title, lat: e.lat, lng: e.lng, atMs: e.atMs }));
  if (
    !shouldAppendDwellPlace(prev, {
      title,
      lat: opts.lat,
      lng: opts.lng,
      atMs,
    })
  ) {
    return;
  }
  useHistoricalTimelineStore.getState().append({
    atMs,
    title,
    lat: opts.lat,
    lng: opts.lng,
    source: 'module1',
    confidence: 1,
  });
}
