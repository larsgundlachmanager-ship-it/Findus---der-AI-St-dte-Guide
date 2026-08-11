/**
 * Tour-Orchestrierung — Parent liefert Brief; hier Plan + Publish + optional Start.
 */

import { collectTourCandidates } from './candidatePool';
import { filterAndRankCandidates } from './filterRank';
import { planWithRetries, TOUR_BUFFER_MIN } from './exactValidate';
import {
  buildTourActions,
  buildTourBullets,
  buildTourSpeech,
  publishTourResult,
} from './tourSpeech';
import {
  parseDurationAnswerMin,
  useTourDurationPendingStore,
} from './pendingDuration';
import { startTourLiveSupervisor } from './tourLiveSupervisor';
import { stashRestPool } from './restPool';
import type { TourRequest, TourResult } from './types';
import type { MultiStopTour } from '../../services/navigation/multiStopTour';

function toMultiStop(req: TourRequest, result: TourResult): MultiStopTour {
  return {
    kind: req.mode === 'path_tour' ? 'jog' : 'explore',
    title: req.title.slice(0, 40) || 'Tour',
    targetDistanceM:
      req.pathSpec?.distanceKm != null
        ? Math.round(req.pathSpec.distanceKm * 1000)
        : null,
    targetDurationMin: result.totalMin,
    estimatedDistanceM: result.legs.reduce((a, l) => a + l.distanceM, 0),
    stops: result.stops.map((s) => ({
      poiId: s.poiId,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      done: false,
      priority: s.priority,
    })),
    currentIndex: 0,
    liveMeta: {
      requestId: result.requestId,
      hardArriveByMs: req.hardArriveByMs ?? null,
      softDurationMin: req.softDurationMin ?? req.timeBudgetMin ?? null,
      bufferMin: TOUR_BUFFER_MIN,
      plannedArriveByMs: Date.now() + result.totalMin * 60_000,
      startedAtMs: Date.now(),
      denserStops: req.prefs.denserStops === true,
      mobility: req.mobility,
    },
  };
}

export async function runTourModule(req: TourRequest): Promise<TourResult> {
  if (req.needsDurationAsk) {
    useTourDurationPendingStore.getState().setPending({
      requestId: req.requestId,
      partialRequest: { ...req, needsDurationAsk: false },
      askedAtMs: Date.now(),
    });
    const spokenText = buildTourSpeech({
      req,
      stops: [],
      totalMin: 0,
      softFail: false,
      needsDurationAsk: true,
    });
    return {
      requestId: req.requestId,
      softFail: false,
      needsDurationAsk: true,
      spokenText,
      stops: [],
      legs: [],
      totalMin: 0,
      bufferMin: TOUR_BUFFER_MIN,
      attempts: 0,
      uiLayout: req.uiLayout,
      actions: [],
      bullets: ['Dauer noch offen'],
    };
  }

  const pool = await collectTourCandidates(req);
  const ranked = filterAndRankCandidates(req, pool);
  const planned = await planWithRetries({ req, ranked });

  const spokenText = buildTourSpeech({
    req,
    stops: planned.stops,
    totalMin: planned.totalMin,
    softFail: planned.softFail,
    needsDurationAsk: false,
  });
  const actions = buildTourActions({
    req,
    stops: planned.stops,
    resultId: req.requestId,
  });
  const bullets = buildTourBullets(planned.stops, planned.totalMin);

  const result: TourResult = {
    requestId: req.requestId,
    softFail: planned.softFail,
    needsDurationAsk: false,
    spokenText,
    summary: req.title,
    stops: planned.stops,
    legs: planned.legs,
    totalMin: planned.totalMin,
    bufferMin: TOUR_BUFFER_MIN,
    attempts: planned.attempts,
    uiLayout: req.uiLayout,
    actions,
    bullets,
  };

  publishTourResult(result, req);

  if (
    !planned.softFail &&
    planned.stops.length >= 1 &&
    req.uiLayout === 'start_nav_now'
  ) {
    try {
      const { startMultiStopTour } = await import(
        '../../services/navigation/multiStopTour'
      );
      const tour = toMultiStop(req, result);
      // attach rest pool on supervisor side via module state
      const started = await startMultiStopTour(tour);
      if (started.ok) {
        startTourLiveSupervisor({
          requestId: req.requestId,
          restPool: planned.rest,
          denserStops: req.prefs.denserStops === true,
        });
      }
    } catch {
      /* soft — user can still tap Tour starten */
    }
  } else if (!planned.softFail && planned.stops.length >= 1) {
    // stash rest pool for when user starts later
    stashRestPool(req.requestId, planned.rest, req.prefs.denserStops === true);
  }

  return result;
}

/** Follow-up: pending duration + new utterance → full request */
export function mergeDurationFollowUp(
  text: string,
): TourRequest | null {
  const pending = useTourDurationPendingStore.getState().takeIfMatch(text);
  if (!pending) return null;
  const min = parseDurationAnswerMin(text);
  if (min == null) {
    useTourDurationPendingStore.getState().setPending({
      requestId: pending.requestId,
      partialRequest: pending,
      askedAtMs: Date.now(),
    });
    return null;
  }
  return {
    ...pending,
    timeBudgetMin: min,
    softDurationMin: min,
    needsDurationAsk: false,
    pathSpec:
      pending.mode === 'path_tour'
        ? {
            ...(pending.pathSpec ?? { loop: true }),
            durationMin: min,
            distanceKm: pending.pathSpec?.distanceKm ?? null,
            loop: pending.pathSpec?.loop ?? true,
          }
        : pending.pathSpec,
  };
}
