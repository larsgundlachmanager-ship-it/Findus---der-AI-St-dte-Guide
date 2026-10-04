/**
 * Call-1 Work-Orchestrator — runnable Work aus dem Brief.
 * Phase C: work[] ist Wahrheit; execution= Compat/Ableitung.
 */

import {
  buildCall1TaskBrief,
  type Call1TaskBrief,
  type Call1WorkItem,
  isPrematureNavStart,
  detectTaxiAirportBlocker,
} from './call1TaskBrief';
import type { ManagerAnalysis, ManagerTask } from './types';
import { stripInternalWorkerSpeech } from '../speech/speechHumanOnly';
import {
  executionFromWorkers,
  normalizeWorkerId,
  workerToExecutionHint,
  workerToManagerLane,
  type Call1ExecutionHint,
  type Call1WorkerId,
} from './call1CapabilityMap';

export type Call1OrchestratorResult = {
  brief: Call1TaskBrief;
  /** Wenn true: Bridge/askBack reicht — kein Nav/Taxi jetzt */
  skipHeavyExecution: boolean;
  /** Compat: welches Backend dominant ist */
  primaryExecution: Call1ExecutionHint | null;
};

export function resolveCall1Task(opts: {
  analysis: ManagerAnalysis;
  userText: string;
  call2Tips?: string[] | null;
}): Call1OrchestratorResult {
  const brief = buildCall1TaskBrief(opts);
  const taxi = detectTaxiAirportBlocker(opts.userText);
  const premature = isPrematureNavStart(opts.userText);

  const skipHeavyExecution =
    Boolean(brief.askBack) ||
    Boolean(brief.bridgeComplete && taxi.blocked) ||
    (premature &&
      brief.work.some((w) => w.worker === 'nav' || w.worker === 'transit') &&
      brief.runnableWork.every((w) => w.worker !== 'nav' && w.worker !== 'transit'));

  const runnableWorkers = brief.runnableWork.map((w) => w.worker);
  let primaryExecution: Call1ExecutionHint | null = runnableWorkers.length
    ? executionFromWorkers(runnableWorkers)
    : brief.work.length
      ? executionFromWorkers(brief.work.map((w) => w.worker))
      : null;

  if (taxi.blocked || premature) {
    if (primaryExecution === 'nav_execute') {
      primaryExecution = brief.runnableWork.some((w) =>
        ['place', 'dining', 'pitch', 'plan', 'hotel'].includes(w.worker),
      )
        ? 'pitch_module'
        : 'chat_lane';
    } else if (
      (premature || taxi.blocked) &&
      (primaryExecution === 'task_fanout' || primaryExecution === 'pitch_module')
    ) {
      // Blocker (Taxi ohne Flug / morgen dahin): nicht Deep-Web-Fanout als Primary
      primaryExecution = 'chat_lane';
    }
  }

  return { brief, skipHeavyExecution, primaryExecution };
}

/**
 * Phase C: work[] schlägt schwache/veraltete execution — Safety-Nav „jetzt“ bleibt.
 */
