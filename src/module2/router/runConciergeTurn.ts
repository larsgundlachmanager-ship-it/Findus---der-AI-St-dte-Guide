/**
 * Concierge turn — Manager → Fanout → Synthese (Reboot-Pipeline-Kern).
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
  commitThreadTurn,
  getForegroundThread,
} from '../../services/memory/conversationThreads';
import {
  classifyJob,
  getJobContract,
  judgeJobCompleteness,
  pendingButtonsFromReport,
} from '../jobs';
import { shouldForceDeepFill, runJobDeepFill } from '../jobs/jobDeepFill';
import { synthesizeRebootTurn } from '../reboot/synthesizeReboot';
import { runLogicNode } from '../pipeline/logicNode';
import {
  extractMoreHistoryTopic,
  isMoreHistoryUtterance,
} from '../reboot/packMatchFacts';
import { buildRebootBoardHints } from '../reboot/rebootActionHints';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  analyzeManagerTurn,
  enrichAnalysisWithBlueprint,
} from './analyzeTurn';
import { takeManagerWarmupIfMatch } from './managerWarmup';
import {
  applyManagerSession,
  mergeCorrectionUtterance,
} from './applySession';
import {
  runManagerTaskFanout,
  runSilentSlowTasks,
} from './runManagerTasks';
import { resolveHandoff, buildM1PoiOffer } from './handoffs';
import { composeBlueprintOnMiss } from '../blueprints/registry';
import { composeEphemeralLogged } from '../blueprints/staging';
import { clipBridgeToWordLimit } from './paceBudget';
import type { ManagerAnalysis } from './types';

async function speakBridgeFromAnalysis(
  analysis: ManagerAnalysis,
  turnId: string,
): Promise<{ text: string | null; alreadySpoken: boolean }> {
  let bridge = analysis.bridge;
  if (!bridge) return { text: null, alreadySpoken: false };
  bridge = clipBridgeToWordLimit(bridge, analysis.bridgeMaxWords);
  if (!bridge) return { text: null, alreadySpoken: false };

  // Spoken-slow latency may already be in bridge from manager
  try {
    const { speakRuntimeText } = await import('../../runtime/speechModule');
    const { getVoiceSettingsForTour } = await import(
      '../../services/ttsService'
    );
    const voice = await getVoiceSettingsForTour();
    const started = Date.now();
    void speakRuntimeText(
      bridge,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { priority: 'system', deliveryKind: 'assistant' },
    ).then(() => {
      try {
        const { noteBridgeCalibration } = require('./paceBudget') as {
          noteBridgeCalibration: (w: number, ms: number) => void;
        };
        noteBridgeCalibration(bridge!.split(/\s+/).length, Date.now() - started);
      } catch {
        /* soft */
      }
    });
  } catch {
    /* soft */
  }

  enqueueSpeech({
    kind: 'bridging',
    text: bridge,
    turnId,
    alreadySpoken: true,
  });
  return { text: bridge, alreadySpoken: true };
}

