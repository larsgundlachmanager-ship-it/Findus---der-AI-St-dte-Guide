/**
 * ComposeRunner — Multi-Need Turns (arrival_home / logistics_multi).
 * Härten: task_fanout + bestehende Worker, kein zweites Gehirn.
 * SSOT: docs/rfc/agent-harden-contract.md
 */

import type { Call1JobShape } from './call1JobShape';
import {
  asCall1JobShape,
  inferCall1JobShape,
  jobShapeNeedsCompose,
} from './call1JobShape';
import type { ManagerAnalysis, ManagerTask } from './types';
import type { ManagerTaskResult } from './runManagerTasks';
import { managerTasksFromWork } from './call1WorkOrchestrator';
import type { RucksackState } from '../rucksack/rucksackStore';

export type ComposeWorkerResult = {
  id: string;
  worker: string;
  speech?: string | null;
  bullets?: string[];
  actions?: Array<{ type: string; label: string; payload?: unknown }>;
};

export type ComposeMergeResult = {
  speechText: string;
  visualBullets: string[];
  quickActions: ComposeWorkerResult['actions'];
  cardTitle: string;
};

/** Ob Exclusive-Early-Return übersprungen werden soll → task_fanout + Compose. */
export function shouldSkipExclusiveEarlyReturn(
  shape: Call1JobShape | string | null | undefined,
): boolean {
  if (!shape) return false;
  return jobShapeNeedsCompose(shape as Call1JobShape);
}

export function resolveComposeJobShape(
  userText: string,
  analysis?: ManagerAnalysis | null,
): Call1JobShape | null {
  const fromOrder = analysis?.order?.jobShape
    ? asCall1JobShape(analysis.order.jobShape)
    : null;
  const shape = fromOrder || inferCall1JobShape(userText);
  return jobShapeNeedsCompose(shape) ? shape : null;
}

/**
 * Webe Worker-Speech zu einem mündlichen Fließtext (kein ·-Telegramm).
 */
export function mergeComposeSpeech(
  parts: ComposeWorkerResult[],
  opts?: { shape?: Call1JobShape; destLabel?: string | null },
): ComposeMergeResult {
  const speeches = parts
    .map((p) => String(p.speech || '').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 8);
  const bullets: string[] = [];
  const actions: NonNullable<ComposeWorkerResult['actions']> = [];
  const seenBullet = new Set<string>();
  const seenAction = new Set<string>();

  for (const p of parts) {
    for (const b of p.bullets || []) {
      const t = String(b || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 72);
      const k = t.toLowerCase();
      if (!t || seenBullet.has(k)) continue;
      seenBullet.add(k);
      bullets.push(t);
      if (bullets.length >= 3) break;
    }
    for (const a of p.actions || []) {
      const key = `${a.type}|${a.label}|${JSON.stringify(a.payload ?? null)}`.slice(
        0,
        160,
      );
      if (seenAction.has(key)) continue;
      seenAction.add(key);
      actions.push(a);
    }
  }

  let speechText = '';
  if (speeches.length === 0) {
    speechText =
      opts?.shape === 'arrival_home'
        ? 'Ich rechne Ankunft und Anreise zusammen und sag dir Bescheid.'
        : 'Ich pack die Teilstücke zusammen.';
  } else if (speeches.length === 1) {
    speechText = speeches[0]!;
  } else {
    const head = speeches[0]!;
    const rest = speeches
      .slice(1)
      .map((s) => s.replace(/^(Klar[,.]?\s*|Ok[,.]?\s*|Verstanden[,.]?\s*)/iu, ''))
      .filter(Boolean);
    speechText = [head, ...rest].join(' ').replace(/\s+/g, ' ').trim();
  }

  speechText = speechText.replace(/\s*·\s*/g, ', ').replace(/\s{2,}/g, ' ').trim();

  const cardTitle =
    opts?.shape === 'arrival_home'
      ? 'Heim-Ankunft'
      : opts?.destLabel
        ? String(opts.destLabel).slice(0, 40)
        : 'Kombi-Plan';

  return {
    speechText: speechText.slice(0, 2400),
    visualBullets: bullets.slice(0, 3),
    quickActions: actions.slice(0, 5),
    cardTitle,
  };
}

