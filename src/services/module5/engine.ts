/**
 * Modul 5 — Engine: Ingest aus Modul 2, Nav, Wetter; Follow-ups.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import type { DecomposedTurn } from '../module2/types';
import type { DayPlanItem } from '../../types/dayPlan';
import { formatPaceForPrompt } from './paceProfile';
import { researchRealisticTiming } from './researchTiming';
import {
  clockLabel,
  dateKeyFromMs,
  todayDateKey,
  uid,
} from '../../types/dayPlan';
import {
  buildReverseScheduleFromDeadlineAsync,
  buildStayBlock,
} from './reverseScheduler';
import { defaultStayMinutes } from './bufferMath';
import { getRainWindowsForPlanning } from '../logistics/weatherTracker';
import { syncRainIntoDayPlan, fillLogisticsGaps } from './smartLogistics';
import { ingestParkedCarFromText, syncParkedCarIntoDayPlan } from './parkedCar';
import {
  applyNavArriveActual,
  applyNavStartActual,
  applyPlaceLeftActual,
} from './planVsActual';
import {
  applyUserPlanOverrides,
  markAsFindusSuggestion,
  markAsUserRequested,
} from './userBossPlan';
import {
  unlockWeatherPlanForUserRevert,
  canAutoRevertWeatherPlan,
  lockWeatherRainSwap,
  rainWindowsFingerprint,
  getWeatherPlanLockSync,
} from './weatherPlanHysteresis';
import {
  saveWeatherPlanSnapshot,
  restoreWeatherPlanSnapshot,
  wantsPlanSnapshotRestore,
} from './planSnapshot';
import { stampTransitHardMeta } from './transitHardMeta';
import {
  canModule5Speak,
  scheduleModule5FollowUp,
} from './module5Priority';
import { getVoiceSettingsForTour, speakAssistantText } from '../ttsService';
const TRAIN_RE =
  /\b(ice|ic\b|intercity|zug|bahn|re\s?\d|rb\s?\d|s-bahn)\b/iu;
const CLOCK_RE =
  /\b(?:um\s+)?(\d{1,2})[:.](\d{2})\s*(?:uhr)?\b/iu;

function parseClockOnDate(text: string, dateKey: string): number | null {
  const m = text.match(CLOCK_RE);
  if (!m) return null;
  const [y, mo, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, (mo ?? 1) - 1, d ?? 1, Number(m[1]), Number(m[2]), 0, 0);
  return dt.getTime();
}

function ensureHotelAnchor(dateKey: string): void {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (!hotel) return;
  const day = useDayPlanStore.getState().ensureDay(dateKey);
  if (day.items.some((i) => i.kind === 'hotel')) return;
  useDayPlanStore.getState().upsertItem(dateKey, {
    id: uid('hotel'),
    kind: 'hotel',
    title: hotel.name,
    startMs: null,
    endMs: null,
    timed: false,
    status: 'planned',
    lat: hotel.lat ?? null,
    lng: hotel.lng ?? null,
    placeName: hotel.name,
    source: 'hotel',
    sortOrder: 1,
    notes: 'Unterkunft (Anker)',
  });
  // Frühstück-Fenster Default 7–11 wenn noch keins — Zeiten parallel recherchieren
  if (!day.items.some((i) => i.kind === 'breakfast')) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const start = new Date(y!, (mo ?? 1) - 1, d ?? 1, 7, 0, 0, 0).getTime();
    const end = new Date(y!, (mo ?? 1) - 1, d ?? 1, 11, 0, 0, 0).getTime();
    useDayPlanStore.getState().upsertItem(dateKey, {
      id: uid('bfwin'),
      kind: 'breakfast',
      title: 'Frühstück 07:00–11:00 (Hotel)',
      startMs: start,
      endMs: end,
      timed: true,
      status: 'planned',
      placeName: hotel.name,
      source: 'hotel',
      sortOrder: 2,
      notes: 'Standardfenster — Recherche läuft…',
    });
    void researchRealisticTiming({
      subject: hotel.name,
      kind: 'breakfast_hours',
    }).then((r) => {
      if (!r.minutes) return;
      useDayPlanStore.getState().addChange(dateKey, {
        summary: `Frühstück/Zeiten recherchiert für ${hotel.name}`,
        reason: r.promptBlock.slice(0, 220),
        significant: false,
      });
    });
    void researchRealisticTiming({
      subject: hotel.name,
      kind: 'checkout',
    }).then((r) => {
      if (r.minutes == null) return;
      // Merker für spätere Rückwärtsrechnung
      useDayPlanStore.getState().upsertItem(dateKey, {
        id: uid('cout'),
        kind: 'checkout',
        title: `Checkout-Puffer ~${r.minutes} Min (recherchiert)`,
        startMs: null,
        endMs: null,
        timed: false,
        status: 'planned',
        placeName: hotel.name,
        bufferMin: r.minutes,
        source: 'hotel',
        sortOrder: 3,
        notes: r.sourceNotes[0]?.slice(0, 120),
      });
    });
  }
}

/**
 * Modul-2 Fakten/Text → Tagesplan.
 */
