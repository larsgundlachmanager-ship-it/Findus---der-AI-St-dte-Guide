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
import { STATION_ARRIVE_BEFORE_MIN } from '../transit/stationArriveBuffer';

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
let muteLeaveSpeech = false;

function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function walkMinToStop(
  from: { lat: number; lng: number },
  stop: { lat: number; lng: number },
  durationSec?: number | null,
): number {
  const m = haversineMeters(from.lat, from.lng, stop.lat, stop.lng);
  const fromDist = Math.max(1, Math.round(m / 70));
  if (typeof durationSec === 'number' && durationSec > 20) {
    return Math.max(fromDist, Math.round(durationSec / 60));
  }
  return fromDist;
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
  const leaveByMs = depMs - (walkMin + STATION_ARRIVE_BEFORE_MIN) * 60_000;
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
    if (now - lastDelaySpeakMs > 4 * 60_000) {
      if (!watchAlive) return;
      lastDelaySpeakMs = now;
      const { enqueueSpeech } = await import('../../module2/speech/speechQueue');
      enqueueSpeech({
        kind: 'main',
        text: `${ride} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr.`,
        turnId: `journey_delay_${Date.now()}`,
      });
    }
    const tour = useFinnusStore.getState().multiStopTour;
    if (tour?.liveMeta) {
      const walkMin = walkMinToStop(
        { lat: origin.lat, lng: origin.lng },
        firstStop,
      );
      const nextLeave = nextDep - (walkMin + STATION_ARRIVE_BEFORE_MIN) * 60_000;
      armedLeaveByMs = nextLeave;
      useFinnusStore.getState().setMultiStopTour({
        ...tour,
        liveMeta: {
          ...tour.liveMeta,
          leaveByMs: nextLeave,
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
    const walkMin = walkMinToStop(origin, firstStop);
    const nextLeave = depMsArmed - (walkMin + STATION_ARRIVE_BEFORE_MIN) * 60_000;
    const shifted =
      armedLeaveByMs == null || Math.abs(nextLeave - armedLeaveByMs) > 45_000;
    armedLeaveByMs = nextLeave;
    if (shifted) {
      try {
        const st = useFinnusStore.getState();
        const tour = st.multiStopTour;
        if (tour?.liveMeta) {
          st.setMultiStopTour({
            ...tour,
            liveMeta: { ...tour.liveMeta, leaveByMs: nextLeave },
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
  if ((tour?.currentIndex ?? 0) > 0) return;
  if (tour?.stops?.[0]?.done) return;
  lastMissedSwapMs = now;
  const oldDep = depMsArmed;
  try {
    const { recalculateNextConnection } = await import('../transit/journeyPlanner');
    const afterMs = Math.max(now, oldDep) + 10 * 60_000;
    const next = await recalculateNextConnection({
      from: { lat: origin.lat, lng: origin.lng },
      to: { lat: destArmed.lat, lng: destArmed.lng },
      after: new Date(afterMs),
      preferLine: lineLabel,
    });
    if (!next) return;
    const nextDep =
      next.firstTransitDeparture instanceof Date
        ? next.firstTransitDeparture.getTime()
        : next.startTime.getTime();
    if (!Number.isFinite(nextDep) || nextDep < oldDep + 10 * 60_000) return;
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
        `${lineLabel || 'Bahn'} um ${clockHm(oldDep)} Uhr ist weg. ` +
        `Nächste: ${ride} um ${clockHm(nextDep)} Uhr.`,
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
  if (depMsArmed == null || now <= depMsArmed + 20_000) return;
  const atHalt =
    firstStop.lat !== 0 &&
    haversineMeters(origin.lat, origin.lng, firstStop.lat, firstStop.lng) < 80;
  if (atHalt) return;
  const tour = useFinnusStore.getState().multiStopTour;
  if ((tour?.currentIndex ?? 0) > 0) return;
  if (tour?.stops?.[0]?.role === 'alight' && useFinnusStore.getState().navActive) {
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
