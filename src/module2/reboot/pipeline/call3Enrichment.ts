/**
 * Call 3 — async UI-first enrichment wenn Call-2-Tail followUp.delegateTo === call3.
 */

import type { AgentResult, Module2ActionButton, SynthesisPayload } from '../../types';
import type { Call2TailV1 } from './call2Tail';
import type { RucksackState } from '../../rucksack/rucksackStore';
import { runJobDeepFill } from '../../jobs/jobDeepFill';
import { judgeJobCompleteness } from '../../jobs';
import type { FindusJobId } from '../../jobs/types';
import { presentToUi } from '../../pipeline/presentToUi';
import {
  FINDUS_CALL3_RETHINK_ONCE,
  shouldRunCall3Rethink,
} from './call3Rethink';

export type Call3Input = {
  tail: Call2TailV1 | null;
  synthesis: SynthesisPayload;
  buttons: Module2ActionButton[];
  userText: string;
  fact: AgentResult;
  jobId: FindusJobId | string;
  rucksack: RucksackState;
  city?: string | null;
  lat: number;
  lng: number;
  signal?: AbortSignal;
};

export type Call3Result = {
  synthesis: SynthesisPayload;
  buttons: Module2ActionButton[];
  ran: boolean;
};

/** @deprecated use shouldRunCall3Rethink — Alias für bestehende Imports */
function shouldRunCall3(tail: Call2TailV1 | null): boolean {
  return shouldRunCall3Rethink(tail);
}

/** UI-first: Karte patchen; Speech nur wenn User idle. Max 1× Rethink. */
export async function maybeRunCall3Enrichment(
  input: Call3Input,
): Promise<Call3Result> {
  if (!shouldRunCall3(input.tail)) {
    return { synthesis: input.synthesis, buttons: input.buttons, ran: false };
  }
  if (input.signal?.aborted) {
    return { synthesis: input.synthesis, buttons: input.buttons, ran: false };
  }

  // Dokumentations-/Log-Anker (kein Prompt-Spam)
  void FINDUS_CALL3_RETHINK_ONCE;

  try {
    const { trackCall3Rate } = require('./turnLatencyMetrics') as {
      trackCall3Rate: () => void;
    };
    trackCall3Rate();
  } catch {
    /* soft */
  }

  const classification = {
    jobId: input.jobId as FindusJobId,
    contract: { agentIntent: input.jobId },
    confidence: 0.8,
  } as import('../../jobs/types').JobClassification;

  const completeness = judgeJobCompleteness({
    classification,
    speech: input.synthesis.fullDraftForUi,
    bullets: input.synthesis.bullets,
    buttons: input.buttons,
    meta: input.fact.meta ?? null,
    logic: {
      spokenDraft: input.synthesis.fullDraftForUi,
      bullets: input.synthesis.bullets,
      buttons: input.buttons,
      moneyEur: [],
      warnings: [],
    },
  });

  const deep = await runJobDeepFill({
    classification,
    report: completeness,
    userText: input.userText,
    rucksack: input.rucksack,
    alreadySaid: input.synthesis.fullDraftForUi,
    city: input.city ?? null,
    lat: input.lat,
    lng: input.lng,
    meta: input.fact.meta ?? null,
    signal: input.signal,
  });

  if (!deep.filled || !deep.agentResult.ok) {
    return { synthesis: input.synthesis, buttons: input.buttons, ran: true };
  }

  const extraButtons = (deep.agentResult.buttons ?? []).slice(0, 4);
  const mergedButtons = [...input.buttons, ...extraButtons].slice(0, 4);
  const mergedBullets = [
    ...input.synthesis.bullets,
    ...(deep.agentResult.bullets ?? []),
  ].slice(0, 3);

  const nextSynthesis: SynthesisPayload = {
    ...input.synthesis,
    bullets: mergedBullets,
    buttons: mergedButtons,
  };

  let speechIdle = true;
  try {
    const { useFinnusStore } = require('../../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { isAudiblySpeaking: boolean; isPlayingAudio: boolean };
      };
    };
    const s = useFinnusStore.getState();
    speechIdle = !s.isAudiblySpeaking && !s.isPlayingAudio;
  } catch {
    speechIdle = true;
  }

  const patchSpeech = deep.agentResult.draftText?.trim();
  if (patchSpeech) {
    await presentToUi(
      speechIdle
        ? `${input.synthesis.fullDraftForUi} ${patchSpeech}`.trim()
        : input.synthesis.fullDraftForUi,
      mergedBullets,
      mergedButtons,
      { userText: input.userText },
    );
    if (speechIdle && patchSpeech.length > 20) {
      try {
        const { enqueueSpeech } = require('../../speech/speechQueue') as {
          enqueueSpeech: (o: { kind: string; text: string; turnId: string }) => void;
        };
        enqueueSpeech({
          kind: 'main',
          text: patchSpeech.slice(0, 400),
          turnId: `call3_${Date.now()}`,
        });
      } catch {
        /* soft */
      }
    }
  }

  return {
    synthesis: nextSynthesis,
    buttons: mergedButtons,
    ran: true,
  };
}
