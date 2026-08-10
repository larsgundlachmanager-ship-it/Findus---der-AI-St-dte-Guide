/**
 * Modul 5 — Masterplan-Orchestrator.
 * 1) Bridge + komplette Timeline einmal befüllen
 * 2) Confirm grober Plan
 * 3) Offene Punkte chronologisch (Prio 6 zuletzt) mit 2er-Auswahl
 * 4) Routes + Final
 */

import { enqueueSpeech } from '../speech/speechQueue';
import {
  requestOpenPlanCalendar,
  usePlanCalendarUiStore,
} from '../timeline/planCalendarUiStore';
import {
  useFuturePlanStore,
  type FuturePlanStop,
  type FuturePlanTransport,
} from '../timeline/futurePlanState';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import {
  getActiveTaskOverride,
  usePlanSessionStore,
} from './planSessionState';
import type {
  IngestedPlan,
  IngestFixedNode,
  IngestGeoAnchor,
  IngestOpenWish,
  PlanNavNode,
} from './planningTypes';
import {
  derivePlanTasks,
  runPlanningIngestion,
} from './planningLlmIngestion';
import {
  executeDeepResearchAndPitch,
  isExploreWish,
  parseWishFreeHours,
  triggerAsyncDeepResearch,
} from './planPlacesResearch';
import { calculateNavigation } from './planMobilityEngine';
import { runFinalTimelineOptimization } from './planConflictResolve';
import { sanitizePlanSpeech } from './planSpeechSanitize';
import {
  clampToFutureMs,
  isPastMs,
} from '../timeline/planNowGuard';
import { todayDateKey } from '../../utils/dateKeys';
import { getCachedUserProfile } from '../../services/userProfileService';

function speak(text: string): void {
  const t = sanitizePlanSpeech((text ?? '').replace(/\s+/g, ' ').trim());
  if (!t) return;
  enqueueSpeech({
    kind: 'main',
    text: t,
    turnId: `m5_${Date.now()}`,
  });
}

function openPlanCalendarModal(targetDate: string): void {
  usePlanCalendarUiStore.getState().setHeadlessPlanning(false);
  usePlanCalendarUiStore.getState().requestDayKey(targetDate);
  requestOpenPlanCalendar();
  useFuturePlanStore.getState().ensureDay(targetDate);
}

