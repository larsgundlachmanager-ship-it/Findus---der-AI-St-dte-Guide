/**
 * Early / route M5 handoffs — aus runConciergeTurn ausgelagert (inkrementell).
 */

import { synthesizeOutput } from '../../pipeline/synthesis';
import type { LogicNodeOutput, PipelineTurnResult } from '../../types';
import type { TurnFrame } from '../turnFrame';
import { frameOwnsDayPlan } from '../turnFrame';

function emptyM5Result(turnId: string): PipelineTurnResult {
  const logic: LogicNodeOutput = {
    spokenDraft: '',
    bullets: [],
    buttons: [],
    moneyEur: [],
    warnings: [],
  };
  return {
    turnId,
    tasks: [],
    bridgingText: null,
    logic,
    synthesis: synthesizeOutput(logic),
    deepResearchQueued: false,
    jobId: 'day_plan_budget',
  };
}

function tourResultPayload(
  turnId: string,
  spoken: string,
  bullets: string[],
): PipelineTurnResult {
  const logic: LogicNodeOutput = {
    spokenDraft: spoken,
    bullets,
    buttons: [],
    moneyEur: [],
    warnings: [],
  };
  return {
    turnId,
    tasks: [],
    bridgingText: null,
    logic,
    synthesis: synthesizeOutput(logic),
    deepResearchQueued: false,
    jobId: 'sight_recommend',
  };
}

/**
 * Erkunden / Multi-Stop → Tour-Modul sofort (vor Chat & Manager).
 * Trägt Orte in die Timeline des aktuellen Plan-Tags ein.
 */
export async function tryEarlyTourHandoff(opts: {
  rewritten: string;
  turnId: string;
}): Promise<PipelineTurnResult | null> {
  try {
    const { shouldHandoffToTourModule } = await import(
      '../../tour/shouldHandoffTour'
    );
    if (!shouldHandoffToTourModule(opts.rewritten)) return null;

    if (__DEV__) {
      console.log(
        '[tour] early handoff → runTourModule',
        opts.rewritten.slice(0, 100),
      );
    }

    const { buildTourRequestFromText, runTourModule } = await import(
      '../../tour'
    );
    const { todayDateKey } = await import('../../../utils/dateKeys');
    const { useFuturePlanStore } = await import(
      '../../timeline/futurePlanState'
    );
    const { usePlanCalendarUiStore, revealPlanCalendarNow } = await import(
      '../../timeline/planCalendarUiStore'
    );
    const { usePlanSessionStore } = await import(
      '../../planning/planSessionState'
    );

    const dayKey =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      usePlanSessionStore.getState().plan?.targetDate ||
      useFuturePlanStore.getState().plan.dayKey ||
      todayDateKey();

    useFuturePlanStore.getState().ensureDay(dayKey);
    await revealPlanCalendarNow(dayKey);

    const built = buildTourRequestFromText({
      text: opts.rewritten,
      uiLayout: 'timeline_stack',
      forceDurationMin: 90,
    });
    const request = {
      ...built.request,
      planDayKey: dayKey,
      uiLayout: 'timeline_stack' as const,
      // Bei offener Planung: nicht nach Dauer fragen — direkt Orte eintragen
      needsDurationAsk: false,
      timeBudgetMin: built.request.timeBudgetMin ?? 90,
      softDurationMin: built.request.softDurationMin ?? 90,
    };

    // Stadt aus der Frage schlägt Pack-Heimat (Lübeck erkunden → nicht Prisdorf-GPS)
    try {
      const { extractCityFromText } = await import(
        '../../context/shortTermContext'
      );
      const named = extractCityFromText(opts.rewritten);
      const area = named || request.areaHint || request.cityHint;
      if (area && !/\bhier\b/i.test(area)) {
        const { geocodePlaceName } = await import(
          '../../../services/navigation/googleMapsNav'
        );
        const geo = await geocodePlaceName(area, { cityHint: area });
        if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
          request.anchor = { lat: geo.lat, lng: geo.lng };
        }
      }
    } catch {
      /* soft */
    }

    // Tag halten — nicht still auf heute/Mittwoch springen
    useFuturePlanStore.getState().ensureDay(dayKey);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);

    const result = await runTourModule(request);

    useFuturePlanStore.getState().ensureDay(dayKey);
    usePlanCalendarUiStore.getState().requestDayKey(dayKey);
    try {
      const { applyGapFillTravelLegs } = await import(
        '../../timeline/gapFillTravel'
      );
      applyGapFillTravelLegs();
    } catch {
      /* soft */
    }

    if (result.spokenText?.trim()) {
      try {
        const { enqueueSpeech } = await import('../../speech/speechQueue');
        enqueueSpeech({
          kind: 'main',
          text: result.spokenText,
          turnId: opts.turnId,
        });
      } catch {
        /* soft */
      }
    }

    const bullets = (result.stops || [])
      .slice(0, 4)
      .map((s) => s.name)
      .filter(Boolean);

    return tourResultPayload(
      opts.turnId,
      result.spokenText || '',
      bullets,
    );
  } catch (err) {
    console.warn('[tour] early handoff failed', err);
    return null;
  }
}