export function ingestModule2IntoDayPlan(opts: {
  userText: string;
  decomposed?: DecomposedTurn | null;
  dateKey?: string;
}): { changed: boolean; summary: string | null } {
  const dateKey = opts.dateKey ?? todayDateKey();
  ensureHotelAnchor(dateKey);
  const store = useDayPlanStore.getState();
  let changed = false;
  const bits: string[] = [];

  const text = opts.userText;
  const facts = opts.decomposed?.facts ?? [];

  // Wetter-Hysterese / Snapshot-Restore
  if (wantsPlanSnapshotRestore(text)) {
    unlockWeatherPlanForUserRevert(text);
    if (restoreWeatherPlanSnapshot({ userText: text, dateKey })) {
      changed = true;
      bits.push('Plan wiederhergestellt');
    }
  } else {
    unlockWeatherPlanForUserRevert(text);
  }

  // User ist Boss — Ablehnungen sofort, vor neuem Ingest
  const override = applyUserPlanOverrides({ userText: text, dateKey });
  if (override.removed.length || override.summary) {
    changed = true;
    if (override.summary) bits.push(override.summary);
  }

  // Harte Deadline: ICE / Zug + Uhrzeit — async Live-ÖPNV im Hintergrund
  const deadlineFromFact = facts.find(
    (f) =>
      /zug|ice|bahn|abfahrt|flug/i.test(f.key) ||
      TRAIN_RE.test(f.value) ||
      CLOCK_RE.test(f.value),
  );
  let deadlineMs =
    parseClockOnDate(text, dateKey) ??
    (deadlineFromFact ? parseClockOnDate(deadlineFromFact.value, dateKey) : null);

  if (deadlineMs && (TRAIN_RE.test(text) || /flug|ice|zug/i.test(text))) {
    const titleMatch =
      text.match(/\b(ICE|IC|RE|RB)\s*\d*/i)?.[0] ??
      (/\bflug\b/i.test(text) ? 'Flug' : 'Zug');
    const title = `${titleMatch} ${clockLabel(deadlineMs)}`;
    const day = store.getDay(dateKey);
    const already = day.items.some(
      (i) =>
        i.hardDeadline &&
        i.startMs != null &&
        Math.abs(i.startMs - deadlineMs!) < 60_000,
    );
    if (!already) {
      changed = true;
      bits.push(`Plane ${title} (Live-Fahrplan folgt)…`);
      void (async () => {
        const rev = await buildReverseScheduleFromDeadlineAsync({
          dateKey,
          deadlineMs: deadlineMs!,
          deadlineTitle: title,
          importance: /flug/i.test(text) ? 'flight' : 'train_hbf',
          preferMode: 'auto',
          destName: /hbf|hauptbahnhof/i.test(text)
            ? 'Hauptbahnhof'
            : 'Bahnhof',
        });
        const cur = useDayPlanStore.getState().getDay(dateKey);
        const kept = cur.items.filter(
          (i) =>
            !(i.kind === 'breakfast' && i.source === 'hotel') &&
            !(i.source === 'module5' && i.kind !== 'hotel') &&
            !i.hardDeadline,
        );
        useDayPlanStore.getState().replaceItems(dateKey, [
          ...kept,
          ...rev.items.map((it) =>
            it.hardDeadline ? markAsUserRequested(it) : it,
          ),
        ]);
        void import('./leaveByTransitPoll').then((m) => {
          m.refreshTransitWatchesFromDayPlan(dateKey);
        });
        useDayPlanStore.getState().addChange(dateKey, {
          summary: `Tagesplan live aus ${title}`,
          reason: rev.speechSummary,
          significant: true,
        });
        scheduleModule5FollowUp({
          speech: `Alles eingetragen: ${rev.speechSummary} Soll ich den Wecker auf ${clockLabel(rev.wakeMs)} stellen?`,
          actions: [
            {
              type: 'SET_WAKE_ALARM',
              label: `Wecker ${clockLabel(rev.wakeMs)}`,
              payload: {
                dateIso: rev.wakeMs
                  ? new Date(rev.wakeMs).toISOString()
                  : undefined,
                timeLabel: clockLabel(rev.wakeMs),
              },
            },
            {
              type: 'SHOW_MORE',
              label: 'Plan öffnen',
              payload: { textPrompt: 'Zeig mir den Tagesplan' },
            },
          ],
        });
      })();
    }
  }

  // Live-Flug (FlightAware) → Reverse-Plan im Hintergrund
  if (/\b(flug|flieger|abflug|lh\s?\d|ew\s?\d|flight)\b/iu.test(text)) {
    void import('./liveFlightPlan')
      .then(({ syncLiveFlightIntoDayPlan }) =>
        syncLiveFlightIntoDayPlan({ userText: text, dateKey }),
      )
      .then((r) => {
        if (r.ok && r.summary) {
          useDayPlanStore.getState().addChange(dateKey, {
            summary: r.summary,
            reason: 'flightaware_live',
            significant: true,
          });
          fillLogisticsGaps(dateKey);
        }
      })
      .catch(() => undefined);
    bits.push('Flug live wird geprüft…');
    changed = true;
  }

  // Auto geparkt?
  {
    const gps = useFinnusStore.getState();
    const coords =
      gps.lastGpsLat != null && gps.lastGpsLng != null
        ? { lat: gps.lastGpsLat, lng: gps.lastGpsLng }
        : null;
    if (ingestParkedCarFromText(text, coords)) {
      bits.push('Auto-Parken eingetragen');
      changed = true;
    }
  }

  fillLogisticsGaps(dateKey);
  if (
    /\b(gutschein|supermarkt|einkaufen|todo|muss\s+noch|unbedingt)\b/iu.test(
      text,
    )
  ) {
    const label =
      text.match(/\b(gutschein[^.]{0,40}|supermarkt|einkaufen)\b/iu)?.[0] ??
      'Offener Punkt';
    const day = store.getDay(dateKey);
    if (!day.items.some((i) => i.title.toLowerCase().includes(label.toLowerCase()))) {
      store.upsertItem(dateKey, {
        id: uid('todo'),
        kind: 'todo',
        title: label.charAt(0).toUpperCase() + label.slice(1),
        startMs: null,
        endMs: null,
        timed: false,
        status: 'planned',
        source: 'module2',
        carryOver: true,
        sortOrder: 900,
        meta: { userRequested: true, findusSuggestion: false },
      });
      bits.push(`Punkt „${label}" eingetragen`);
      changed = true;
    }
  }

  // Abendessen / Restaurant ohne harte Zeit → untimed oder Abend-Slot
  if (/\b(abendessen|essen\s+gehen|restaurant|burger)\b/iu.test(text)) {
    const name =
      text.match(
        /\b(?:im|in(?:s)?|zum)\s+([A-ZÄÖÜ][\wÄÖÜäöüß'&\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß'&\-]+){0,3})/u,
      )?.[1] ?? 'Abendessen';
    const day = store.getDay(dateKey);
    if (!day.items.some((i) => /abendessen|restaurant|burger/i.test(i.title))) {
      const mealId = uid('meal');
      store.upsertItem(dateKey, {
        id: mealId,
        kind: 'meal',
        title: name,
        startMs: null,
        endMs: null,
        timed: false,
        status: 'planned',
        placeName: name,
        durationMin: defaultStayMinutes('meal', name),
        source: 'module2',
        sortOrder: 500,
        notes: 'Verweildauer wird aus Google/Recherche + deinem Tempo gelernt…',
        meta: { userRequested: true, findusSuggestion: false },
      });
      bits.push(`Essen „${name}" vorgemerkt`);
      changed = true;
      void import('./dwellLearning')
        .then(({ resolveStayMinutesForPlace }) =>
          resolveStayMinutesForPlace({ name, kindHint: 'restaurant' }),
        )
        .then((r) => {
          useDayPlanStore.getState().upsertItem(dateKey, {
            id: mealId,
            kind: 'meal',
            title: name,
            startMs: null,
            endMs: null,
            timed: false,
            status: 'planned',
            placeName: name,
            durationMin: r.planMin,
            source: 'module2',
            sortOrder: 500,
            notes: r.notes.join(' · '),
            meta: { dwellRange: r.range, personalFactor: r.personalFactor },
          });
        })
        .catch(() => undefined);
      scheduleModule5FollowUp({
        speech: `„${name}" steht im Plan. Soll ich später einen Tisch reservieren, sobald die Uhrzeit feststeht?`,
        actions: [
          {
            type: 'SHOW_MORE',
            label: 'Tisch reservieren',
            payload: {
              textPrompt: `Reserviere einen Tisch bei ${name} für heute Abend`,
            },
          },
          {
            type: 'SHOW_MORE',
            label: 'Später',
            payload: { textPrompt: 'Reservierung später' },
          },
        ],
      });
    }
  }

  // Shopping tasks sync as untimed dots
  try {
    const tasks = useShoppingTaskStore.getState().getOpenTasks();
    for (const t of tasks.slice(0, 8)) {
      const day = store.getDay(dateKey);
      if (day.items.some((i) => i.meta?.taskId === t.id)) continue;
      store.upsertItem(dateKey, {
        id: uid('shop'),
        kind: 'todo',
        title: t.itemLabel,
        startMs: t.dueAtMs,
        endMs: null,
        timed: t.dueAtMs != null,
        status: 'planned',
        source: 'module2',
        carryOver: true,
        sortOrder: 850,
        meta: { taskId: t.id },
      });
      changed = true;
    }
  } catch {
    /* soft */
  }

  if (changed) {
    store.ensureDay(dateKey);
    try {
      const { applyDedupeToDay } = require('./dayPlanDedupe') as {
        applyDedupeToDay: (
          dk: string,
          replace: (dk: string, items: import('../../types/dayPlan').DayPlanItem[]) => void,
          get: () => import('../../types/dayPlan').DayPlanItem[],
        ) => { removed: number };
      };
      applyDedupeToDay(
        dateKey,
        (dk, items) => store.replaceItems(dk, items),
        () => store.getDay(dateKey).items,
      );
    } catch {
      /* soft */
    }
  }
  return {
    changed,
    summary: bits.length ? bits.join(' · ') : null,
  };
}

