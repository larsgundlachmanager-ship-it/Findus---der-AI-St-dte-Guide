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
import {
  wantsLiveChatVoiceCommand,
  wantsStopLiveChatVoiceCommand,
} from '../../services/handsFree/liveChatSession';

const PER_TASK_CAP: Record<string, number> = {
  weather: 1200,
  pack: 400,
  places: 1500,
  hours: 1500,
  walk_eta: 1500,
  dining: 1500,
  cinema: 2000,
  amenity: 5000,
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
  let cap = PER_TASK_CAP[opts.task.lane] ?? 2000;
  // Explizite Nav / Aldi-Lidl: OSM braucht oft >5s — sonst LÜCKEN ohne Buttons
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (t: string) => boolean;
    };
    const { detectAmenityKind } = require('../agents/amenityNavFacts') as {
      detectAmenityKind: (t: string) => string | null;
    };
    if (
      isExplicitNavIntent(opts.userText) ||
      detectAmenityKind(opts.userText) != null ||
      opts.task.lane === 'amenity' ||
      /nav_|aldi|lidl|baecker|bäck/i.test(opts.task.id)
    ) {
      cap = Math.max(cap, 12_000);
    }
  } catch {
    /* soft */
  }

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
    try {
      const { researchPublicInstagram } = await import(
        '../../services/research/instagramPublicResearch'
      );
      const ig = await researchPublicInstagram({
        userText: opts.userText,
        subject: opts.subject,
        city: opts.city,
        signal: opts.signal,
      });
      return {
        task: opts.task,
        status: 'ok',
        draftText: ig.spokenSpeech || ig.draftText,
        bullets: ig.hits.slice(0, 3).map(
          (h) =>
            `${h.kind === 'story' ? 'Story' : 'IG'}: ${(h.venue || h.title).slice(0, 40)}`,
        ),
        buttons: ig.buttons,
        meta: {
          instagramFallback: ig.empty,
          instagramHits: ig.hits.length,
          concrete_place: ig.hits.length > 0,
          spokenSpeech: ig.spokenSpeech,
        },
        elapsedMs: Date.now() - started,
      };
    } catch {
      return {
        task: opts.task,
        status: 'ok',
        draftText:
          'INSTAGRAM: Recherche fehlgeschlagen — nichts erfinden. Web-Lane nutzen.',
        bullets: [],
        buttons: [],
        meta: { instagramFallback: true },
        elapsedMs: Date.now() - started,
      };
    }
  }

  let jobHint = (opts.analysis.jobHint ||
    classifyJob(opts.userText).jobId) as FindusJobId;
  let secondaryJobIds: FindusJobId[] = [];
  let thinkAhead = opts.task.thinkAhead
    ? (['outfit_from_plan_and_weather'] as const).slice()
    : [];
  let skipTimeout = false;
  try {
    const { dispatchJobsForUtterance } = require('../reboot/pipeline/dispatchJobs') as {
      dispatchJobsForUtterance: (s: string) => FindusJobId[];
    };
    const { orchestrateUtterance } = require('../reboot/pipeline/orchestrateSlots') as {
      orchestrateUtterance: (s: string) => { thinkAhead: string[] };
    };
    const { thinkAheadToLaneHints } = require('../reboot/pipeline/thinkAheadCode') as {
      thinkAheadToLaneHints: (ids: string[]) => string[];
    };
    const ids = dispatchJobsForUtterance(opts.userText);
    if (ids.length) {
      jobHint = ids[0]!;
      secondaryJobIds = ids.slice(1);
      skipTimeout = ids.length > 1;
    }
    thinkAhead = [
      ...thinkAhead,
      ...thinkAheadToLaneHints(orchestrateUtterance(opts.userText).thinkAhead as never),
    ];
  } catch {
    /* soft — classifyJob fallback */
  }

  // Live-Chat-Kurzbefehl ohne Task-Suffix; sonst Brief für Lane-Kontext
  const laneUserText =
    wantsLiveChatVoiceCommand(opts.userText) ||
    wantsStopLiveChatVoiceCommand(opts.userText)
      ? opts.userText
      : `${opts.userText}\n\n[TASK ${opts.task.id}] ${opts.task.brief}`;
  const work = (async (): Promise<ManagerTaskResult> => {
    try {
      const { result } = await runFactLanes({
        userText: laneUserText,
        jobId: jobHint,
        secondaryJobIds,
        thinkAhead: thinkAhead as never,
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
          payload: b.payload,
        })),
        meta: result.meta as Record<string, unknown> | undefined,
        agent: result.agent,
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

  return skipTimeout ? work : withTimeout(work, cap, timeoutResult);
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
      const payload =
        b.payload && typeof b.payload === 'object'
          ? b.payload
          : ({ kind: 'ui', action: 'noop' } as Module2ActionButton['payload']);
      buttons.push({
        id: b.id,
        label: b.label.slice(0, 28),
        payload,
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

  const metaPick = ok.find(
    (r) =>
      r.meta?.amenityNav === true ||
      r.meta?.autoStartNav === true ||
      typeof r.meta?.destLat === 'number',
  )?.meta;

  // System/Live-Chat: nie zu knowledge mergen — sonst skipLlm verloren + Echo
  const systemHit = ok.find(
    (r) =>
      r.agent === 'system' ||
      r.meta?.liveChat === 'started' ||
      r.meta?.liveChat === 'stopped' ||
      r.meta?.liveChat === 'failed' ||
      r.meta?.handsFree != null,
  );
  if (systemHit) {
    const sysButtons: Module2ActionButton[] = [];
    const seenSys = new Set<string>();
    for (const b of systemHit.buttons) {
      if (seenSys.has(b.id)) continue;
      seenSys.add(b.id);
      const payload =
        b.payload && typeof b.payload === 'object'
          ? b.payload
          : ({ kind: 'ui', action: 'noop' } as Module2ActionButton['payload']);
      sysButtons.push({
        id: b.id,
        label: b.label.slice(0, 28),
        payload,
      });
    }
    return {
      agent: 'system',
      ok: true,
      draftText: systemHit.draftText.trim() || 'Ok.',
      bullets: systemHit.bullets.slice(0, 6),
      buttons: (sysButtons.length ? sysButtons : buttons).slice(0, 6),
      meta: {
        managerRoute: analysis.route,
        blueprintId: analysis.blueprintId,
        blueprintStage: analysis.blueprintStage,
        pace: analysis.pace,
        openLoops: analysis.openLoops,
        needsLiveResearch: false,
        ...systemHit.meta,
      },
    };
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
      ...(metaPick
        ? {
            amenityNav: metaPick.amenityNav === true,
            unique: metaPick.unique === true,
            autoStartNav: metaPick.autoStartNav === true,
            forceAutoNav: metaPick.forceAutoNav === true,
            route_or_nav: metaPick.route_or_nav === true,
            destName: metaPick.destName,
            destLat: metaPick.destLat,
            destLng: metaPick.destLng,
            distanceM: metaPick.distanceM,
          }
        : {}),
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
  const fastTasks = analysis.tasks
    .filter((t) => t.priority === 'fast')
    .sort((a, b) => {
      if (a.lane === 'pack' && b.lane !== 'pack') return -1;
      if (b.lane === 'pack' && a.lane !== 'pack') return 1;
      return 0;
    });
  const silentSlowPending = analysis.tasks.filter(
    (t) => t.priority === 'silent_slow',
  );
  const spokenSlowPending = analysis.tasks.filter(
    (t) => t.priority === 'spoken_slow',
  );

  const deadline = analysis.fastDeadlineMs;
  const started = Date.now();

  const packTask = fastTasks.find((t) => t.lane === 'pack');
  const orderedFast = packTask
    ? [packTask, ...fastTasks.filter((t) => t !== packTask)]
    : fastTasks;

  const fastPromises = orderedFast.slice(0, 20).map((task) =>
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

  if (packTask && fastPromises.length > 0) {
    const packHeadMs = Math.min(1200, Math.max(400, deadline / 2));
    await Promise.race([fastPromises[0]!, sleep(packHeadMs)]);
  }

  const deadlineFallback: ManagerTaskResult[] = orderedFast.map((task) => ({
    task,
    status: 'timeout' as const,
    draftText: '',
    bullets: [],
    buttons: [],
    meta: { timedOut: true, globalDeadline: true },
    elapsedMs: deadline,
  }));

  // Wall-clock: Lane-Cap + Nav-Boost respektieren
  const fastResults = await Promise.all(
    fastPromises.map((p, i) => {
      const task = orderedFast[i]!;
      const lane = task.lane ?? 'other';
      let slotMs = Math.max(deadline, PER_TASK_CAP[lane] ?? 2000);
      try {
        const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
          isExplicitNavIntent: (t: string) => boolean;
        };
        if (
          isExplicitNavIntent(opts.userText) ||
          lane === 'amenity' ||
          /nav_|aldi|lidl/i.test(task.id)
        ) {
          slotMs = Math.max(slotMs, 12_000);
        }
      } catch {
        /* soft */
      }
      return withTimeout(p, slotMs, deadlineFallback[i]!);
    }),
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
