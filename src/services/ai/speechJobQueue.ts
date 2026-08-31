/**
 * Globale Speech-Job-Queue mit Priorität:
 * question > nav > system > explore
 *
 * - Fragen (Modul 2) gehen immer vor und preempten alles.
 * - Navi unterbricht nur Explore (Modul 1); danach läuft Explore weiter.
 * - Modul 1 ist immer das Unwichtigste.
 * - clearSpeechJobQueue rejected Pending sauber — nie Jobs still verwerfen
 *   (sonst hängt await speak* und Yorro bleibt stumm).
 */

export type SpeechPriority = 'question' | 'nav' | 'system' | 'explore';

const PRIORITY_RANK: Record<SpeechPriority, number> = {
  question: 100,
  nav: 70,
  system: 40,
  explore: 10,
};

type SpeechJob = {
  id: number;
  priority: SpeechPriority;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
  settled: boolean;
};

let nextId = 1;
const pending: SpeechJob[] = [];
let running: SpeechJob | null = null;
let draining = false;
/** Soft stop of current job only (nav preempts explore / barge-in). */
let softAbortCurrent = false;

export function getSpeechJobQueueSize(): number {
  return pending.length + (running ? 1 : 0);
}

/**
 * Busy = Job läuft oder wartet.
 * `draining` allein zählt nicht (Mikro-Settle zwischen Jobs) —
 * sonst blockieren Folge-Utterances fälschlich.
 */
export function isSpeechJobQueueBusy(): boolean {
  return running != null || pending.length > 0;
}

export function getCurrentSpeechPriority(): SpeechPriority | null {
  return running?.priority ?? null;
}

export function getSpeechPriorityRank(p: SpeechPriority): number {
  return PRIORITY_RANK[p];
}

function settleJob(
  job: SpeechJob,
  kind: 'resolve' | 'reject',
  err?: Error,
): void {
  if (job.settled) return;
  job.settled = true;
  if (kind === 'resolve') job.resolve();
  else job.reject(err ?? new Error('speech_interrupted'));
}

function rejectAllPending(reason: string): void {
  const dropped = pending.splice(0, pending.length);
  const err = new Error(reason);
  for (const job of dropped) {
    settleJob(job, 'reject', err);
  }
}

function insertByPriority(job: SpeechJob): void {
  const rank = PRIORITY_RANK[job.priority];
  let i = 0;
  while (
    i < pending.length &&
    PRIORITY_RANK[pending[i].priority] >= rank
  ) {
    i += 1;
  }
  pending.splice(i, 0, job);
}

/**
 * Enqueue a speech job. Higher priority inserts ahead of lower pending jobs.
 * Does not by itself cancel the currently playing job — callers preempt explicitly.
 */
export function enqueueSpeechJob(
  run: () => Promise<void>,
  opts?: { priority?: SpeechPriority },
): Promise<void> {
  const priority = opts?.priority ?? 'system';
  const id = nextId++;
  return new Promise<void>((resolve, reject) => {
    const job: SpeechJob = {
      id,
      priority,
      settled: false,
      resolve,
      reject,
      run: async () => {
        try {
          await run();
          if (softAbortCurrent) {
            settleJob(job, 'reject', new Error('speech_interrupted'));
            return;
          }
          settleJob(job, 'resolve');
        } catch (err) {
          settleJob(
            job,
            'reject',
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      },
    };
    insertByPriority(job);
    void drainSpeechJobs();
  });
}

async function drainSpeechJobs(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.length > 0) {
      // Jeder neue Job startet sauber — Abort gilt nur für den vorher laufenden.
      softAbortCurrent = false;
      const job = pending.shift()!;
      running = job;
      try {
        await job.run();
      } catch {
        /* settleJob already called inside run */
      } finally {
        running = null;
        softAbortCurrent = false;
        if (!job.settled) {
          settleJob(job, 'resolve');
        }
      }
      // Mikro-Settle: nächster Job startet nie über ausklingendes Audio
      await new Promise((r) => setTimeout(r, 40));
    }
  } finally {
    draining = false;
    if (pending.length > 0) {
      void drainSpeechJobs();
    }
  }
}

/**
 * Hard clear — Voice-Input / Modul-2 Interrupt.
 * Pending Jobs werden rejected (kein hängendes await); laufender Job soft-abort.
 */
export function clearSpeechJobQueue(): void {
  softAbortCurrent = true;
  rejectAllPending('speech_interrupted');
}

/**
 * Soft-abort nur den laufenden Job (z. B. Explore für Navi).
 * Pending Jobs bleiben erhalten (inkl. Explore-Rest nach Re-Enqueue).
 */
export function softAbortCurrentSpeechJob(): void {
  softAbortCurrent = true;
}

export function dropPendingBelowPriority(minPriority: SpeechPriority): void {
  const minRank = PRIORITY_RANK[minPriority];
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    if (PRIORITY_RANK[pending[i].priority] < minRank) {
      const [job] = pending.splice(i, 1);
      settleJob(job, 'reject', new Error('speech_interrupted'));
    }
  }
}

export function peekSpeechJobQueueDepth(): number {
  return pending.length;
}

export function isSoftAbortRequested(): boolean {
  return softAbortCurrent;
}
