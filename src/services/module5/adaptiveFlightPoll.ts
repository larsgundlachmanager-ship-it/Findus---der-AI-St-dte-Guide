/**
 * Adaptive FlightAware-Taktung (Just-in-Time):
 * 24h vorher 1× · 4h 1× · ab 2h vor Abflug alle 20 Min.
 * Polls nutzen Delta-Patch — kein voller syncLiveFlightIntoDayPlan.
 */

import { fetchFlightByIdent, hasFlightAwareKey } from '../flights/FlightTrackingService';
import {
  decideFlightDelta,
  getLastFlightDelta,
  patchFlightIntoDayPlan,
  rememberFlightDelta,
} from './flightDeltaPatch';

type FlightWatch = {
  ident: string;
  departureMs: number;
  lastPollAtMs: number;
  polled24h: boolean;
  polled4h: boolean;
};

const watches = new Map<string, FlightWatch>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function nextDue(w: FlightWatch, now: number): boolean {
  const until = w.departureMs - now;
  if (until < -30 * 60_000) return false;
  if (until <= 2 * 60 * 60_000) {
    return now - w.lastPollAtMs >= 20 * 60_000;
  }
  if (until <= 4 * 60 * 60_000) {
    return !w.polled4h;
  }
  if (until <= 24 * 60 * 60_000) {
    return !w.polled24h;
  }
  return false;
}

export function registerFlightWatch(opts: {
  ident: string;
  departureMs: number;
}): void {
  if (!hasFlightAwareKey()) return;
  const ident = opts.ident.replace(/\s+/g, '').toUpperCase();
  const prev = watches.get(ident);
  watches.set(ident, {
    ident,
    departureMs: opts.departureMs,
    lastPollAtMs: prev?.lastPollAtMs ?? 0,
    polled24h: prev?.polled24h ?? false,
    polled4h: prev?.polled4h ?? false,
  });
  if (!getLastFlightDelta(ident)) {
    rememberFlightDelta({
      ident,
      departureMs: opts.departureMs,
      delayMin: null,
      gate: null,
      terminal: null,
      updatedAtMs: 0,
    });
  }
  ensureFlightPollTicker();
}

async function pollOne(w: FlightWatch, now: number): Promise<void> {
  const flight = await fetchFlightByIdent(w.ident);
  w.lastPollAtMs = now;
  const until = w.departureMs - now;
  if (until <= 4 * 60 * 60_000) w.polled4h = true;
  if (until <= 24 * 60 * 60_000) w.polled24h = true;

  if (!flight) return;
  const depart =
    flight.estimatedDeparture ?? flight.scheduledDeparture ?? null;
  if (depart) {
    w.departureMs = depart.getTime();
  }

  const prev = getLastFlightDelta(w.ident);
  const decision = decideFlightDelta(flight, prev);
  if (decision.action === 'noop') return;

  // Regelmäßige Polls: nur Delta-Patch, nie voller Reverse-Schedule
  patchFlightIntoDayPlan({ flight, speak: decision.action === 'patch' && decision.significant });
}

export async function tickAdaptiveFlightPolls(): Promise<void> {
  if (!hasFlightAwareKey() || !watches.size) return;
  const now = Date.now();
  for (const w of watches.values()) {
    if (!nextDue(w, now)) continue;
    try {
      await pollOne(w, now);
    } catch {
      w.lastPollAtMs = now;
    }
  }
}

function ensureFlightPollTicker(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void tickAdaptiveFlightPolls();
  }, 60_000);
}

export function stopAdaptiveFlightPolls(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