export function parseTimeToMs(dayKey: string, time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const dt = new Date(y!, mo! - 1, d!, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

function clearPlanningArtifactsOnDay(dayKey: string, lageMode: IngestedPlan['lageMode']): void {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  for (const s of [...plan.stops]) {
    if (s.id.startsWith('choice_')) {
      useFuturePlanStore.getState().removeStop(s.id);
      continue;
    }
    // Bei neuem Plan: alte Soft-Wünsche/Master-Slots dieses Tags ersetzen
    if (lageMode === 'new') {
      if (
        s.kind === 'wish' ||
        s.id.startsWith('fix_') ||
        s.id.startsWith('wish_') ||
        s.id.startsWith('anchor_') ||
        s.id.startsWith('explore_')
      ) {
        useFuturePlanStore.getState().removeStop(s.id);
      }
    }
  }
}

function insertGeoAnchor(anchor: IngestGeoAnchor, dayKey: string): void {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const lat = anchor.lat ?? gps.lat;
  const lng = anchor.lng ?? gps.lng;
  const isToday = dayKey === todayDateKey();
  const label = (anchor.name || '').trim() || (isToday ? 'Hier' : 'Basis');
  const kind =
    anchor.type === 'HOTEL_START'
      ? 'hotel'
      : isToday
        ? 'gps'
        : /hotel|pension|ferien/i.test(label)
          ? 'hotel'
          : 'home';

  // Basis oben in der UI — kein Fake-„08:00 Hamburg-Start“ als Timeline-Stop
  useFuturePlanStore.getState().setDayBase(dayKey, {
    label: label.slice(0, 48),
    kind: kind as 'home' | 'hotel' | 'gps' | 'other',
    lat,
    lng,
  });

  // Alte Anker-Stops entfernen (Legacy)
  for (const s of [...useFuturePlanStore.getState().getPlanForDay(dayKey).stops]) {
    if (s.id.startsWith('anchor_')) {
      useFuturePlanStore.getState().removeStop(s.id);
    }
  }

  // Nur HEUTE: weicher GPS-Start nahe jetzt (für Gap-Fill / Anreise)
  if (!isToday) return;

  const startMs =
    clampToFutureMs(Date.now(), {
      nowMs: Date.now(),
      minAheadMs: 20 * 60_000,
    }) ?? Date.now() + 20 * 60_000;
  const stop: FuturePlanStop = {
    id: `anchor_${dayKey}_start`,
    title: label.slice(0, 48),
    lat,
    lng,
    plannedStartMs: startMs,
    plannedEndMs: startMs + 15 * 60_000,
    bufferMin: 5,
    transport: 'walk',
    hardAnchor: true,
    userFixedTime: false,
    kind: 'stop',
    status: 'planned',
    planPriority: 1,
    notes: 'Start (aktuell)',
    emoji: '🏁',
  };
  useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
}

function insertTimeline(fixedNodes: IngestFixedNode[], dayKey: string): void {
  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const nowMs = Date.now();
  const isToday = dayKey === todayDateKey();
  for (const n of fixedNodes) {
    let startMs = parseTimeToMs(dayKey, n.time);
    if (isToday && startMs != null && isPastMs(startMs, nowMs)) {
      startMs = clampToFutureMs(startMs, { nowMs, minAheadMs: 25 * 60_000 });
    }
    const id = `fix_${dayKey}_${n.title.replace(/\W+/g, '_').slice(0, 24)}_${n.priority}`;
    const stop: FuturePlanStop = {
      id,
      title: n.title.slice(0, 48),
      lat: n.lat ?? gps.lat,
      lng: n.lng ?? gps.lng,
      plannedStartMs: startMs,
      plannedEndMs: startMs != null ? startMs + 60 * 60_000 : null,
      bufferMin: n.priority === 1 ? 15 : 10,
      transport: 'walk',
      hardAnchor: n.priority <= 2,
      userFixedTime: Boolean(n.time),
      kind: 'stop',
      status: n.needsClarification ? 'pending_change' : 'planned',
      planPriority: n.priority,
      notes: n.location || undefined,
      emoji: n.priority === 1 ? '📌' : '📍',
      planTaskId: id,
    };
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
  }
}

/**
 * Offene Wünsche MIT Zeit → blaue Bänder auf der Achse (kind wish + plannedStartMs).
 */
function insertOpenBands(wishes: IngestOpenWish[], dayKey: string): void {
  const nowMs = Date.now();
  const isToday = dayKey === todayDateKey();
  wishes.forEach((w, i) => {
    const id = w.id ?? `wish_${dayKey}_${i}`;
    let startMs = parseTimeToMs(dayKey, w.estimatedTime ?? null);
    if (isToday && startMs != null && isPastMs(startMs, nowMs)) {
      startMs = clampToFutureMs(startMs, { nowMs, minAheadMs: 25 * 60_000 });
    }
    const stop: FuturePlanStop = {
      id,
      title: (w.title || 'Offener Wunsch').slice(0, 48),
      lat: w.lat ?? undefined,
      lng: w.lng ?? undefined,
      plannedStartMs: startMs,
      plannedEndMs: startMs != null ? startMs + 45 * 60_000 : null,
      bufferMin: 5,
      transport: 'unknown',
      kind: 'wish',
      status: 'pending_change',
      planPriority: w.priority,
      openOrder: w.priority === 6 ? 900 + i : i,
      notes: w.context,
      emoji: w.priority === 6 ? '✨' : '🔵',
      userFixedTime: Boolean(w.estimatedTime),
      planTaskId: id,
    };
    useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
  });
}

function applyMasterTimeline(plan: IngestedPlan): void {
  const dayKey = plan.targetDate;
  clearPlanningArtifactsOnDay(dayKey, plan.lageMode);
  // Transport-Default aus Onboarding (Fahrrad/Fuß/ÖPNV/Auto)
  try {
    const mode = getCachedUserProfile()?.mobilityMode;
    const map: Record<string, FuturePlanTransport> = {
      foot: 'walk',
      bike: 'bike',
      public_transit: 'transit',
      car: 'car',
    };
    if (mode && map[mode]) {
      useFuturePlanStore.getState().setTransportDefault(map[mode]!);
    }
  } catch {
    /* soft */
  }
  insertGeoAnchor(plan.geoAnchor, dayKey);
  insertTimeline(plan.fixedNodes, dayKey);
  insertOpenBands(plan.openWishesQueue, dayKey);
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
}

/** Confirm nur bei echten Fixterminen — Explore-only / Soft-Wünsche ohne Confirm. */
function planNeedsVoiceConfirm(plan: IngestedPlan): boolean {
  return plan.fixedNodes.some((n) => Boolean(n.time) || n.priority <= 2);
}

const GASTRO_WISH_RE =
  /\b(restaurant|essen|dinner|mittag|pizza|burger|café|cafe|imbiss|gastro|abendessen|italiener|sushi|steak)\b/i;

function planAlreadyHasGastro(plan: IngestedPlan): boolean {
  for (const w of plan.openWishesQueue) {
    if (GASTRO_WISH_RE.test(`${w.title} ${w.context}`)) return true;
  }
  for (const n of plan.fixedNodes) {
    if (GASTRO_WISH_RE.test(`${n.title} ${n.location ?? ''}`)) return true;
  }
  try {
    const stops = useFuturePlanStore.getState().getPlanForDay(plan.targetDate)
      .stops;
    for (const s of stops) {
      if (s.kind === 'nav_leg' || s.id.startsWith('choice_')) continue;
      if (GASTRO_WISH_RE.test(`${s.title} ${s.notes ?? ''}`)) return true;
    }
  } catch {
    /* soft */
  }
  return false;
}

async function waitForUserLocationInput(): Promise<string> {
  return usePlanSessionStore.getState().beginWaitLocation();
}

function stripPlanConfirmQuestions(text: string): string {
  return (text ?? '')
    .replace(
      /\s*(passt\s+der\s+(fokus|grobe\s+plan|plan)[^.?！？]*[.?!？]?)/giu,
      '',
    )
    .replace(/\s*(soll(?:en)?\s+wir\s+(den\s+)?jetzt\s+suchen)[^.?！？]*[.?!？]?/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function waitForUserConfirmation(intro?: string): Promise<boolean> {
  const line =
    stripPlanConfirmQuestions(intro ?? '') ||
    'Passt der grobe Plan so für dich?';
  speak(line);
  usePlanCalendarUiStore.getState().setShortAnswers([
    { id: 'confirm_change', label: 'Ändern', action: 'plan_reject' },
    { id: 'confirm_ok', label: 'Bestätigen', action: 'plan_confirm' },
  ]);
  return usePlanSessionStore.getState().beginWaitConfirm();
}

function toNavNode(stop: FuturePlanStop): PlanNavNode | null {
  if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') {
    return null;
  }
  return {
    id: stop.id,
    title: stop.title,
    coords: { lat: stop.lat, lng: stop.lng },
    plannedStartMs: stop.plannedStartMs,
    planPriority: stop.planPriority ?? null,
  };
}

function modeToTransport(
  mode: 'WALKING' | 'BICYCLE' | 'TRANSIT' | 'TAXI',
): FuturePlanTransport {
  switch (mode) {
    case 'BICYCLE':
      return 'bike';
    case 'TRANSIT':
      return 'transit';
    case 'TAXI':
      return 'taxi';
    default:
      return 'walk';
  }
}

export async function injectNavigationNode(
  wish: IngestOpenWish,
  committedStopId?: string,
): Promise<void> {
  const plan = useFuturePlanStore.getState().plan;
  const target =
    (committedStopId
      ? plan.stops.find((s) => s.id === committedStopId)
      : null) ??
    plan.stops.find(
      (s) =>
        s.kind !== 'wish' &&
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        s.title.toLowerCase().includes(wish.title.slice(0, 12).toLowerCase()),
    );
  if (!target) return;
  const end = toNavNode(target);
  if (!end) return;

  const prev = plan.stops
    .filter(
      (s) =>
        s.kind !== 'wish' &&
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        s.id !== target.id &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number',
    )
    .sort((a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0))
    .at(-1);

  const bag = readRucksackSync();
  const gps = anchorCoords(bag);
  const start: PlanNavNode = prev
    ? toNavNode(prev) ?? {
        id: 'gps',
        title: 'Start',
        coords: { lat: gps.lat, lng: gps.lng },
      }
    : {
        id: 'gps',
        title: 'Start',
        coords: { lat: gps.lat, lng: gps.lng },
      };

  const leg = await calculateNavigation(start, end);
  const leaveMs =
    (target.plannedStartMs ?? Date.now() + 60 * 60_000) -
    leg.duration * 60_000;

  useFuturePlanStore.getState().upsertStop({
    id: leg.id,
    title: `${leg.mode === 'TRANSIT' ? 'ÖPNV' : leg.mode === 'TAXI' ? 'Taxi' : leg.mode === 'BICYCLE' ? 'Rad' : 'Fuß'} → ${target.title}`,
    lat: start.coords.lat,
    lng: start.coords.lng,
    plannedStartMs: leaveMs,
    plannedEndMs: leaveMs + leg.duration * 60_000,
    bufferMin: 10,
    transport: modeToTransport(leg.mode),
    kind: 'nav_leg',
    status: 'planned',
    planPriority: 4,
    notes: `${leg.duration} Min inkl. Puffer`,
    emoji: '➡️',
    routeEstimate: 'routed',
  });
}

async function waitForPickOrAdvance(timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  const REMIND_AFTER_MS = 4 * 60_000;
  let reminded = false;
  let hadChoice = Boolean(usePlanCalendarUiStore.getState().pendingChoice);
  while (Date.now() - start < timeoutMs) {
    const ui = usePlanCalendarUiStore.getState();
    if (hadChoice && !ui.pendingChoice) return;
    if (getActiveTaskOverride()) return;
    const phase = usePlanSessionStore.getState().phase;
    if (phase === 'idle' || phase === 'final') return;
    // Offene Punkte: erst nach 4 Min einmal erinnern
    if (
      !reminded &&
      hadChoice &&
      ui.pendingChoice &&
      Date.now() - start >= REMIND_AFTER_MS
    ) {
      reminded = true;
      const title = ui.pendingChoice.headline?.trim() || 'dein offener Punkt';
      speak(
        `Nur kurz: ${title} wartet noch auf deine Wahl — kein Stress, tipp einfach, wenn du soweit bist.`,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
    hadChoice = hadChoice || Boolean(ui.pendingChoice);
  }
}

function mergePlans(base: IngestedPlan, patched: IngestedPlan): IngestedPlan {
  const merged: IngestedPlan = {
    targetDate: patched.targetDate || base.targetDate,
    geoAnchor: patched.geoAnchor.needsClarification
      ? base.geoAnchor
      : patched.geoAnchor,
    fixedNodes: [
      ...base.fixedNodes,
      ...patched.fixedNodes.filter(
        (n) =>
          !base.fixedNodes.some(
            (e) => e.title.toLowerCase() === n.title.toLowerCase(),
          ),
      ),
    ],
    openWishesQueue: [
      ...base.openWishesQueue,
      ...patched.openWishesQueue.filter(
        (w) =>
          !base.openWishesQueue.some(
            (e) => e.title.toLowerCase() === w.title.toLowerCase(),
          ),
      ),
    ],
    tasks: [],
    lageMode: patched.lageMode || base.lageMode,
    bridgeSpeech: patched.bridgeSpeech || base.bridgeSpeech,
    openQuestions: patched.openQuestions?.length
      ? patched.openQuestions
      : base.openQuestions,
    initialVoiceConfirm:
      patched.initialVoiceConfirm ||
      'Hab die Änderung eingetragen. Passt das so?',
  };
  if (patched.lageMode === 'change' && patched.openWishesQueue.length > 0) {
    for (const w of patched.openWishesQueue) {
      const idx = merged.openWishesQueue.findIndex(
        (e) => e.title.toLowerCase() === w.title.toLowerCase(),
      );
      if (idx >= 0) merged.openWishesQueue[idx] = w;
    }
  }
  // Prio 6 ans Ende
  merged.openWishesQueue = [
    ...merged.openWishesQueue.filter((w) => w.priority !== 6),
    ...merged.openWishesQueue.filter((w) => w.priority === 6),
  ];
  merged.tasks = derivePlanTasks(merged);
  return merged;
}

function selectionQueue(plan: IngestedPlan): IngestOpenWish[] {
  // Chronologisch nach Zeit; Prio 6 zuletzt; Explore separat am Ende
  const nonExplore = plan.openWishesQueue.filter((w) => !isExploreWish(w));
  const explore = plan.openWishesQueue.filter((w) => isExploreWish(w));
  const byTime = (a: IngestOpenWish, b: IngestOpenWish) =>
    (a.estimatedTime || '99:99').localeCompare(b.estimatedTime || '99:99');
  const soft = nonExplore.filter((w) => w.priority !== 6).sort(byTime);
  const p6 = nonExplore.filter((w) => w.priority === 6).sort(byTime);
  return [...soft, ...p6, ...explore];
}

function speakBridge(plan: IngestedPlan): void {
  // Nur grobe Zusammenfassung — Confirm kommt EINMAL in waitForUserConfirmation
  const bridge = stripPlanConfirmQuestions(plan.bridgeSpeech ?? '');
  if (bridge) speak(bridge);
}

/**
 * Masterplan-Session.
 */
export async function runPlanSession(ingestedPlan: IngestedPlan): Promise<void> {
  const store = usePlanSessionStore.getState();
  store.setActive(true);
  store.setPhase('lage');
  store.setPlan(ingestedPlan);
  store.setTaskQueue(ingestedPlan.tasks);

  // Nur den Zieldatum-Tag öffnen — kein Tag-Sprung
  openPlanCalendarModal(ingestedPlan.targetDate);

  if (
    ingestedPlan.geoAnchor.needsClarification ||
    ingestedPlan.fixedNodes.some((n) => n.needsClarification && !n.time)
  ) {
    speak('Kurze Frage: Wo startest du — oder wo ist der erste Termin?');
    const loc = await waitForUserLocationInput();
    if (loc.trim()) {
      ingestedPlan = {
        ...ingestedPlan,
        geoAnchor: {
          ...ingestedPlan.geoAnchor,
          name: loc.trim(),
          needsClarification: false,
        },
      };
      store.setPlan(ingestedPlan);
    }
  }

  store.setPhase('list_build');
  applyMasterTimeline(ingestedPlan);

  // Schritt 1: alle Unklarheiten (Ort fehlt) VOR Confirm klären
  const unclear = [
    ...ingestedPlan.fixedNodes.filter(
      (n) => n.needsClarification || (!n.location && n.time),
    ),
  ];
  for (const n of unclear.slice(0, 4)) {
    speak(
      sanitizePlanSpeech(
        `Kurz: „${n.title}“${n.time ? ` um ${n.time}` : ''} — wo genau?`,
      ),
    );
    const loc = await waitForUserLocationInput();
    if (loc.trim()) {
      n.location = loc.trim();
      n.needsClarification = false;
      ingestedPlan = {
        ...ingestedPlan,
        fixedNodes: [...ingestedPlan.fixedNodes],
        tasks: derivePlanTasks(ingestedPlan),
      };
      store.setPlan(ingestedPlan);
      applyMasterTimeline(ingestedPlan);
    }
  }

  // Prefetch erste konkrete Auswahl (kein Explore)
  const queue0 = selectionQueue(ingestedPlan).filter((w) => !isExploreWish(w));
  triggerAsyncDeepResearch(queue0[0]);

  speakBridge(ingestedPlan);

  if (planNeedsVoiceConfirm(ingestedPlan)) {
    for (let confirmRound = 0; confirmRound < 5; confirmRound++) {
      const confirmed = await waitForUserConfirmation(
        ingestedPlan.initialVoiceConfirm,
      );
      if (confirmed) break;

      const amendment =
        usePlanSessionStore.getState().takePendingAmendment() || '';
      if (!amendment.trim()) {
        speak('Sag kurz was ändern — oder tipp Bestätigen.');
        continue;
      }
      speak('Alles klar, rechne den Tag neu.');
      const patched = await runPlanningIngestion(amendment, {
        dayKeyHint: ingestedPlan.targetDate,
      });
      patched.targetDate = ingestedPlan.targetDate;
      ingestedPlan = mergePlans(ingestedPlan, patched);
      store.setPlan(ingestedPlan);
      store.setTaskQueue(ingestedPlan.tasks);
      openPlanCalendarModal(ingestedPlan.targetDate);
      applyMasterTimeline(ingestedPlan);
      try {
        const { repackExploreStopsOnDay } = await import('./planPlacesResearch');
        repackExploreStopsOnDay(ingestedPlan.targetDate);
      } catch {
        /* soft */
      }
      speakBridge(ingestedPlan);
    }
  } else {
    // Nur Soft/Explore: direkt weiter, kein „Passt der Plan?“
    speak(
      sanitizePlanSpeech(
        'Alles klar — ich bau die Route und die offenen Punkte.',
      ),
    );
  }

  // Auswahl-Schleife: konkrete Wünsche chronologisch; Explore separat am Ende
  store.setPhase('step_loop');
  const concreteQueue = selectionQueue(
    usePlanSessionStore.getState().plan ?? ingestedPlan,
  ).filter((w) => !isExploreWish(w));
  const exploreQueue = selectionQueue(
    usePlanSessionStore.getState().plan ?? ingestedPlan,
  ).filter((w) => isExploreWish(w));
  let currentTaskIndex = 0;

  while (currentTaskIndex < concreteQueue.length) {
    if (usePlanSessionStore.getState().phase === 'idle') break;

    const override = getActiveTaskOverride();
    const activeTask = override || concreteQueue[currentTaskIndex]!;

    const nextWish = concreteQueue[currentTaskIndex + 1];
    if (nextWish) triggerAsyncDeepResearch(nextWish);

    store.setPhase('select_mode');
    const pitch = await executeDeepResearchAndPitch(activeTask);
    speak(
      pitch.spokenText ||
        `Als Nächstes: ${activeTask.title}. Zwei Optionen — was ist dein Favorit?`,
    );
    await waitForPickOrAdvance();
    store.setPhase('step_loop');

    if (!usePlanCalendarUiStore.getState().pendingChoice) {
      await injectNavigationNode(activeTask);
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
    }

    const midAmend = usePlanSessionStore.getState().takePendingAmendment();
    if (midAmend?.trim()) {
      try {
        const extra = await runPlanningIngestion(midAmend, {
          dayKeyHint: ingestedPlan.targetDate,
        });
        extra.targetDate = ingestedPlan.targetDate;
        for (const w of extra.openWishesQueue) {
          if (
            !concreteQueue.some(
              (q) => q.title.toLowerCase() === w.title.toLowerCase(),
            ) &&
            !exploreQueue.some(
              (q) => q.title.toLowerCase() === w.title.toLowerCase(),
            )
          ) {
            if (isExploreWish(w) || w.priority === 6) exploreQueue.push(w);
            else concreteQueue.splice(currentTaskIndex + 1, 0, w);
            insertOpenBands([w], ingestedPlan.targetDate);
          }
        }
        for (const n of extra.fixedNodes) {
          insertTimeline([n], ingestedPlan.targetDate);
        }
        try {
          const { repackExploreStopsOnDay } = await import(
            './planPlacesResearch'
          );
          repackExploreStopsOnDay(ingestedPlan.targetDate);
        } catch {
          /* soft */
        }
        speak('Hab den neuen Wunsch mit aufgenommen.');
      } catch {
        /* soft */
      }
    }

    if (!getActiveTaskOverride()) {
      currentTaskIndex += 1;
    } else {
      usePlanSessionStore.getState().clearOverride();
      const idx = concreteQueue.findIndex(
        (w) => w.id === activeTask.id || w.title === activeTask.title,
      );
      if (idx >= 0) currentTaskIndex = idx + 1;
    }
  }

  // Noch offene Wish-Stops auf der Timeline? Nur Zukunft — keine Vergangenheit
  const leftoverWishes = useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind === 'wish' &&
        s.status !== 'done' &&
        (s.plannedStartMs == null || !isPastMs(s.plannedStartMs, Date.now())) &&
        !isExploreWish({
          title: s.title,
          priority: 6,
          context: s.notes ?? s.title,
        }),
    );
  for (const s of leftoverWishes) {
    const wish: IngestOpenWish = {
      id: s.id,
      title: s.title,
      priority: (s.planPriority === 4 || s.planPriority === 5 || s.planPriority === 6
        ? s.planPriority
        : 5) as 4 | 5 | 6,
      context: s.notes ?? s.title,
      estimatedTime:
        s.plannedStartMs != null
          ? `${String(new Date(s.plannedStartMs).getHours()).padStart(2, '0')}:${String(new Date(s.plannedStartMs).getMinutes()).padStart(2, '0')}`
          : null,
      completeness: 2,
    };
    store.setPhase('select_mode');
    const pitch = await executeDeepResearchAndPitch(wish);
    speak(
      pitch.spokenText ||
        `Noch offen: ${wish.title}. Was ist dein Favorit?`,
    );
    await waitForPickOrAdvance();
  }

  // Explore zuletzt: volle Highlight-Route, kein Pitch/Auswahl
  let exploreDidInsert = false;
  for (const explore of exploreQueue) {
    const { executeExploreWishInsert } = await import('./planPlacesResearch');
    const freeHoursHint =
      parseWishFreeHours(explore) ??
      (() => {
        const m = explore.estimatedTime?.match(/^(\d{1,2}):/);
        const startH = m ? Number(m[1]) : 10;
        return Math.max(2, Math.min(6, 17 - startH));
      })();
    const result = await executeExploreWishInsert(explore, {
      dayKey: ingestedPlan.targetDate,
      fixedCount: ingestedPlan.fixedNodes.length,
      freeHoursHint,
    });
    if (result.inserted > 0) exploreDidInsert = true;
    speak(result.spokenText);
    usePlanCalendarUiStore.getState().setShortAnswers([
      { id: 'explore_reject', label: 'Neu suchen', action: 'plan_reject' },
      { id: 'explore_ok', label: 'Bestätigen', action: 'plan_confirm' },
    ]);
    const ok = await usePlanSessionStore.getState().beginWaitConfirm();
    if (!ok) {
      const again = await executeExploreWishInsert(explore, {
        dayKey: ingestedPlan.targetDate,
        fixedCount: ingestedPlan.fixedNodes.length,
        freeHoursHint,
      });
      if (again.inserted > 0) exploreDidInsert = true;
      speak(again.spokenText);
      usePlanCalendarUiStore.getState().setShortAnswers([
        { id: 'explore_ok2', label: 'Bestätigen', action: 'plan_confirm' },
      ]);
      await usePlanSessionStore.getState().beginWaitConfirm();
    }
  }

  // Nach Explore: Restaurant-Auswahl (~17 Uhr), wenn noch kein Gastro im Plan
  // Kurze lokale Spaziergänge (≤3 h) nicht mit Auto-Dinner überfrachten
  const exploreWasShort = exploreQueue.some((w) => {
    const h = parseWishFreeHours(w);
    return h != null && h <= 3;
  });
  if (exploreDidInsert && !exploreWasShort && !planAlreadyHasGastro(ingestedPlan)) {
    const dinnerWish: IngestOpenWish = {
      id: `auto_dinner_${ingestedPlan.targetDate}`,
      title: 'Abendessen',
      priority: 5,
      context: 'Restaurant Abendessen nach dem Erkunden',
      estimatedTime: '17:00',
      completeness: 2,
    };
    store.setPhase('select_mode');
    speak(
      sanitizePlanSpeech(
        'Als Nächstes Essen — zwei Optionen fürs Abendessen. Was ist dein Favorit?',
      ),
    );
    const pitch = await executeDeepResearchAndPitch(dinnerWish);
    speak(
      pitch.spokenText ||
        'Zwei Restaurants fürs Abendessen — tipp deinen Favoriten.',
    );
    await waitForPickOrAdvance();
    store.setPhase('step_loop');
  }

  // Final erst wenn keine offenen Wünsche mehr
  const stillOpen = useFuturePlanStore
    .getState()
    .plan.stops.some((s) => s.kind === 'wish' && s.status !== 'done');
  if (stillOpen) {
    speak('Es sind noch offene Punkte auf der Timeline — tipp einen an.');
    store.setPhase('step_loop');
    return;
  }

  store.setPhase('final');
  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  await runFinalTimelineOptimization();
  store.setActive(false);
  store.setPhase('idle');
}
