/**
 * Leichte Schrittfrequenz (spm) für Bewegungsmodus-Cut.
 * Fuß = viele Schritte · Rad/ÖPNV = schnell, kaum Schritte · Jog = hohe spm.
 */

import { Pedometer } from 'expo-sensors';

const WINDOW_MS = 12_000;
const samples: Array<{ atMs: number; steps: number }> = [];

let watching = false;
let sub: { remove: () => void } | null = null;

function prune(now: number): void {
  while (samples.length && now - samples[0]!.atMs > WINDOW_MS) {
    samples.shift();
  }
}

/** Roh-Delta aus Pedometer (oder Battery-Sleep-Watcher). */
export function noteMotionStepDelta(steps: number, atMs = Date.now()): void {
  const n = Math.max(0, Math.floor(steps));
  if (n <= 0) return;
  samples.push({ atMs, steps: n });
  prune(atMs);
}

/** Schritte pro Minute im letzten Fenster; null wenn zu wenig Signal. */
export function getRecentStepsPerMin(nowMs = Date.now()): number | null {
  prune(nowMs);
  if (samples.length < 2) {
    const only = samples[0];
    if (!only) return null;
    // Ein Burst: grob auf Fenster hochrechnen nur wenn frisch
    if (nowMs - only.atMs > 4_000) return 0;
    return Math.round((only.steps * 60_000) / Math.max(2_000, WINDOW_MS / 2));
  }
  const first = samples[0]!;
  const span = Math.max(2_000, nowMs - first.atMs);
  const total = samples.reduce((s, x) => s + x.steps, 0);
  return Math.round((total * 60_000) / span);
}

export function resetMotionCadence(): void {
  samples.length = 0;
}

export async function ensureMotionCadenceWatching(): Promise<void> {
  if (watching) return;
  watching = true;
  try {
    const ok = await Pedometer.isAvailableAsync();
    if (!ok) return;
    sub?.remove();
    sub = Pedometer.watchStepCount((r) => {
      noteMotionStepDelta(r.steps ?? 0);
    });
  } catch {
    /* optional sensor */
  }
}

export function stopMotionCadenceWatching(): void {
  sub?.remove();
  sub = null;
  watching = false;
}