export function composeWorkHintsForShape(
  shape: Call1JobShape,
  userText: string,
): Array<{ id: string; worker: string; brief: string }> {
  if (shape === 'arrival_home') {
    return [
      {
        id: 'home_eta',
        worker: 'flight',
        brief:
          'Ankunft Heim: Flug/Anreise Leave-by + ETA — journeyLeaveBy / flight Worker',
      },
      {
        id: 'home_leg',
        worker: 'nav',
        brief: 'Letzte Meile / Anschluss nach Hause wenn belegt',
      },
    ];
  }
  if (shape === 'logistics_multi') {
    return [
      {
        id: 'main_leg',
        worker: 'nav',
        brief: `Hauptroute: ${userText.slice(0, 80)}`,
      },
      {
        id: 'add_stop',
        worker: 'nav',
        brief: 'Zwischenstopp — multiStopTour / nav Worker',
      },
    ];
  }
  return [];
}

export function buildComposeManagerTasks(
  shape: Call1JobShape,
  userText: string,
  existing: ManagerTask[] = [],
): ManagerTask[] {
  if (existing.length >= 2) return existing.slice(0, 6);

  const hints = composeWorkHintsForShape(shape, userText);
  try {
    const { planDiningTaxiCompound } = require('./call1MobilityCompound') as {
      planDiningTaxiCompound: (s: string) => { work: Array<{ id: string; worker: string; brief: string }> } | null;
    };
    const plan = shape === 'logistics_multi' ? planDiningTaxiCompound(userText) : null;
    if (plan?.work?.length) {
      const fromWork = managerTasksFromWork(
        plan.work.map((w) => ({
          id: w.id,
          worker: w.worker as never,
          brief: w.brief,
          executeWhen: 'now' as const,
          blockedByAskBack: false,
        })),
      );
      if (fromWork.length >= 2) return fromWork.slice(0, 6);
    }
  } catch {
    /* soft */
  }

  const out: ManagerTask[] = [...existing];
  const seen = new Set(out.map((t) => t.id));
  for (const h of hints) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({
      id: h.id,
      lane: h.worker === 'nav' || h.worker === 'transit' ? 'walk_eta' : 'other',
      brief: h.brief,
      priority: 'fast',
      affectsSpeech: true,
    });
  }
  return out.slice(0, 6);
}

export function mergeComposeSpeechFromResults(
  results: ManagerTaskResult[],
  shape?: Call1JobShape,
): { speech: string; bullets: string[] } {
  const parts: ComposeWorkerResult[] = results
    .filter((r) => r.status === 'ok' && r.draftText.trim())
    .map((r) => ({
      id: r.task.id,
      worker: r.task.lane,
      speech: r.draftText,
      bullets: r.bullets,
    }));
  const merged = mergeComposeSpeech(parts, { shape });
  return {
    speech: merged.speechText,
    bullets: merged.visualBullets,
  };
}

export function augmentAnalysisForCompose(
  analysis: ManagerAnalysis,
  userText: string,
  shape: Call1JobShape,
): ManagerAnalysis {
  const tasks = buildComposeManagerTasks(shape, userText, analysis.tasks ?? []);
  return {
    ...analysis,
    execution: 'task_fanout',
    tasks,
  };
}

export async function runComposeRunner(opts: {
  shape: Call1JobShape;
  analysis: ManagerAnalysis;
  userText: string;
  rucksack: RucksackState;
  subject: string | null;
  city: string | null;
  signal?: AbortSignal;
}): Promise<{
  fanout: Awaited<
    ReturnType<typeof import('./runManagerTasks').runManagerTaskFanout>
  >;
  composedSpeech: string;
  composedBullets: string[];
}> {
  const { runManagerTaskFanout } = require('./runManagerTasks') as typeof import('./runManagerTasks');
  const analysis = augmentAnalysisForCompose(
    opts.analysis,
    opts.userText,
    opts.shape,
  );
  const fanout = await runManagerTaskFanout({
    analysis,
    userText: opts.userText,
    rucksack: opts.rucksack,
    subject: opts.subject,
    city: opts.city,
    signal: opts.signal,
  });
  const { speech, bullets } = mergeComposeSpeechFromResults(
    fanout.fastResults,
    opts.shape,
  );
  return { fanout, composedSpeech: speech, composedBullets: bullets };
}