/**
 * Vor Manager-LLM: Tour gewinnt vor M5; sonst Force-M5 → Planning.
 */
export async function tryEarlyM5Handoff(opts: {
  rewritten: string;
  turnId: string;
}): Promise<PipelineTurnResult | null> {
  try {
    const { isPlanAwaitingUserReply } = await import(
      '../../planning/planSessionState'
    );
    if (isPlanAwaitingUserReply()) {
      let yieldToFlight = false;
      try {
        const { shouldYieldPlanWaitToFlight } = await import(
          '../../../services/flights/flightTripIntent'
        );
        const {
          hydrateFlightTripSession,
          hasFlightTripSession,
          getFlightTripSession,
        } = await import('../../../services/flights/flightTripSession');
        await hydrateFlightTripSession();
        const open = hasFlightTripSession();
        yieldToFlight = shouldYieldPlanWaitToFlight({
          userText: opts.rewritten,
          hasOpenSession: open,
          pendingAsk: open ? getFlightTripSession()?.pendingAsk ?? null : null,
        });
      } catch {
        yieldToFlight = false;
      }
      if (yieldToFlight) {
        const { releasePlanWaitForForeignTopic } = await import(
          '../../planning/planSessionState'
        );
        releasePlanWaitForForeignTopic();
      } else {
        const { runPlanningModule } = await import(
          '../../planning/runPlanningModule'
        );
        await runPlanningModule({
          userText: opts.rewritten,
          turnId: opts.turnId,
        });
        return emptyM5Result(opts.turnId);
      }
    }

    // Tour zuerst — sonst frisst Chat „welche Orte … erkunden“ ohne Timeline
    const earlyTour = await tryEarlyTourHandoff(opts);
    if (earlyTour) return earlyTour;

    const { shouldHandoffToTourModule } = await import(
      '../../tour/shouldHandoffTour'
    );
    const { shouldForceModul5Handoff } = await import(
      '../../planning/planHandoffGuard'
    );
    const tourFirst = shouldHandoffToTourModule(opts.rewritten);
    if (!tourFirst && shouldForceModul5Handoff(opts.rewritten)) {
      if (__DEV__) {
        console.log(
          '[m5] force handoff → runPlanningModule',
          opts.rewritten.slice(0, 100),
        );
      }
      const { runPlanningModule } = await import(
        '../../planning/runPlanningModule'
      );
      await runPlanningModule({
        userText: opts.rewritten,
        turnId: opts.turnId,
      });
      return emptyM5Result(opts.turnId);
    }
    if (tourFirst && __DEV__) {
      console.log('[tour] skip early m5 — tour handoff pending');
    }
  } catch (err) {
    console.warn('[m5] early handoff failed', err);
  }
  return null;
}

/** Manager-Route m5_plan — Tour kann noch gewinnen, außer Call-1 hat Plan-Auftrag. */
export async function tryM5PlanRouteHandoff(opts: {
  rewritten: string;
  turnId: string;
  frame?: TurnFrame | null;
}): Promise<PipelineTurnResult | null> {
  try {
    const { shouldHandoffToTourModule } = await import(
      '../../tour/shouldHandoffTour'
    );
    if (
      shouldHandoffToTourModule(opts.rewritten) &&
      !frameOwnsDayPlan(opts.frame)
    ) {
      if (__DEV__) console.log('[m5] skip m5_plan handoff — tour wins');
      return null;
    }
    const { runPlanningModule } = await import(
      '../../planning/runPlanningModule'
    );
    await runPlanningModule({
      userText: opts.rewritten,
      turnId: opts.turnId,
      frame: opts.frame ?? null,
    });
    return emptyM5Result(opts.turnId);
  } catch {
    return null;
  }
}
