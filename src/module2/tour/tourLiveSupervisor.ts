/**
 * Live-Supervisor — ~5 Min Tick: Drift, hard/soft Replan, ÖPNV-Slip, Dwell-Lernen.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { noteObservedDwell } from './dwellEstimates';
import { takeRestPool } from './restPool';
import type { TourCandidate } from './types';
import { TOUR_BUFFER_MIN } from './exactValidate';

type SupervisorState = {
  timer: ReturnType<typeof setInterval> | null;
  requestId: string | null;
  restPool: TourCandidate[];
  denserStops: boolean;
  lastStopIndex: number;
  arrivedAtMs: number | null;
  softAskPending: boolean;
};

const state: SupervisorState = {
  timer: null,
  requestId: null,
  restPool: [],
  denserStops: false,
  lastStopIndex: -1,
  arrivedAtMs: null,
  softAskPending: false,
};

const TICK_MS = 5 * 60_000;
const DRIFT_TRIGGER_MIN = 8;

async function speak(text: string): Promise<void> {
  try {
    const { enqueueSpeech } = await import('../speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text,
      turnId: `tour_live_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}

function remainingEtaMin(): number {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour) return 0;
  const meta = tour.liveMeta;
  const left = tour.stops.slice(tour.currentIndex).filter((s) => !s.done);
  // grob: 8 Min Leg + dwell aus priority
  let min = 0;
  for (const s of left) {
    min += 8 + (s.priority === 'must' ? 12 : s.priority === 'high' ? 8 : 4);
  }
  if (meta?.plannedArriveByMs) {
    const until = Math.round((meta.plannedArriveByMs - Date.now()) / 60_000);
    return Math.max(min, until);
  }
  return min;
}

async function dropSoftStops(count: number): Promise<void> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return;
  const { removeTourStopAt } = await import(
    '../../services/navigation/multiStopTour'
  );
  let removed = 0;
  for (let i = tour.stops.length - 1; i > tour.currentIndex && removed < count; i--) {
    const s = tour.stops[i]!;
    if (s.done) continue;
    if (s.priority === 'must') continue;
    removeTourStopAt(i);
    removed += 1;
  }
}

async function insertFromRest(maxInsert: number): Promise<number> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || !state.restPool.length) return 0;
  const { insertTourStop } = await import(
    '../../services/navigation/multiStopTour'
  );
  let n = 0;
  while (n < maxInsert && state.restPool.length) {
    const c = state.restPool.shift()!;
    await insertTourStop(
      {
        poiId: c.poiId,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        done: false,
        priority: c.priority,
      },
      { position: 'end', startNow: false },
    );
    n += 1;
  }
  return n;
}

async function tick(): Promise<void> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.liveMeta) return;

  const meta = tour.liveMeta;
  const now = Date.now();

  // Dwell: Index gewechselt → beobachten
  if (tour.currentIndex !== state.lastStopIndex) {
    if (state.arrivedAtMs != null && state.lastStopIndex >= 0) {
      const prev = tour.stops[state.lastStopIndex];
      if (prev) {
        const dwellMin = Math.max(
          1,
          Math.round((now - state.arrivedAtMs) / 60_000),
        );
        noteObservedDwell({
          name: prev.name,
          category: '',
          dwellMin,
        });
      }
    }
    state.lastStopIndex = tour.currentIndex;
    state.arrivedAtMs = now;
  }

  const plannedEnd = meta.plannedArriveByMs ?? now + remainingEtaMin() * 60_000;
  const driftMin = Math.round((plannedEnd - (meta.hardArriveByMs ?? plannedEnd)) / 60_000);
  // Behind schedule if ETA finish > hard deadline or soft planned end + buffer
  const etaFinish = now + remainingEtaMin() * 60_000;
  const targetEnd =
    meta.hardArriveByMs ??
    meta.startedAtMs +
      (meta.softDurationMin ?? tour.targetDurationMin ?? 60) * 60_000;
  const behindMin = Math.round((etaFinish - targetEnd) / 60_000);
  const aheadMin = -behindMin;

  if (Math.abs(behindMin) < DRIFT_TRIGGER_MIN) {
    return; // im Puffer
  }

  if (behindMin >= DRIFT_TRIGGER_MIN) {
    if (meta.hardArriveByMs != null) {
      await dropSoftStops(2);
      const t2 = useFinnusStore.getState().multiStopTour;
      if (t2?.liveMeta) {
        useFinnusStore.getState().setMultiStopTour({
          ...t2,
          liveMeta: {
            ...t2.liveMeta,
            plannedArriveByMs: now + remainingEtaMin() * 60_000,
          },
        });
      }
      await speak(
        'Wir liegen hinter der Zeit — ich streiche ein paar Stopps, damit du pünktlich ankommst.',
      );
      return;
    }
    if (!state.softAskPending) {
      state.softAskPending = true;
      await speak(
        `Aktuell brauchen wir etwa ${behindMin} Minuten länger. Passt das, oder soll ich die Tour neu kürzen?`,
      );
    }
    return;
  }

  if (aheadMin >= DRIFT_TRIGGER_MIN && state.denserStops) {
    const inserted = await insertFromRest(2);
    if (inserted > 0) {
      await speak(
        `Wir sind etwas früher — ich hänge ${inserted === 1 ? 'noch einen Ort' : 'noch ein paar Orte'} an.`,
      );
    }
  }

  // ÖPNV: nächste Transit-Erinnerung knapp?
  try {
    const legsHint = meta.plannedArriveByMs;
    if (legsHint && behindMin > 0) {
      /* soft — Anschluss-Logik: bei Verzug Füller + späterer Bus bereits durch Drop abgedeckt */
    }
  } catch {
    /* soft */
  }

  void driftMin;
  void TOUR_BUFFER_MIN;
}