/** Navigation gestartet → Plan-Eintrag + Stay-Dauer. */
export function noteNavigationStarted(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  etaMin?: number | null;
}): void {
  const dateKey = todayDateKey();
  // Vorherigen Ort verlassen → Dwell lernen
  try {
    const day = useDayPlanStore.getState().getDay(dateKey);
    const openStay = day.items.find(
      (i) =>
        (i.kind === 'activity' || i.kind === 'meal') &&
        i.status === 'in_progress' &&
        i.actualStartMs != null,
    );
    if (openStay?.placeName) {
      notePlaceLeft({ name: openStay.placeName });
    }
  } catch {
    /* soft */
  }
  ensureHotelAnchor(dateKey);
  const now = Date.now();
  const arriveMs =
    opts.etaMin != null ? now + opts.etaMin * 60_000 : now + 20 * 60_000;
  const stay = defaultStayMinutes('activity', opts.name);
  const store = useDayPlanStore.getState();

  store.upsertItem(dateKey, {
    id: uid('nav'),
    kind: 'nav',
    title: `Unterwegs → ${opts.name}`,
    startMs: now,
    endMs: arriveMs,
    timed: true,
    status: 'in_progress',
    lat: opts.lat,
    lng: opts.lng,
    placeName: opts.name,
    source: 'nav',
    actualStartMs: now,
    sortOrder: 300,
  });

  store.upsertItem(dateKey, buildStayBlock({
    title: opts.name,
    startMs: arriveMs,
    kind: 'activity',
    lat: opts.lat,
    lng: opts.lng,
    placeName: opts.name,
    durationMin: stay,
    source: 'nav',
  }));

  store.addChange(dateKey, {
    summary: `Navigation zu ${opts.name} · Ankunft ~${clockLabel(arriveMs)} · Aufenthalt ~${stay} Min`,
    reason: 'nav_start',
    significant: false,
  });

  applyNavStartActual({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    atMs: now,
    dateKey,
  });
}

