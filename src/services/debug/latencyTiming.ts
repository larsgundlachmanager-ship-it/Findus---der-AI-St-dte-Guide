/**
 * Latenz-Tracking (__DEV__ only) — Request-Lifecycle:
 * t0 (Mic off) → ack → contextMs → decomposeMs → researchMs → ttsMs
 *
 * Unsichtbar für User; nur Console auf dem Dev-Gerät.
 */

export type LatencyMark =
  | 't0'
  | 'ack'
  | 'context'
  | 'decompose'
  | 'research'
  | 'tts';

type LatencyTurn = {
  id: string;
  t0: number;
  marks: Partial<Record<Exclude<LatencyMark, 't0'>, number>>;
  meta?: string;
  logged?: boolean;
};

let active: LatencyTurn | null = null;

function now(): number {
  return Date.now();
}

function msSinceT0(at: number, t0: number): number {
  return Math.max(0, Math.round(at - t0));
}

function makeId(): string {
  return `lt_${now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Aktiv in __DEV__ oder wenn Sentry-DSN gesetzt (Latenz → Breadcrumbs). */
function enabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  try {
    const { env } = require('../../config/env') as {
      env: { sentryDsn: () => string };
    };
    return Boolean(env.sentryDsn()?.trim());
  } catch {
    return false;
  }
}

/**
 * Start eines neuen Turns — typisch: Mic loslassen / Zuhören beendet.
 */
export function latencyStartTurn(meta?: string): string | null {
  if (!enabled()) return null;
  const id = makeId();
  active = {
    id,
    t0: now(),
    marks: {},
    meta: meta?.slice(0, 80),
  };
  console.log(
    `[latency] t0 mic_off${meta ? ` · ${meta.slice(0, 40)}` : ''} id=${id}`,
  );
  return id;
}

/**
 * Fallback: Start wenn noch kein Turn aktiv (Text-Eingabe / Mic-Mark verpasst).
 */
export function latencyEnsureTurn(meta?: string): string | null {
  if (!enabled()) return null;
  if (active && !active.logged) return active.id;
  return latencyStartTurn(meta ?? 'ensure');
}

export function latencyMark(
  mark: Exclude<LatencyMark, 't0'>,
  detail?: string,
): void {
  if (!enabled() || !active || active.logged) return;
  // Erstes Event gewinnt (Doppel-Ack / Doppel-TTS vermeiden)
  if (active.marks[mark] != null) return;
  const at = now();
  active.marks[mark] = at;
  const delta = msSinceT0(at, active.t0);
  const label =
    mark === 'ack'
      ? 'ack floskel'
      : mark === 'context'
        ? 'contextMs'
        : mark === 'decompose'
          ? 'decomposeMs'
          : mark === 'research'
            ? 'researchMs'
            : 'ttsMs final_audio';
  if (__DEV__) {
    console.log(
      `[latency] +${delta}ms ${label}${detail ? ` · ${detail}` : ''} id=${active.id}`,
    );
  }

  if (mark === 'tts') {
    latencyFlushSummary();
  }
}

/** Zusammenfassung nach Final-TTS (oder manuell). */
export function latencyFlushSummary(): void {
  if (!enabled() || !active || active.logged) return;
  const turn = active;
  turn.logged = true;
  const t0 = turn.t0;
  const row = (m: Exclude<LatencyMark, 't0'>): number | null =>
    turn.marks[m] != null ? msSinceT0(turn.marks[m]!, t0) : null;

  const ack = row('ack');
  const contextMs = row('context');
  const decomposeMs = row('decompose');
  const researchMs = row('research');
  const ttsMs = row('tts');
  const total = ttsMs ?? Math.round(now() - t0);

  if (__DEV__) {
    console.log(
    '[latency] SUMMARY',
    JSON.stringify({
      id: turn.id,
      meta: turn.meta ?? null,
      t0: 0,
      ackMs: ack,
      contextMs,
      decomposeMs,
      researchMs,
      ttsMs,
      totalMs: total,
      gaps: {
        ack_to_context:
          ack != null && contextMs != null ? contextMs - ack : null,
        context_to_decompose:
          contextMs != null && decomposeMs != null
            ? decomposeMs - contextMs
            : null,
        decompose_to_research:
          decomposeMs != null && researchMs != null
            ? researchMs - decomposeMs
            : null,
        research_to_tts:
          researchMs != null && ttsMs != null ? ttsMs - researchMs : null,
        ack_to_tts: ack != null && ttsMs != null ? ttsMs - ack : null,
      },
    }),
    );
  }

  // Production-fähig: Breadcrumb an Sentry (wenn DSN gesetzt)
  try {
    const { reportLatencyToSentry } = require('../diagnostics/sentryBootstrap') as {
      reportLatencyToSentry: (s: {
        id: string;
        meta?: string | null;
        ackMs?: number | null;
        contextMs?: number | null;
        decomposeMs?: number | null;
        researchMs?: number | null;
        ttsMs?: number | null;
        totalMs?: number | null;
      }) => void;
    };
    reportLatencyToSentry({
      id: turn.id,
      meta: turn.meta ?? null,
      ackMs: ack,
      contextMs,
      decomposeMs,
      researchMs,
      ttsMs,
      totalMs: total,
    });
  } catch {
    /* soft */
  }
}

/** Turn verwerfen (leerer Transcript etc.) */
export function latencyAbortTurn(): void {
  if (!enabled()) return;
  active = null;
}

export function latencyGetActiveId(): string | null {
  return active && !active.logged ? active.id : null;
}
