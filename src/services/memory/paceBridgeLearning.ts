/**
 * Collective Pace-Bridge Learning — Bridge-Länge ↔ Call-2-Ready für alle User.
 */

import type { PaceBrick, PaceBucket } from '../../module2/reboot/pipeline/bridgePace';
import { paceSignalKey } from '../../module2/reboot/pipeline/bridgePace';

type PaceSample = {
  bridgeMs: number;
  call2ReadyMs: number;
  gapAfterBridgeMs: number;
  usedCall3: boolean;
  atMs: number;
};

const cache = new Map<string, PaceSample[]>();
const MIN_SAMPLES = 8;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function getPaceBridgeBudgetSec(
  bucket: PaceBucket,
  brick: PaceBrick,
): number | null {
  const key = paceSignalKey(bucket, brick);
  const samples = cache.get(key) || [];
  if (samples.length < MIN_SAMPLES) return null;
  const ready = samples.map((s) => s.call2ReadyMs).filter((n) => n > 0);
  if (ready.length < MIN_SAMPLES) return null;
  // P75 Call-2-ready → Bridge-Budget (etwas Cover)
  const sorted = [...ready].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  const p75 = sorted[idx]!;
  return Math.max(2, Math.min(22, Math.round(p75 / 1000)));
}

export async function contributePaceBridgeSample(opts: {
  bucket: PaceBucket;
  brick: PaceBrick;
  bridgeMs: number;
  call2ReadyMs: number;
  gapAfterBridgeMs: number;
  usedCall3: boolean;
}): Promise<void> {
  const key = paceSignalKey(opts.bucket, opts.brick);
  const list = cache.get(key) || [];
  list.push({
    bridgeMs: opts.bridgeMs,
    call2ReadyMs: opts.call2ReadyMs,
    gapAfterBridgeMs: opts.gapAfterBridgeMs,
    usedCall3: opts.usedCall3,
    atMs: Date.now(),
  });
  cache.set(key, list.slice(-40));

  try {
    const { contributePaceBridgeSignal } = require('./collectiveLearning') as {
      contributePaceBridgeSignal: (o: {
        paceKey: string;
        bridgeMs: number;
        call2ReadyMs: number;
        gapAfterBridgeMs: number;
        usedCall3: boolean;
        sampleCount: number;
        readyP50Ms: number;
        call3Rate: number;
      }) => Promise<void>;
    };
    const medReady = median(list.map((s) => s.call2ReadyMs));
    const call3Rate =
      list.filter((s) => s.usedCall3).length / Math.max(1, list.length);
    await contributePaceBridgeSignal({
      paceKey: key,
      bridgeMs: opts.bridgeMs,
      call2ReadyMs: opts.call2ReadyMs,
      gapAfterBridgeMs: opts.gapAfterBridgeMs,
      usedCall3: opts.usedCall3,
      sampleCount: list.length,
      readyP50Ms: Math.round(medReady),
      call3Rate,
    });
  } catch {
    /* soft — lokal reicht */
  }
}

/** Collective promoted → lokaler Cache (nach Pull). */
export function ingestPromotedPaceBudgets(
  items: Array<{ signalKey: string; payload: Record<string, unknown> }>,
): void {
  for (const it of items) {
    const key = String(it.signalKey || '');
    if (!key.startsWith('pace::')) continue;
    const ready =
      typeof it.payload.readyP50Ms === 'number'
        ? it.payload.readyP50Ms
        : typeof it.payload.call2ReadyMs === 'number'
          ? it.payload.call2ReadyMs
          : null;
    if (ready == null || !Number.isFinite(ready) || ready <= 0) continue;
    const list = cache.get(key) || [];
    // Seed mit Aggregat, damit getPaceBridgeBudgetSec nach Pull greifen kann
    if (list.length < MIN_SAMPLES) {
      const seed: PaceSample = {
        bridgeMs:
          typeof it.payload.bridgeMs === 'number' ? it.payload.bridgeMs : ready,
        call2ReadyMs: ready,
        gapAfterBridgeMs:
          typeof it.payload.gapAfterBridgeMs === 'number'
            ? it.payload.gapAfterBridgeMs
            : 0,
        usedCall3: Boolean(it.payload.usedCall3),
        atMs: Date.now(),
      };
      while (list.length < MIN_SAMPLES) list.push({ ...seed });
      cache.set(key, list.slice(-40));
    }
  }
}

/** Test/Debug */
export function _resetPaceBridgeCacheForTests(): void {
  cache.clear();
}
