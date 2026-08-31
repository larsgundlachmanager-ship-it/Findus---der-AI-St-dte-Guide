/**
 * Flug-Advisor — früh im Turn, kein Fall-through in Chat/Plan/Synthese.
 */

import { synthesizeOutput } from '../../pipeline/synthesis';
import type { LogicNodeOutput, PipelineTurnResult } from '../../types';
import type { ManagerAnalysis } from '../types';

export async function tryFlightAdvisorHandoff(opts: {
  rewritten: string;
  turnId: string;
  turnCityKey: string | null;
  turnCityHint: string | null;
  analysis: ManagerAnalysis;
}): Promise<PipelineTurnResult | null> {
  try {
    const { clearCityPackOffer, clearLastLiveInventory } = await import(
      '../../context/shortTermContext'
    );
    clearCityPackOffer();
    try {
      clearLastLiveInventory();
    } catch {
      /* soft */
    }
  } catch {
    /* soft */
  }

  let flight: {
    speech: string;
    bullets?: string[];
    quickActions?: unknown[];
    cardTitle?: string | null;
    reopenMic?: boolean;
  } | null = null;

  try {
    const { prepareFlightTripFollowUp } = await import(
      '../../../services/flights/flightTripAdvisor'
    );
    const frame = opts.analysis.frame;
    const {
      resolveFrameDateKey,
      resolveFrameClockHm,
    } = await import('../turnFrame');
    const dateKey = resolveFrameDateKey(frame) ?? null;
    const clockHm = resolveFrameClockHm(frame) ?? null;
    // Live-Tafel früh vorwärmen (parallel zur Slot-Logik)
    try {
      const { warmOriginBoard } = await import(
        '../../../services/flights/originAirportBoard'
      );
      void warmOriginBoard({
        originIata: 'HAM',
        dateKey,
      });
    } catch {
      /* soft */
    }
    flight = await prepareFlightTripFollowUp(opts.rewritten, {
      dateKey,
      clockHm,
    });
  } catch (err) {
    console.warn('[flight] prepareFlightTripFollowUp failed', err);
    flight = null;
  }

  if (!flight?.speech?.trim()) {
    try {
      const { peekFlightBeat1Bridge } = await import(
        '../../../services/flights/flightTripAdvisor'
      );
      const { parseFlightTripSlots } = await import(
        '../../../services/flights/flightTripIntent'
      );
      const bridge =
        peekFlightBeat1Bridge(opts.rewritten) ||
        (() => {
          const dest = parseFlightTripSlots(opts.rewritten).destHint;
          return dest
            ? `${dest} — ich schau Abflug und Leave-by nach.`
            : 'Alles klar — ich schau deinen Flug nach.';
        })();
      flight = {
        speech: bridge,
        bullets: [],
        quickActions: [],
        reopenMic: true,
        cardTitle: 'Flug',
      };
    } catch {
      flight = {
        speech: 'Alles klar — ich schau deinen Flug nach.',
        bullets: [],
        quickActions: [],
        reopenMic: true,
        cardTitle: 'Flug',
      };
    }
  }

  const speech = flight.speech.trim();
  if (!speech) return null;

  try {
    const { presentConciergeResponse } = await import(
      '../../../services/concierge/presentConcierge'
    );
    await presentConciergeResponse(
      {
        speechText: speech,
        visualBullets: (flight.bullets ?? []).slice(0, 3),
        quickActions: (flight.quickActions ?? []).slice(0, 5) as never[],
        cardTitle: flight.cardTitle,
      },
      { userText: opts.rewritten, skipAutoNav: true },
    );
  } catch (err) {
    console.warn('[flight] presentConciergeResponse failed', err);
  }

  if (flight.reopenMic) {
    try {
      const { scheduleMicAfterDirectAsk } = require('../../../services/handsFree/scheduleMicAfterAsk') as {
        scheduleMicAfterDirectAsk: () => void;
      };
      scheduleMicAfterDirectAsk();
    } catch {
      /* soft */
    }
  }

  try {
    const { rememberTurnForChoices } = await import('../choiceTurnContext');
    rememberTurnForChoices({
      turnId: opts.turnId,
      userText: opts.rewritten,
      jobId: 'flight_trip',
      analysis: opts.analysis,
      speech,
      bullets: flight.bullets ?? [],
      cityKey: opts.turnCityKey,
      cityHint: opts.turnCityHint,
    });
  } catch {
    /* soft */
  }

  const logic: LogicNodeOutput = {
    spokenDraft: speech,
    bullets: (flight.bullets ?? []).slice(0, 3),
    buttons: [],
    moneyEur: [],
    warnings: [],
  };

  return {
    turnId: opts.turnId,
    tasks: [],
    bridgingText: null,
    logic,
    synthesis: synthesizeOutput(logic),
    deepResearchQueued: false,
    jobId: 'flight_trip',
  };
}
