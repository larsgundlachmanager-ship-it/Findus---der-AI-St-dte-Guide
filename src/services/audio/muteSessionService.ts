/**
 * Temporäres Stummschalten mit Wake: Dauer / Uhrzeit / Geofence.
 * Museum-Tipp: Yorro kann stumm — und wacht nach Zeit oder Distanz wieder auf.
 */

import * as FileSystem from 'expo-file-system';
import {
  getCachedUserProfile,
  updateUserProfile,
} from '../userProfileService';
import type { AudioOutputMode } from '../../types/userProfile';

export type MuteWakePreset =
  | { kind: 'duration'; hours: 1 | 2 }
  | { kind: 'until_clock'; atMs: number }
  | { kind: 'geo'; radiusM: number }
  | { kind: 'manual' };

export type MuteSession = {
  active: boolean;
  startedAtMs: number;
  /** Unmute at absolute time (1h / 2h / user clock) */
  unmuteAtMs: number | null;
  originLat: number | null;
  originLng: number | null;
  /** Unmute when distance from origin ≥ radius (100 / 200 / custom) */
  wakeRadiusM: number | null;
  reason: string | null;
  /** Audio mode before mute (restore on wake) */
  previousMode: AudioOutputMode;
};

const PATH = `${FileSystem.documentDirectory}findus-mute-session.json`;

const DEFAULT_SESSION: MuteSession = {
  active: false,
  startedAtMs: 0,
  unmuteAtMs: null,
  originLat: null,
  originLng: null,
  wakeRadiusM: null,
  reason: null,
  previousMode: 'normal',
};

let cached: MuteSession = { ...DEFAULT_SESSION };
let hydrated = false;
const listeners = new Set<(s: MuteSession) => void>();

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(cached);
    } catch {
      /* ignore */
    }
  }
}

async function persist(session: MuteSession): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(session));
  } catch {
    /* soft-fail */
  }
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function subscribeMuteSession(
  fn: (s: MuteSession) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getMuteSession(): MuteSession {
  return cached;
}

export function isTemporaryMuteActive(nowMs = Date.now()): boolean {
  if (!cached.active) return false;
  if (cached.unmuteAtMs != null && nowMs >= cached.unmuteAtMs) return false;
  return true;
}

export async function hydrateMuteSession(): Promise<MuteSession> {
  if (hydrated) return cached;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<MuteSession>;
      cached = {
        ...DEFAULT_SESSION,
        ...parsed,
        active: !!parsed.active,
      };
      // Expired time wake while app was closed
      if (
        cached.active &&
        cached.unmuteAtMs != null &&
        Date.now() >= cached.unmuteAtMs
      ) {
        await clearMuteSession({ restoreAudio: true });
      }
    }
  } catch {
    cached = { ...DEFAULT_SESSION };
  }
  hydrated = true;
  notify();
  return cached;
}

export type StartMuteOpts = {
  unmuteAtMs?: number | null;
  wakeRadiusM?: number | null;
  originLat?: number | null;
  originLng?: number | null;
  reason?: string | null;
};

/**
 * Activate mute session + set profile audio to mute.
 * Time and/or geo wake may be combined (first wins).
 */
export async function startMuteSession(
  opts: StartMuteOpts = {},
): Promise<MuteSession> {
  const profile = getCachedUserProfile();
  const previousMode = profile?.audioOutputMode ?? 'normal';
  const now = Date.now();
  cached = {
    active: true,
    startedAtMs: now,
    unmuteAtMs:
      opts.unmuteAtMs != null && Number.isFinite(opts.unmuteAtMs)
        ? opts.unmuteAtMs
        : null,
    originLat:
      opts.originLat != null && Number.isFinite(opts.originLat)
        ? opts.originLat
        : null,
    originLng:
      opts.originLng != null && Number.isFinite(opts.originLng)
        ? opts.originLng
        : null,
    wakeRadiusM:
      opts.wakeRadiusM != null && opts.wakeRadiusM > 0
        ? Math.round(opts.wakeRadiusM)
        : null,
    reason: opts.reason ?? null,
    previousMode: previousMode === 'mute' ? 'normal' : previousMode,
  };
  await persist(cached);
  notify();
  await updateUserProfile({ audioOutputMode: 'mute' });
  return cached;
}

export async function clearMuteSession(opts?: {
  restoreAudio?: boolean;
}): Promise<void> {
  const restore = opts?.restoreAudio !== false;
  const prev = cached.previousMode;
  cached = { ...DEFAULT_SESSION };
  await persist(cached);
  notify();
  if (restore) {
    await updateUserProfile({
      audioOutputMode: prev === 'mute' ? 'normal' : prev,
    });
  }
}

/** Convenience: mute for N hours from now. */
export async function muteForHours(
  hours: 1 | 2,
  opts?: Omit<StartMuteOpts, 'unmuteAtMs'>,
): Promise<MuteSession> {
  return startMuteSession({
    ...opts,
    unmuteAtMs: Date.now() + hours * 60 * 60_000,
  });
}

/**
 * GPS tick — unmute when time elapsed or user left the geo radius.
 */
export async function tickMuteSession(opts: {
  lat?: number | null;
  lng?: number | null;
  nowMs?: number;
}): Promise<{ woke: boolean; reason: 'time' | 'geo' | null }> {
  if (!hydrated) await hydrateMuteSession();
  if (!cached.active) return { woke: false, reason: null };

  const now = opts.nowMs ?? Date.now();
  if (cached.unmuteAtMs != null && now >= cached.unmuteAtMs) {
    await clearMuteSession({ restoreAudio: true });
    return { woke: true, reason: 'time' };
  }

  const lat = opts.lat;
  const lng = opts.lng;
  if (
    cached.wakeRadiusM != null &&
    cached.originLat != null &&
    cached.originLng != null &&
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    const dist = haversineM(
      { lat: cached.originLat, lng: cached.originLng },
      { lat, lng },
    );
    if (dist >= cached.wakeRadiusM) {
      await clearMuteSession({ restoreAudio: true });
      return { woke: true, reason: 'geo' };
    }
  }

  return { woke: false, reason: null };
}

/** Museum / indoor tip copy — never say „Wegweiser“. */
export function museumMuteTipSpeech(): string {
  return (
    'Tipp: Im Museum kannst du Yorro stumm schalten — ' +
    'er wacht nach einer Stunde, zwei Stunden, zu einer Uhrzeit ' +
    'oder wenn du 100 bzw. 200 Meter weiter bist wieder auf.'
  );
}

export function describeMuteSession(s: MuteSession = cached): string {
  if (!s.active) return 'Nicht stumm';
  const parts: string[] = ['Aktiv stumm'];
  if (s.unmuteAtMs != null) {
    const d = new Date(s.unmuteAtMs);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    parts.push(`bis ${h}:${m}`);
  }
  if (s.wakeRadiusM != null) {
    parts.push(`oder ${s.wakeRadiusM} m weg`);
  }
  if (s.reason) parts.push(`(${s.reason})`);
  return parts.join(' · ');
}