export function reconcileExecutionWithOrchestrator(
  current: Call1ExecutionHint,
  orch: Call1OrchestratorResult,
  userText?: string,
): Call1ExecutionHint {
  const text = userText || '';
  // Reisebüro / Trip-Paket: nie durch work[]/Pitch/Nav überschreiben
  if (current === 'reisebuero') {
    return 'reisebuero';
  }
  try {
    const { inferCall1JobShape, jobShapeNeedsCompose } = require('./call1JobShape') as {
      inferCall1JobShape: (s: string) => string;
      jobShapeNeedsCompose: (s: string) => boolean;
    };
    if (text && jobShapeNeedsCompose(inferCall1JobShape(text) as never)) {
      return 'task_fanout';
    }
  } catch {
    /* soft */
  }
  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (s: string) => boolean;
    };
    if (text && isFindusReisebueroHandoff(text)) {
      return 'reisebuero';
    }
  } catch {
    /* soft */
  }
  // Solo-Flug A→B / Flight-Advisor: nie durch work[]/Pitch/Chat überschreiben
  // (sonst Spickzettel „Flug“ ohne Kiwi-Links)
  if (current === 'flight_advisor') {
    return 'flight_advisor';
  }
  let tripPackage = false;
  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (s: string) => boolean;
    };
    tripPackage = Boolean(text && isFindusReisebueroHandoff(text));
  } catch {
    tripPackage = false;
  }
  try {
    const {
      isSoloFlightAbSearch,
      blocksExploreDriftForFlight,
    } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
      blocksExploreDriftForFlight: (s: string) => boolean;
    };
    if (
      text &&
      !tripPackage &&
      (isSoloFlightAbSearch(text) || blocksExploreDriftForFlight(text))
    ) {
      return 'flight_advisor';
    }
  } catch {
    /* soft */
  }
  let namedNav = false;
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    namedNav = Boolean(text) && isExplicitNavIntent(text);
    if (!namedNav && text) {
      const { detectHardNavOverride } = require('../../services/navigation/hardNavOverride') as {
        detectHardNavOverride: (s: string) => string | null;
      };
      namedNav = Boolean(detectHardNavOverride(text));
    }
  } catch {
    namedNav = false;
  }
  const premature = text ? isPrematureNavStart(text) : false;
  const taxiBlocked = text ? detectTaxiAirportBlocker(text).blocked : false;

  // Explizites / Hard-Dest Sofort-Nav — nie Trip-Paket / Dining stehlen
  if (namedNav && !premature && !taxiBlocked && !tripPackage) {
    try {
      const { inferCall1JobShape } = require('./call1JobShape') as {
        inferCall1JobShape: (s: string) => string;
      };
      const shape = inferCall1JobShape(text);
      if (
        shape === 'place_dining' ||
        shape === 'trip_package' ||
        shape === 'weather_info' ||
        shape === 'weather_rain' ||
        shape === 'weather_outfit' ||
        shape === 'fact_lookup'
      ) {
        /* keep current / fall through */
      } else {
        return 'nav_execute';
      }
    } catch {
      return 'nav_execute';
    }
  }

  if (orch.brief.askBack) {
    try {
      const { isCriticalSlotAskBack } = require('./call1BridgeCompleteGate') as {
        isCriticalSlotAskBack: (a: string | null, u: string) => boolean;
      };
      if (isCriticalSlotAskBack(orch.brief.askBack, userText || '')) {
        return 'chat_lane';
      }
    } catch {
      return 'chat_lane';
    }
  }
  if (orch.skipHeavyExecution && current === 'nav_execute') {
    return orch.primaryExecution && orch.primaryExecution !== 'nav_execute'
      ? orch.primaryExecution
      : 'chat_lane';
  }
  if (orch.brief.runnableWork.length > 0 && orch.primaryExecution) {
    // Explizites Sofort-Nav (nicht premature) nicht kaputt machen
    if (
      current === 'nav_execute' &&
      orch.primaryExecution === 'nav_execute' &&
      !orch.skipHeavyExecution
    ) {
      return 'nav_execute';
    }
    return orch.primaryExecution;
  }
  if (
    orch.brief.work.length > 0 &&
    orch.brief.runnableWork.length === 0 &&
    current === 'nav_execute'
  ) {
    return 'chat_lane';
  }
  return current;
}