export async function runConciergeTurn(
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

  const prevFg = getForegroundThread();
  const correction = mergeCorrectionUtterance({
    previousUserText: prevFg?.lastUserText,
    newUserText: input.userText,
  });
  const rawForRewrite = correction.mergedUserText;

  const { rewritten } = rewriteQuery(rawForRewrite, {
    lastPlaceName: short.lastPlaceName,
    lastTopic: short.lastTopic,
  });

  // Modul-1 POI-Chat follow-up (existing)
  try {
    const {
      ensureModule1PoiChatHydrated,
      getActiveModule1PoiChat,
      module1FollowupFitsChat,
      generateModule1ChatTurn,
    } = await import('../../services/ai/module1PoiChat');
    await ensureModule1PoiChatHydrated();
    const m1Session = getActiveModule1PoiChat();
    if (module1FollowupFitsChat(rewritten, m1Session) && m1Session) {
      const { getPoiWithFacts } = await import('../../db/database');
      const poi = await getPoiWithFacts(m1Session.poiId);
      if (poi) {
        const chat = await generateModule1ChatTurn({
          poi,
          mode: 'followup',
          userQuestion: rewritten,
        });
        const text = chat.text.trim();
        if (text) {
          presentToUi(text, [], []);
          enqueueSpeech({ kind: 'main', text, turnId });
          const logic: LogicNodeOutput = {
            spokenDraft: text,
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
          };
        }
      }
    }
  } catch {
    /* soft */
  }

  try {
    const {
      detectTravelModeVoiceOverride,
      forceBikeModeFromVoice,
      setPreferredTravelMode,
    } = await import('../../services/navigation/travelModeContext');
    const mode = detectTravelModeVoiceOverride(rewritten);
    if (mode === 'bike') forceBikeModeFromVoice();
    else if (mode === 'foot') setPreferredTravelMode('foot');
  } catch {
    /* soft */
  }

  const navActive = Boolean(useFinnusStore.getState().navActive);
  let calendarOpen = false;
  try {
    const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
    };
    calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  } catch {
    calendarOpen = false;
  }

  let analysis =
    (await takeManagerWarmupIfMatch(rewritten)) ||
    (await analyzeManagerTurn({
      userText: rewritten,
      cityHint: short.lastMentionedCity,
      navActive,
      calendarOpen,
      signal,
    }));
  analysis = enrichAnalysisWithBlueprint(analysis);
  if (correction.isCorrection) {
    analysis = { ...analysis, session: 'continue', isCorrection: true };
  }

  if (!analysis.blueprintId && analysis.route === 'blueprint') {
    const composed = composeBlueprintOnMiss({ userText: rewritten });
    composeEphemeralLogged(composed);
    analysis = enrichAnalysisWithBlueprint({
      ...analysis,
      blueprintId: composed.id,
      blueprintStage: composed.stage,
    });
  }

  const topicDecision = applyManagerSession({
    analysis,
    userText: rewritten,
    intent: analysis.jobHint,
    cityHint: short.lastMentionedCity,
  });

  let subject =
    analysis.subject ||
    (topicDecision.mode === 'continue' || topicDecision.mode === 'resume'
      ? topicDecision.thread.entities.subject ||
        topicDecision.thread.entities.place ||
        null
      : null);
  if (isMoreHistoryUtterance(rewritten)) {
    subject =
      extractMoreHistoryTopic(rewritten) ||
      subject ||
      short.lastPlaceName ||
      null;
  }

  const handoff = resolveHandoff(analysis);

  // --- Handoffs ---
  if (handoff === 'm5_plan') {
    try {
      const { runPlanningModule } = await import('../planning/runPlanningModule');
      await runPlanningModule({ userText: rewritten, turnId });
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
    } catch {
      /* fall through to blueprint */
    }
  }

  // Auswahl-Pitch (M2): zwei Optionen — Parent-Bridge + Pitch-Modul
  try {
    const { shouldHandoffToPitchModule } = await import(
      '../pitch/shouldHandoffPitch'
    );
    if (handoff === 'none' && shouldHandoffToPitchModule(rewritten)) {
      try {
        const { useLivePitchStore } = await import('../pitch/publishPitchUi');
        useLivePitchStore.getState().clear();
      } catch {
        /* soft */
      }
      const { buildPitchRequestFromText } = await import(
        '../pitch/buildPitchRequest'
      );
      const { runPitchModule } = await import('../pitch/runPitchModule');
      const { request, bridge } = buildPitchRequestFromText({
        text: rewritten,
        requestId: `m2_${turnId}`,
        uiLayout: calendarOpen ? 'timeline_stack' : 'live_split',
        signal,
      });
      if (bridge) {
        enqueueSpeech({
          kind: 'bridging',
          text: bridge,
          turnId,
          alreadySpoken: false,
        });
        try {
          const { speakRuntimeText } = await import('../../runtime/speechModule');
          const { getVoiceSettingsForTour } = await import(
            '../../services/ttsService'
          );
          const voice = await getVoiceSettingsForTour();
          void speakRuntimeText(
            bridge,
            { voiceId: voice.voiceId, speechRate: voice.speechRate },
            { priority: 'system', deliveryKind: 'assistant' },
          );
        } catch {
          /* soft */
        }
      }
      const result = await runPitchModule(request);
      presentToUi(
        result.spokenText,
        result.options.flatMap((o) => o.bullets).slice(0, 6),
        [],
      );
      enqueueSpeech({
        kind: 'main',
        text: result.spokenText,
        turnId,
      });
      const logic: LogicNodeOutput = {
        spokenDraft: result.spokenText,
        bullets: result.options.flatMap((o) => o.bullets).slice(0, 6),
        buttons: [],
        moneyEur: [],
        warnings: result.softFail ? ['soft_fail'] : [],
      };
      return {
        turnId,
        tasks: [],
        bridgingText: bridge,
        logic,
        synthesis: synthesizeOutput(logic),
        deepResearchQueued: true,
        jobId: 'dining_hard_match',
      };
    }
  } catch {
    /* fall through */
  }

  if (handoff === 'memory') {
    try {
      const { handleMemoryIntent } = await import(
        '../../services/intentService'
      );
      const intent = await handleMemoryIntent(rewritten);
      if (intent.handled && (intent.reply || intent.concierge)) {
        const text =
          intent.concierge?.speechText || intent.reply || '';
        if (text) {
          presentToUi(text, intent.concierge?.visualBullets ?? [], []);
          enqueueSpeech({ kind: 'main', text, turnId });
          const logic: LogicNodeOutput = {
            spokenDraft: text,
            bullets: intent.concierge?.visualBullets ?? [],
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
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (handoff === 'm1_poi_offer') {
    const { text: bridge } = await speakBridgeFromAnalysis(analysis, turnId);
    const coords = anchorCoords(rucksack);
    const offer = await buildM1PoiOffer({
      userText: rewritten,
      lat: coords.lat,
      lng: coords.lng,
      headingDeg: null,
    });
    presentToUi(offer.speech, offer.placeName ? [offer.placeName] : [], [], {
      userText: rewritten,
    });
    enqueueSpeech({ kind: 'main', text: offer.speech, turnId });
    if (!offer.poiId) {
      void import('../packEnrich/queuePackEnrich')
        .then((m) =>
          m.queuePackEnrichFromMiss({
            userText: rewritten,
            lat: coords.lat,
            lng: coords.lng,
          }),
        )
        .catch(() => undefined);
    }
    const logic: LogicNodeOutput = {
      spokenDraft: offer.speech,
      bullets: offer.placeName ? [offer.placeName] : [],
      buttons: [],
      moneyEur: [],
      warnings: [],
    };
    return {
      turnId,
      tasks: [],
      bridgingText: bridge,
      logic,
      synthesis: synthesizeOutput(logic),
      deepResearchQueued: false,
      jobId: 'poi_identify',
    };
  }

  const { text: bridgingText } = await speakBridgeFromAnalysis(
    analysis,
    turnId,
  );

  const bridgeOnce = bridgingText;

  const fanout = await runManagerTaskFanout({
    analysis,
    userText: rewritten,
    rucksack,
    subject,
    city: short.lastMentionedCity,
    signal,
  });

  if (fanout.silentSlowPending.length) {
    void runSilentSlowTasks({
      tasks: fanout.silentSlowPending,
      analysis,
      userText: rewritten,
      rucksack,
      subject,
      city: short.lastMentionedCity,
      signal,
    }).catch(() => undefined);
  }

  let fact = fanout.mergedFact;
  if (
    analysis.lanePlan === 'fast_then_spoken_slow' &&
    fanout.spokenSlowPending.length
  ) {
    void runSilentSlowTasks({
      tasks: fanout.spokenSlowPending,
      analysis,
      userText: rewritten,
      rucksack,
      subject,
      city: short.lastMentionedCity,
      signal,
    })
      .then((slowResults) => {
        const extra = slowResults
          .filter((r) => r.status === 'ok' && r.draftText)
          .map((r) => r.draftText)
          .join(' ')
          .slice(0, 400);
        if (extra) {
          enqueueSpeech({
            kind: 'main',
            text: extra,
            turnId: `${turnId}_slow`,
          });
          return;
        }
        if (fanout.spokenSlowPending.some((t) => t.lane === 'instagram')) {
          enqueueSpeech({
            kind: 'main',
            text: 'Im Web war wenig Brauchbares — ich schau noch auf Instagram nach öffentlichen Posts.',
            turnId: `${turnId}_ig`,
          });
        }
      })
      .catch(() => undefined);
  }

  if (signal?.aborted) {
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
      bridgingText: bridgeOnce,
      logic,
      synthesis: synthesizeOutput(logic),
      deepResearchQueued: false,
    };
  }

  const jobClass = classifyJob(rewritten);
  const jobId = jobClass.jobId;

  const task: PipelineTask = {
    id: `mgr_${jobId}`,
    rawText: input.userText,
    rewrittenText: rewritten,
    intent: jobClass.contract.agentIntent,
    priority: 1,
    subject,
    city: short.lastMentionedCity,
    jobId,
    commitment: jobClass.commitment,
    mustHaves: jobClass.mustHaves,
  };

  if (handoff === 'm3_nav_start') {
    fact = {
      ...fact,
      meta: { ...fact.meta, autoStartNav: true, forceAutoNav: true },
    };
  }

  const logic = runLogicNode({
    results: [fact],
    futurePlan: rucksack.futurePlan,
  });

  const skipLlm =
    fact.meta?.amenityNav === true ||
    fact.meta?.parkingCare === true ||
    fact.meta?.pitchModule === true ||
    fact.agent === 'system';

  let synthesis: SynthesisPayload;
  if (fact.meta?.pitchModule === true) {
    const spoken = logic.spokenDraft || fact.draftText || '';
    const { chunkTextForTts } = await import('../speech/ttsChunker');
    synthesis = {
      spokenChunks: chunkTextForTts(spoken),
      bullets: (fact.bullets ?? logic.bullets ?? []).slice(0, 6),
      buttons: [],
      fullDraftForUi: spoken,
    };
  } else if (skipLlm) {
    synthesis = synthesizeOutput(logic);
  } else {
    synthesis = await synthesizeRebootTurn({
      userText: rewritten,
      fact,
      bridgeOneLiner: bridgeOnce,
      jobId,
      speechBudgetChars: getJobContract(jobId).speechBudgetChars,
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
    handoff === 'm3_nav_start' ||
    fact.meta?.autoStartNav === true ||
    (fact.meta?.amenityNav === true && fact.meta?.unique === true);
  const seedDistanceM =
    typeof fact.meta?.distanceM === 'number' ? fact.meta.distanceM : null;
  const board = buildRebootBoardHints(fact);
  const startActionDeep =
    (board.wantDeepLinks || pendingBtns.length > 0) &&
    fact.meta?.amenityNav !== true;

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
    subject;
  if (placeName) setLastPlaceName(placeName);
  setLastTopic(topicDecision.thread.label || analysis.subject || jobId);

  try {
    commitThreadTurn({
      userText: rewritten,
      assistantSpeech: synthesis.fullDraftForUi,
      intent: jobClass.contract.agentIntent,
      subject: placeName,
      cityHint: short.lastMentionedCity,
      saidFactLines: synthesis.bullets,
      openLoop: analysis.openLoops[0] ?? null,
    });
  } catch {
    /* soft */
  }

  let deepResearchQueued = false;
  if (
    shouldForceDeepFill(completeness) ||
    fanout.silentSlowPending.length > 0
  ) {
    deepResearchQueued = true;
    const coords = anchorCoords(rucksack);
    void runJobDeepFill({
      classification: jobClass,
      report: completeness,
      userText: rewritten,
      rucksack,
      alreadySaid: synthesis.fullDraftForUi,
      city: short.lastMentionedCity,
      lat: coords.lat,
      lng: coords.lng,
      meta: fact.meta,
      signal,
    }).catch(() => undefined);
  }

  return {
    turnId,
    tasks: [task],
    bridgingText: bridgeOnce,
    logic,
    synthesis: { ...synthesis, buttons },
    deepResearchQueued,
    jobId,
    jobCompletenessOk: completeness.ok,
  };
}