export function startTourLiveSupervisor(opts: {
  requestId: string;
  restPool: TourCandidate[];
  denserStops: boolean;
}): void {
  stopTourLiveSupervisor();
  const stashed = takeRestPool(opts.requestId);
  state.requestId = opts.requestId;
  state.restPool = opts.restPool.length
    ? opts.restPool
    : stashed?.rest ?? [];
  state.denserStops = opts.denserStops || stashed?.denserStops === true;
  state.lastStopIndex = useFinnusStore.getState().multiStopTour?.currentIndex ?? 0;
  state.arrivedAtMs = Date.now();
  state.softAskPending = false;
  state.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // erster Check nach kurzer Zeit
  setTimeout(() => void tick(), 30_000);
}

export function stopTourLiveSupervisor(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.requestId = null;
  state.restPool = [];
  state.softAskPending = false;
}

/** Soft-Antwort: weiter = Puffer anpassen; neu = Stops droppen */
export async function handleTourSoftReplanAnswer(
  text: string,
): Promise<boolean> {
  if (!state.softAskPending) return false;
  const t = text.toLowerCase();
  if (/\b(neu|kürzen|kuerzen|streichen|anpassen)\b/u.test(t)) {
    state.softAskPending = false;
    await dropSoftStops(3);
    await speak('Alles klar — ich habe die Tour gekürzt.');
    return true;
  }
  if (/\b(passt|weiter|ok|okay|länger|laenger|ja)\b/u.test(t)) {
    state.softAskPending = false;
    const tour = useFinnusStore.getState().multiStopTour;
    if (tour?.liveMeta) {
      useFinnusStore.getState().setMultiStopTour({
        ...tour,
        liveMeta: {
          ...tour.liveMeta,
          softDurationMin:
            (tour.liveMeta.softDurationMin ?? 60) + 30,
          plannedArriveByMs: Date.now() + remainingEtaMin() * 60_000,
        },
      });
    }
    await speak('Super — wir laufen das so weiter.');
    return true;
  }
  return false;
}