export function noteNavigationArrived(opts: {
  name: string;
}): void {
  const dateKey = todayDateKey();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const nav = day.items.find(
    (i) =>
      i.kind === 'nav' &&
      i.status === 'in_progress' &&
      (i.placeName === opts.name || i.title.includes(opts.name)),
  );
  if (nav) {
    store.markItemActual(dateKey, nav.id, {
      status: 'done',
      actualEndMs: Date.now(),
    });
  }
  const stay = day.items.find(
    (i) =>
      (i.kind === 'activity' || i.kind === 'meal') &&
      i.placeName === opts.name &&
      i.status === 'planned',
  );
  if (stay) {
    store.markItemActual(dateKey, stay.id, {
      status: 'in_progress',
      actualStartMs: Date.now(),
    });
  }
  applyNavArriveActual({
    name: opts.name,
    dateKey,
  });
}

/** Ort verlassen → echte Verweildauer lernen. */
export function notePlaceLeft(opts: { name: string }): void {
  const dateKey = todayDateKey();
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  const stay = day.items.find(
    (i) =>
      (i.kind === 'activity' || i.kind === 'meal') &&
      (i.placeName === opts.name || i.title.includes(opts.name)) &&
      i.status === 'in_progress' &&
      i.actualStartMs != null,
  );
  if (!stay?.actualStartMs) return;
  const actualMin = Math.round((Date.now() - stay.actualStartMs) / 60_000);
  store.markItemActual(dateKey, stay.id, {
    status: 'done',
    actualEndMs: Date.now(),
  });
  applyPlaceLeftActual({ name: opts.name });
  void import('./dwellLearning').then(({ recordActualDwell }) => {
    const range = (stay.meta as { dwellRange?: { minMin: number; maxMin: number; source: 'google' | 'research' | 'default' } } | undefined)
      ?.dwellRange;
    recordActualDwell({
      name: opts.name,
      actualMin,
      expectedRange: range ?? null,
    });
  });
}

