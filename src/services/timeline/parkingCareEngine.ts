/**
 * Care-Lane Parken: Leave-by aus Live-Wegzeit, Logistics-Trigger (30/5 Ansage),
 * Invalidate wenn Auto weg. Soft deadline (~10 Min Spielraum).
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  clearParkingSpot,
  getParkingSpot,
  hydrateParkingSpot,
  type ParkingSpot,
} from './parkingSpotStore';

export type ParkingCareState = {
  spot: ParkingSpot;
  expiresAtMs: number | null;
  /** Empfohlenes Losgehen (Leave-by) */
  leaveByMs: number | null;
  walkMinEstimate: number | null;
  invalidated: boolean;
  reason?: string;
};

let lastLeaveByMs: number | null = null;
/** Letzte geschätzte Wegzeit zum Spot — Sync für Live-HUD. */
let lastWalkMinEstimate: number | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let lastWatchSyncMs = 0;

function expiresAtFromSpot(spot: ParkingSpot): number | null {
  if (spot.maxDurationMin == null || spot.maxDurationMin <= 0) return null;
  return spot.parkedAtMs + spot.maxDurationMin * 60_000;
}

/** Grobe Gehzeit ohne API — 4,8 km/h. */
function walkMinutesFallback(distM: number): number {
  return Math.max(3, Math.ceil(distM / 80));
}

async function resolveWalkMin(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number; name: string },
): Promise<number> {
  try {
    const { estimateTravelEtaRouted } = await import(
      '../navigation/travelEta'
    );
    const eta = await estimateTravelEtaRouted({
      userLat: from.lat,
      userLng: from.lng,
      destLat: to.lat,
      destLng: to.lng,
      destName: to.name,
    });
    return Math.max(3, Math.ceil(eta.totalMinutes));
  } catch {
    const dist = haversineMeters(from.lat, from.lng, to.lat, to.lng);
    return walkMinutesFallback(dist);
  }
}

function syncParkingLogisticsWatch(opts: {
  spot: ParkingSpot;
  expiresAtMs: number;
  leaveByMs: number;
  walkMin: number;
}): void {
  try {
    const { registerDepartureWatch } = require('../logistics/logisticsTriggerEngine') as {
      registerDepartureWatch: (input: Record<string, unknown>) => {
        leaveByMs: number;
      };
    };
    registerDepartureWatch({
      eventId: `parking:${opts.spot.id}`,
      title: opts.spot.label || 'Parkplatz',
      departureMs: opts.expiresAtMs,
      walkEtaMin: opts.walkMin,
      mode: 'car',
      destLat: opts.spot.lat,
      destLng: opts.spot.lng,
      destName: opts.spot.label || 'Auto',
      detail: `Parkticket · max ${opts.spot.maxDurationMin} Min`,
      warnLeadMin: 30,
      planPriority: 2,
      deadlineSoftness: 'forgiving',
      scheduleOsPush: true,
      externalId: `parking:${opts.spot.id}`,
    });
    void opts.leaveByMs;
  } catch (err) {
    console.warn('[parkingCare] logistics sync failed', err);
  }
}

export async function evaluateParkingCare(
  nowMs = Date.now(),
): Promise<ParkingCareState | null> {
  await hydrateParkingSpot();
  const spot = getParkingSpot();
  if (!spot) return null;

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  let speed = 0;
  try {
    const { getSmoothedSpeedMs } = require('../navigation/transportMode') as {
      getSmoothedSpeedMs: () => number;
    };
    speed = getSmoothedSpeedMs() || 0;
  } catch {
    try {
      const { readRucksackSync } = require('../../module2/rucksack/rucksackStore') as {
        readRucksackSync: () => { vector: { speedMps: number | null } };
      };
      speed = readRucksackSync().vector.speedMps ?? 0;
    } catch {
      speed = 0;
    }
  }

  const expiresAtMs = expiresAtFromSpot(spot);

  // Auto weg: schnell unterwegs und Spot weit entfernt → Reminder irrelevant
  if (
    spot.lat != null &&
    spot.lng != null &&
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    const dist = haversineMeters(lat, lng, spot.lat, spot.lng);
    const driving = speed != null && speed > 6;
    if (driving && dist > 180) {
      clearParkingSpot();
      lastLeaveByMs = null;
      lastWalkMinEstimate = null;
      try {
        const { useLogisticsTriggerStore } = require('../../store/useLogisticsTriggerStore') as {
          useLogisticsTriggerStore: {
            getState: () => { cancelEvent: (id: string) => void };
          };
        };
        useLogisticsTriggerStore.getState().cancelEvent(`parking:${spot.id}`);
      } catch {
        /* soft */
      }
      return {
        spot,
        expiresAtMs,
        leaveByMs: null,
        walkMinEstimate: null,
        invalidated: true,
        reason: 'vehicle_left_spot',
      };
    }
  }

  let walkMin: number | null = null;
  let leaveByMs: number | null = null;
  if (
    spot.lat != null &&
    spot.lng != null &&
    lat != null &&
    lng != null
  ) {
    walkMin = await resolveWalkMin(
      { lat, lng },
      { lat: spot.lat, lng: spot.lng, name: spot.label || 'Auto' },
    );
    lastWalkMinEstimate = walkMin;

    if (expiresAtMs != null) {
      // Kleiner Puffer; Spielraum ~10 Min steckt in deadlineSoftness
      leaveByMs = expiresAtMs - (walkMin + 3) * 60_000;
      lastLeaveByMs = leaveByMs;

      // Logistics-Watch max. alle 4 Min aktualisieren (ETA-Drift)
      if (nowMs - lastWatchSyncMs > 4 * 60_000 || lastWatchSyncMs === 0) {
        lastWatchSyncMs = nowMs;
        let parkingOk = true;
        try {
          const { isProactiveAlertEnabled } = require('../notifications/proactiveAlerts') as {
            isProactiveAlertEnabled: (k: 'parking') => boolean;
          };
          parkingOk = isProactiveAlertEnabled('parking');
        } catch {
          parkingOk = true;
        }
        if (parkingOk) {
          syncParkingLogisticsWatch({
            spot,
            expiresAtMs,
            leaveByMs,
            walkMin,
          });
        }
      }
    }
  }

  return {
    spot,
    expiresAtMs,
    leaveByMs,
    walkMinEstimate: walkMin,
    invalidated: false,
  };
}

/** @deprecated Speech läuft über Logistics 30/5 — kein Extra-Spam. */
export function parkingReminderDue(
  _care: ParkingCareState,
  _nowMs = Date.now(),
): string | null {
  return null;
}

export function getLastParkingLeaveByMs(): number | null {
  return lastLeaveByMs;
}

export function getLastParkingWalkMinEstimate(): number | null {
  return lastWalkMinEstimate;
}

/** Nach Speichern: sofort Logistics + Watch. */
export async function armParkingCare(): Promise<ParkingCareState | null> {
  lastWatchSyncMs = 0;
  const care = await evaluateParkingCare();
  startParkingCareWatch();
  return care;
}

/** Hintergrund-Tick — ETA/Leave nachziehen, Speech über Logistics-Trigger. */
export function startParkingCareWatch(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    void evaluateParkingCare();
  }, 90_000);
}

export function stopParkingCareWatch(): void {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}
