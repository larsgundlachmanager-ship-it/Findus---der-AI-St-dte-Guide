/**
 * ÖPNV-Reise: Losgehen erst wenn's Zeit ist.
 * 30-Min- und 5-Min-Ansage kurz; Fuß-Nav startet am Leave-by.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import type { JourneyItinerary } from '../transit/journeyPlanner';
import { classifyTransitSlip } from '../transit/transitSlipPolicy';
import { stationArriveBufferMin } from '../transit/stationArriveBuffer';
import {
  assessLiveJourneyPace,
  assessTransferConnection,
  findUpcomingTransferBoard,
  liveWalkEtaMin,
  resolveAlightArriveMs,
  shiftTourStopTimesForDelay,
} from '../transit/liveJourneyAdapt';
import { getNavPhase } from './boardingDetector';

const START_NAV_SLACK_MIN = 8;

let watchTimer: ReturnType<typeof setInterval> | null = null;
let watchAlive = false;
let watchStartedAt = 0;
let lastWarn: '30' | '5' | 'go' | null = null;
let armedLeaveByMs: number | null = null;
let firstStop = { lat: 0, lng: 0 };
let lineLabel = '';
let depMsArmed: number | null = null;
let destArmed = { lat: 0, lng: 0, name: '' };
let originArmed = { lat: 0, lng: 0 };
let lastDelayPollMs = 0;
let lastDelaySpeakMs = 0;
let lastMissedSwapMs = 0;
let lastCatchUpSpeakMs = 0;
let lastPaceHint: string | null = null;
let lastWaitShown = -1;
let muteLeaveSpeech = false;
/** Nächste Folge-Abfahrt (ms), wenn Delay-Poll sie kennt. */
let nextDepHintMs: number | null = null;
let nextLineHint = '';
let lastTransferSpeakMs = 0;
let lastTransferHint: string | null = null;

function isMidRideTransit(): boolean {
  try {
    if (getNavPhase() === 'in_transit') return true;
  } catch {
    /* soft */
  }
  const tour = useFinnusStore.getState().multiStopTour;
  const cur = tour?.stops?.[tour.currentIndex ?? 0];
  return cur?.role === 'alight';
}

function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function planWalkMPerMin(): number {
  try {
    const { getPlanWalkMPerMin } = require('../mobility/paceProfile') as {
      getPlanWalkMPerMin: () => number;
    };
    return Math.max(40, getPlanWalkMPerMin());
  } catch {
    return 70;
  }
}

export function walkMinToStop(
  from: { lat: number; lng: number },
  stop: { lat: number; lng: number },
  durationSec?: number | null,
): number {
  const m = haversineMeters(from.lat, from.lng, stop.lat, stop.lng);
  const fromDist = liveWalkEtaMin({
    distanceM: m,
    paceMPerMin: planWalkMPerMin(),
  });
  if (typeof durationSec === 'number' && durationSec > 20) {
    return Math.max(fromDist, Math.round(durationSec / 60));
  }
  return fromDist || Math.max(1, Math.round(m / 70));
}

function currentBoardTarget(): {
  lat: number;
  lng: number;
  name: string | null;
  depMs: number | null;
  line: string | null;
} {
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const stop = tour?.stops?.[idx];
  if (
    stop &&
    (stop.role === 'walk' ||
      stop.role === 'board' ||
      stop.role === 'transfer') &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng)
  ) {
    return {
      lat: stop.lat,
      lng: stop.lng,
      name: stop.name ?? null,
      depMs: stop.vehicleStartMs ?? depMsArmed,
      line: stop.line ?? lineLabel,
    };
  }
  return {
    lat: firstStop.lat,
    lng: firstStop.lng,
    name: tour?.stops?.[0]?.name ?? null,
    depMs: depMsArmed,
    line: lineLabel,
  };
}

function applyLiveHintToTour(hint: string | null): void {
  try {
    const st = useFinnusStore.getState();
    const tour = st.multiStopTour;
    if (!tour?.stops?.length) return;
    const idx = tour.currentIndex ?? 0;
    const stops = tour.stops.map((s, i) => {
      if (i !== idx) {
        return s.liveHint ? { ...s, liveHint: null } : s;
      }
      if ((s.liveHint ?? null) === hint) return s;
      return { ...s, liveHint: hint };
    });
    const changed = stops.some((s, i) => s !== tour.stops[i]);
    if (!changed) return;
    st.setMultiStopTour({ ...tour, stops });
  } catch {
    /* soft */
  }
}