/**
 * Wetter: Regen in Timeline + Outdoor tauschen — mit Hysterese (kein Flapping).
 */
export function replanForRainWindows(opts?: { userText?: string; forceRevert?: boolean }): void {
  if (opts?.userText && wantsPlanSnapshotRestore(opts.userText)) {
    unlockWeatherPlanForUserRevert(opts.userText);
    if (restoreWeatherPlanSnapshot({ userText: opts.userText })) {
      return;
    }
  } else if (opts?.userText) {
    unlockWeatherPlanForUserRevert(opts.userText);
  }

  syncRainIntoDayPlan();
  fillLogisticsGaps();

  const dateKey = todayDateKey();
  const windows = getRainWindowsForPlanning();
  const fp = rainWindowsFingerprint(windows);

  // Regen weg: nicht automatisch zurücktauschen (Hysterese)
  if (!windows.length) {
    if (!opts?.forceRevert && !canAutoRevertWeatherPlan('')) {
      return;
    }
    return;
  }

  // Gleicher Regen-Fingerprint schon angewandt → kein erneutes Flapping
  const existingLock = getWeatherPlanLockSync();
  if (
    existingLock?.rainSwapApplied &&
    existingLock.rainFingerprint === fp &&
    !opts?.forceRevert
  ) {
    return;
  }

  // Snapshot VOR dem ersten Swap
  saveWeatherPlanSnapshot({ dateKey, reason: 'pre_weather_swap' });

  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  let changed = false;
  const items = [...day.items];

  for (const win of windows) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (!it.timed || it.startMs == null || it.endMs == null) continue;
      if (!/picknick|strand|outdoor|sonnenuntergang|park|radtour/i.test(it.title + (it.kind ?? ''))) {
        continue;
      }
      const overlaps = it.startMs < win.endMs && it.endMs > win.startMs;
      if (!overlaps) continue;

      const indoor = items.find(
        (x) =>
          x !== it &&
          /museum|café|cafe|indoor|galerie/i.test(x.title) &&
          x.startMs != null,
      );
      if (indoor && indoor.startMs != null && indoor.endMs != null) {
        if (it.status === 'moved' && indoor.status === 'moved') {
          // schon getauscht — nicht erneut
          continue;
        }
        const aStart = it.startMs;
        const aEnd = it.endMs;
        items[i] = {
          ...it,
          startMs: indoor.startMs,
          endMs: indoor.endMs,
          status: 'moved',
          meta: { ...(it.meta ?? {}), weatherSwap: true },
        };
        const j = items.indexOf(indoor);
        items[j] = {
          ...indoor,
          startMs: aStart,
          endMs: aEnd,
          status: 'moved',
          meta: { ...(indoor.meta ?? {}), weatherSwap: true },
        };
        changed = true;
        store.addChange(dateKey, {
          summary: `Wegen Regen ${clockLabel(win.startMs)}–${clockLabel(win.endMs)}: „${it.title}" und „${indoor.title}" getauscht`,
          reason: 'weather_rain_swap',
          significant: true,
        });
      } else {
        items[i] = {
          ...it,
          notes:
            (it.notes ? `${it.notes} · ` : '') +
            `Regen ${clockLabel(win.startMs)}–${clockLabel(win.endMs)} — Indoor-Alternative suchen`,
          status: 'moved',
        };
        changed = true;
        store.addChange(dateKey, {
          summary: `Picknick/Outdoor kollidiert mit Regen — Alternative vorschlagen`,
          reason: 'weather_rain_conflict',
          significant: true,
        });
      }
    }
  }

  if (changed) {
    store.replaceItems(dateKey, items);
    lockWeatherRainSwap(fp);
  }
}

