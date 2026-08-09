/**
 * Findus Reboot Pipeline SSOT
 * User → Manager (sync) → Fact-Lane(s) → 1× Synthese → Speech/UI
 * + Completeness → pending Buttons → Deep-Fill (Slow-Lane)
 *
 * Kein LLM-Intent-Router, keine Regex-Override-Leiter, keine Doppel-Bridge.
 */

import type {
  LogicNodeOutput,
  PipelineTask,
  PipelineTurnInput,
  PipelineTurnResult,
  SynthesisPayload,
} from '../types';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import { isRucksackOffline, offlineLogicFallback } from '../safety/offlineGate';
import { rewriteQuery } from '../pipeline/queryRewriter';
import { synthesizeOutput } from '../pipeline/synthesis';
import { presentToUi } from '../pipeline/presentToUi';
import { enqueueSpeech } from '../speech/speechQueue';
import {
  noteUserUtterance,
  getShortTerm,
  setLastPlaceName,
  setLastTopic,
} from '../context/shortTermContext';
import {
  loadConversationThreads,
  routeConversationTopic,
  commitThreadTurn,
} from '../../services/memory/conversationThreads';
import {
  classifyJob,
  getJobContract,
  judgeJobCompleteness,
  pendingButtonsFromReport,
} from '../jobs';
import { shouldForceDeepFill, runJobDeepFill } from '../jobs/jobDeepFill';
import { buildManagerTurn, shouldSuppressBridge } from './managerTurn';
import { runFactLanes } from './factLaneRegistry';
import { synthesizeRebootTurn } from './synthesizeReboot';
import { runLogicNode } from '../pipeline/logicNode';
import {
  extractMoreHistoryTopic,
  isMoreHistoryUtterance,
} from './packMatchFacts';
import { buildRebootBoardHints } from './rebootActionHints';
import { useFinnusStore } from '../../store/useFinnusStore';

