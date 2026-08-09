/**
 * Care-Lane Parken: Leave-by aus OSM/Luftlinie, Reminder, Invalidate wenn Auto weg.
 * Kein Gemini — nur Code + GPS.
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
let lastRemindSpokenAt = 0;
let watchTimer: ReturnType<typeof setInterval> | null = null;

function expiresAtFromSpot(spot: ParkingSpot): number | null {
  if (spot.maxDurationMin == null || spot.maxDurationMin <= 0) return null;
  return spot.parkedAtMs + spot.maxDurationMin * 60_000;
}

/** Grobe Gehzeit ohne API — 4,8 km/h. */
function walkMinutes(distM: number): number {
  return Math.max(3, Math.ceil(distM / 80));
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
    const driving = speed != null && speed > 6; // ~22 km/h
    if (driving && dist > 180) {
      clearParkingSpot();
      lastLeaveByMs = null;
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
    expiresAtMs != null &&
    spot.lat != null &&
    spot.lng != null &&
    lat != null &&
    lng != null
  ) {
    const dist = haversineMeters(lat, lng, spot.lat, spot.lng);
    walkMin = walkMinutes(dist);
    // Puffer 3 Min
    leaveByMs = expiresAtMs - (walkMin + 3) * 60_000;
    lastLeaveByMs = leaveByMs;
  }

  return {
    spot,
    expiresAtMs,
    leaveByMs,
    walkMinEstimate: walkMin,
    invalidated: false,
  };
}

/** Ob jetzt eine lockere Reminder-Speech fällig ist (max 1× / 8 Min). */
export function parkingReminderDue(
  care: ParkingCareState,
  nowMs = Date.now(),
): string | null {
  if (care.invalidated || care.leaveByMs == null || care.expiresAtMs == null) {
    return null;
  }
  if (nowMs - lastRemindSpokenAt < 8 * 60_000) return null;
  const minsToLeave = (care.leaveByMs - nowMs) / 60_000;
  const minsToExpiry = (care.expiresAtMs - nowMs) / 60_000;

  if (minsToExpiry <= 0) {
    lastRemindSpokenAt = nowMs;
    return `Dein Parkticket ist abgelaufen — falls du verlängern willst, besser jetzt zum Auto.`;
  }
  if (minsToLeave <= 0 && minsToExpiry > 0) {
    lastRemindSpokenAt = nowMs;
    const w = care.walkMinEstimate ?? 10;
    return `Zeit Richtung Auto — etwa ${w} Minuten Fußweg, Ticket läuft in ${Math.round(minsToExpiry)} Minuten ab.`;
  }
  if (minsToLeave <= 15 && minsToLeave > 0) {
    lastRemindSpokenAt = nowMs;
    return `Nur kurz: in etwa ${Math.round(minsToLeave)} Minuten solltest du los zum Auto, sonst wird’s knapp mit dem Ticket.`;
  }
  return null;
}

export function getLastParkingLeaveByMs(): number | null {
  return lastLeaveByMs;
}

/** Hintergrund-Tick — von App-Start / GPS-Writer aufrufen. */
export function startParkingCareWatch(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    void (async () => {
      const care = await evaluateParkingCare();
      if (!care || care.invalidated) return;
      const line = parkingReminderDue(care);
      if (!line) return;
      try {
        const { enqueueSpeech } = require('../../module2/speech/speechQueue') as {
          enqueueSpeech: (o: {
            kind: string;
            text: string;
            turnId: string;
          }) => void;
        };
        enqueueSpeech({
          kind: 'bridging',
          text: line,
          turnId: `park_care_${Date.now()}`,
        });
      } catch {
        /* soft */
      }
    })();
  }, 45_000);
}

export function stopParkingCareWatch(): void {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}