export async function speakPlanChangeExplanation(dateKey?: string): Promise<void> {
  const key = dateKey ?? todayDateKey();
  const store = useDayPlanStore.getState();
  const day = store.getDay(key);
  const unread = day.changes.filter((c) =>
    day.unreadSignificantChangeIds.includes(c.id),
  );
  if (!unread.length) return;
  const gate = canModule5Speak();
  if (!gate.ok) return;

  const lines = unread
    .slice(0, 3)
    .map((c) => `${c.summary}. ${c.reason}`)
    .join(' ');
  const speech = `Kurz zu deinem Plan: ${lines}`;
  store.clearUnreadChanges(key);
  for (const c of unread) store.markChangeSpoken(key, c.id);

  const voice = await getVoiceSettingsForTour();
  useFinnusStore.getState().addChatMessage({
    role: 'assistant',
    content: speech,
  });
  await speakAssistantText(speech, {
    voiceId: voice.voiceId,
    speechRate: voice.speechRate,
  });
}

export function formatDayPlanForPrompt(dateKey?: string): string {
  const key = dateKey ?? todayDateKey();
  const day = useDayPlanStore.getState().getDay(key);
  const lines = day.items.map((i) => {
    if (!i.timed || i.startMs == null) {
      return `• [Punkt] ${i.title}${i.status !== 'planned' ? ` (${i.status})` : ''}`;
    }
    return `• ${clockLabel(i.startMs)}${
      i.endMs ? `–${clockLabel(i.endMs)}` : ''
    } ${i.title}${i.hardDeadline ? ' [DEADLINE]' : ''}`;
  });
  let pace = '';
  try {
    pace = formatPaceForPrompt();
  } catch {
    pace = '';
  }
  return [
    `=== MODUL 5 TAGESPLAN ${key} ===`,
    day.goalSummary ? `Ziel: ${day.goalSummary}` : null,
    pace || null,
    ...lines,
    'Regel: Harte Deadlines rückwärts planen; Regen → Indoor tauschen; To-dos ohne Uhr = Punkte.',
    'USER IST BOSS: Wünsche sofort umsetzen; Findus-Vorschläge bei Ablehnung ohne Rückfrage löschen.',
    'Alles Planungsrelevante aus Modul 2 landet in Modul 5.',
    'Logistik selbst mitdenken: Checkout/Check-in, Frühstück, Packen, Wartezeiten, Zwischenstopps.',
    'Live: Wetter (Regenfenster), Flug (FlightAware), ÖPNV (DB) — User darf nichts verpassen.',
    'Auto geparkt: Kosten/h, Ticket-Ende, Mindestdauer einrechnen; rechtzeitig zurückplanen.',
    'Unbekannte Zeiten/Puffer → realistisch recherchieren, nicht raten.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Soft multi-stop tour → Tagesplan-Punkte (noch ohne harte Uhrzeiten). */
export function importTourStopsIntoDayPlan(opts: {
  title: string;
  stops: Array<{
    name: string;
    lat: number;
    lng: number;
    poiId?: number;
  }>;
  dateKey?: string;
}): void {
  const dateKey = opts.dateKey ?? todayDateKey();
  ensureHotelAnchor(dateKey);
  const store = useDayPlanStore.getState();
  const day = store.getDay(dateKey);
  let order = 200;
  for (const s of opts.stops) {
    if (
      day.items.some(
        (i) =>
          i.placeName?.toLowerCase() === s.name.toLowerCase() ||
          i.title.toLowerCase() === s.name.toLowerCase(),
      )
    ) {
      continue;
    }
    store.upsertItem(
      dateKey,
      markAsFindusSuggestion({
        id: uid('tour'),
        kind: 'activity',
        title: s.name,
        startMs: null,
        endMs: null,
        timed: false,
        status: 'planned',
        lat: s.lat,
        lng: s.lng,
        placeName: s.name,
        durationMin: defaultStayMinutes('activity', s.name),
        source: 'module5',
        sortOrder: order++,
        meta: { poiId: s.poiId, tour: opts.title, wish: true },
      }),
    );
  }
  store.addChange(dateKey, {
    summary: `Tour „${opts.title}" → ${opts.stops.length} Stopps im Plan`,
    reason: 'day_plan_mode',
    significant: false,
  });
  const plans = useDayPlanStore.getState().plansByDate;
  const next = {
    ...plans,
    [dateKey]: {
      ...plans[dateKey]!,
      goalSummary: opts.title,
      updatedAtMs: Date.now(),
    },
  };
  useDayPlanStore.setState({ plansByDate: next });
}

/** SessionPlan (Flugtag o.ä.) → harte Timeline-Einträge. */
export function importSessionPlanIntoDayPlan(opts: {
  leaveByMs: number | null;
  departureLabel?: string | null;
  airportName?: string | null;
  airportLat?: number | null;
  airportLng?: number | null;
  arriveByMs?: number | null;
  dateKey?: string;
}): void {
  if (opts.leaveByMs == null && opts.arriveByMs == null) return;
  const dateKey =
    opts.dateKey ??
    dateKeyFromMs(opts.arriveByMs ?? opts.leaveByMs ?? Date.now());
  ensureHotelAnchor(dateKey);
  const store = useDayPlanStore.getState();

  if (opts.leaveByMs != null) {
    store.upsertItem(dateKey, {
      id: uid('leave'),
      kind: 'nav',
      title: `Los zum ${opts.airportName ?? 'Flugplatz'}`,
      startMs: opts.leaveByMs,
      endMs: opts.arriveByMs ?? opts.leaveByMs + 30 * 60_000,
      timed: true,
      status: 'planned',
      lat: opts.airportLat,
      lng: opts.airportLng,
      placeName: opts.airportName,
      source: 'module5',
      hardDeadline: false,
      sortOrder: 100,
    });
  }
  if (opts.arriveByMs != null) {
    store.upsertItem(dateKey, {
      id: uid('air'),
      kind: 'transit',
      title: opts.departureLabel
        ? `Flug ${opts.departureLabel}`
        : opts.airportName ?? 'Flug',
      startMs: opts.arriveByMs,
      endMs: opts.arriveByMs + 5 * 60_000,
      timed: true,
      status: 'planned',
      lat: opts.airportLat,
      lng: opts.airportLng,
      placeName: opts.airportName,
      source: 'module2',
      hardDeadline: true,
      sortOrder: 110,
    });
  }
  store.addChange(dateKey, {
    summary: 'Flugtag aus Session-Plan übernommen',
    reason: 'session_plan_sync',
    significant: false,
  });
}

/** Bootstrap: heute + Carryover vom Vortag + Just-in-Time Live-Polls. */
export function bootstrapModule5Today(): void {
  const store = useDayPlanStore.getState();
  const today = todayDateKey();
  store.ensureDay(today);
  ensureHotelAnchor(today);
  const yest = dateKeyFromMs(Date.now() - 24 * 60 * 60_000);
  store.carryOverOpenTodos(yest, today);
  syncParkedCarIntoDayPlan(today);
  replanForRainWindows();
  fillLogisticsGaps(today);
  void import('./leaveByTransitPoll').then((m) => {
    m.startLeaveByTransitPolls();
  });
  void import('./adaptiveFlightPoll').then((m) => {
    void m.tickAdaptiveFlightPolls();
  });
}