export async function runRebootPipeline(
  input: PipelineTurnInput,
): Promise<PipelineTurnResult> {
  const turnId = input.turnId;
  const signal = input.signal;

  if (isRucksackOffline()) {
    const logic = offlineLogicFallback();
    const synthesis = synthesizeOutput(logic);
    presentToUi(synthesis.fullDraftForUi, synthesis.bullets, synthesis.buttons);
    enqueueSpeech({
      kind: 'main',
      text: synthesis.spokenChunks.join(' '),
      turnId,
    });
    return {
      turnId,
      tasks: [],
      bridgingText: null,
      logic,
      synthesis,
      deepResearchQueued: false,
    };
  }

  await loadConversationThreads();
  const rucksack = readRucksackSync();
  const short = getShortTerm();
  noteUserUtterance(input.userText);
  const { rewritten } = rewriteQuery(input.userText, {
    lastPlaceName: short.lastPlaceName,
    lastTopic: short.lastTopic,
  });

  const jobClass = classifyJob(rewritten);
  const topicDecision = routeConversationTopic({
    userText: rewritten,
    intent: jobClass.contract.agentIntent,
    subject: null,
    cityHint: short.lastMentionedCity,
  });

  let subject: string | null = null;
  if (
    topicDecision.mode === 'continue' ||
    topicDecision.mode === 'resume'
  ) {
    subject =
      topicDecision.thread.entities.subject ||
      topicDecision.thread.entities.place ||
      null;
  }
  if (isMoreHistoryUtterance(rewritten)) {
    subject =
      extractMoreHistoryTopic(rewritten) ||
      subject ||
      short.lastPlaceName ||
      null;
  }

  const manager = buildManagerTurn({
    jobClass,
    topic: topicDecision,
    userText: rewritten,
    earlyBridgeLine: null,
  });

  let bridgingText: string | null = null;
  const suppress = shouldSuppressBridge({
    topicMode: topicDecision.mode,
    jobId: jobClass.jobId,
    userText: rewritten,
  });
  if (!suppress && manager.bridgeOneLiner) {
    bridgingText = manager.bridgeOneLiner;
  } else if (!suppress && jobClass.confidence >= 0.55) {
    try {
      const { bridgeLineForJob } = await import('../jobs/bridgeForJob');
      bridgingText = bridgeLineForJob(jobClass, rewritten).trim() || null;
    } catch {
      bridgingText = null;
    }
  }
  if (bridgingText) {
    enqueueSpeech({ kind: 'bridging', text: bridgingText, turnId });
  }

  const { result: fact } = await runFactLanes({
    userText: rewritten,
    jobId: jobClass.jobId,
    secondaryJobIds: jobClass.secondaryJobIds,
    thinkAhead: manager.thinkAhead,
    rucksack,
    subject,
    city: short.lastMentionedCity,
    signal,
  });

  const emptyLogic = (): LogicNodeOutput => ({
    spokenDraft: '',
    bullets: [],
    buttons: [],
    moneyEur: [],
    warnings: [],
  });

  if (signal?.aborted) {
    const logic = emptyLogic();
    const synthesis = synthesizeOutput(logic);
    return {
      turnId,
      tasks: [],
      bridgingText,
      logic,
      synthesis,
      deepResearchQueued: false,
      jobId: jobClass.jobId,
    };
  }

  const task: PipelineTask = {
    id: `reboot_${jobClass.jobId}`,
    rawText: input.userText,
    rewrittenText: rewritten,
    intent: jobClass.contract.agentIntent,
    priority: 1,
    subject,
    city: short.lastMentionedCity,
    jobId: jobClass.jobId,
    commitment: jobClass.commitment,
    mustHaves: jobClass.mustHaves,
  };

  const logic = runLogicNode({
    results: [fact],
    futurePlan: rucksack.futurePlan,
  });

  const skipLlm =
    fact.meta?.amenityNav === true ||
    fact.meta?.parkingCare === true ||
    fact.meta?.comboCluster === true ||
    fact.meta?.hourTour === true ||
    fact.agent === 'system' ||
    fact.meta?.handsFree != null ||
    fact.meta?.flashlight != null ||
    fact.meta?.voiceId != null;

  let synthesis: SynthesisPayload;
  if (skipLlm) {
    synthesis = synthesizeOutput(logic);
  } else {
    const budgetHint =
      typeof fact.meta?.speechBudgetHint === 'number'
        ? fact.meta.speechBudgetHint
        : getJobContract(jobClass.jobId).speechBudgetChars;
    synthesis = await synthesizeRebootTurn({
      userText: rewritten,
      fact,
      bridgeOneLiner: bridgingText,
      jobId: jobClass.jobId,
      speechBudgetChars: budgetHint,
      signal,
    });
  }

  let buttons =
    synthesis.buttons.length > 0 ? synthesis.buttons : logic.buttons;

  const completeness = judgeJobCompleteness({
    classification: jobClass,
    speech: synthesis.fullDraftForUi,
    bullets: synthesis.bullets,
    buttons,
    meta: fact.meta ?? null,
    logic,
  });
  const pendingBtns = completeness.pendingActionHints.length
    ? pendingButtonsFromReport(completeness)
    : [];
  if (pendingBtns.length) {
    buttons = [...buttons, ...pendingBtns].slice(0, 4);
  }

  const forceAutoNav =
    fact.meta?.autoStartNav === true ||
    (fact.meta?.amenityNav === true && fact.meta?.unique === true);
  const seedDistanceM =
    typeof fact.meta?.distanceM === 'number' ? fact.meta.distanceM : null;
  const board = buildRebootBoardHints(fact);
  const startActionDeep =
    (board.wantDeepLinks || pendingBtns.length > 0) &&
    fact.meta?.amenityNav !== true &&
    fact.meta?.parkingCare !== true;

  presentToUi(synthesis.fullDraftForUi, synthesis.bullets, buttons, {
    userText: rewritten,
    forceAutoNav,
    seedDistanceM,
    boardEntities: board.entities,
    boardModule1: board.module1,
    startActionDeep,
  });

  enqueueSpeech({
    kind: 'main',
    text: synthesis.spokenChunks.join(' ') || synthesis.fullDraftForUi,
    turnId,
  });

  const placeName =
    (typeof fact.meta?.placeName === 'string' && fact.meta.placeName) ||
    (typeof fact.meta?.destName === 'string' && fact.meta.destName) ||
    subject;
  if (placeName) setLastPlaceName(placeName);
  setLastTopic(topicDecision.thread.label);

  try {
    commitThreadTurn({
      userText: rewritten,
      assistantSpeech: synthesis.fullDraftForUi,
      intent: jobClass.contract.agentIntent,
      subject: placeName,
      cityHint: short.lastMentionedCity,
      saidFactLines: synthesis.bullets,
    });
  } catch {
    /* soft */
  }

  let deepResearchQueued = false;
  let skipDeepForLiveChat = false;
  try {
    const { isLiveChatActive } = await import(
      '../../services/handsFree/liveChatSession'
    );
    const { getHandsFreePrefsSync } = await import(
      '../../services/handsFree/handsFreePrefs'
    );
    skipDeepForLiveChat =
      isLiveChatActive() && getHandsFreePrefsSync().askBeforeDeepResearch;
  } catch {
    skipDeepForLiveChat = false;
  }
  if (
    shouldForceDeepFill(completeness) &&
    !signal?.aborted &&
    !skipDeepForLiveChat
  ) {
    deepResearchQueued = true;
    const a = anchorCoords(rucksack);
    void runJobDeepFill({
      classification: jobClass,
      report: completeness,
      userText: rewritten,
      rucksack,
      alreadySaid: synthesis.fullDraftForUi,
      city: short.lastMentionedCity,
      lat: a.lat,
      lng: a.lng,
      meta: fact.meta ?? null,
      signal,
    })
      .then(async (fill) => {
        if (!fill.filled || !fill.agentResult.ok) return;
        const extraButtons = fill.agentResult.buttons ?? [];
        if (!extraButtons.length && !fill.agentResult.draftText?.trim()) {
          return;
        }
        // Slow-Lane: Card-Buttons nachziehen, kein zweites Main-Speech
        try {
          const store = useFinnusStore.getState();
          const card = store.activeConciergeCard;
          if (!card) return;
          const { presentToUi: present } = await import(
            '../pipeline/presentToUi'
          );
          const mergedBtns = [
            ...buttons,
            ...extraButtons,
          ].slice(0, 4);
          const appendSpeech =
            fill.agentResult.draftText?.trim() &&
            fill.agentResult.draftText.length < 280 &&
            !/silent|pending/i.test(String(fill.agentResult.meta?.reason ?? ''))
              ? `${card.speechText}\n\n${fill.agentResult.draftText.trim()}`
              : card.speechText;
          present(appendSpeech, card.visualBullets ?? synthesis.bullets, mergedBtns, {
            userText: rewritten,
            forceAutoNav: false,
            startActionDeep: true,
            boardEntities: board.entities,
            boardModule1: board.module1,
          });
        } catch {
          /* soft */
        }
      })
      .catch(() => {
        /* soft */
      });
  }

  // Gastro Speisekarte Slow-Lane (wenn Venues ohne Menu)
  if (
    !deepResearchQueued &&
    (jobClass.jobId === 'dining_open' ||
      jobClass.jobId === 'dining_hard_match') &&
    Array.isArray(fact.meta?.venues)
  ) {
    const venues = fact.meta.venues as Array<{
      name: string;
      websiteUrl?: string | null;
      menuUrl?: string | null;
    }>;
    if (venues.length && venues.some((v) => !v.menuUrl)) {
      deepResearchQueued = true;
      void import('../agents/gastroMenuDeepResearch')
        .then(({ runGastroMenuDeepResearch }) =>
          runGastroMenuDeepResearch({
            userText: rewritten,
            venues,
            alreadySaid: synthesis.fullDraftForUi,
            signal,
          }),
        )
        .then(async (deep) => {
          if (!deep?.ok || !deep.buttons?.length) return;
          const store = useFinnusStore.getState();
          const card = store.activeConciergeCard;
          if (!card) return;
          const { presentToUi: present } = await import(
            '../pipeline/presentToUi'
          );
          present(
            card.speechText,
            card.visualBullets ?? [],
            [...buttons, ...deep.buttons].slice(0, 4),
            { userText: rewritten, startActionDeep: false },
          );
        })
        .catch(() => {
          /* soft */
        });
    }
  }

  return {
    turnId,
    tasks: [task],
    bridgingText,
    logic: { ...logic, spokenDraft: synthesis.fullDraftForUi, buttons },
    synthesis: { ...synthesis, buttons },
    deepResearchQueued,
    jobId: jobClass.jobId,
    jobCompletenessOk: completeness.ok,
  };
}