export function leaveByFromItinerary(
  it: JourneyItinerary,
  origin: { lat: number; lng: number },
  nowMs = Date.now(),
): {
  leaveByMs: number;
  depMs: number;
  walkMin: number;
  leaveInMin: number;
  line: string | null;
  station: string | null;
  arriveMs: number;
} | null {
  const firstTransit = (it.legs ?? []).find(
    (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
  );
  const walk = (it.legs ?? []).find((l) => l.mode === 'WALK');
  const live = it.firstTransitDeparture ?? firstTransit?.startTime ?? null;
  const scheduled = firstTransit?.scheduledStart ?? null;
  const dep =
    live instanceof Date && Number.isFinite(live.getTime())
      ? live
      : scheduled;
  const depMs =
    dep instanceof Date && Number.isFinite(dep.getTime())
      ? dep.getTime()
      : NaN;
  if (!Number.isFinite(depMs)) return null;
  const stop = {
    lat: firstTransit?.fromLat ?? walk?.toLat ?? origin.lat,
    lng: firstTransit?.fromLng ?? walk?.toLng ?? origin.lng,
  };
  const walkMin = walkMinToStop(
    origin,
    {
      lat: Number.isFinite(stop.lat as number) ? (stop.lat as number) : origin.lat,
      lng: Number.isFinite(stop.lng as number) ? (stop.lng as number) : origin.lng,
    },
    it.walkToStopSec ?? walk?.durationSec,
  );
  const leaveByMs =
    depMs -
    (walkMin +
      stationArriveBufferMin({
        name: firstTransit?.fromName ?? walk?.toName ?? null,
        mode: firstTransit?.mode ?? null,
      })) *
      60_000;
  const arrive =
    it.endTime instanceof Date && Number.isFinite(it.endTime.getTime())
      ? it.endTime.getTime()
      : depMs + Math.max(60, it.durationSec) * 1000;
  return {
    leaveByMs,
    depMs,
    walkMin,
    leaveInMin: Math.round((leaveByMs - nowMs) / 60_000),
    line: it.firstTransitLine ?? firstTransit?.line ?? null,
    station: firstTransit?.fromName?.trim() || walk?.toName?.trim() || null,
    arriveMs: arrive,
  };
}

export function shouldDeferJourneyNav(leaveInMin: number): boolean {
  return leaveInMin > START_NAV_SLACK_MIN;
}

async function speakOnce(kind: '30' | '5' | 'go', text: string): Promise<void> {
  if (!watchAlive || muteLeaveSpeech) return;
  if (lastWarn === kind || lastWarn === 'go') return;
  lastWarn = kind;
  try {
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: text.slice(0, 280),
      turnId: `journey_leave_${kind}_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}

async function startWalkingNow(): Promise<void> {
  const tour = useFinnusStore.getState().multiStopTour;
  const stop = tour?.stops?.[tour.currentIndex];
  if (!stop) return;
  const hasTransit = (tour?.stops ?? []).some(
    (s) => s.role === 'alight' || s.role === 'board' || Boolean(s.line),
  );
  if (hasTransit && (stop.role === 'dest' || stop.role === 'alight')) return;
  try {
    const { startNavigationToCoords } = await import('./navigationService');
    await startNavigationToCoords({
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      poiId: stop.poiId >= 0 ? stop.poiId : -1,
      stations: stop.stations,
      transitRide: stop.role === 'alight',
    });
  } catch {
    /* soft */
  }
}

async function pollDelay(): Promise<void> {
  if (!watchAlive) return;
  const now = Date.now();
  if (now - lastDelayPollMs < 90_000) return;
  lastDelayPollMs = now;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;
  const origin = {
    lat: useGpsStore.getState().lat ?? useFinnusStore.getState().lastGpsLat,
    lng: useGpsStore.getState().lng ?? useFinnusStore.getState().lastGpsLng,
  };
  if (origin.lat == null || origin.lng == null) return;
  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const fresh = await planTransitHandsFree({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
    });
    const first = (fresh?.legs ?? []).find(
      (l) => l.mode !== 'WALK' && l.mode !== 'BIKE',
    );
    const nextDep =
      fresh?.firstTransitDeparture instanceof Date
        ? fresh.firstTransitDeparture.getTime()
        : first?.startTime instanceof Date
          ? first.startTime.getTime()
          : NaN;
    if (!Number.isFinite(nextDep) || depMsArmed == null) return;
    const scheduledMs =
      first?.scheduledStart instanceof Date
        ? first.scheduledStart.getTime()
        : null;
    const kind = classifyTransitSlip({
      nowMs: now,
      armedDepMs: depMsArmed,
      nextDepMs: nextDep,
      scheduledStartMs: scheduledMs,
      delaySec: first?.delaySec ?? null,
    });
    const slipMin = Math.round((nextDep - depMsArmed) / 60_000);
    if (kind === 'unchanged') return;
    if (kind === 'missed_next') {
      void proposeMissedAlternative(origin, now);
      return;
    }
    const ride = (first?.line || lineLabel || 'Bahn').trim();
    const delayMin = Math.max(
      3,
      Math.round((first?.delaySec ?? slipMin * 60) / 60),
    );
    // Folgeverbindung merken (für „lieber warten“-Tipp).
    try {
      const alts = await planTransitHandsFree({
        from: { lat: origin.lat, lng: origin.lng },
        to: { lat: destArmed.lat, lng: destArmed.lng },
        departAt: new Date(nextDep + 8 * 60_000),
      });
      const altDep =
        alts?.firstTransitDeparture instanceof Date
          ? alts.firstTransitDeparture.getTime()
          : NaN;
      if (Number.isFinite(altDep) && altDep > nextDep + 60_000) {
        nextDepHintMs = altDep;
        nextLineHint = (alts?.firstTransitLine || ride).trim();
      }
    } catch {
      /* soft */
    }
    if (now - lastDelaySpeakMs > 4 * 60_000) {
      if (!watchAlive) return;
      lastDelaySpeakMs = now;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      const bufferGain =
        slipMin >= 2
          ? ` Mehr Puffer — du kannst entspannter laufen.`
          : '';
      enqueueSpeech({
        kind: 'main',
        text: `${ride} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr.${bufferGain}`,
        turnId: `journey_delay_${Date.now()}`,
      });
    }
    const tour = useFinnusStore.getState().multiStopTour;
    if (tour?.liveMeta && depMsArmed != null) {
      const oldDep = depMsArmed;
      const walkMin = walkMinToStop(
        { lat: origin.lat, lng: origin.lng },
        firstStop,
      );
      const nextLeave =
        nextDep -
        (walkMin +
          stationArriveBufferMin({
            name:
              useFinnusStore.getState().multiStopTour?.stops?.[0]?.name ??
              lineLabel,
          })) *
          60_000;
      armedLeaveByMs = nextLeave;
      depMsArmed = nextDep;
      const patchedStops = shiftTourStopTimesForDelay(tour.stops, {
        oldDepMs: oldDep,
        newDepMs: nextDep,
        delaySec: first?.delaySec ?? delayMin * 60,
      });
      useFinnusStore.getState().setMultiStopTour({
        ...tour,
        stops: patchedStops,
        liveMeta: {
          ...tour.liveMeta,
          leaveByMs: nextLeave,
          firstTransitMs: nextDep,
          plannedArriveByMs:
            fresh?.endTime instanceof Date
              ? fresh.endTime.getTime()
              : tour.liveMeta.plannedArriveByMs,
        },
      });
      const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
        upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
      };
      upsertLiveNavFromStore({ force: true });
    }
  } catch {
    /* soft */
  }
}

function tick(): void {
  if (!watchAlive) return;
  const now = Date.now();
  try {
    const {
      isLiveJourneyOnTimeline,
      isLiveNavMirrorSuppressed,
    } = require('../../module2/timeline/syncLiveNavToPlan') as {
      isLiveJourneyOnTimeline: () => boolean;
      isLiveNavMirrorSuppressed: () => boolean;
    };
    const tour = useFinnusStore.getState().multiStopTour;
    const onTimeline = isLiveJourneyOnTimeline();
    const suppressed = isLiveNavMirrorSuppressed();
    const ageMs = now - watchStartedAt;
    if (suppressed || !tour) {
      stopJourneyLeaveWatch(suppressed ? 'suppressed' : 'no_tour');
      return;
    }
    if (!onTimeline) {
      try {
        const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
          upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
        };
        upsertLiveNavFromStore({ force: true });
      } catch {
        /* soft */
      }
      if (!isLiveJourneyOnTimeline()) {
        stopJourneyLeaveWatch('timeline_empty');
        return;
      }
    }
  } catch {
    /* soft */
  }
  const gps = useGpsStore.getState();
  const origin = {
    lat: gps.lat ?? useFinnusStore.getState().lastGpsLat ?? firstStop.lat,
    lng: gps.lng ?? useFinnusStore.getState().lastGpsLng ?? firstStop.lng,
  };
  if (
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    Number.isFinite(firstStop.lat) &&
    depMsArmed != null
  ) {
    const board = currentBoardTarget();
    const boardStop = { lat: board.lat, lng: board.lng };
    const distM = haversineMeters(origin.lat, origin.lng, boardStop.lat, boardStop.lng);
    const walkMin = walkMinToStop(origin, boardStop);
    const depMs = board.depMs ?? depMsArmed;
    const bufferMin = stationArriveBufferMin({
      name: board.name,
    });
    const nextLeave = depMs - (walkMin + bufferMin) * 60_000;
    const shifted =
      armedLeaveByMs == null || Math.abs(nextLeave - armedLeaveByMs) > 45_000;
    armedLeaveByMs = nextLeave;

    const pace = assessLiveJourneyPace({
      nowMs: now,
      depMs,
      distanceM: distM,
      bufferMin,
      paceMPerMin: planWalkMPerMin(),
      nextDepMs: nextDepHintMs,
      line: board.line,
      nextLine: nextLineHint || board.line,
    });
    const hint = pace.timelineHint;
    const hintChanged = hint !== lastPaceHint;
    const waitChanged = pace.waitMin !== lastWaitShown;
    if (hintChanged) {
      lastPaceHint = hint;
      applyLiveHintToTour(hint);
    }
    lastWaitShown = pace.waitMin;
    // Catch-up / „lieber warten“ — gedrosselt ansagen.
    if (
      !muteLeaveSpeech &&
      pace.tip &&
      (pace.scenario === 'catch_up' || pace.scenario === 'wait_next') &&
      now - lastCatchUpSpeakMs > 90_000
    ) {
      lastCatchUpSpeakMs = now;
      void (async () => {
        try {
          const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
          enqueueSpeech({
            kind: 'main',
            text: pace.tip!.slice(0, 280),
            turnId: `journey_catchup_${Date.now()}`,
          });
        } catch {
          /* soft */
        }
      })();
    }
    // Verpasst während Umstieg → Alternative vorschlagen.
    if (pace.scenario === 'missed') {
      void proposeMissedAlternative(origin, now);
    }

    if (shifted || hintChanged || waitChanged) {
      try {
        const st = useFinnusStore.getState();
        const tour = st.multiStopTour;
        if (tour?.liveMeta) {
          st.setMultiStopTour({
            ...tour,
            liveMeta: {
              ...tour.liveMeta,
              leaveByMs: nextLeave,
              bufferMin: Math.max(0, pace.waitMin),
            },
          });
          const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
            upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
          };
          upsertLiveNavFromStore({ force: true });
        }
      } catch {
        /* soft */
      }
    }
  }
  void maybeSwapMissedConnection(origin, now);
  if (armedLeaveByMs == null) return;
  const left = Math.round((armedLeaveByMs - now) / 60_000);
  const ride = lineLabel.trim() || 'Bahn';
  if (left <= 0) {
    if (!muteLeaveSpeech && !useFinnusStore.getState().navActive) {
      void speakOnce(
        'go',
        `Jetzt los — ${ride} nicht verpassen.`,
      );
      void startWalkingNow();
    }
    void pollDelay();
    return;
  }
  if (!muteLeaveSpeech && left <= 5) {
    void speakOnce(
      '5',
      `In 5 Minuten müssen wir aufbrechen, um pünktlich die ${ride} zu bekommen.`,
    );
    void pollDelay();
    return;
  }
  if (!muteLeaveSpeech && left <= 30 && left >= 25) {
    void speakOnce(
      '30',
      `In 30 Minuten müssen wir los zur Bahn.`,
    );
  }
  void pollDelay();
}

async function proposeMissedAlternative(
  origin: { lat: number; lng: number },
  now: number,
): Promise<void> {
  if (!watchAlive) return;
  if (depMsArmed == null) return;
  if (now - lastMissedSwapMs < 90_000) return;
  if (!Number.isFinite(destArmed.lat) || destArmed.lat === 0) return;
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const cur = tour?.stops?.[idx];
  // Erster Einstieg oder Umstieg (transfer/walk mit Fahrzeug) — nicht mitten in der Fahrt.
  if (idx > 0) {
    const okRole =
      cur?.role === 'transfer' ||
      cur?.role === 'walk' ||
      cur?.role === 'board';
    if (!okRole) return;
  }
  if (tour?.stops?.[0]?.done && idx === 0) return;
  lastMissedSwapMs = now;
  const oldDep = cur?.vehicleStartMs ?? depMsArmed;
  try {
    const { recalculateMissedConnection } = await import('../transit/journeyPlanner');
    const afterMs = Math.max(now, oldDep) + 2 * 60_000;
    const pick = await recalculateMissedConnection({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      after: new Date(afterMs),
      preferLine: cur?.line ?? lineLabel,
      missedLineLabel: cur?.line ?? lineLabel,
    });
    const next = pick.primary;
    if (!next) return;
    const nextDep =
      next.firstTransitDeparture instanceof Date
        ? next.firstTransitDeparture.getTime()
        : next.startTime.getTime();
    if (!Number.isFinite(nextDep)) return;
    nextDepHintMs = nextDep;
    nextLineHint = (next.firstTransitLine || '').trim();

    // Aktiver Prompt bei langer Wartezeit — Alternative nur vorschlagen, nicht still ersetzen.
    if (pick.mode === 'active_prompt' && pick.promptSpeech) {
      if (!watchAlive) return;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      enqueueSpeech({
        kind: 'main',
        text: pick.promptSpeech.slice(0, 320),
        turnId: `journey_missed_ask_${Date.now()}`,
      });
      applyLiveHintToTour(
        pick.waitMinForPrimary > 0
          ? `nächste in ${pick.waitMinForPrimary} Min`
          : 'Alternative prüfen',
      );
      try {
        const { upsertLiveNavFromStore } = require('../../module2/timeline/syncLiveNavToPlan') as {
          upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
        };
        upsertLiveNavFromStore({ force: true });
      } catch {
        /* soft */
      }
      return;
    }

    const { startJourneyNavigation } = await import('./startJourneyNavigation');
    await startJourneyNavigation({
      itinerary: next,
      destName: destArmed.name,
      destLat: destArmed.lat,
      destLng: destArmed.lng,
      replace: true,
    });
    const ride = (next.firstTransitLine || 'nächste Verbindung').trim();
    if (!watchAlive) return;
    const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text:
        `${cur?.line || lineLabel || 'Bahn'} um ${clockHm(oldDep)} Uhr ist weg. ` +
        `Nächste: ${ride} um ${clockHm(nextDep)} Uhr` +
        (pick.waitMinForPrimary > 0
          ? ` — etwa ${pick.waitMinForPrimary} Minuten warten.`
          : '.'),
      turnId: `journey_missed_${Date.now()}`,
    });
  } catch {
    /* soft */
  }
}

async function maybeSwapMissedConnection(
  origin: { lat: number; lng: number },
  now: number,
): Promise<void> {
  const board = currentBoardTarget();
  const depMs = board.depMs ?? depMsArmed;
  if (depMs == null || now <= depMs + 20_000) return;
  const atHalt =
    board.lat !== 0 &&
    haversineMeters(origin.lat, origin.lng, board.lat, board.lng) < 80;
  if (atHalt) return;
  const tour = useFinnusStore.getState().multiStopTour;
  const idx = tour?.currentIndex ?? 0;
  const cur = tour?.stops?.[idx];
  // Schon im Fahrzeug (alight-Phase mit aktiver Nav) → nicht umbuchen.
  if (cur?.role === 'alight' && useFinnusStore.getState().navActive) {
    return;
  }
  void proposeMissedAlternative(origin, now);
}

export function startJourneyLeaveWatch(opts: {
  leaveByMs: number;
  firstStop: { lat: number; lng: number };
  destName: string;
  destLat?: number;
  destLng?: number;
  line: string | null;
  depMs: number;
  muteLeaveSpeech?: boolean;
}): void {
  stopJourneyLeaveWatch('restart');
  try {
    const { allowLiveNavMirror } = require('../../module2/timeline/syncLiveNavToPlan') as {
      allowLiveNavMirror: () => void;
    };
    allowLiveNavMirror();
  } catch {
    /* soft */
  }
  armedLeaveByMs = opts.leaveByMs;
  firstStop = opts.firstStop;
  lineLabel = opts.line ?? '';
  depMsArmed = opts.depMs;
  destArmed = {
    lat: opts.destLat ?? 0,
    lng: opts.destLng ?? 0,
    name: opts.destName,
  };
  const gps = useGpsStore.getState();
  originArmed = {
    lat: gps.lat ?? useFinnusStore.getState().lastGpsLat ?? 0,
    lng: gps.lng ?? useFinnusStore.getState().lastGpsLng ?? 0,
  };
  muteLeaveSpeech = opts.muteLeaveSpeech === true;
  lastWarn = muteLeaveSpeech ? 'go' : null;
  lastDelayPollMs = 0;
  lastDelaySpeakMs = 0;
  lastMissedSwapMs = 0;
  lastCatchUpSpeakMs = 0;
  lastPaceHint = null;
  lastWaitShown = -1;
  nextDepHintMs = null;
  nextLineHint = '';
  watchAlive = true;
  watchStartedAt = Date.now();
  watchTimer = setInterval(tick, 20_000);
  tick();
}

export function stopJourneyLeaveWatch(reason?: string): void {
  const wasAlive = watchAlive || Boolean(watchTimer);
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  watchAlive = false;
  armedLeaveByMs = null;
  depMsArmed = null;
  lastWarn = 'go';
  muteLeaveSpeech = true;
  if (wasAlive && reason !== 'restart') {
    try {
      const { clearCatchMyBusReminder } = require('../transit/catchMyBusReminder') as {
        clearCatchMyBusReminder: () => void;
      };
      clearCatchMyBusReminder();
    } catch {
      /* soft */
    }
  }
}

export function peekArmedLeaveByMs(): number | null {
  return armedLeaveByMs;
}

export function formatJourneyCommitSpeech(opts: {
  destName: string;
  leaveInMin: number;
  leaveByMs: number;
  depMs: number;
  arriveMs: number;
  walkMin: number;
  line: string | null;
  station: string | null;
  tight?: boolean;
}): string {
  const ride = (opts.line || 'ÖPNV').trim();
  const halt = (opts.station || 'der Haltestelle').trim();
  const leave = clockHm(opts.leaveByMs);
  const dep = clockHm(opts.depMs);
  const arrive = clockHm(opts.arriveMs);
  const hurry = opts.tight
    ? ` Wenn du jetzt zügig gehst, schaffst du ${ride} um ${dep} Uhr noch.`
    : '';
  if (opts.leaveInMin > START_NAV_SLACK_MIN && !opts.tight) {
    return (
      `Alles klar, wir fahren mit dem ÖPNV zu ${opts.destName}. ` +
      `${ride} um ${dep} Uhr von ${halt}. ` +
      `Zu Fuß ca. ${opts.walkMin} Minuten — Losgehen um ${leave} Uhr. ` +
      `Ankunft gegen ${arrive} Uhr.`
    );
  }
  return (
    `Alles klar, wir fahren mit dem ÖPNV zu ${opts.destName}. ` +
    `${ride} um ${dep} Uhr von ${halt}. ` +
    `Ankunft gegen ${arrive} Uhr.` +
    (hurry || ' Wir gehen jetzt raus zur Haltestelle.')
  );
}
