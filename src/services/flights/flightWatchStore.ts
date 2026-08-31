/**
 * Mehrere gebuchte Flüge merken — RAM + Datei. Überlebt App-Kill.
 */

import type { FlightStatus } from './FlightTrackingService';
import { identsMatch, preferredIataIdent } from './flightIdent';

export type ActiveFlightWatch = {
  ident: string;
  destLabel: string;
  airportName: string;
  airportLat: number;
  airportLng: number;
  originIata: string | null;
  destIata: string | null;
  dateKey: string | null;
  clockHm: string | null;
  luggage: 'carry' | 'checked' | 'unknown';
  lastFlight: FlightStatus;
  lastSpokenDelayMin: number;
  lastGate: string | null;
  lastTerminal: string | null;
  lastSpokenTerminal: string | null;
  lastBag: string | null;
  lastLeaveMs: number | null;
  lastInboundLateMin: number;
  lastPollMs: number;
  lastClkResolveMs?: number;
  lastFidsPollMs?: number;
  lastAeroPollMs?: number;
  announcedCancel: boolean;
  announcedBoarding?: boolean;
  announcedLastCall?: boolean;
  /** Live-Security-Wartezeit einmal ~2 h vorher gepusht. */
  announcedSecurityWait?: boolean;
};

function watchDepMs(w: ActiveFlightWatch): number | null {
  const d = w.lastFlight.estimatedDeparture ?? w.lastFlight.scheduledDeparture;
  if (!d || !Number.isFinite(d.getTime())) return null;
  return d.getTime();
}
const FILE = 'findus-flight-watches.json';
const MAX_WATCHES = 8;

let watches: ActiveFlightWatch[] = [];
let focusKey: string | null = null;
let hydrated = false;

const DATE_KEYS: (keyof FlightStatus)[] = [
  'scheduledDeparture',
  'estimatedDeparture',
  'actualDeparture',
  'scheduledArrival',
  'estimatedArrival',
  'actualArrival',
];

export function flightWatchKey(w: {
  ident: string;
  originIata?: string | null;
  destIata?: string | null;
  dateKey?: string | null;
  clockHm?: string | null;
}): string {
  const ident = preferredIataIdent((w.ident || '').replace(/\s+/g, '').toUpperCase());
  if (ident && !ident.startsWith('CLK')) {
    return `id:${ident}:${w.dateKey ?? ''}`;
  }
  return `rt:${(w.originIata || '').toUpperCase()}:${(w.destIata || '').toUpperCase()}:${w.dateKey || ''}:${w.clockHm || ''}`;
}

export function listFlightWatches(): ActiveFlightWatch[] {
  return watches.slice();
}

export function hasCommittedFlightWatches(): boolean {
  return watches.length > 0;
}

export function getFocusFlightWatch(): ActiveFlightWatch | null {
  if (focusKey) {
    const hit = watches.find((w) => flightWatchKey(w) === focusKey);
    if (hit) return hit;
  }
  return nextDepartingWatch(Date.now());
}

export function nextDepartingWatch(nowMs = Date.now()): ActiveFlightWatch | null {
  const ranked = watches
    .map((w) => ({
      w,
      t: watchDepMs(w) ?? Number.POSITIVE_INFINITY,
    }))
    .filter((x) => x.t + 4 * 3600_000 > nowMs)
    .sort((a, b) => a.t - b.t);
  return ranked[0]?.w ?? watches[0] ?? null;
}

export function findFlightWatchByIdent(ident: string): ActiveFlightWatch | null {
  return watches.find((w) => identsMatch(w.ident, ident)) ?? null;
}

export function upsertFlightWatch(
  next: ActiveFlightWatch,
  opts?: { previousIdent?: string | null },
): ActiveFlightWatch {
  const key = flightWatchKey(next);
  const prevKey = opts?.previousIdent
    ? flightWatchKey({ ...next, ident: opts.previousIdent })
    : null;
  watches = watches.filter((w) => {
    const k = flightWatchKey(w);
    if (k === key) return false;
    if (prevKey && k === prevKey) return false;
    if (
      opts?.previousIdent &&
      identsMatch(w.ident, opts.previousIdent) &&
      (w.dateKey ?? '') === (next.dateKey ?? '')
    ) {
      return false;
    }
    return true;
  });
  watches.push(next);
  if (watches.length > MAX_WATCHES) {
    watches.sort((a, b) => {
      const ta = watchDepMs(a) ?? 0;
      const tb = watchDepMs(b) ?? 0;
      return ta - tb;
    });
    watches = watches.slice(-MAX_WATCHES);
  }
  focusKey = key;
  persistSoft();
  return next;
}

