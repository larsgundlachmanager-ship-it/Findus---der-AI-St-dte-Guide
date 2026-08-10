/**
 * Task-Fanout: parallele Fast-Tasks mit harter Deadline;
 * Silent/Spoken Slow getrennt.
 */

import type { AgentResult, Module2ActionButton } from '../types';
import type { RucksackState } from '../rucksack/rucksackStore';
import { runFactLanes } from '../reboot/factLaneRegistry';
import { classifyJob } from '../jobs/classifyJob';
import type { FindusJobId } from '../jobs/types';
import type { ManagerAnalysis, ManagerTask, ManagerTaskResult } from './types';

const PER_TASK_CAP: Record<string, number> = {
  weather: 1200,
  pack: 400,
  places: 1500,
  hours: 1500,
  walk_eta: 1500,
  dining: 1500,
  cinema: 2000,
  amenity: 1500,
  parking: 1200,
  combo: 2000,
  knowledge: 2000,
  grocery_on_way: 1500,
  web_events: 8000,
  instagram: 25000,
  other: 2000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => fallback)]);
}

async function runOneTask(opts: {
  task: ManagerTask;
  userText: string;
  analysis: ManagerAnalysis;
  rucksack: RucksackState;
  subject: string | null;
  city: string | null;
  signal?: AbortSignal;
}): Promise<ManagerTaskResult> {
  const started = Date.now();
  const cap = PER_TASK_CAP[opts.task.lane] ?? 2000;

  if (opts.signal?.aborted) {
    return {
      task: opts.task,
      status: 'skipped',
      draftText: '',
      bullets: [],
      buttons: [],
      elapsedMs: 0,
    };
  }

  if (opts.task.lane === 'instagram') {
    return {
      task: opts.task,
      status: 'ok',
      draftText:
        'INSTAGRAM-FALLBACK vorgesehen: öffentliche Beiträge/Stories prüfen wenn Web dünn. Nichts erfinden.',
      bullets: ['Instagram-Fallback'],
      buttons: [],
      meta: { instagramFallback: true },
      elapsedMs: Date.now() - started,
    };
  }

  const jobHint = (opts.analysis.jobHint ||
    classifyJob(opts.userText).jobId) as FindusJobId;

  const work = (async (): Promise<ManagerTaskResult> => {
    try {
      const { result } = await runFactLanes({
        userText: `${opts.userText}\n\n[TASK ${opts.task.id}] ${opts.task.brief}`,
        jobId: jobHint,
        secondaryJobIds: [],
        thinkAhead: opts.task.thinkAhead
          ? ['outfit_from_plan_and_weather']
          : [],
        rucksack: opts.rucksack,
        subject: opts.subject,
        city: opts.city,
        signal: opts.signal,
      });
      return {
        task: opts.task,
        status: 'ok',
        draftText: result.draftText || '',
        bullets: result.bullets ?? [],
        buttons: (result.buttons ?? []).map((b) => ({
          id: b.id,
          label: b.label,
        })),
        meta: result.meta as Record<string, unknown> | undefined,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      return {
        task: opts.task,
        status: 'error',
        draftText: '',
        bullets: [],
        buttons: [],
        meta: {
          error: err instanceof Error ? err.message.slice(0, 80) : 'error',
        },
        elapsedMs: Date.now() - started,
      };
    }
  })();

  const timeoutResult: ManagerTaskResult = {
    task: opts.task,
    status: 'timeout',
    draftText: '',
    bullets: [],
    buttons: [],
    meta: { timedOut: true },
    elapsedMs: cap,
  };

  return withTimeout(work, cap, timeoutResult);
}

export type FanoutBundle = {
  fastResults: ManagerTaskResult[];
  silentSlowPending: ManagerTask[];
  spokenSlowPending: ManagerTask[];
  mergedFact: AgentResult;
  fastGatherMs: number;
  timedOutIds: string[];
};

function mergeResults(
  results: ManagerTaskResult[],
  analysis: ManagerAnalysis,
): AgentResult {
  const ok = results.filter((r) => r.status === 'ok' && r.draftText.trim());
  const timed = results.filter((r) => r.status === 'timeout');
  const parts = ok.map(
    (r) =>
      `### ${r.task.id} (${r.task.lane}${r.task.thinkAhead ? ', thinkAhead' : ''})\n${r.task.brief}\n${r.draftText}`,
  );
  if (timed.length) {
    parts.push(
      `### LÜCKEN (Timeout)\n${timed.map((t) => t.task.id).join(', ')} — nicht erfinden.`,
    );
  }
  const bullets = ok.flatMap((r) => r.bullets).slice(0, 6);
  const buttons: Module2ActionButton[] = [];
  const seen = new Set<string>();
  for (const r of ok) {
    for (const b of r.buttons) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      buttons.push({
        id: b.id,
        label: b.label.slice(0, 20),
        payload: { kind: 'ui', action: 'noop' },
      });
    }
  }
  for (const t of analysis.tasks.filter((x) => x.priority === 'silent_slow')) {
    const id = `pending_${t.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    buttons.push({
      id,
      label: `${t.lane.slice(0, 12)}…`.slice(0, 20),
      payload: {
        kind: 'ui',
        action: 'pending_slow',
        data: { taskId: t.id, pending: true },
      },
    });
  }

  return {
    agent: 'knowledge',
    ok: true,
    draftText:
      parts.join('\n\n').slice(0, 6000) ||
      'Keine Fast-Fakten in der Deadline.',
    bullets,
    buttons,
    meta: {
      managerRoute: analysis.route,
      blueprintId: analysis.blueprintId,
      blueprintStage: analysis.blueprintStage,
      pace: analysis.pace,
      openLoops: analysis.openLoops,
      needsLiveResearch: analysis.lanePlan === 'fast_then_spoken_slow',
      concrete_place: ok.some((r) => r.meta?.concrete_place === true),
      pendingSilentSlow: analysis.tasks
        .filter((t) => t.priority === 'silent_slow')
        .map((t) => t.id),
    },
  };
}

export async function runManagerTaskFanout(opts: {
  analysis: ManagerAnalysis;
  userText: string;
  rucksack: RucksackState;
  subject: string | null;
  city: string | null;
  signal?: AbortSignal;
}): Promise<FanoutBundle> {
  const { analysis } = opts;
  const fastTasks = analysis.tasks.filter((t) => t.priority === 'fast');
  const silentSlowPending = analysis.tasks.filter(
    (t) => t.priority === 'silent_slow',
  );
  const spokenSlowPending = analysis.tasks.filter(
    (t) => t.priority === 'spoken_slow',
  );

  const deadline = analysis.fastDeadlineMs;
  const started = Date.now();

  const fastPromises = fastTasks.slice(0, 20).map((task) =>
    runOneTask({
      task,
      userText: opts.userText,
      analysis,
      rucksack: opts.rucksack,
      subject: opts.subject,
      city: opts.city,
      signal: opts.signal,
    }),
  );

  const deadlineFallback: ManagerTaskResult[] = fastTasks.map((task) => ({
    task,
    status: 'timeout' as const,
    draftText: '',
    bullets: [],
    buttons: [],
    meta: { timedOut: true, globalDeadline: true },
    elapsedMs: deadline,
  }));

  // Wall-clock ≈ deadline: each slot races its task vs global deadline
  const fastResults = await Promise.all(
    fastPromises.map((p, i) =>
      withTimeout(p, deadline, deadlineFallback[i]!),
    ),
  );

  const timedOutIds = fastResults
    .filter((r) => r.status === 'timeout')
    .map((r) => r.task.id);

  return {
    fastResults,
    silentSlowPending,
    spokenSlowPending,
    mergedFact: mergeResults(fastResults, analysis),
    fastGatherMs: Date.now() - started,
    timedOutIds,
  };
}

/** Background silent-slow — buttons pop in without speech block. */
export async function runSilentSlowTasks(opts: {
  tasks: ManagerTask[];
  analysis: ManagerAnalysis;
  userText: string;
  rucksack: RucksackState;
  subject: string | null;
  city: string | null;
  signal?: AbortSignal;
}): Promise<ManagerTaskResult[]> {
  return Promise.all(
    opts.tasks.slice(0, 8).map((task) =>
      runOneTask({
        task,
        userText: opts.userText,
        analysis: opts.analysis,
        rucksack: opts.rucksack,
        subject: opts.subject,
        city: opts.city,
        signal: opts.signal,
      }),
    ),
  );
}