/** work[] → ManagerTasks für task_fanout (wenn legacy tasks leer). */
export function managerTasksFromWork(work: Call1WorkItem[]): ManagerTask[] {
  const out: ManagerTask[] = [];
  const seen = new Set<string>();
  for (const w of work) {
    if (w.executeWhen !== 'now' || w.blockedByAskBack) continue;
    const id = w.id || `w_${w.worker}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id: id.slice(0, 40),
      lane: workerToManagerLane(w.worker),
      brief: `${w.brief || w.worker}${w.wantBookingLink ? ' wantBookingLink' : ''}`.slice(
        0,
        220,
      ),
      priority: 'fast',
      affectsSpeech: true,
      searchHints: w.destCity ? [w.destCity] : undefined,
      filters: {
        ...(w.wantBookingLink ? { wantBookingLink: true } : {}),
        ...(w.must?.length
          ? { mustKeys: w.must.map((m) => m.key).join(',') }
          : {}),
      },
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** Frame-Worker-IDs für deriveCall1Execution. */
export function workersFromAnalysis(analysis: ManagerAnalysis): Call1WorkerId[] {
  const out: Call1WorkerId[] = [];
  for (const t of analysis.frame?.tasks ?? []) {
    const w = normalizeWorkerId(t.worker);
    if (w) out.push(w);
  }
  return out;
}

export function formatBriefForCall2(
  brief: Call1TaskBrief,
  userText?: string,
): string {
  const lines: string[] = [
    'CALL1_TASK_BRIEF (verbindlich — keine Roh-Chat-Halluzination):',
    'SPRACHE: nur Umgangssprache, wie ein Mensch neben dem User. Keine Labels, keine Task-Namen, keine Engine-Wörter.',
    `authorIntent (nie wörtlich sprechen, nur Umgangssprache): ${
      stripInternalWorkerSpeech(brief.authorIntent || '') || '—'
    }`,
    `goldPolicy: adapt (Geländer, kein 1:1-Skript)`,
    `proximity: ${brief.proximity}`,
    `topicCut: ${brief.topicCut ? 'yes' : 'no'}`,
  ];
  const ow = brief.openWorld;
  if (ow) {
    lines.push(
      `openWorld: slot=${ow.answerSlot ?? 'null'} softFillForbidden=${ow.stopPolicy.forbidSoftFillOnMust} radiusKm=${ow.searchPlan.maxRadiusKm} stages=${ow.searchPlan.stages.join('→')}`,
    );
    const ui = ow.uiRequirements;
    lines.push(
      `uiRequirements: menu=${ui.needMenuUrl} priceBullets=${ui.showPriceInBullets} ticket=${ui.needTicket} maps=${ui.needMaps} booking=${ui.needBookingLink} openCalendar=${ui.openCalendar} bullets=${ui.maxBullets}x${ui.bulletMaxLines}@${ui.bulletMaxChars}`,
    );
    if (ow.must.length) lines.push(`must: ${ow.must.join(', ')}`);
    if (ow.avoid.length) lines.push(`avoid: ${ow.avoid.join(', ')}`);
    if (ow.bridgeIntentMirror) {
      lines.push(`bridgeIntentMirror: ${ow.bridgeIntentMirror.slice(0, 160)}`);
    }
    try {
      const {
        call2MustsAreWeak,
        formatCall2MustFitRail,
        strengthenCall2Musts,
      } = require('../speech/call2MustFit') as {
        strengthenCall2Musts: (u: string, m: string[]) => string[];
        call2MustsAreWeak: (m: string[], u: string) => boolean;
        formatCall2MustFitRail: (o: {
          musts: string[];
          avoid?: string[];
          weak?: boolean;
        }) => string;
      };
      const blob = String(userText || brief.authorIntent || '').trim();
      const musts = strengthenCall2Musts(blob, ow.must);
      const weak = call2MustsAreWeak(musts, blob);
      const rail = formatCall2MustFitRail({
        musts,
        avoid: ow.avoid,
        weak,
      });
      if (rail) lines.push(rail);
      else {
        lines.push(
          'HART Call-2: nur Evidence; Stichpunkte max Budget; Buttons ⊆ Evidence; kein Soft-Fill; Speech-Preis = Link-Preis.',
        );
      }
    } catch {
      lines.push(
        'HART Call-2: nur Evidence; Stichpunkte max Budget; Buttons ⊆ Evidence; kein Soft-Fill; Speech-Preis = Link-Preis.',
      );
    }
  }
  if (brief.askBack) {
    lines.push(`askBack: ${brief.askBack}`);
  }
  if (brief.researchCity) {
    lines.push(`researchCity: ${brief.researchCity}`);
  }
  if (brief.curatedContext.length) {
    lines.push('curatedContext:');
    for (const c of brief.curatedContext) lines.push(`- ${c}`);
  }
  if (brief.selfQuestions.length) {
    lines.push('selfQuestions:');
    for (const q of brief.selfQuestions) lines.push(`- ${q}`);
  }
  if (brief.runnableWork.length) {
    lines.push('runnableWork:');
    for (const w of brief.runnableWork) {
      lines.push(
        `- [${w.id}] ${w.worker} @${w.executeWhen}${w.dependsOn ? ` after:${w.dependsOn}` : ''}: ${w.brief}`,
      );
    }
  }
  const deferred = brief.work.filter(
    (w) =>
      !brief.runnableWork.some((r) => r.id === w.id) &&
      (w.dependsOn || w.executeWhen === 'later' || w.executeWhen === 'on_confirm'),
  );
  if (deferred.length) {
    lines.push(
      'queuedWork (nacheinander — logische Reihenfolge, nie droppen):',
    );
    for (const w of deferred.slice(0, 6)) {
      lines.push(
        `- [${w.id}] ${w.worker} @${w.executeWhen}${w.dependsOn ? ` after:${w.dependsOn}` : ''}: ${w.brief}`,
      );
    }
  } else if (!brief.runnableWork.length && brief.work.length) {
    lines.push('work (noch nicht runnable / later / blocked):');
    for (const w of brief.work.slice(0, 6)) {
      lines.push(
        `- [${w.id}] ${w.worker} @${w.executeWhen}${w.blockedByAskBack ? ' BLOCKED' : ''}: ${w.brief}`,
      );
    }
  }
  const tips = [...(brief.call2Tips ?? [])];
  const workers = [
    ...brief.runnableWork.map((w) => w.worker),
    ...brief.work.map((w) => w.worker),
  ];
  // Open-World: Wetter-Worker → Slots explizit an Call-2 (sonst oft nur Slot-Name)
  if (
    workers.includes('weather') &&
    !tips.some((t) => /wetter|temp_c|rain_timing|\bsky\b/i.test(t))
  ) {
    tips.push(
      'Wetter: Slots temp_c / sky / rain_timing nur aus Evidence; answerSlot rain|temperature|activity_weather ehren (bei Aktivität: Regenfenster + Aktivitäts-Bezug + Fallback-Lösung).',
    );
  }
  if (
    workers.includes('events') &&
    !tips.some((t) => /event/i.test(t))
  ) {
    tips.push(
      'Events: nur belegte Termine/Orte — kein Soft-Fill mit Gastro/Dining.',
    );
  }
  if (tips.length) {
    lines.push('call2Tips:');
    for (const t of tips.slice(0, 8)) lines.push(`- ${t}`);
  }
  return lines.join('\n');
}

export function summarizeRunnableWorkers(work: Call1WorkItem[]): string {
  return work.map((w) => w.worker).join('+') || 'none';
}

/** @deprecated use workerToExecutionHint — re-export for older imports */
export { workerToExecutionHint };