export function replaceFlightWatch(
  prev: ActiveFlightWatch,
  next: ActiveFlightWatch,
): void {
  watches = watches.filter((w) => flightWatchKey(w) !== flightWatchKey(prev));
  upsertFlightWatch(next, { previousIdent: prev.ident });
}

export function pruneFlightWatches(nowMs = Date.now()): void {
  const before = watches.length;
  watches = watches.filter((w) => !watchIsDone(w, nowMs));
  if (watches.length !== before) persistSoft();
}

/** Timeline/User hat den Flug gestrichen — Watch tot. */
export function removeFlightWatchByIdent(ident: string): boolean {
  const before = watches.length;
  watches = watches.filter((w) => !identsMatch(w.ident, ident));
  if (focusKey && !watches.some((w) => flightWatchKey(w) === focusKey)) {
    focusKey = watches[0] ? flightWatchKey(watches[0]) : null;
  }
  if (watches.length !== before) persistSoft();
  return watches.length < before;
}

export function resetFlightWatchesForTests(): void {
  watches = [];
  focusKey = null;
  hydrated = true;
}

function watchIsDone(w: ActiveFlightWatch, nowMs: number): boolean {
  const arr = w.lastFlight.actualArrival?.getTime();
  if (arr != null && nowMs > arr + 3 * 3600_000) return true;
  const dep = watchDepMs(w);
  if (w.announcedCancel && dep != null && nowMs > dep + 6 * 3600_000) return true;
  if (dep != null && nowMs > dep + 18 * 3600_000) return true;
  return false;
}

function flightToJson(f: FlightStatus): Record<string, unknown> {
  const o: Record<string, unknown> = { ...f };
  for (const k of DATE_KEYS) {
    const v = f[k];
    o[k] = v instanceof Date ? v.toISOString() : v;
  }
  return o;
}

function flightFromJson(raw: Record<string, unknown>): FlightStatus {
  const f = { ...(raw as unknown as FlightStatus) };
  for (const k of DATE_KEYS) {
    const v = raw[k];
    if (typeof v === 'string') {
      const d = new Date(v);
      (f as unknown as Record<string, unknown>)[k] = Number.isFinite(d.getTime())
        ? d
        : null;
    }
  }
  return f;
}

function persistSoft(): void {
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      writeAsStringAsync: (p: string, s: string) => Promise<void>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    void FS.writeAsStringAsync(
      `${dir}${FILE}`,
      JSON.stringify({
        focusKey,
        watches: watches.map((w) => ({
          ...w,
          lastFlight: flightToJson(w.lastFlight),
        })),
      }),
    );
  } catch {
    /* node / tests */
  }
}

export async function hydrateFlightWatches(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      getInfoAsync: (p: string) => Promise<{ exists: boolean }>;
      readAsStringAsync: (p: string) => Promise<string>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    const path = `${dir}${FILE}`;
    const info = await FS.getInfoAsync(path);
    if (!info.exists) return;
    const raw = JSON.parse(await FS.readAsStringAsync(path)) as {
      focusKey?: string | null;
      watches?: Array<ActiveFlightWatch & { lastFlight: Record<string, unknown> }>;
    };
    if (!Array.isArray(raw.watches)) return;
    watches = raw.watches.map((w) => ({
      ...w,
      clockHm: w.clockHm ?? null,
      lastTerminal: w.lastTerminal ?? w.lastFlight?.departureTerminal ?? null,
      lastSpokenTerminal: w.lastSpokenTerminal ?? null,
      lastFlight: flightFromJson(w.lastFlight as unknown as Record<string, unknown>),
    }));
    focusKey = raw.focusKey ?? null;
    pruneFlightWatches(Date.now());
  } catch {
    /* soft */
  }
}

export function persistFlightWatchesNow(): void {
  persistSoft();
}
