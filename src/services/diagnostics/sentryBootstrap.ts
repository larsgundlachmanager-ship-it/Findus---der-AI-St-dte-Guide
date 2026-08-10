/**
 * Sentry + Latenz-Traces — soft-fail ohne DSN / ohne Package.
 * EXPO_PUBLIC_SENTRY_DSN setzen; npm i @sentry/react-native bei Bedarf.
 */

import { env } from '../../config/env';

type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
  addBreadcrumb: (b: Record<string, unknown>) => void;
  setMeasurement?: (name: string, value: number, unit?: string) => void;
};

let sentry: SentryLike | null = null;
let tried = false;

function loadSentry(): SentryLike | null {
  if (tried) return sentry;
  tried = true;
  const dsn = env.sentryDsn?.() || '';
  if (!dsn) return null;
  try {
    // Optional peer — Bundle bricht nicht ohne Package
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/react-native') as SentryLike;
    mod.init({
      dsn,
      tracesSampleRate: 0.15,
      enableAutoSessionTracking: true,
      environment: __DEV__ ? 'development' : 'production',
    });
    sentry = mod;
    if (__DEV__) console.log('[sentry] initialized');
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[sentry] @sentry/react-native nicht installiert oder Init fehlgeschlagen',
        err,
      );
    }
    sentry = null;
  }
  return sentry;
}

export function initSentryIfConfigured(): void {
  loadSentry();
}

export function captureFindusException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const s = loadSentry();
  if (!s) return;
  try {
    s.captureException(err, context ? { extra: context } : undefined);
  } catch {
    /* soft */
  }
}

/** Latenz-SUMMARY → Breadcrumb + optionale Measurements (auch Production). */
export function reportLatencyToSentry(summary: {
  id: string;
  meta?: string | null;
  ackMs?: number | null;
  contextMs?: number | null;
  decomposeMs?: number | null;
  researchMs?: number | null;
  ttsMs?: number | null;
  totalMs?: number | null;
}): void {
  const s = loadSentry();
  if (!s) return;
  try {
    s.addBreadcrumb({
      category: 'latency',
      level: 'info',
      message: `turn ${summary.id}`,
      data: {
        meta: summary.meta ?? null,
        ackMs: summary.ackMs ?? null,
        contextMs: summary.contextMs ?? null,
        decomposeMs: summary.decomposeMs ?? null,
        researchMs: summary.researchMs ?? null,
        ttsMs: summary.ttsMs ?? null,
        totalMs: summary.totalMs ?? null,
      },
    });
    if (typeof summary.totalMs === 'number' && s.setMeasurement) {
      s.setMeasurement('findus.latency.total_ms', summary.totalMs, 'millisecond');
    }
    if (typeof summary.researchMs === 'number' && s.setMeasurement) {
      s.setMeasurement(
        'findus.latency.research_ms',
        summary.researchMs,
        'millisecond',
      );
    }
  } catch {
    /* soft */
  }
}
