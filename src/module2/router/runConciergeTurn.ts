/**
 * Concierge turn — Manager → Fanout → Synthese (Reboot-Pipeline-Kern).
 */

import type {
  AgentResult,
  LogicNodeOutput,
  PipelineTask,
  PipelineTurnInput,
  PipelineTurnResult,
  SynthesisPayload,
} from '../types';
import { readRucksackSync, anchorCoords } from '../rucksack/rucksackStore';
import { synthesizeOutput } from '../pipeline/synthesis';
import { presentToUi } from '../pipeline/presentToUi';
import { enqueueSpeech } from '../speech/speechQueue';
import {
  beginFusedTurnSpeech,
  drainFusedEnqueue,
  endFusedTurnSpeech,
  getFusedTurnPump,
  stripLeadingBridgeEcho,
} from '../speech/fusedTurnSpeech';
import {
  createLiveSentencePump,
  remainingSpeechAfterLead,
} from '../../services/audio/liveSentencePump';
import { startLiveSpeechSession } from './runConciergeTurnSpeech';
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
import { tryM5PlanRouteHandoff } from './handoffs/m5Early';
import { clipBridgeToWordLimit } from './paceBudget';
import { shouldSuppressBridge } from '../reboot/managerTurn';
import type { ManagerAnalysis } from './types';
import {
  seedIntentQueue,
  completeActiveIntent,
  summarizeOpenIntents,
  hasPendingIntents,
} from './intentQueue';
import { runChatLane } from '../chat/runChatLane';
import { presentChatLaneResult } from '../chat/presentChatLane';
import {
  detectLiveInventoryKind,
  rememberLiveInventoryQuery,
  resolveLiveInventoryUserText,
} from './liveInventoryGate';

async function speakBridgeFromAnalysis(
  analysis: ManagerAnalysis,
  turnId: string,
  userText?: string,
  topicMode?: 'new' | 'continue' | 'resume' | 'parallel' | null,
): Promise<{ text: string | null; alreadySpoken: boolean }> {
  if (
    shouldSuppressBridge({
      topicMode: topicMode ?? analysis.session,
      jobId: analysis.jobHint || '',
      userText: userText || '',
    })
  ) {
    return { text: null, alreadySpoken: false };
  }
  let bridge = analysis.bridge;
  if (!bridge) return { text: null, alreadySpoken: false };
  try {
    const { speechInventedAirportLead } = require('../../services/flights/flightTripIntent') as {
      speechInventedAirportLead: (s: string) => boolean;
    };
    const { frameHasWorker } = require('./turnFrame') as {
      frameHasWorker: (f: ManagerAnalysis['frame'], w: 'flight') => boolean;
    };
    if (
      (frameHasWorker(analysis.frame, 'flight') ||
        analysis.jobHint === 'flight_trip') &&
      speechInventedAirportLead(bridge)
    ) {
      return { text: null, alreadySpoken: false };
    }
    const { speechFlightTourismOnlyBridge, isFlightTripQuery } = require('../../services/flights/flightTripIntent') as {
      speechFlightTourismOnlyBridge: (s: string) => boolean;
      isFlightTripQuery: (s: string) => boolean;
    };
    const { peekFlightBeat1Bridge } = require('../../services/flights/flightTripAdvisor') as {
      peekFlightBeat1Bridge: (s: string) => string | null;
    };
    const { hasFlightTripSession } = require('../../services/flights/flightTripSession') as {
      hasFlightTripSession: () => boolean;
    };
    const flightFrame =
      frameHasWorker(analysis.frame, 'flight') ||
      analysis.jobHint === 'flight_trip' ||
      isFlightTripQuery(userText || '') ||
      hasFlightTripSession();
    if (flightFrame) {
      if (speechFlightTourismOnlyBridge(bridge)) {
        bridge = peekFlightBeat1Bridge(userText || '') || null;
      }
      if (!bridge?.trim()) {
        bridge = peekFlightBeat1Bridge(userText || '');
      }
      if (!bridge?.trim()) {
        return { text: null, alreadySpoken: false };
      }
    }
  } catch {
    /* soft */
  }
  bridge = clipBridgeToWordLimit(bridge, analysis.bridgeMaxWords);
  const spoken = await speakModuleWaitBridge(bridge, turnId);
  return { text: spoken, alreadySpoken: Boolean(spoken) };
}

/** Ein Wait-Ack pro Turn — nie Sofort-Floskel + „kurz Geduld“ + Queue-Replay. */
async function speakModuleWaitBridge(
  line: string | null | undefined,
  turnId: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  let t = (line || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  try {
    const { sanitizeBridgeText } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
    };
    t = sanitizeBridgeText(t) || '';
  } catch {
    /* soft */
  }
  if (!t) return null;

  let pumpStarted = false;
  try {
    const { getFusedTurnPump } = require('../speech/fusedTurnSpeech') as {
      getFusedTurnPump: () => { hasStarted: () => boolean };
    };
    pumpStarted = getFusedTurnPump().hasStarted();
  } catch {
    pumpStarted = false;
  }

  // Dedup nur wenn diese Turn-Session schon TTS hat — sonst Stille bis Call 2.
  if (!opts?.force && !pumpStarted) {
    /* kein Skip wegen Fremd-Ack */
  } else if (!opts?.force) {
    try {
      const {
        getLastBridgeLine,
        isBridgeAlreadySpoken,
      } = require('../../services/speech/contextualBridge') as {
        getLastBridgeLine: () => string | null;
        isBridgeAlreadySpoken: (line?: string | null) => boolean;
      };
      const last = getLastBridgeLine();
      if (isBridgeAlreadySpoken(t) || isBridgeAlreadySpoken(last)) {
        return last || t;
      }
      if (last && last.length >= 8) {
        const {
          hadRecentLatencyAck,
        } = require('../../services/speech/floskelEngine') as {
          hadRecentLatencyAck: (ms?: number) => boolean;
        };
        if (hadRecentLatencyAck(12_000)) return last;
      }
    } catch {
      /* soft */
    }

    try {
      const { hadRecentLatencyAck } = require('../../services/speech/floskelEngine') as {
        hadRecentLatencyAck: (ms?: number) => boolean;
      };
      if (hadRecentLatencyAck(12_000)) {
        try {
          const { getLastBridgeLine } = require('../../services/speech/contextualBridge') as {
            getLastBridgeLine: () => string | null;
          };
          return getLastBridgeLine() || t;
        } catch {
          return t;
        }
      }
    } catch {
      /* soft */
    }
  }

  let enqueued = false;
  try {
    const { fusedEnqueue } = require('../speech/fusedTurnSpeech') as {
      fusedEnqueue: (o: {
        kind: 'bridging' | 'main';
        text: string;
        turnId: string;
      }) => Promise<boolean>;
    };
    enqueued = await fusedEnqueue({ kind: 'bridging', text: t, turnId });
  } catch {
    enqueueSpeech({
      kind: 'bridging',
      text: t,
      turnId,
      alreadySpoken: false,
    });
    enqueued = true;
  }

  if (!enqueued) return null;

  // Ack erst NACH echtem Enqueue — sonst skippt die Safety-Bridge und es bleibt still.
  try {
    const { noteLatencyAck } = require('../../services/speech/floskelEngine') as {
      noteLatencyAck: (p?: string | null) => void;
    };
    noteLatencyAck(t);
  } catch {
    /* soft */
  }
  try {
    const { rememberSpokenBridgeLine } = require('../../services/speech/contextualBridge') as {
      rememberSpokenBridgeLine?: (s: string) => void;
    };
    rememberSpokenBridgeLine?.(t);
  } catch {
    /* soft */
  }
  try {
    const { noteFindusSpokenForEcho } = require('../../services/handsFree/echoGuard') as {
      noteFindusSpokenForEcho: (s: string) => void;
    };
    noteFindusSpokenForEcho(t);
  } catch {
    /* soft */
  }
  return t;
}

/** Haupt-Speech darf Wait-Bridge nicht wiederholen. */
export { stripLeadingBridgeEcho } from '../speech/fusedTurnSpeech';

function resolveHandoffIntro(analysis: ManagerAnalysis): string | null {
  const fromMgr = (analysis.bridge || '').replace(/\s+/g, ' ').trim();
  if (fromMgr.length >= 8) return fromMgr;
  try {
    const { getLastBridgeLine } = require('../../services/speech/contextualBridge') as {
      getLastBridgeLine: () => string | null;
    };
    const last = (getLastBridgeLine() || '').replace(/\s+/g, ' ').trim();
    return last.length >= 8 ? last : null;
  } catch {
    return null;
  }
}

async function speakHandoffIntro(opts: {
  analysis: ManagerAnalysis;
  userText: string;
  turnId: string;
}): Promise<string | null> {
  // Early Floskel/Stream-Bridge schon draußen → keine zweite Wait-Bridge.
  if (opts.analysis.bridgeSpokenEarly) {
    return resolveHandoffIntro(opts.analysis);
  }
  const intro = resolveHandoffIntro(opts.analysis);
  return speakModuleWaitBridge(intro, opts.turnId);
}

export async function runConciergeTurn(
  input: PipelineTurnInput,
): Promise<PipelineTurnResult> {
  beginFusedTurnSpeech(input.turnId);
  try {
    return await runConciergeTurnBody(input);
  } finally {
    try {
      await drainFusedEnqueue();
    } catch {
      /* soft */
    }
    endFusedTurnSpeech();
  }
}

async function runConciergeTurnBody(
  input: PipelineTurnInput,
): Promise<PipelineTurnResult> {
  const turnId = input.turnId;
  const signal = input.signal;

  // Manager-Verfassung: KEIN Pre-Call-1 Bypass (kein Nav-Stop-Return, keine Early-Floskel,
  // kein Mode-Switch vor Analyze). Bridge nur aus Call-1 JSON-Stream (onBridge).
  let earlyBridgePromise: Promise<string | null> = Promise.resolve(null);
  let bridgeSpokenDuringAnalyze = false;
  let earlyNavModeSwitchPromise: Promise<{
    ok: boolean;
    speech: string;
    bullets: string[];
    mode: 'foot' | 'bike';
    destName: string;
  } | null> | null = null;
  let earlyNavModeSwitchBridge: string | null = null;

  await loadConversationThreads();
  const rucksack = readRucksackSync();
  // Snapshot erst nach Call-1 Isolation lesen — sonst leakt Tennis/Amsterdam trotz scrub.
  let short = getShortTerm();
  noteUserUtterance(input.userText);

  const { resolveCityChatScope } = await import('../context/placeContext');
  const cityScope = resolveCityChatScope(input.userText);
  const turnCityHint = cityScope.cityHint;
  const turnCityKey = cityScope.cityKey;

  const prevFg = getForegroundThread();
  const correction = mergeCorrectionUtterance({
    previousUserText: prevFg?.lastUserText,
    newUserText: input.userText,
  });
  const rawForRewrite = correction.mergedUserText;

  // Trivia/Knowledge vor Rewrite: Sticky Events/Sport scrubben (kein Towers→Personen-Alter).
  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    const { looksLikeNamedTriviaSubject } = require('../kernel/turnKernel') as {
      looksLikeNamedTriviaSubject: (s: string) => boolean;
    };
    let quick = false;
    try {
      const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
        isQuickLookupQuery: (s: string) => boolean;
      };
      quick = isQuickLookupQuery(rawForRewrite);
    } catch {
      quick = false;
    }
    const rawFam = classifyUtteranceFamily(rawForRewrite).family;
    let supermarketOffer = false;
    try {
      const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
        isSupermarketOfferQuery: (s: string) => boolean;
      };
      supermarketOffer = isSupermarketOfferQuery(rawForRewrite);
    } catch {
      supermarketOffer = false;
    }
    if (
      quick ||
      rawFam === 'knowledge' ||
      rawFam === 'weather' ||
      supermarketOffer ||
      looksLikeNamedTriviaSubject(rawForRewrite)
    ) {
      const { clearLastLiveInventory } = require('../context/shortTermContext') as {
        clearLastLiveInventory: () => void;
      };
      clearLastLiveInventory();
    }
    // Wetter / Produkt-Prospekt = neuer Thread: Flug-Sticky + Gesprächsstadt scrubben.
    if (rawFam === 'weather' || supermarketOffer) {
      try {
        const { scrubDeadFlightThread } = require('../../services/flights/flightTripSession') as {
          scrubDeadFlightThread: () => void;
        };
        scrubDeadFlightThread();
      } catch {
        /* soft */
      }
      if (supermarketOffer) {
        try {
          const {
            clearLastMentionedCity,
            clearCityPackOffer,
          } = require('../context/shortTermContext') as {
            clearLastMentionedCity: () => void;
            clearCityPackOffer: () => void;
          };
          clearLastMentionedCity();
          clearCityPackOffer();
        } catch {
          /* soft */
        }
      }
    }
  } catch {
    /* soft */
  }

  // Flug-Session vor Live-Inventory — nacktes „um 20 Uhr“ darf nicht Pitch/Hafen klauen.
  try {
    const { hydrateFlightTripSession } = await import(
      '../../services/flights/flightTripSession'
    );
    await hydrateFlightTripSession();
  } catch {
    /* soft */
  }

  // Manager-Verfassung: Call 1 sieht den ROHEN UserText (nur Korrektur-Merge als Hint).
  // Kein rewriteQuery / Live-Inventory vor Analyze — Isolation entscheidet Call 1.
  let rewritten = String(rawForRewrite || input.userText || '').trim();
  const rawUserTextForCall1 = String(input.userText || '').trim() || rewritten;

  // Kontext-Hygiene (kein Answer-Bypass): Wetter ohne Deixis → Sticky-POI/Pitch/Nav-Laden weg vor Call 1.
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(rawUserTextForCall1) &&
      !weatherAskWantsConversationPlace(rawUserTextForCall1)
    ) {
      const {
        setLastPlaceName,
        clearLastLiveInventory,
        setLastTopic,
        clearLastMentionedCity,
        clearCityPackOffer,
      } = require('../context/shortTermContext') as {
        setLastPlaceName: (n: string | null) => void;
        clearLastLiveInventory: () => void;
        setLastTopic: (t: string | null) => void;
        clearLastMentionedCity: () => void;
        clearCityPackOffer: () => void;
      };
      setLastPlaceName(null);
      clearLastLiveInventory();
      setLastTopic('weather');
      clearLastMentionedCity();
      clearCityPackOffer();
      try {
        const { useLivePitchStore } = require('../pitch/publishPitchUi') as {
          useLivePitchStore: { getState: () => { clear: (force?: boolean) => void } };
        };
        useLivePitchStore.getState().clear(true);
      } catch {
        /* soft */
      }
      try {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: {
            getState: () => {
              setActiveConciergeCard: (c: null) => void;
              setNavRouteLoading: (v: boolean) => void;
              setIsGenerating: (v: boolean) => void;
              setPendingNavOffer: (o: null) => void;
            };
          };
        };
        const st = useFinnusStore.getState();
        st.setActiveConciergeCard(null);
        st.setNavRouteLoading(false);
        st.setIsGenerating(false);
        st.setPendingNavOffer(null);
      } catch {
        /* soft */
      }
      try {
        const { clearIntentQueue } = require('./intentQueue') as {
          clearIntentQueue: () => void;
        };
        clearIntentQueue();
      } catch {
        /* soft */
      }
    }
  } catch {
    /* soft */
  }

  // Wetter-API parallel zu Call-1 laden — kein Routing, nur IO.
  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    if (classifyUtteranceFamily(rawUserTextForCall1).family === 'weather') {
      const { ensureWeatherFresh } = require('../../services/weatherService') as {
        ensureWeatherFresh: (
          reason: 'tick',
          coords?: { lat: number; lng: number } | null,
          opts?: { userAsked?: boolean },
        ) => Promise<unknown>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
      };
      const gps = useGpsStore.getState();
      void ensureWeatherFresh(
        'tick',
        gps.lat != null && gps.lng != null ? { lat: gps.lat, lng: gps.lng } : null,
        { userAsked: true },
      );
    }
  } catch {
    /* soft */
  }

  // Call-1 sieht JEDEN Satz (auch 5k / Plan-Ja / Hamburg-Tag).
  // M5 / Pitch / Tour sind Backends NACH Call-1, keine Early-Weiche.

  // Modul-1/Geofence ~60 s pausieren, solange User-Frage läuft
  try {
    const { holdExploreForUserQuestion } = await import('../../runtime/exploreHold');
    if (rawUserTextForCall1.length >= 4) {
      holdExploreForUserQuestion(60_000, 'concierge_turn');
    }
  } catch {
    /* soft */
  }

  // Hard-Nav / Just-Do-It / Stadt-Pack / M1 / Reisebüro erst NACH Call-1.
  // Pack-Popup: nicht mid-turn soft-offer — nur Call-1 packPolicy / echter Stadtwechsel.

  try {
    const {
      detectTravelModeVoiceOverride,
      forceBikeModeFromVoice,
      setPreferredTravelMode,
    } = await import('../../services/navigation/travelModeContext');
    const mode = detectTravelModeVoiceOverride(rawUserTextForCall1);
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

  // Explizite Nav: Planungs-UI (Pending-Choice / Short-Answers) darf Just-Do-It nicht blocken
  try {
    const { isExplicitNavIntent } = await import(
      '../../services/intent/poiInfoVsNav'
    );
    if (isExplicitNavIntent(rewritten)) {
      try {
        const { usePlanCalendarUiStore } = await import(
          '../timeline/planCalendarUiStore'
        );
        const ui = usePlanCalendarUiStore.getState();
        ui.clearShortAnswers?.();
        ui.setPendingChoice?.(null);
      } catch {
        /* soft */
      }
    }
  } catch {
    /* soft */
  }

  // Plan/Tour/Reisebüro erst NACH dem Manager — keine Keyword-Weiche vor der KI.

  let turnRucksack: import('../reboot/pipeline/turnRucksack').TurnRucksackV1 | null =
    null;
  try {
    const { loadBulletUiBudget } = await import(
      '../reboot/pipeline/bulletUiBudget'
    );
    const { buildTurnRucksack, formatRucksackLine } = await import(
      '../reboot/pipeline/turnRucksack'
    );
    const bulletBudget = await loadBulletUiBudget();
    let liveChatActive = false;
    try {
      const { isLiveChatTurnActive } = require('../../services/handsFree/liveChatTurnContext') as {
        isLiveChatTurnActive: () => boolean;
      };
      liveChatActive = isLiveChatTurnActive();
    } catch {
      liveChatActive = false;
    }
    let planModuleActive = false;
    try {
      const { isPlanningModuleActive } = require('../planning/planSessionState') as {
        isPlanningModuleActive: () => boolean;
      };
      planModuleActive = isPlanningModuleActive();
    } catch {
      planModuleActive = false;
    }
    turnRucksack = buildTurnRucksack({
      turnId,
      userText: rawUserTextForCall1,
      bulletBudget,
      navActive,
      calendarOpen,
      liveChatActive,
      planModuleActive,
    });
  } catch {
    turnRucksack = null;
  }

  let rucksackLine: string | null = null;
  try {
    if (turnRucksack) {
      const { formatRucksackLine } = await import(
        '../reboot/pipeline/turnRucksack'
      );
      rucksackLine = formatRucksackLine(turnRucksack);
    }
    const { formatOwnerGoldCatalogForCall1 } = await import(
      './call1OwnerGoldCatalog'
    );
    const goldBlock = formatOwnerGoldCatalogForCall1();
    if (goldBlock) {
      rucksackLine = [rucksackLine, goldBlock].filter(Boolean).join('\n');
    }
    if (correction.isCorrection) {
      rucksackLine = [
        rucksackLine,
        `CORRECTION_HINT: User korrigiert gerade — vorheriger Satz war „${String(prevFg?.lastUserText || '').slice(0, 120)}“. merged=„${rewritten.slice(0, 160)}“. Rohsatz unverändert an Call 1; session=continue + neue criteria.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
  } catch {
    rucksackLine = rucksackLine ?? null;
  }

  // choiceFast VOR Analyze (kein TDZ). Early Bridge läuft schon parallel (nach Rewrite).
  let choiceFast: import('./choiceTurnContext').ChoiceFastPathArm | null = null;
  try {
    const { takeChoiceFastPath } = await import('./choiceTurnContext');
    choiceFast = takeChoiceFastPath();
  } catch {
    choiceFast = null;
  }

  let analysis: ManagerAnalysis;
  if (choiceFast) {
    const {
      getChoiceTurnContext,
      buildAnalysisFromChoice,
    } = await import('./choiceTurnContext');
    const parentCtx = getChoiceTurnContext(choiceFast.parentTurnId);
    analysis = buildAnalysisFromChoice(choiceFast, parentCtx);
    if (parentCtx?.userText && !rewritten.includes(parentCtx.userText.slice(0, 24))) {
      rewritten = `${parentCtx.userText} — ${rewritten}`;
    }
  } else {
    let streamBridgeMaxWords = 14;
    try {
      const { resolveTurnBridgePace } = require('../kernel/turnKernel') as {
        resolveTurnBridgePace: (s: string) => { bridgeMaxWords: number };
      };
      streamBridgeMaxWords = resolveTurnBridgePace(rawUserTextForCall1).bridgeMaxWords;
    } catch {
      streamBridgeMaxWords = 14;
    }
    analysis =
      (await takeManagerWarmupIfMatch(rawUserTextForCall1)) ||
      (await analyzeManagerTurn({
        userText: rawUserTextForCall1,
        cityHint: turnCityHint,
        cityKey: turnCityKey,
        navActive,
        calendarOpen,
        signal,
        rucksackLine,
        onBridge: (bridge) => {
          if (!bridge?.trim() || bridgeSpokenDuringAnalyze) return;
          // Mode-Switch-Bridge hat Zusagen+ETA schon — kein zweites Stream-Bridge
          if (earlyNavModeSwitchBridge) return;
          if (!(streamBridgeMaxWords > 0)) return;
          try {
            const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
              markBridgeFirst: () => void;
            };
            markBridgeFirst();
          } catch {
            /* soft */
          }
          void speakBridgeFromAnalysis(
            {
              bridge,
              bridgeMaxWords: streamBridgeMaxWords,
              jobHint: null,
              session: 'new',
              intentSummary: '',
              route: 'blueprint',
              blueprintId: null,
              blueprintStage: null,
              threadMatchId: null,
              subject: null,
              lanePlan: 'fast_only',
              pace: 'standard',
              fastDeadlineMs: 8000,
              latencyHintSec: null,
              tasks: [],
              openLoops: [],
              nameAllowed: false,
            },
            turnId,
            rewritten,
            'new',
          ).then((r) => {
            if (r?.alreadySpoken || r?.text) bridgeSpokenDuringAnalyze = true;
          });
        },
      }));
  }
  // Early Bridge: erst nach echtem TTS-Start als „gesprochen“ markieren.
  {
    const earlySpoken = await earlyBridgePromise.catch(() => null);
    let pumpLive = false;
    try {
      const { getFusedTurnPump } = require('../speech/fusedTurnSpeech') as {
        getFusedTurnPump: () => { hasStarted: () => boolean };
      };
      pumpLive = getFusedTurnPump().hasStarted();
    } catch {
      pumpLive = false;
    }
    if (earlySpoken || bridgeSpokenDuringAnalyze || pumpLive) {
      analysis = { ...analysis, bridgeSpokenEarly: true };
    }
  }
  analysis = enrichAnalysisWithBlueprint(analysis);

  // Genannter Termin: destCity/researchCity aus dem Satz (nicht GPS) — soft, kein Team-Hardcode.
  try {
    const { looksLikeNamedScheduleQuery } = require('../../services/concierge/sportsScheduleQuery') as {
      looksLikeNamedScheduleQuery: (s: string) => boolean;
    };
    if (looksLikeNamedScheduleQuery(rewritten)) {
      const { extractCityFromText } = require('../context/shortTermContext') as {
        extractCityFromText: (t: string) => string | null;
      };
      const namedCity = extractCityFromText(rewritten)?.trim() || null;
      if (namedCity) {
        const frame = analysis.frame
          ? { ...analysis.frame, destCity: analysis.frame.destCity || namedCity }
          : null;
        const cityScope = analysis.cityScope
          ? {
              ...analysis.cityScope,
              researchCity: analysis.cityScope.researchCity || namedCity,
            }
          : {
              cityId: null,
              researchCity: namedCity,
              packPolicy: 'none' as const,
            };
        analysis = { ...analysis, ...(frame ? { frame } : {}), cityScope };
      }
    }
  } catch {
    /* soft */
  }

  try {
    const { hydrateFlightTripSession } = await import(
      '../../services/flights/flightTripSession'
    );
    await hydrateFlightTripSession();
  } catch {
    /* soft */
  }

  const { finalizeCall1Execution } = await import('./call1Dispatch');
  let call1Execution = finalizeCall1Execution(analysis, rawUserTextForCall1);
  analysis = { ...analysis, execution: call1Execution };

  // Wetter-Opener: Call-1 Isolation erzwingen (auch wenn LLM session=continue sagt).
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(rawUserTextForCall1) &&
      !weatherAskWantsConversationPlace(rawUserTextForCall1) &&
      !looksLikePicnicQuery(rawUserTextForCall1)
    ) {
      analysis = {
        ...analysis,
        execution: 'chat_lane',
        chatLane: 'chat',
        session: 'new',
        topicScope: {
          mode: 'new',
          turnsForCall2: 0,
          inheritLiveInventory: false,
        },
        blueprintId:
          analysis.blueprintId === 'weather' ? analysis.blueprintId : 'weather',
      };
      call1Execution = 'chat_lane';
    }
  } catch {
    /* soft */
  }

  // Nach Call-1: topicScope hart normalisieren.
  // session=new ODER mode=new ODER turns=0 ⇒ KEINE Historie an Call 2 / Chat-Lane.
  try {
    const { parseTopicScope } = require('../reboot/pipeline/topicScopeParse') as {
      parseTopicScope: (r: unknown) => {
        mode: 'new' | 'followup';
        turnsForCall2: number;
        inheritLiveInventory?: boolean;
      };
    };
    const forceNew =
      analysis.session === 'new' ||
      analysis.topicScope?.mode === 'new' ||
      analysis.topicScope?.turnsForCall2 === 0;
    const scoped = parseTopicScope(
      forceNew
        ? { mode: 'new', turnsForCall2: 0, inheritLiveInventory: false }
        : analysis.topicScope ?? { mode: 'followup', turnsForCall2: 3 },
    );
    analysis = {
      ...analysis,
      session: scoped.mode === 'new' ? 'new' : analysis.session,
      topicScope: scoped,
    };
  } catch {
    /* soft */
  }

  // Isolation: neues Thema → Sticky/Card/Pitch scrubben (Call-1 topicScope ehren).
  try {
    const { scrubStickyAfterCall1 } = await import('./call1ManagerIsolation');
    await scrubStickyAfterCall1(analysis);
  } catch {
    /* soft */
  }
  // Frischer Short-Term nach Scrub — nie den Pre-Call-1 Snapshot weiterreichen.
  try {
    short = getShortTerm();
  } catch {
    /* soft */
  }

  // Nav-Stop: Call 1 hat den Satz gesehen (Bridge/JSON). Reiner Stopp greift immer —
  // sonst hängt die Nav, wenn Call 1 falsch weicht (chat_lane statt nav_execute).
  try {
    const { isPureStopNavigationIntent, clearNavigationHard } = await import(
      '../../services/navigation/hardNavOverride'
    );
    const stopAsk = isPureStopNavigationIntent(rawUserTextForCall1);
    if (stopAsk) {
      await clearNavigationHard({ silent: true });
      const text =
        (analysis.bridge || '').trim() ||
        'Alles klar — Navigation ist aus.';
      if (!analysis.bridgeSpokenEarly) {
        try {
          const spoken = await speakModuleWaitBridge(text, turnId, { force: true });
          if (spoken) {
            analysis = {
              ...analysis,
              bridgeSpokenEarly: true,
              bridgeComplete: true,
              execution: 'nav_execute',
            };
            bridgeSpokenDuringAnalyze = true;
          }
        } catch {
          /* soft */
        }
      } else {
        analysis = {
          ...analysis,
          bridgeComplete: true,
          execution: 'nav_execute',
        };
      }
      try {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: analysis.bridgeSpokenEarly ? '' : text,
            visualBullets: [],
            quickActions: [],
            cardTitle: 'Navigation',
          },
          { userText: rawUserTextForCall1, skipAutoNav: true },
        );
      } catch {
        /* soft */
      }
      const logic: LogicNodeOutput = {
        spokenDraft: analysis.bridgeSpokenEarly ? '' : text,
        bullets: [],
        buttons: [],
        moneyEur: [],
        warnings: [],
      };
      return {
        turnId,
        tasks: [],
        bridgingText: analysis.bridge || text,
        logic,
        synthesis: synthesizeOutput(logic),
        deepResearchQueued: false,
        jobId: 'nav_stop',
      };
    }
  } catch (err) {
    console.warn('[runConciergeTurn] call1 nav-stop failed', err);
  }

  // bridgeComplete → Call 2 skip (Bridge = ganze Antwort / Klärfrage).
  if (analysis.bridgeComplete === true) {
    const text = (analysis.bridge || '').trim();
    if (text && !analysis.bridgeSpokenEarly && !bridgeSpokenDuringAnalyze) {
      try {
        const spoken = await speakModuleWaitBridge(text, turnId, { force: true });
        if (spoken) {
          analysis = { ...analysis, bridgeSpokenEarly: true };
          bridgeSpokenDuringAnalyze = true;
        }
      } catch {
        /* soft */
      }
    }
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
      bridgingText: analysis.bridge || null,
      logic,
      synthesis: synthesizeOutput(logic),
      deepResearchQueued: false,
      jobId: analysis.jobHint || 'bridge_complete',
    };
  }

  if (__DEV__) {
    try {
      console.log(
        '[call1]',
        JSON.stringify({
          execution: analysis.execution,
          lane: analysis.chatLane,
          session: analysis.session,
          bridge: analysis.bridge,
          authorIntent: analysis.authorIntent,
          call2Brief: analysis.call2Brief,
          mustHaves: analysis.mustHaves,
          criteria: analysis.criteria,
          when: analysis.frame?.when ?? [],
          destCity: analysis.frame?.destCity ?? null,
          work: (analysis.frame?.tasks ?? []).map((t) => ({
            worker: t.worker,
            brief: t.brief,
          })),
        }),
      );
    } catch {
      /* soft */
    }
  }

  if (call1Execution === 'flight_advisor') {
    try {
      const { shouldPreserveFlightTripSession, isFlightTripQuery } = require(
        '../../services/flights/flightTripIntent',
      ) as {
        shouldPreserveFlightTripSession: (s: string) => boolean;
        isFlightTripQuery: (s: string) => boolean;
      };
      const { hasFlightTripSession } = require('../../services/flights/flightTripSession') as {
        hasFlightTripSession: () => boolean;
      };
      if (
        shouldPreserveFlightTripSession(rewritten) ||
        isFlightTripQuery(rewritten) ||
        hasFlightTripSession()
      ) {
        analysis = {
          ...analysis,
          session:
            hasFlightTripSession() && analysis.session === 'new'
              ? 'continue'
              : analysis.session,
          topicScope: {
            ...analysis.topicScope,
            inheritLiveInventory: false,
            // Call 1 bleibt SSOT — History nicht erzwingen.
            turnsForCall2: analysis.topicScope?.turnsForCall2 ?? 2,
          },
        };
      }
    } catch {
      /* soft */
    }
  }

  if (turnRucksack && analysis.memoryPolicy?.longTerm) {
    try {
      const { enrichTurnRucksackWithLtm } = await import(
        '../reboot/pipeline/turnRucksack'
      );
      turnRucksack = await enrichTurnRucksackWithLtm(turnRucksack, {
        userText: rewritten,
        memoryPolicy: analysis.memoryPolicy,
        cityKey: turnCityKey,
      });
    } catch {
      /* soft */
    }
  }

  if (
    analysis.topicScope?.inheritLiveInventory === true &&
    !choiceFast &&
    call1Execution !== 'flight_advisor'
  ) {
    const invFollow = resolveLiveInventoryUserText(rewritten);
    if (invFollow.text && invFollow.text !== rewritten) {
      rewritten = invFollow.text;
    }
    if (invFollow.kind) {
      rememberLiveInventoryQuery(rewritten, invFollow.kind);
    }
  }
  if (call1Execution === 'flight_advisor') {
    try {
      const { releasePlanWaitForForeignTopic } = await import(
        '../planning/planSessionState'
      );
      releasePlanWaitForForeignTopic();
    } catch {
      /* soft */
    }
    try {
      const { tryFlightAdvisorHandoff } = await import('./handoffs/flightEarly');
      const flightResult = await tryFlightAdvisorHandoff({
        rewritten,
        turnId,
        turnCityKey,
        turnCityHint,
        analysis,
      });
      if (flightResult) return flightResult;
    } catch (err) {
      console.warn('[runConciergeTurn] flight advisor handoff failed', err);
    }
  }

  try {
    const { frameHasWorker } = require('./turnFrame') as {
      frameHasWorker: (
        f: ManagerAnalysis['frame'],
        w: 'flight',
      ) => boolean;
    };
    if (
      call1Execution !== 'flight_advisor' &&
      analysis.session === 'new' &&
      analysis.jobHint !== 'flight_trip' &&
      !frameHasWorker(analysis.frame, 'flight')
    ) {
      let keepFlight = false;
      try {
        const { shouldPreserveFlightTripSession } = require('../../services/flights/flightTripIntent') as {
          shouldPreserveFlightTripSession: (s: string) => boolean;
        };
        keepFlight = shouldPreserveFlightTripSession(rewritten);
      } catch {
        keepFlight = false;
      }
      if (!keepFlight) {
        const { scrubDeadFlightThread } = require('../../services/flights/flightTripSession') as {
          scrubDeadFlightThread: () => void;
        };
        scrubDeadFlightThread();
      }
    }
  } catch {
    /* soft */
  }
  try {
    const { latencyMark } = require('../../services/debug/latencyTiming') as {
      latencyMark: (m: string, d?: string) => void;
    };
    latencyMark('decompose', analysis.pace);
  } catch {
    /* soft */
  }
  if (correction.isCorrection) {
    analysis = { ...analysis, session: 'continue', isCorrection: true };
    try {
      const { runCorrectionLearningCapture } = await import(
        '../../services/memory/correctionLearning'
      );
      const cap = await runCorrectionLearningCapture(rawUserTextForCall1);
      if (cap.effectiveQuestion?.trim()) {
        rewritten = cap.effectiveQuestion.trim();
      }
      if (cap.rule) {
        try {
          const { scrubStickyAfterCall1 } = await import('./call1ManagerIsolation');
          await scrubStickyAfterCall1({
            ...analysis,
            session: 'new',
            topicScope: {
              mode: 'new',
              turnsForCall2: 0,
              inheritLiveInventory: false,
            },
          });
        } catch {
          /* soft */
        }
      }
    } catch (err) {
      console.warn('[runConciergeTurn] correction learn failed', err);
    }
  }

  // Call-1 verlangt Pack-Download → einmal Popup (nicht mid-turn Soft-Offer).
  if (analysis.cityScope?.packPolicy === 'require_download') {
    try {
      const coords = anchorCoords(rucksack);
      if (
        Number.isFinite(coords.lat) &&
        Number.isFinite(coords.lng)
      ) {
        const { promptCityPackDownloadIfNeeded } = await import(
          '../../services/homeMap/mapPackPrompt'
        );
        void promptCityPackDownloadIfNeeded({
          viewportLat: coords.lat,
          viewportLng: coords.lng,
          cityId: analysis.cityScope.cityId || turnCityKey,
          localPackIds: [],
          cityEnter: true,
        });
      }
    } catch {
      /* soft */
    }
  }

  try {
    const { isRainDontCareUtterance } = await import(
      '../../services/weather/rainIncomingPolicy'
    );
    const rainCard =
      useFinnusStore.getState().activeConciergeCard?.cardTitle === 'Wetter';
    if (
      isRainDontCareUtterance(rewritten) ||
      (rainCard && /^\s*(ist mir )?egal\.?\s*$/i.test(rewritten))
    ) {
      useFinnusStore.getState().setActiveConciergeCard(null);
    }
  } catch {
    /* soft */
  }

  try {
    const { isStreetViewVoiceAsk, fulfillStreetViewVoiceAsk } = await import(
      '../../services/navigation/lookAheadBuffer'
    );
    if (isStreetViewVoiceAsk(rewritten)) {
      void fulfillStreetViewVoiceAsk();
    }
  } catch {
    /* soft */
  }

  // Notfall / Pass / Zahn — deterministic early path (sichtbare Bullets + Actions).
  try {
    const { detectEmergencyIntent, handleEmergencyConcierge } = await import(
      '../../services/concierge/emergencyConcierge'
    );
    if (detectEmergencyIntent(rewritten) || detectEmergencyIntent(input.userText)) {
      const { useFinnusStore } = await import('../../store/useFinnusStore');
      const st = useFinnusStore.getState();
      const origin =
        st.lastGpsLat != null && st.lastGpsLng != null
          ? { lat: st.lastGpsLat, lng: st.lastGpsLng }
          : null;
      const em = await handleEmergencyConcierge(rewritten || input.userText, origin);
      if (em.handled && em.concierge) {
        const speech = String(em.reply || em.concierge.speechText || '').trim();
        const bullets = (em.concierge.visualBullets || []).slice(0, 3);
        const actions = em.concierge.quickActions || [];
        presentToUi(speech, bullets, actions as never, {
          userText: rewritten,
          cardTitle: em.concierge.cardTitle || 'Hilfe',
        });
        if (speech) {
          enqueueSpeech({ kind: 'main', text: speech, turnId });
        }
        const logic: LogicNodeOutput = {
          spokenDraft: speech,
          bullets,
          buttons: actions as never,
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'emergency_care',
        };
      }
    }
  } catch (err) {
    console.warn('[runConciergeTurn] emergency early failed', err);
  }

  // Call-1 sagte nav_execute → Hard-Dest / Mode-Switch. Kein Keyword-Steal mehr.
  try {
    if (call1Execution === 'nav_execute') {
      const forceExplicitNav = true;
      // Mode-Switch zum selben Ziel (ÖPNV→Fuß) — bevor Hard-Dest-Geocode
      if (!earlyNavModeSwitchPromise) {
        const navLive = Boolean(useFinnusStore.getState().navActive);
        if (navLive) {
          const {
            isActiveNavTravelModeSwitchIntent,
            trySwitchActiveNavTravelMode,
          } = await import('../../services/navigation/switchActiveNavTravelMode');
          const switchMode = isActiveNavTravelModeSwitchIntent(rewritten);
          if (switchMode === 'foot' || switchMode === 'bike') {
            earlyNavModeSwitchPromise = trySwitchActiveNavTravelMode(
              switchMode,
              rewritten,
            );
          }
        }
      }
      if (earlyNavModeSwitchPromise) {
        const switched = await earlyNavModeSwitchPromise;
        earlyNavModeSwitchPromise = null;
        if (switched?.speech) {
          const bridgeText =
            earlyNavModeSwitchBridge || analysis.bridge || switched.speech;
          // Bridge hat Zusagen+ETA schon gesprochen → keine zweite Main-Speech
          if (!bridgeSpokenDuringAnalyze && !analysis.bridgeSpokenEarly) {
            const { presentConciergeResponse } = await import(
              '../../services/concierge/presentConcierge'
            );
            await presentConciergeResponse(
              {
                speechText: switched.speech,
                visualBullets: (switched.bullets ?? []).slice(0, 3),
                quickActions: [],
                cardTitle: 'Navigation',
              },
              { userText: rewritten, skipAutoNav: true },
            );
          } else {
            try {
              useFinnusStore.getState().setActiveConciergeCard({
                id: `nav-mode-${Date.now()}`,
                createdAtMs: Date.now(),
                cardTitle: 'Navigation',
                speechText: bridgeText,
                visualBullets: (switched.bullets ?? []).slice(0, 3),
                quickActions: [],
              });
            } catch {
              /* soft */
            }
          }
          const logic: LogicNodeOutput = {
            spokenDraft: bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly
              ? ''
              : switched.speech,
            bullets: (switched.bullets ?? []).slice(0, 3),
            buttons: [],
            moneyEur: [],
            warnings: [],
          };
          return {
            turnId,
            tasks: [],
            bridgingText: bridgeText,
            logic,
            synthesis: synthesizeOutput(logic),
            deepResearchQueued: false,
            jobId: 'nav_route',
          };
        }
      }

      const { detectHardNavOverride, hardOverrideNavigationTo } = await import(
        '../../services/navigation/hardNavOverride'
      );
      const { peekLastStreetNavQuery } = await import(
        '../../services/navigation/streetAddressQuery'
      );
      const { detectChainedNavIntent } = await import(
        '../../services/navigation/chainedNavIntent'
      );
      const { extractNamedDestinationLabel } = await import(
        '../../services/concierge/canonicalDestination'
      );
      const { formatDurationMinutesDe } = await import(
        '../../services/navigation/travelEtaFormat'
      );
      const store = useFinnusStore.getState();
      const navCtx = {
        currentDestName: store.navTargetName,
        lastStreetQuery: peekLastStreetNavQuery(),
      };
      const dest =
        detectHardNavOverride(rewritten, navCtx) ||
        detectHardNavOverride(input.userText, navCtx) ||
        extractNamedDestinationLabel(rewritten) ||
        extractNamedDestinationLabel(input.userText);
      const gastroNamed =
        /\b(restaurant|café|cafe|bistro|imbiss)\b/iu.test(rewritten) ||
        /\b(tisch|reservier|speisekarte)\b/iu.test(rewritten);
      if (dest && !gastroNamed && !detectChainedNavIntent(rewritten)) {
        const result = await hardOverrideNavigationTo(dest);
        let text = result.reply;
        // Kurze Nav-Speech: Zusagen + ETA — kein Pack/M1-Roman
        if (result.ok) {
          try {
            await new Promise((r) => setTimeout(r, 280));
            const etaMin = useFinnusStore.getState().navEtaMin;
            const bridgeAlready =
              bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly;
            if (typeof etaMin === 'number' && etaMin > 0) {
              const dur = formatDurationMinutesDe(etaMin, 'speech');
              text = bridgeAlready
                ? `Das dauert etwa ${dur}.`
                : result.replaced
                  ? `Alles klar — ich führ dich jetzt zu ${result.name}. Das dauert etwa ${dur}.`
                  : `Alles klar — ich starte die Navigation zu ${result.name}. Das dauert etwa ${dur}.`;
            } else if (bridgeAlready) {
              // Bridge hat Zusagen schon — keine zweite „Alles klar“-Schleife
              text = '';
            } else if (!result.replaced) {
              text = `Alles klar — ich starte die Navigation zu ${result.name}.`;
            }
          } catch {
            if (!result.replaced) {
              text = `Alles klar — ich starte die Navigation zu ${result.name}.`;
            }
          }
        }
        if (text) {
          presentToUi(text, [], []);
          enqueueSpeech({ kind: 'main', text, turnId });
        } else {
          presentToUi(result.reply, [], []);
        }
        const logic: LogicNodeOutput = {
          spokenDraft: text || result.reply,
          bullets: [],
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nav_route',
        };
      }
      // Explizite Nav ohne Ziel: trotzdem kein Pitch/M1 — Mobility später.
      if (forceExplicitNav) {
        analysis = {
          ...analysis,
          execution: 'nav_execute',
          chatLane: 'nav',
        };
      }
    }
  } catch (err) {
    console.warn('[runConciergeTurn] hard dest after manager failed', err);
  }

  const managerLane = String(analysis.chatLane || '');

  // Mid-nav Mode-Switch Fallback (wenn Call-1 nicht nav_execute sagte, Intent aber klar)
  try {
    if (earlyNavModeSwitchPromise) {
      const switched = await earlyNavModeSwitchPromise;
      earlyNavModeSwitchPromise = null;
      if (switched?.speech) {
        const bridgeText =
          earlyNavModeSwitchBridge || analysis.bridge || switched.speech;
        if (!bridgeSpokenDuringAnalyze && !analysis.bridgeSpokenEarly) {
          const { presentConciergeResponse } = await import(
            '../../services/concierge/presentConcierge'
          );
          await presentConciergeResponse(
            {
              speechText: switched.speech,
              visualBullets: (switched.bullets ?? []).slice(0, 3),
              quickActions: [],
              cardTitle: 'Navigation',
            },
            { userText: rewritten, skipAutoNav: true },
          );
        } else {
          try {
            useFinnusStore.getState().setActiveConciergeCard({
              id: `nav-mode-${Date.now()}`,
              createdAtMs: Date.now(),
              cardTitle: 'Navigation',
              speechText: bridgeText,
              visualBullets: (switched.bullets ?? []).slice(0, 3),
              quickActions: [],
            });
          } catch {
            /* soft */
          }
        }
        const logic: LogicNodeOutput = {
          spokenDraft:
            bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly
              ? ''
              : switched.speech,
          bullets: (switched.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: bridgeText,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nav_route',
        };
      }
    }
    const navLive = Boolean(useFinnusStore.getState().navActive);
    if (navLive) {
      const {
        isActiveNavTravelModeSwitchIntent,
        trySwitchActiveNavTravelMode,
      } = await import('../../services/navigation/switchActiveNavTravelMode');
      const switchMode = isActiveNavTravelModeSwitchIntent(rewritten);
      if (switchMode === 'foot' || switchMode === 'bike') {
        const switched = await trySwitchActiveNavTravelMode(
          switchMode,
          rewritten,
        );
        if (switched?.speech) {
          const { presentConciergeResponse } = await import(
            '../../services/concierge/presentConcierge'
          );
          await presentConciergeResponse(
            {
              speechText: switched.speech,
              visualBullets: (switched.bullets ?? []).slice(0, 3),
              quickActions: [],
              cardTitle: 'Navigation',
            },
            { userText: rewritten, skipAutoNav: true },
          );
          const logic: LogicNodeOutput = {
            spokenDraft: switched.speech,
            bullets: (switched.bullets ?? []).slice(0, 3),
            buttons: [],
            moneyEur: [],
            warnings: [],
          };
          return {
            turnId,
            tasks: [],
            bridgingText: analysis.bridge || null,
            logic,
            synthesis: synthesizeOutput(logic),
            deepResearchQueued: false,
            jobId: 'nav_route',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[pipeline] active-nav mode switch failed', err);
  }

  // Nav-Angebot „Ja“ nach Call-1 — Compound (Ja + Wecker) nicht abbrechen.
  if (managerLane === 'nav') {
    try {
      const {
        shouldStartNavFromOffer,
        resolveNavOfferFromReply,
      } = await import('../../services/navigation/pendingOffer');
      const store = useFinnusStore.getState();
      if (
        shouldStartNavFromOffer(
          rewritten,
          store.pendingNavOffer,
          store.pendingNavAlternatives,
        )
      ) {
        const offer = resolveNavOfferFromReply(
          rewritten,
          store.pendingNavOffer,
          store.pendingNavAlternatives,
        );
        if (offer) {
          const { startNavigationFromOffer } = await import(
            '../../services/navigation/resolveNavTarget'
          );
          const started = await startNavigationFromOffer(offer);
          const { hasMultipleIntents } = require('../kernel/turnKernel') as {
            hasMultipleIntents: (s: string) => boolean;
          };
          if (!hasMultipleIntents(rewritten) && started?.ok) {
            const text =
              started.message?.trim() ||
              `Okay, ich führ dich zu ${offer.name}.`;
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
              bridgingText: analysis.bridge || null,
              logic,
              synthesis: synthesizeOutput(logic),
              deepResearchQueued: false,
              jobId: 'nav_route',
            };
          }
        }
      }
    } catch (err) {
      console.warn('[runConciergeTurn] nav offer after manager failed', err);
    }
  }

  // Buchungs-Angebot annehmen — nach Call-1, nicht vor Lane-Wahl.
  if (
    managerLane !== 'nav' &&
    managerLane !== 'm1' &&
    managerLane !== 'plan'
  ) {
    try {
      const { shouldAcceptPendingAffiliateOffer } = await import(
        '../../services/affiliate/pendingAffiliateOffer'
      );
      const store = useFinnusStore.getState();
      const aff = store.pendingAffiliateOffer;
      const hasNav =
        store.pendingNavOffer != null ||
        (store.pendingNavAlternatives?.length ?? 0) > 0;
      if (aff && shouldAcceptPendingAffiliateOffer(rewritten, aff, hasNav)) {
        const { handleQuickAction } = await import(
          '../../services/actionHandlerService'
        );
        store.setPendingAffiliateOffer(null);
        const result = await handleQuickAction(aff);
        const { hasMultipleIntents } = require('../kernel/turnKernel') as {
          hasMultipleIntents: (s: string) => boolean;
        };
        if (!hasMultipleIntents(rewritten)) {
          const text = result.ok
            ? result.message || 'Alles klar — ich öffne dir die Buchungsoption.'
            : result.message ||
              'Das lässt sich gerade nicht öffnen — tipp einfach auf den Button.';
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
            bridgingText: analysis.bridge || null,
            logic,
            synthesis: synthesizeOutput(logic),
            deepResearchQueued: false,
          };
        }
      }
    } catch (err) {
      console.warn('[runConciergeTurn] affiliate after manager failed', err);
    }
  }

  // Modul-1 POI-Chat: Ausführung nach Call-1, nur wenn die Lane m1 ist.
  if (managerLane === 'm1') {
    try {
      const {
        ensureModule1PoiChatHydrated,
        getActiveModule1PoiChat,
        module1FollowupFitsChat,
        looksLikePoiFactQuestion,
        streamModule1ChatSentences,
      } = await import('../../services/ai/module1PoiChat');
      await ensureModule1PoiChatHydrated();
      const m1Session = getActiveModule1PoiChat();
      const currentPoiId = useFinnusStore.getState().currentPoiId;
      const wantsDeep = isMoreHistoryUtterance(rewritten);
      const poiId =
        module1FollowupFitsChat(rewritten, m1Session) && m1Session
          ? m1Session.poiId
          : (looksLikePoiFactQuestion(rewritten) || wantsDeep) &&
              currentPoiId != null
            ? currentPoiId
            : null;
      if (poiId != null) {
        const { getPoiWithFacts } = await import('../../db/database');
        const poi = await getPoiWithFacts(poiId);
        if (poi) {
          const mode = wantsDeep ? 'deep' : 'followup';
          let acc = '';
          const m1Pump = getFusedTurnPump();
          for await (const sentence of streamModule1ChatSentences({
            poi,
            mode,
            userQuestion: rewritten,
          })) {
            const t = sentence.trim();
            if (!t) continue;
            acc = acc ? `${acc} ${t}` : t;
            m1Pump.push(t);
            if (!m1Pump.hasStarted()) {
              void presentToUi(t, [], [], rewritten);
              await startLiveSpeechSession(m1Pump, turnId, t);
            }
          }
          m1Pump.end();
          const text = acc.trim();
          if (text) {
            try {
              const { markQuestionClosed, getForegroundThread } = await import(
                '../../services/memory/conversationThreads'
              );
              const fg = getForegroundThread();
              markQuestionClosed(fg?.label || poi.name || 'poi');
            } catch {
              /* soft */
            }
            void presentToUi(text, [], [], rewritten);
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
              bridgingText: analysis.bridge || null,
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
  }

  // Stadt-Pack: Ausführung nach Call-1 (Button/Sprachbefehl), nicht davor.
  if (managerLane !== 'nav' && managerLane !== 'pitch' && managerLane !== 'm1') {
    try {
      const m =
        rewritten.match(
          /stadt[-\s]?datensatz\s+f(?:ü|ue)r\s+(.+?)(?:\s*\(([a-z0-9_-]+)\))?\.?$/i,
        ) ||
        rewritten.match(
          /lade\s+jetzt\s+den\s+stadt[-\s]?datensatz\s+f(?:ü|ue)r\s+(.+?)(?:\s*\(([a-z0-9_-]+)\))?/i,
        );
      if (m) {
        const { acceptCityPackOffer, maybeCityPackOfferForText } = await import(
          '../../services/cityPackOffer'
        );
        const { clearCityPackOffer } = await import('../context/shortTermContext');
        const cityId =
          (m[2] || '').trim() ||
          (await maybeCityPackOfferForText(m[1] || rewritten))?.city.id ||
          '';
        if (cityId) {
          const res = await acceptCityPackOffer(cityId);
          clearCityPackOffer();
          const text = res.ok
            ? `Alles klar — ${res.cityName} ist geladen. Ab jetzt nutze ich den Datensatz mit.`
            : 'Der Download hat nicht geklappt — ich suche weiter online.';
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
            bridgingText: analysis.bridge || null,
            logic,
            synthesis: synthesizeOutput(logic),
            deepResearchQueued: false,
          };
        }
      }
    } catch {
      /* soft */
    }
  }

  // Just-Do-It (Wecker/Lautstärke/Timer) nur wenn Call 1 es freigibt —
  // nie Keyword-Steal gegen execution/lane.
  try {
    const { shouldAbortTurnForEarlyJustDoIt, looksLikeClockIntentLite } =
      require('../kernel/turnKernel') as {
        shouldAbortTurnForEarlyJustDoIt: (s: string) => boolean;
        looksLikeClockIntentLite: (s: string) => boolean;
      };
    const call1AllowsJustDoIt =
      call1Execution === 'memory' ||
      call1Execution === 'chat_lane' ||
      call1Execution === 'task_fanout';
    if (
      call1AllowsJustDoIt &&
      !choiceFast &&
      shouldAbortTurnForEarlyJustDoIt(rewritten) &&
      managerLane !== 'nav' &&
      managerLane !== 'pitch' &&
      managerLane !== 'plan' &&
      managerLane !== 'm1'
    ) {
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      const early = await tryEarlyJustDoIt(rewritten);
      if (early?.speech) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: early.speech,
            visualBullets: (early.bullets ?? []).slice(0, 3),
            quickActions: (early.quickActions ?? []).slice(0, 5),
            cardTitle: early.cardTitle,
          },
          { userText: rewritten, skipAutoNav: true },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: early.speech,
          bullets: (early.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'day_plan_budget',
        };
      }
    } else if (call1AllowsJustDoIt && looksLikeClockIntentLite(rewritten)) {
      const { prepareClockIntentFollowUp } = await import(
        '../../services/alarms/clockIntents'
      );
      void prepareClockIntentFollowUp(rewritten);
    }
  } catch (err) {
    console.warn('[pipeline] just-do-it after manager failed', err);
  }

  // Insel-Anreise: Fähre vs. Inselflieger (Vergleich) — vor Linienflug-Advisor
  try {
    const {
      isWangeroogeIslandAccessQuery,
      prepareIslandAccessFollowUp,
    } = await import('../../services/flights/islandAccessCompare');
    if (
      call1Execution === 'chat_lane' &&
      isWangeroogeIslandAccessQuery(rewritten)
    ) {
      const island = await prepareIslandAccessFollowUp(rewritten);
      if (island?.speech) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: island.speech,
            visualBullets: (island.bullets ?? []).slice(0, 3),
            quickActions: (island.quickActions ?? []).slice(0, 5),
            cardTitle: island.cardTitle,
          },
          { userText: rewritten, skipAutoNav: true },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: island.speech,
          bullets: (island.bullets ?? []).slice(0, 3),
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
          jobId: 'transit_live',
        };
      }
    }
  } catch (err) {
    console.warn('[pipeline] island access failed', err);
  }

  // Flug läuft früh nach finalizeCall1Execution (flightEarly.ts) — kein Fall-through.

  // Reisebüro: nur wenn Call-1 execution=reisebuero sagt.
  if (call1Execution === 'reisebuero') {
    try {
        const { useReisebueroStore } = await import('../../reisebuero/store');
        useReisebueroStore.getState().openOverlay({ reset: true, seedText: rewritten });
        const speech =
          'Das klären wir im Reisebüro — ich mach da den Plan mit euch, ohne dass wir hier abdriften.';
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: speech,
            visualBullets: ['Yorro Reisebüro', 'Plan sammeln, dann suchen'],
            quickActions: [],
            cardTitle: 'Yorro Reisebüro',
          },
          { userText: rewritten, skipAutoNav: true },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: speech,
          bullets: ['Yorro Reisebüro'],
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'day_plan_budget',
        };
    } catch (err) {
      console.warn('[runConciergeTurn] reisebuero handoff failed', err);
    }
  }

  // Intent-Queue: nur aus Call-1 intents[] — kein Kernel-Split danach.
  const intentsForQueue = (analysis.intents || []).map((i) => ({
    id: i.id,
    lane: i.lane,
    blueprintId: (i.blueprintId as any) || null,
    brief: i.brief,
    dependsOn: i.dependsOn,
  }));
  // Offene Intents aus Vorturn nicht wegwischen — außer Call-1 sagt neues Thema.
  try {
    const { hasPendingIntents, seedIntentQueue: seed } =
      await import('./intentQueue');
    const topicCut =
      analysis.session === 'new' ||
      analysis.topicScope?.mode === 'new' ||
      analysis.topicScope?.turnsForCall2 === 0;
    if (topicCut) {
      seed(intentsForQueue);
    } else if (intentsForQueue.length === 0 && hasPendingIntents()) {
      /* keep existing queue */
    } else {
      seed(intentsForQueue);
    }
  } catch {
    seedIntentQueue(intentsForQueue);
  }

  const topicDecision = applyManagerSession({
    analysis,
    userText: rewritten,
    intent: analysis.jobHint,
    cityHint: turnCityHint,
    cityKey: turnCityKey,
  });

  const handoff = resolveHandoff(analysis);
  let subject =
    analysis.subject ||
    (topicDecision.mode === 'continue' || topicDecision.mode === 'resume'
      ? topicDecision.thread.entities.subject ||
        topicDecision.thread.entities.place ||
        null
      : null);
  if (isMoreHistoryUtterance(rewritten)) {
    const topicCut =
      analysis.session === 'new' ||
      analysis.topicScope?.mode === 'new' ||
      analysis.topicScope?.turnsForCall2 === 0;
    subject =
      extractMoreHistoryTopic(rewritten) ||
      subject ||
      (topicCut ? null : short.lastPlaceName) ||
      null;
  }

  const liveKind = detectLiveInventoryKind(rewritten);

  // Manager-Bridge = Beat 1 — sofort in die Queue, Lane läuft parallel.
  // Safety: Early-Flag ohne laufende Session → nochmal Bridge (sonst Stille bis Call 2).
  if (analysis.bridgeSpokenEarly) {
    try {
      const { getFusedTurnPump } = require('../speech/fusedTurnSpeech') as {
        getFusedTurnPump: () => { hasStarted: () => boolean };
      };
      if (!getFusedTurnPump().hasStarted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly) {
    await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
  }

  let compoundPlanDayKey: string | null = null;
  try {
    const { shouldIngestCompoundPlan, ingestCompoundDayPlan } = await import(
      '../planning/compoundPlanIngest'
    );
    if (shouldIngestCompoundPlan(rewritten)) {
      const ingested = await ingestCompoundDayPlan({
        userText: rewritten,
        frame: analysis.frame ?? null,
      });
      if (ingested?.targetDate) {
        compoundPlanDayKey = ingested.targetDate;
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] compound plan ingest', err);
  }

  // --- Call-2 Chat-Lane: nur wenn Call-1 execution=chat_lane ---
  {
    const useChat =
      call1Execution === 'chat_lane' &&
      !choiceFast &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start';
    if (useChat) {
      // Zwischenfrage: offene Queue behalten
      if (hasPendingIntents() && analysis.intents && analysis.intents.length > 1) {
        /* already seeded */
      }

      const chatResult = await runChatLane({
        userText: rewritten,
        turnId,
        bridgeFromRouter: analysis.bridge,
        blueprintId: analysis.blueprintId,
        nearestBlueprint: analysis.nearestBlueprint,
        blueprintStage: analysis.blueprintStage,
        needsResearch: analysis.needsResearch,
        personaVariant: analysis.personaVariant,
        cityHint: turnCityHint,
        cityKey: turnCityKey,
        openIntentsSummary: summarizeOpenIntents(),
        signal,
        fromPlanContext: false,
        topicScope: analysis.topicScope ?? {
          mode: 'new',
          turnsForCall2: 0,
          inheritLiveInventory: false,
        },
      });

      // Chat hat selbst Live-Recherche angefordert → nicht die Chat-Erfindung vorlesen
      if (
        chatResult.nextHandoff === 'pitch' ||
        chatResult.nextHandoff === 'events'
      ) {
        const allowInventory =
          analysis.topicScope?.inheritLiveInventory === true &&
          analysis.session !== 'new' &&
          analysis.topicScope?.mode !== 'new' &&
          (analysis.topicScope?.turnsForCall2 ?? 0) > 0;
        if (allowInventory) {
          rememberLiveInventoryQuery(
            rewritten,
            detectLiveInventoryKind(rewritten) ||
              (chatResult.nextHandoff === 'events' ? 'events' : 'pitch_choice'),
          );
        }
      } else {
        completeActiveIntent();

        // Weitere Chat-Intents in derselben Antwort nachziehen (nichts verwerfen)
        let extraSpeech = '';
        const extraBullets: string[] = [];
        try {
          const {
            hasPendingIntents: hasPend,
            peekActiveIntent,
            completeActiveIntent: completeNext,
            summarizeOpenIntents: sumOpen,
          } = require('./intentQueue') as typeof import('./intentQueue');
          let guard = 0;
          while (hasPend() && guard < 3) {
            guard += 1;
            const next = peekActiveIntent();
            if (!next || next.lane !== 'chat') break;
            const follow = await runChatLane({
              userText: next.brief || rewritten,
              turnId: `${turnId}_i${guard}`,
              bridgeFromRouter: null,
              blueprintId: (next.blueprintId as any) || null,
              nearestBlueprint: analysis.nearestBlueprint,
              blueprintStage: analysis.blueprintStage,
              needsResearch: analysis.needsResearch,
              personaVariant: analysis.personaVariant,
              cityHint: turnCityHint,
              cityKey: turnCityKey,
              openIntentsSummary: sumOpen(),
              signal,
              fromPlanContext: false,
              topicScope: analysis.topicScope ?? {
                mode: 'new',
                turnsForCall2: 0,
                inheritLiveInventory: false,
              },
            });
            if (
              follow.nextHandoff === 'pitch' ||
              follow.nextHandoff === 'events'
            ) {
              break;
            }
            if (follow.speech?.trim()) {
              extraSpeech = `${extraSpeech} ${follow.speech}`.trim();
            }
            for (const b of follow.bullets || []) {
              if (extraBullets.length < 3) extraBullets.push(b);
            }
            completeNext();
          }
          if (hasPend()) {
            const rest = sumOpen();
            if (rest) {
              extraSpeech = `${extraSpeech} Als Nächstes habe ich noch: ${rest.split('|')[0]?.trim()}.`.trim();
            }
          }
        } catch {
          /* soft */
        }

        if (extraSpeech) {
          chatResult.speech = `${chatResult.speech} ${extraSpeech}`.trim();
          chatResult.bullets = [
            ...(chatResult.bullets || []),
            ...extraBullets,
          ].slice(0, 5);
        }

        const presented = await presentChatLaneResult({
          turnId,
          result: chatResult,
          bridgeFromRouter: analysis.bridge,
          userText: rewritten,
        });

        try {
          commitThreadTurn({
            userText: rewritten,
            assistantSpeech: chatResult.speech,
            intent: analysis.jobHint || 'chat_lane',
            subject: subject || analysis.subject,
            cityHint: turnCityHint,
            cityKey: turnCityKey,
            saidFactLines: chatResult.bullets,
          });
        } catch {
          /* soft */
        }

        return presented;
      }
    }
  }

  // --- Handoffs ---
  // Compound-Skeleton → Step-Loop (Voice „jeden Punkt durchgehen“)
  try {
    const { looksLikePlanWalkthroughUtterance } = await import(
      '../planning/planUtteranceGate'
    );
    const { isPlanningModuleActive, usePlanSessionStore } = await import(
      '../planning/planSessionState'
    );
    if (
      call1Execution === 'plan_walkthrough' &&
      isPlanningModuleActive() &&
      (usePlanSessionStore.getState().plan?.openWishesQueue?.length ?? 0) > 0
    ) {
      const { runPlanningModule } = await import('../planning/runPlanningModule');
      await runPlanningModule({
        userText: rewritten,
        turnId,
        frame: analysis.frame,
      });
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
  } catch {
    /* soft */
  }

  if (handoff === 'm5_plan' && call1Execution !== 'flight_advisor') {
    const { shouldExclusiveM5Plan, call1OwnsCompoundTurn } = await import(
      '../reboot/pipeline/dispatchJobs'
    );
    const { isPlanAwaitingUserReply } = await import(
      '../planning/planSessionState'
    );
    let yieldFlight = false;
    try {
      const { shouldYieldPlanWaitToFlight } = await import(
        '../../services/flights/flightTripIntent'
      );
      const {
        hydrateFlightTripSession,
        hasFlightTripSession,
        getFlightTripSession,
      } = await import('../../services/flights/flightTripSession');
      await hydrateFlightTripSession();
      const open = hasFlightTripSession();
      yieldFlight = shouldYieldPlanWaitToFlight({
        userText: rewritten,
        hasOpenSession: open,
        pendingAsk: open ? getFlightTripSession()?.pendingAsk ?? null : null,
      });
    } catch {
      yieldFlight = false;
    }
    const exclusiveM5 =
      !yieldFlight &&
      (shouldExclusiveM5Plan(rewritten) ||
        (isPlanAwaitingUserReply() && !call1OwnsCompoundTurn(rewritten)));
    if (exclusiveM5) {
      const m5Route = await tryM5PlanRouteHandoff({
        rewritten,
        turnId,
        frame: analysis.frame,
      });
      if (m5Route) return m5Route;
    }
  }

  // Plan-Konflikt / Edit bei offenem Kalender → Modul 5
  try {
    const {
      shouldHandoffConflictToPlanning,
    } = await import('../planning/planConflictHandoff');
    const { looksLikePlanEditUtterance } = await import(
      '../planning/planEditDetect'
    );
    const { usePlanCalendarUiStore } = await import(
      '../timeline/planCalendarUiStore'
    );
    const { isPlanningModuleActive } = await import(
      '../planning/planSessionState'
    );
    const { isExplicitNavIntent } = await import(
      '../../services/intent/poiInfoVsNav'
    );
    // Explizite Navigation nie in M5 umleiten (Kalender offen / Session egal)
    if (!isExplicitNavIntent(rewritten) && call1Execution !== 'flight_advisor') {
      let yieldFlight = false;
      try {
        const { shouldYieldPlanWaitToFlight } = await import(
          '../../services/flights/flightTripIntent'
        );
        const {
          hydrateFlightTripSession,
          hasFlightTripSession,
          getFlightTripSession,
        } = await import('../../services/flights/flightTripSession');
        await hydrateFlightTripSession();
        const open = hasFlightTripSession();
        yieldFlight = shouldYieldPlanWaitToFlight({
          userText: rewritten,
          hasOpenSession: open,
          pendingAsk: open ? getFlightTripSession()?.pendingAsk ?? null : null,
        });
      } catch {
        yieldFlight = false;
      }
      if (
        !yieldFlight &&
        (usePlanCalendarUiStore.getState().calendarVisible ||
          isPlanningModuleActive() ||
          shouldHandoffConflictToPlanning(rewritten)) &&
        (looksLikePlanEditUtterance(rewritten) ||
          shouldHandoffConflictToPlanning(rewritten))
      ) {
        const { runPlanningModule } = await import('../planning/runPlanningModule');
        await runPlanningModule({
          userText: rewritten,
          turnId,
          frame: analysis.frame,
        });
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
    }
  } catch {
    /* soft */
  }

  // --- Tour-Modul (vor Pitch): Multi-Stop / Path / Dauer-Follow-up ---
  try {
    const {
      shouldHandoffToTourModule,
      buildTourRequestFromText,
      runTourModule,
      mergeDurationFollowUp,
      handleTourSoftReplanAnswer,
    } = await import('../tour');

    const softHandled = await handleTourSoftReplanAnswer(rewritten);
    if (softHandled) {
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
        jobId: 'sight_recommend',
      };
    }

    const durationMerged = mergeDurationFollowUp(rewritten);
    const tourHandoff =
      (call1Execution === 'tour_module' || durationMerged != null) &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer' &&
      handoff !== 'm5_plan';

    if (tourHandoff) {
      // Unseen-Auto-Tour: Navigation starten; sonst Timeline-Überblick.
      let unseenAuto = false;
      try {
        const { wantsUnseenTour } = require('../tour/parentBrief') as {
          wantsUnseenTour: (s: string) => boolean;
        };
        unseenAuto = wantsUnseenTour(rewritten);
      } catch {
        unseenAuto = /noch\s+nicht\s+(gesehen|besucht)|unbesucht/iu.test(rewritten);
      }
      const layout = unseenAuto ? ('start_nav_now' as const) : ('timeline_stack' as const);
      const built = durationMerged
        ? {
            request: {
              ...durationMerged,
              uiLayout: layout,
              visitedExclude: unseenAuto ? true : durationMerged.visitedExclude,
            },
            bridge: null as string | null,
          }
        : buildTourRequestFromText({
            text: rewritten,
            requestId: `m2_tour_${turnId}`,
            uiLayout: layout,
            signal,
          });
      const spokenBridge = await speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const bridge = spokenBridge || built.bridge;
      const result = await runTourModule(built.request);
      const tourButtons = result.actions.map((a, i) => ({
        id: a.payload.actionBoardId ?? `tour_btn_${i}`,
        label: (() => {
          try {
            const { shortenActionLabel } = require('../../services/concierge/actionLabelShorten') as {
              shortenActionLabel: (s: string, max?: number) => string;
            };
            return shortenActionLabel(a.label);
          } catch {
            return a.label;
          }
        })(),
        payload: {
          kind: 'navigate' as const,
          lat: a.payload.destLat!,
          lng: a.payload.destLng!,
          label: a.payload.destName ?? a.label,
          multiStop: a.payload.multiStop,
        },
      }));
      // Timeline-Überblick zuerst — kein Auto-Nav.
      // start_nav_now startet Multi-Stop bereits in runTourModule.
      const tourSpeech = stripLeadingBridgeEcho(result.spokenText, bridge);
      presentToUi(tourSpeech, result.bullets, tourButtons as never, {
        userText: rewritten,
        forceAutoNav: false,
      });
      enqueueSpeech({
        kind: 'main',
        text: tourSpeech,
        turnId,
      });
      const logic: LogicNodeOutput = {
        spokenDraft: tourSpeech,
        bullets: result.bullets,
        buttons: tourButtons,
        moneyEur: [],
        warnings: result.softFail ? ['soft_fail'] : [],
      };
      return {
        turnId,
        tasks: [],
        bridgingText: bridge,
        logic,
        synthesis: synthesizeOutput(logic),
        deepResearchQueued: false,
        jobId: 'sight_recommend',
      };
    }
  } catch {
    /* fall through */
  }

  // Tages-Events: Research + Buttons — nur execution=events_research
  try {
    const {
      isEventResearchQuery,
      researchTodaysEvents,
      synthesizeEventSpeech,
      eventResearchToActions,
      eventFactBullets,
      publishEventLivePitch,
      resolveEventResearchCity,
      buildEmptyEventResearch,
    } = await import('../../services/concierge/eventResearchService');
    if (
      call1Execution === 'events_research' &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer'
    ) {
      if (__DEV__) console.log('[events] handoff → researchTodaysEvents', rewritten.slice(0, 80));
      rememberLiveInventoryQuery(rewritten, 'events');
      const eventWait = await speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const eventCity =
        analysis.frame?.destCity ||
        analysis.cityScope?.researchCity ||
        resolveEventResearchCity(rewritten);
      const research =
        (await researchTodaysEvents(rewritten, {
          cityHint: eventCity,
          force: true,
        })) ||
        buildEmptyEventResearch(eventCity, 'research_unavailable');
      try {
        const { enrichEventsWithLiveTransit } = await import(
          '../../services/concierge/eventTravelSpeech'
        );
        const { useGpsStore } = await import('../../store/useGpsStore');
        const gps = useGpsStore.getState();
        if (
          gps.lat != null &&
          gps.lng != null &&
          research.events.length > 0
        ) {
          await enrichEventsWithLiveTransit({
            events: research.events,
            fromLat: gps.lat,
            fromLng: gps.lng,
            timeoutMs: 2800,
          });
        }
      } catch {
        /* soft — Luftlinien-ETA bleibt */
      }
      const seedSpeech = stripLeadingBridgeEcho(
        synthesizeEventSpeech(research),
        eventWait,
      );
        // Speech zuerst — Geocode/Button-Sync parallel danach
        if (seedSpeech.trim()) {
          enqueueSpeech({ kind: 'main', text: seedSpeech, turnId });
        }
        const seedActions = eventResearchToActions(research, {
          includeNav:
            research.events.length === 1 ||
            (() => {
              try {
                const {
                  wantsEventBriefingActions,
                  isEventFestivalDeepenQuery,
                } = require('../../services/concierge/eventResearchService') as {
                  wantsEventBriefingActions: (s: string) => boolean;
                  isEventFestivalDeepenQuery: (s: string) => boolean;
                };
                const {
                  looksLikeNamedScheduleQuery,
                } = require('../../services/concierge/sportsScheduleQuery') as {
                  looksLikeNamedScheduleQuery: (s: string) => boolean;
                };
                return (
                  looksLikeNamedScheduleQuery(rewritten) ||
                  wantsEventBriefingActions(rewritten) ||
                  isEventFestivalDeepenQuery(rewritten)
                );
              } catch {
                return false;
              }
            })(),
        });
        const { reflectAndSyncConciergeActions } = await import(
          '../../services/concierge/actionButtonSync'
        );
        const synced = await reflectAndSyncConciergeActions(
          {
            speechText: seedSpeech,
            visualBullets: eventFactBullets(research),
            quickActions: seedActions,
            cardTitle: 'Heute vor Ort',
          },
          { eventResearch: research, userText: rewritten },
        );
        const speech = synced.response.speechText || seedSpeech;
        let bullets = synced.response.visualBullets ?? eventFactBullets(research);
        try {
          let namedAskPitch = false;
          try {
            const {
              looksLikeNamedScheduleQuery,
            } = require('../../services/concierge/sportsScheduleQuery') as {
              looksLikeNamedScheduleQuery: (s: string) => boolean;
            };
            namedAskPitch = looksLikeNamedScheduleQuery(rewritten);
          } catch {
            namedAskPitch = false;
          }
          // Genannter Spielplan = Answer-First, kein Ambient-/Live-Pitch-UI
          if (!namedAskPitch) {
            publishEventLivePitch(research, speech);
          }
        } catch {
          /* soft */
        }
        const eventButtons = synced.response.quickActions
          .slice(0, 4)
          .map((a, i) => {
            if (
              a.type === 'START_NAVIGATION' &&
              typeof a.payload.destLat === 'number' &&
              typeof a.payload.destLng === 'number'
            ) {
              return {
                id: `ev_nav_${i}`,
                label: a.label,
                payload: {
                  kind: 'navigate' as const,
                  lat: a.payload.destLat,
                  lng: a.payload.destLng,
                  label: a.payload.destName || a.label,
                },
              };
            }
            if (a.type === 'OPEN_URL' && a.payload.url) {
              return {
                id: `ev_url_${i}`,
                label: a.label,
                payload: {
                  kind: 'deep_link' as const,
                  url: a.payload.url,
                  destName: a.payload.destName,
                },
              };
            }
            if (a.type === 'SHOW_MORE') {
              return {
                id: `ev_more_${i}`,
                label: a.label,
                payload: {
                  kind: 'ui' as const,
                  action: 'ask_history',
                  data: {
                    prompt:
                      a.payload.textPrompt ||
                      'Zeig mir noch zwei andere Locations für heute Abend — mit Route.',
                  },
                },
              };
            }
            return null;
          })
          .filter(Boolean) as Array<{
          id: string;
          label: string;
          payload: Record<string, unknown>;
        }>;
        let buttonsClean = [...eventButtons];
        // Mindestens PDF/Ticket behalten — wenn Sync alles wegfilterte, Seed-URLs nachziehen
        if (
          !buttonsClean.some((b) => b.payload.kind === 'deep_link') &&
          research.events.some((e) => e.infoUrl || e.ticketUrl)
        ) {
          for (const e of research.events.slice(0, 3)) {
            const url = e.ticketUrl || e.infoUrl;
            if (!url) continue;
            buttonsClean.push({
              id: `ev_seed_${buttonsClean.length}`,
              label: (() => {
                try {
                  const { shortenActionLabel } = require('../../services/concierge/actionLabelShorten') as {
                    shortenActionLabel: (s: string, max?: number) => string;
                  };
                  return shortenActionLabel(
                    e.ticketUrl ? '🎫 Tickets' : e.hasPdf ? '📄 PDF' : `ℹ️ ${e.title}`,
                  );
                } catch {
                  return e.ticketUrl ? '🎫 Tickets' : '📄 Info';
                }
              })(),
              payload: { kind: 'deep_link', url, destName: e.venue },
            });
            if (buttonsClean.length >= 4) break;
          }
        }
        // Kein belegtes Programm: bei genanntem Termin keine Fake-Nightlife-Chips.
        // Sonst kurze Nachzieh-Prompts — Stichpunkte aus Speech ableiten lassen.
        if (!research.events.length) {
          let namedAsk = false;
          try {
            const {
              looksLikeNamedScheduleQuery,
            } = require('../../services/concierge/sportsScheduleQuery') as {
              looksLikeNamedScheduleQuery: (s: string) => boolean;
            };
            namedAsk = looksLikeNamedScheduleQuery(rewritten);
          } catch {
            namedAsk = false;
          }
          if (namedAsk) {
            bullets = [];
            buttonsClean = buttonsClean.filter((b) => b.payload.kind === 'deep_link');
          } else {
            bullets = [];
            buttonsClean = [
              {
                id: 'ev_ask_live',
                label: '🎸 Live-Musik',
                payload: {
                  kind: 'ui' as const,
                  action: 'ask_history',
                  data: {
                    prompt:
                      'Such gezielt nach Live-Musik oder Open-Mic heute Abend — mit Route und Links.',
                  },
                },
              },
              {
                id: 'ev_ask_bar',
                label: '🍹 Bar/Club',
                payload: {
                  kind: 'ui' as const,
                  action: 'ask_history',
                  data: {
                    prompt:
                      'Was läuft heute Abend in einer Bar oder einem Club — Programm, Route, Tickets.',
                  },
                },
              },
              {
                id: 'ev_ask_concert',
                label: '🎤 Konzert',
                payload: {
                  kind: 'ui' as const,
                  action: 'ask_history',
                  data: {
                    prompt:
                      'Gibt es heute Abend Konzerte oder Live-Shows hier — mit Route und Infos.',
                  },
                },
              },
            ];
          }
        }
        await presentToUi(speech, bullets, buttonsClean as never, {
          userText: rewritten,
          skipBulletDerive: bullets.filter(Boolean).length > 0,
        });
        // Main-Speech schon oben gestartet — nur nachziehen wenn Sync den Text geändert hat
        if (speech.trim() && speech.trim() !== seedSpeech.trim()) {
          enqueueSpeech({ kind: 'main', text: speech, turnId });
        }
        const logic: LogicNodeOutput = {
          spokenDraft: speech,
          bullets,
          buttons: buttonsClean as never,
          moneyEur: [],
          warnings: research.events.length ? [] : ['no_events'],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: eventWait,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nightlife_vibe',
        };
    }
  } catch (err) {
    console.warn('[events] handoff failed', err);
    try {
      const {
        resolveEventResearchCity,
        buildEmptyEventResearch,
        synthesizeEventSpeech,
      } = await import('../../services/concierge/eventResearchService');
      const city = resolveEventResearchCity(rewritten);
      const failSpeech = synthesizeEventSpeech(
        buildEmptyEventResearch(
          city,
          'Recherche gerade fehlgeschlagen — gezielter nachfragen anbieten',
        ),
      );
      if (failSpeech.trim()) {
        enqueueSpeech({ kind: 'main', text: failSpeech, turnId });
        await presentToUi(failSpeech, [], [], { userText: rewritten });
        const logic: LogicNodeOutput = {
          spokenDraft: failSpeech,
          bullets: [],
          buttons: [],
          moneyEur: [],
          warnings: ['event_research_failed'],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nightlife_vibe',
        };
      }
    } catch {
      /* soft fall through */
    }
  }

  // Auswahl-Pitch (M2): nur wenn Call-1 execution=pitch_module
  try {
    if (
      call1Execution === 'pitch_module' &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer'
    ) {
      rememberLiveInventoryQuery(
        rewritten,
        detectLiveInventoryKind(rewritten) ||
          (String(analysis.blueprintId || '').startsWith('hotel')
            ? 'hotel'
            : 'pitch_choice'),
      );
      if (__DEV__) console.log('[pitch] handoff → runPitchModule', rewritten.slice(0, 80));
      try {
        const { noteTourAfterParkingPitch } = await import('./compoundFollowUp');
        noteTourAfterParkingPitch(rewritten);
      } catch {
        /* soft */
      }
      if (signal?.aborted) {
        return {
          turnId,
          tasks: [],
          bridgingText: null,
          logic: {
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          },
          synthesis: synthesizeOutput({
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          }),
          deepResearchQueued: false,
          jobId: 'sight_recommend',
        };
      }
      try {
        const { useLivePitchStore } = await import('../pitch/publishPitchUi');
        useLivePitchStore.getState().setLoading(rewritten.slice(0, 48));
      } catch {
        /* soft */
      }
      const { buildPitchRequestFromText } = await import(
        '../pitch/buildPitchRequest'
      );
      const { runPitchModule } = await import('../pitch/runPitchModule');
      const intro = await speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const { request, bridge } = buildPitchRequestFromText({
        text: rewritten,
        requestId: `m2_${turnId}`,
        uiLayout: 'live_split',
        signal,
        continueFromBridge: intro,
        call1MustHaves: [
          ...(analysis.mustHaves ?? []),
          ...(analysis.frame?.mustHaves ?? []),
          ...(analysis.criteria ?? [])
            .filter((c) => c.role === 'must')
            .map((c) => c.key),
        ],
        call1Criteria: analysis.criteria ?? null,
        authorIntent:
          analysis.authorIntent ||
          analysis.call2Brief ||
          analysis.intentSummary ||
          null,
        call1DestCity:
          analysis.frame?.destCity ||
          analysis.cityScope?.researchCity ||
          analysis.cityScope?.cityId ||
          null,
        call1When: analysis.frame?.when ?? null,
      });
      if (signal?.aborted) {
        try {
          const { useLivePitchStore } = await import('../pitch/publishPitchUi');
          useLivePitchStore.getState().clear();
        } catch {
          /* soft */
        }
        return {
          turnId,
          tasks: [],
          bridgingText: null,
          logic: {
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          },
          synthesis: synthesizeOutput({
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          }),
          deepResearchQueued: false,
          jobId: 'sight_recommend',
        };
      }
      const result = await runPitchModule(request);
      if (signal?.aborted) {
        try {
          const { useLivePitchStore } = await import('../pitch/publishPitchUi');
          useLivePitchStore.getState().clear();
        } catch {
          /* soft */
        }
        return {
          turnId,
          tasks: [],
          bridgingText: null,
          logic: {
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          },
          synthesis: synthesizeOutput({
            spokenDraft: '',
            bullets: [],
            buttons: [],
            moneyEur: [],
            warnings: ['aborted'],
          }),
          deepResearchQueued: false,
          jobId: 'sight_recommend',
        };
      }
      const pitchButtons = result.options.slice(0, 2).flatMap((o, i) => {
        const medal = i === 0 ? '🥇' : '🥈';
        const primary =
          o.actions.find((a) => a.type === 'OPEN_URL') ||
          o.actions.find((a) => a.type === 'START_NAVIGATION') ||
          o.actions[0];
        if (!primary) return [] as Array<{
          id: string;
          label: string;
          payload:
            | { kind: 'navigate'; lat: number; lng: number; label: string }
            | { kind: 'deep_link'; url: string; destName: string };
        }>;
        const label = (() => {
          try {
            const { shortenActionLabel } = require('../../services/concierge/actionLabelShorten') as {
              shortenActionLabel: (s: string, max?: number) => string;
            };
            return shortenActionLabel(`${medal} ${o.name}`, 28);
          } catch {
            return `${medal} ${o.name}`.slice(0, 28);
          }
        })();
        if (primary.type === 'START_NAVIGATION') {
          const p = primary.payload as {
            destName?: string;
            destLat?: number;
            destLng?: number;
          };
          const lat =
            typeof p.destLat === 'number' && Number.isFinite(p.destLat)
              ? p.destLat
              : o.lat;
          const lng =
            typeof p.destLng === 'number' && Number.isFinite(p.destLng)
              ? p.destLng
              : o.lng;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return [
              {
                id: `pitch_nav_${i}`,
                label,
                payload: {
                  kind: 'navigate' as const,
                  lat,
                  lng,
                  label: p.destName || o.name,
                },
              },
            ];
          }
        }
        const url =
          primary.payload &&
          typeof primary.payload === 'object' &&
          'url' in primary.payload
            ? String((primary.payload as { url?: string }).url ?? '')
            : o.mapsUrl || '';
        if (!url) return [];
        return [
          {
            id: `pitch_url_${i}`,
            label,
            payload: { kind: 'deep_link' as const, url, destName: o.name },
          },
        ];
      });
      const pitchBullets = (() => {
        const humanizeEvidence = (b: string): string | null => {
          const t = b.trim();
          if (!t) return null;
          // Machine-Tags nie in UI (cuisine_steak, amenity_pool, …)
          if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/u.test(t)) {
            const last = t.split('_').pop() || '';
            if (last.length >= 3) {
              return last.charAt(0).toUpperCase() + last.slice(1);
            }
            return null;
          }
          if (/^(cuisine|amenity|tag|facet)[:_]/iu.test(t)) {
            const rest = t.replace(/^(cuisine|amenity|tag|facet)[:_]+/iu, '').trim();
            return rest
              ? rest.charAt(0).toUpperCase() + rest.slice(1)
              : null;
          }
          return t;
        };
        const fromOpts = result.options
          .flatMap((o) =>
            (o.bullets ?? [])
              .map((b) => humanizeEvidence(String(b)))
              .filter((b): b is string => Boolean(b))
              .slice(0, 2)
              .map((b) => (o.name ? `${o.name}: ${b}` : b)),
          )
          .filter(Boolean);
        if (fromOpts.length) return fromOpts.slice(0, 3);
        const names = result.options
          .map((o) => o.name)
          .filter(Boolean)
          .slice(0, 3);
        if (names.length) return names;
        // SoftFail ohne Optionen: Speech → Stichpunkte, sonst unsichtbare Karte
        if (result.softFail && result.spokenText?.trim()) {
          try {
            const { deriveMemoryBullets } = require('../../services/concierge/speechMemoryBullets') as {
              deriveMemoryBullets: (
                speech: string,
                prior?: string[] | null,
                o?: { userText?: string },
              ) => string[];
            };
            return deriveMemoryBullets(result.spokenText, [], {
              userText: rewritten,
            }).slice(0, 3);
          } catch {
            return result.spokenText
              .split(/(?<=[.!?])\s+/)
              .map((s) => s.trim())
              .filter((s) => s.length >= 12)
              .slice(0, 2);
          }
        }
        return [];
      })();
      const pitchSpeech = stripLeadingBridgeEcho(result.spokenText, bridge);
      await presentToUi(pitchSpeech, pitchBullets, pitchButtons as never, {
        userText: rewritten,
      });
      enqueueSpeech({
        kind: 'main',
        text: pitchSpeech,
        turnId,
      });
      const logic: LogicNodeOutput = {
        spokenDraft: pitchSpeech,
        bullets: pitchBullets,
        buttons: pitchButtons as never,
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
  } catch (err) {
    console.warn('[pitch] handoff failed', err);
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
    const { text: bridge } = await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
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

  // Say–Do: Amenity-Nav VOR Manager-Fanout (kein Timeout-Lücken-Speech)
  let amenityFact: AgentResult | null = null;
  try {
    const { isExplicitNavIntent } = await import(
      '../../services/intent/poiInfoVsNav'
    );
    const { detectAmenityKind, researchAmenityNav } = await import(
      '../agents/amenityNavFacts'
    );
    const { anchorCoords } = await import('../rucksack/rucksackStore');
    const amenity = detectAmenityKind(rewritten);
    if (amenity && isExplicitNavIntent(rewritten)) {
      const a = anchorCoords(rucksack);
      if (__DEV__) console.log('[nav] amenity direct start', amenity, a.lat, a.lng);
      const recovered = await researchAmenityNav({
        userText: rewritten,
        lat: a.lat,
        lng: a.lng,
        kind: amenity,
        commitNearest: true,
      });
      if (recovered.ok) {
        amenityFact = {
          ...recovered,
          meta: {
            ...recovered.meta,
            autoStartNav: true,
            forceAutoNav: true,
            amenityNav: true,
            unique: true,
          },
        };
        if (__DEV__) {
          console.log(
            '[nav] amenity direct ok',
            amenity,
            recovered.meta?.destName ?? recovered.draftText?.slice(0, 60),
          );
        }
      }
    }
  } catch (err) {
    console.warn('[nav] amenity direct failed', err);
  }

  const fanoutPromise = amenityFact
    ? null
    : runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject,
        city: short.lastMentionedCity,
        signal,
      });

  let bridgingText: string | null = analysis.bridgeSpokenEarly
    ? analysis.bridge
    : null;
  if (analysis.bridgeSpokenEarly) {
    try {
      const { getFusedTurnPump } = require('../speech/fusedTurnSpeech') as {
        getFusedTurnPump: () => { hasStarted: () => boolean };
      };
      if (!getFusedTurnPump().hasStarted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly) {
    const br = await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
    bridgingText = br.text;
  }

  const bridgeOnce = bridgingText;

  const fanout = amenityFact
    ? {
        mergedFact: amenityFact,
        fastResults: [] as import('./runManagerTasks').ManagerTaskResult[],
        silentSlowPending: [] as typeof analysis.tasks,
        spokenSlowPending: [] as typeof analysis.tasks,
      }
    : await fanoutPromise!;
  try {
    const { latencyMark } = require('../../services/debug/latencyTiming') as {
      latencyMark: (m: string, d?: string) => void;
    };
    latencyMark('research', `${fanout.mergedFact?.agent ?? 'fanout'}`);
  } catch {
    /* soft */
  }

  if (!amenityFact && fanout.silentSlowPending.length) {
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

  if (compoundPlanDayKey) {
    try {
      const { enrichCompoundPlanFromFacts } = await import(
        '../planning/compoundPlanIngest'
      );
      enrichCompoundPlanFromFacts({
        fact,
        taskResults: 'fastResults' in fanout ? fanout.fastResults : [],
        userText: rewritten,
      });
    } catch {
      /* soft */
    }
  }

  // Say–Do Recovery: Amenity-Nav (Aldi/Lidl/…) nie als Manager-Timeout-Lücke sprechen
  try {
    const { isExplicitNavIntent } = await import(
      '../../services/intent/poiInfoVsNav'
    );
    const { detectAmenityKind, researchAmenityNav } = await import(
      '../agents/amenityNavFacts'
    );
    const { anchorCoords } = await import('../rucksack/rucksackStore');
    const amenity = detectAmenityKind(rewritten);
    const draft = String(fact?.draftText ?? '');
    const timedOut =
      /LÜCKEN\s*\(Timeout\)/i.test(draft) ||
      /Keine Fast-Fakten/i.test(draft) ||
      fact?.meta?.destLat == null;
    if (
      !amenityFact &&
      amenity &&
      (isExplicitNavIntent(rewritten) || timedOut)
    ) {
      const a = anchorCoords(rucksack);
      const recovered = await researchAmenityNav({
        userText: rewritten,
        lat: a.lat,
        lng: a.lng,
        kind: amenity,
        commitNearest: isExplicitNavIntent(rewritten),
      });
      if (recovered.ok && (recovered.buttons?.length || recovered.meta?.destLat)) {
        const explicit = isExplicitNavIntent(rewritten);
        fact = {
          ...recovered,
          meta: {
            ...recovered.meta,
            autoStartNav:
              explicit || recovered.meta?.autoStartNav === true,
            forceAutoNav: explicit,
            amenityNav: true,
            ...(explicit ? { unique: true } : {}),
          },
        };
        if (__DEV__) {
          console.log(
          '[nav] amenity recovery ok',
          amenity,
          recovered.meta?.destName ?? '',
        );
        }
      }
    }
  } catch (err) {
    console.warn('[nav] amenity recovery failed', err);
  }

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
        if (compoundPlanDayKey) {
          try {
            const { enrichCompoundPlanFromFacts } = require('../planning/compoundPlanIngest') as {
              enrichCompoundPlanFromFacts: (o: {
                taskResults: unknown[];
                userText: string;
              }) => boolean;
            };
            enrichCompoundPlanFromFacts({
              taskResults: slowResults,
              userText: rewritten,
            });
          } catch {
            /* soft */
          }
        }
        const igResults = slowResults.filter(
          (r) => r.task.lane === 'instagram' && r.status === 'ok',
        );
        const igHit = igResults.find(
          (r) =>
            r.meta?.instagramFallback !== true &&
            (r.buttons?.length ?? 0) > 0,
        );
        if (igHit?.draftText?.trim()) {
          enqueueSpeech({
            kind: 'main',
            text: String(igHit.draftText).slice(0, 1200),
            turnId: `${turnId}_ig`,
          });
          try {
            const { useFinnusStore } = require('../../store/useFinnusStore') as {
              useFinnusStore: {
                getState: () => {
                  activeConciergeCard: Record<string, unknown> | null;
                  setActiveConciergeCard: (c: unknown) => void;
                };
              };
            };
            const card = useFinnusStore.getState().activeConciergeCard;
            if (card && igHit.buttons?.length) {
              const extraActions = igHit.buttons.flatMap((b) => {
                const p = b.payload;
                if (!p || p.kind !== 'deep_link' || !p.url) return [];
                return [
                  {
                    type: 'OPEN_URL' as const,
                    label: b.label,
                    payload: { url: String(p.url) },
                  },
                ];
              });
              if (extraActions.length) {
                const prev = (card.quickActions as unknown[]) ?? [];
                useFinnusStore.getState().setActiveConciergeCard({
                  ...card,
                  quickActions: [...prev, ...extraActions].slice(0, 4),
                });
              }
            }
          } catch {
            /* soft */
          }
          return;
        }
        const extra = slowResults
          .filter((r) => r.status === 'ok' && r.draftText)
          .map((r) => r.draftText)
          .join(' ')
          .slice(0, 400);
        if (extra && !/INSTAGRAM:\s*Keine belegten/i.test(extra)) {
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
            text: 'Auf Instagram war öffentlich nichts Brauchbares dazu — ich bleibe bei den Web-Quellen.',
            turnId: `${turnId}_ig_empty`,
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

  if (
    (handoff === 'm3_nav_start' ||
      (typeof rewritten === 'string' &&
        (() => {
          try {
            const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
              isExplicitNavIntent: (t: string) => boolean;
            };
            return isExplicitNavIntent(rewritten);
          } catch {
            return false;
          }
        })())) &&
    fact.meta?.needsNavConfirm !== true
  ) {
    fact = {
      ...fact,
      meta: { ...fact.meta, autoStartNav: true, forceAutoNav: true },
    };
  }

  // Say–Do: Navigation VOR der Stimme starten, wenn Ziel-Koordinaten schon da
  let navPreStarted = false;
  if (
    fact.meta?.needsNavConfirm !== true &&
    (fact.meta?.autoStartNav === true || fact.meta?.forceAutoNav === true) &&
    typeof fact.meta?.destLat === 'number' &&
    typeof fact.meta?.destLng === 'number' &&
    Number.isFinite(fact.meta.destLat) &&
    Number.isFinite(fact.meta.destLng)
  ) {
    try {
      const { commitHandsFreeNavStart } = await import(
        '../../services/navigation/handsFreeNav'
      );
      const started = await commitHandsFreeNavStart(
        {
          poiId: -1,
          name:
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName
              : 'Ziel',
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          userQuery: rewritten,
        },
        { skipClosingGate: true },
      );
      navPreStarted = started.ok === true;
      if (__DEV__) {
        console.log(
          '[runConciergeTurn] pre-start nav',
          started.ok,
          'via=' + (started as { via?: string }).via,
          'name=' + started.name,
        );
      }
      if (started.needsConfirm && started.message) {
        fact = {
          ...fact,
          draftText: started.message,
          meta: {
            ...fact.meta,
            autoStartNav: false,
            forceAutoNav: false,
            needsNavConfirm: true,
          },
        };
      } else if (navPreStarted) {
        useFinnusStore.getState().patchNavigation({
          navActive: true,
          navVisible: true,
        });
        // Explizite Nav: nur Call1+Call2 — kein Pack-/Meta-/Gastro-Gelaber
        try {
          const {
            buildExplicitNavCommitSpeech,
            arriveHmFromEtaMin,
          } = require('../../services/navigation/navStartSpeech') as {
            buildExplicitNavCommitSpeech: (o: {
              destName: string;
              etaMin: number | null;
              mode?: 'foot' | 'bike' | 'drive' | null;
              arriveHm?: string | null;
              bridgeAlreadySpoken?: boolean;
            }) => string;
            arriveHmFromEtaMin: (m: number | null) => string | null;
          };
          const { getCommittedRoutePhrase } = require('../../services/navigation/navSpeechDistance') as {
            getCommittedRoutePhrase: () => { etaMin: number | null } | null;
          };
          const dest =
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName.trim()
              : 'Ziel';
          const phrase = getCommittedRoutePhrase();
          let etaMin =
            phrase?.etaMin ??
            (typeof fact.meta.etaMin === 'number' && Number.isFinite(fact.meta.etaMin)
              ? Math.max(1, Math.round(fact.meta.etaMin))
              : useFinnusStore.getState().navEtaMin);
          if (etaMin != null && Number.isFinite(etaMin)) {
            etaMin = Math.max(1, Math.round(etaMin));
          } else {
            etaMin = null;
          }
          let mode: 'foot' | 'bike' | 'drive' | null = null;
          try {
            const {
              resolveActiveTravelMode,
            } = require('../../services/navigation/travelModeContext') as {
              resolveActiveTravelMode: () => { mode: string };
            };
            const m = resolveActiveTravelMode().mode;
            mode =
              m === 'bike' || m === 'drive' || m === 'foot'
                ? m
                : fact.meta?.bike === true
                  ? 'bike'
                  : 'foot';
          } catch {
            mode = fact.meta?.bike === true ? 'bike' : 'foot';
          }
          const arriveHm =
            etaMin != null && etaMin > 60 ? arriveHmFromEtaMin(etaMin) : null;
          fact = {
            ...fact,
            draftText: buildExplicitNavCommitSpeech({
              destName: dest,
              etaMin,
              mode,
              arriveHm,
              bridgeAlreadySpoken:
                (bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly) &&
                /starte die Navigation|Navigation (zum|nach|zu)\b/i.test(
                  String(analysis.bridge || ''),
                ),
            }),
            bullets: [],
            buttons: [],
          };
          try {
            const { markNavOpeningSpoken } = require('../../services/navigation/landmarkNavCoach') as {
              markNavOpeningSpoken: () => void;
            };
            markNavOpeningSpoken();
          } catch {
            /* soft */
          }
        } catch {
          const dest =
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName
              : 'Ziel';
          fact = {
            ...fact,
            draftText: `Alles klar, ich starte die Navigation zum ${dest}.`,
            bullets: [],
            buttons: [],
          };
        }
      } else if (typeof fact.draftText === 'string' && fact.draftText.trim()) {
        const { stripFakeReservationClaims } = await import(
          '../../services/concierge/zeroFakeActions'
        );
        fact = {
          ...fact,
          draftText: stripFakeReservationClaims(fact.draftText, [], {
            navActuallyStarted: false,
          }),
          meta: { ...fact.meta, autoStartNav: false },
        };
      }
    } catch (err) {
      console.warn('[runConciergeTurn] pre-start nav failed', err);
    }
  }

  const logic = runLogicNode({
    results: [fact],
    futurePlan: rucksack.futurePlan,
  });

  const skipLlm =
    fact.meta?.amenityNav === true ||
    fact.meta?.parkingCare === true ||
    fact.meta?.pitchModule === true ||
    fact.meta?.autoStartNav === true ||
    fact.meta?.forceAutoNav === true ||
    fact.agent === 'trigger' ||
    (fact.agent === 'mobility' &&
      typeof fact.meta?.destLat === 'number' &&
      typeof fact.meta?.destLng === 'number') ||
    fact.agent === 'system';

  let streamedSentenceCount = 0;
  const livePump = getFusedTurnPump();
  const speakStreamedSentence = async (sentence: string, index: number) => {
    if (signal?.aborted || !sentence.trim()) return;
    streamedSentenceCount += 1;
    try {
      const { noteFindusSpokenForEcho } = require('../../services/handsFree/echoGuard') as {
        noteFindusSpokenForEcho: (t: string) => void;
      };
      noteFindusSpokenForEcho(sentence);
    } catch {
      /* soft */
    }
    livePump.push(sentence);
    if (index === 0) {
      try {
        const { latencyMark } = require('../../services/debug/latencyTiming') as {
          latencyMark: (m: string, d?: string) => void;
        };
        latencyMark('tts', 'first_main');
      } catch {
        /* soft */
      }
      try {
        const { markCall2FirstSentence } = require('../reboot/pipeline/turnLatencyMetrics') as {
          markCall2FirstSentence: () => void;
        };
        markCall2FirstSentence();
      } catch {
        /* soft */
      }
    }
    if (!livePump.hasStarted()) {
      await startLiveSpeechSession(livePump, turnId, sentence);
    }
  };

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
    let partnerHints: import('../../services/affiliate/helpFirstMonetization').HelpFirstMoment[] =
      [];
    try {
      const {
        detectHelpFirstMoments,
      } = require('../../services/affiliate/helpFirstMonetization') as {
        detectHelpFirstMoments: (o: {
          userText?: string;
          jobHints?: string[];
        }) => import('../../services/affiliate/helpFirstMonetization').HelpFirstMoment[];
      };
      partnerHints = detectHelpFirstMoments({
        userText: rewritten,
        jobHints: [jobId].filter(Boolean),
      }).slice(0, 2);
    } catch {
      partnerHints = [];
    }
    synthesis = await synthesizeRebootTurn({
      userText: rewritten,
      fact,
      bridgeOneLiner: bridgeOnce,
      jobId,
      speechBudgetChars: getJobContract(jobId).speechBudgetChars,
      signal,
      rucksack: turnRucksack,
      topicScope: analysis.topicScope,
      cityKey: turnCityKey,
      turnId,
      partnerHints,
      call2Brief: analysis.call2Brief ?? null,
      selectedGoldBlock: (() => {
        try {
          const { formatSelectedGoldForCall2 } = require('./call1OwnerGoldCatalog') as {
            formatSelectedGoldForCall2: (k?: string[] | null) => string;
          };
          return formatSelectedGoldForCall2(analysis.selectedGoldKeys) || null;
        } catch {
          return null;
        }
      })(),
      call1WhenBlock: (() => {
        try {
          const { formatCall1WhenSlotsForPrompt } = require('./turnFrame') as {
            formatCall1WhenSlotsForPrompt: (
              f: ManagerAnalysis['frame'],
            ) => string;
          };
          return formatCall1WhenSlotsForPrompt(analysis.frame) || null;
        } catch {
          return null;
        }
      })(),
      call1CriteriaBlock: (() => {
        try {
          const { formatCall1CriteriaForPrompt, mergeCall1Criteria } =
            require('../pitch/call1Criteria') as {
              formatCall1CriteriaForPrompt: (
                c: NonNullable<ManagerAnalysis['criteria']>,
              ) => string;
              mergeCall1Criteria: (o: {
                criteria?: ManagerAnalysis['criteria'];
                mustHaves?: string[] | null;
              }) => NonNullable<ManagerAnalysis['criteria']>;
            };
          const merged = mergeCall1Criteria({
            criteria: analysis.criteria,
            mustHaves: [
              ...(analysis.mustHaves ?? []),
              ...(analysis.frame?.mustHaves ?? []),
            ],
          });
          return formatCall1CriteriaForPrompt(merged) || null;
        } catch {
          return null;
        }
      })(),
      onSpeechSentence: (sentence, index) => {
        void speakStreamedSentence(sentence, index);
      },
    });
  }

  let buttons =
    synthesis.buttons.length > 0 ? synthesis.buttons : logic.buttons;

  // Hilfe-zuerst: fehlende Partner-Buttons (max 2) — nie Uber aus Help-First
  try {
    const {
      detectHelpFirstMoments,
      injectHelpFirstModule2Buttons,
    } = require('../../services/affiliate/helpFirstMonetization') as {
      detectHelpFirstMoments: (o: {
        userText?: string;
        jobHints?: string[];
      }) => Array<{ kind: string }>;
      injectHelpFirstModule2Buttons: (o: {
        buttons: typeof buttons;
        moments: Array<{ kind: string; promptHint: string; priority: number }>;
        userText?: string | null;
        cityName?: string | null;
        placeName?: string | null;
        openTableIdOrUrl?: string | null;
        venueWebsite?: string | null;
        venuePhone?: string | null;
      }) => typeof buttons;
    };
    const moments = detectHelpFirstMoments({
      userText: rewritten,
      jobHints: [jobId].filter(Boolean),
    }).slice(0, 3);
    const placeName =
      typeof fact.meta?.placeName === 'string' ? fact.meta.placeName : null;
    const openTableIdOrUrl =
      typeof fact.meta?.openTableId === 'string'
        ? fact.meta.openTableId
        : typeof fact.meta?.openTableUrl === 'string'
          ? fact.meta.openTableUrl
          : null;
    const venueWebsite =
      typeof fact.meta?.website === 'string'
        ? fact.meta.website
        : typeof fact.meta?.venueWebsite === 'string'
          ? fact.meta.venueWebsite
          : null;
    const venuePhone =
      typeof fact.meta?.phone === 'string'
        ? fact.meta.phone
        : typeof fact.meta?.venuePhone === 'string'
          ? fact.meta.venuePhone
          : null;
    buttons = injectHelpFirstModule2Buttons({
      buttons,
      moments: moments as Array<{
        kind: string;
        promptHint: string;
        priority: number;
      }>,
      userText: rewritten,
      cityName: turnCityKey || null,
      placeName,
      openTableIdOrUrl,
      venueWebsite,
      venuePhone,
    });
  } catch {
    /* soft */
  }

  // Fremde Stadt mit Pack: Download-Button + kurzer Speech-Hinweis (Suche läuft trotzdem).
  // Flug-Leave-by / Wetter: kein Pack-Switch anhängen.
  try {
    const offer = getShortTerm().cityPackOffer;
    let flightJob = analysis.jobHint === 'flight_trip';
    if (!flightJob && analysis.frame) {
      try {
        const { frameHasWorker } = require('./turnFrame') as {
          frameHasWorker: (
            f: ManagerAnalysis['frame'],
            w: 'flight',
          ) => boolean;
        };
        flightJob = frameHasWorker(analysis.frame, 'flight');
      } catch {
        flightJob = false;
      }
    }
    let weatherTurn = false;
    try {
      const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {
        looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      };
      const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
        classifyUtteranceFamily: (s: string) => { family: string };
      };
      weatherTurn =
        looksLikeOutfitOrWeatherUtterance(rewritten) ||
        classifyUtteranceFamily(rewritten).family === 'weather' ||
        analysis.blueprintId === 'weather' ||
        (analysis.frame &&
          (require('./turnFrame') as {
            frameHasWorker: (
              f: ManagerAnalysis['frame'],
              w: 'weather',
            ) => boolean;
          }).frameHasWorker(analysis.frame, 'weather'));
    } catch {
      weatherTurn = false;
    }
    if (offer && !flightJob && !weatherTurn) {
      let supermarketOffer = false;
      try {
        const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
          isSupermarketOfferQuery: (s: string) => boolean;
        };
        supermarketOffer = isSupermarketOfferQuery(rewritten);
      } catch {
        supermarketOffer = false;
      }
      if (!supermarketOffer) {
        const already = buttons.some((b) =>
          /datensatz|stadt.?pack|laden/i.test(b.label || ''),
        );
        if (!already && buttons.length < 4) {
          buttons = [
            ...buttons,
            {
              id: `city_pack_${offer.cityId}`,
              label: `📥 ${offer.cityName} laden`,
              payload: {
                kind: 'ui' as const,
                action: 'install_city_pack',
                data: {
                  cityId: offer.cityId,
                  cityName: offer.cityName,
                  prompt: `Bitte lade jetzt den Stadt-Datensatz für ${offer.cityName} (${offer.cityId}).`,
                },
              },
            },
          ].slice(0, 4);
        }
        const spoken = (synthesis.fullDraftForUi || '').trim();
        if (spoken && !/datensatz|herunterladen|pack laden/i.test(spoken)) {
          synthesis = {
            ...synthesis,
            fullDraftForUi: `${spoken} ${offer.speechHint}`.trim(),
            spokenChunks: [
              ...(synthesis.spokenChunks || []),
              offer.speechHint,
            ].filter(Boolean),
          };
        }
      }
    }
  } catch {
    /* soft */
  }

  try {
    const { applyCall2TailEffects } = await import(
      '../reboot/pipeline/executeCall2TailEffects'
    );
    const { parseCall2Tail } = await import('../reboot/pipeline/call2Tail');
    const tailRaw =
      synthesis.call2Tail && typeof synthesis.call2Tail === 'object'
        ? JSON.stringify(synthesis.call2Tail)
        : '';
    const tailParsed = tailRaw ? parseCall2Tail(tailRaw) : null;
    synthesis = await applyCall2TailEffects({
      tail: tailParsed,
      synthesis,
      userText: rewritten,
    });
  } catch {
    /* soft */
  }

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
    fact.meta?.needsNavConfirm !== true &&
    (handoff === 'm3_nav_start' ||
      fact.meta?.autoStartNav === true ||
      fact.meta?.forceAutoNav === true ||
      (fact.meta?.amenityNav === true && fact.meta?.unique === true));
  const board = buildRebootBoardHints(fact);
  const startActionDeep =
    (board.wantDeepLinks || pendingBtns.length > 0) &&
    fact.meta?.amenityNav !== true;

  // Buttons ohne URL/Coords nicht flashen (Nav ohne Ziel / leere Links)
  buttons = buttons.filter((b) => {
    const p = b.payload as {
      kind?: string;
      url?: string;
      lat?: number;
      lng?: number;
    };
    if (p.kind === 'deep_link' && !(p.url ?? '').trim()) return false;
    if (
      p.kind === 'navigate' &&
      !(
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng)
      )
    ) {
      return false;
    }
    return true;
  });

  if (synthesis.shortAnswers?.length) {
    try {
      const { shortAnswersToModuleButtons, resolveShortAnswerSlotKey } =
        await import('../reboot/pipeline/shortAnswerChips');
      const slotKey = resolveShortAnswerSlotKey(
        synthesis.call2Tail as Record<string, unknown> | undefined,
        jobId,
      );
      const chips = shortAnswersToModuleButtons({
        turnId,
        labels: synthesis.shortAnswers,
        slotKey,
      });
      if (chips.length) {
        buttons = [...chips, ...buttons].slice(0, 4);
      }
    } catch {
      /* soft */
    }
  }

  if (!compoundPlanDayKey) {
    try {
      const { shouldIngestCompoundPlan, ingestCompoundDayPlan } = await import(
        '../planning/compoundPlanIngest'
      );
      if (shouldIngestCompoundPlan(rewritten)) {
        const ingested = await ingestCompoundDayPlan({
          userText: rewritten,
          frame: analysis.frame ?? null,
          skipIfRichSession: true,
        });
        if (ingested?.targetDate) compoundPlanDayKey = ingested.targetDate;
      }
    } catch {
      /* soft */
    }
  }

  if (compoundPlanDayKey) {
    const planBtn = {
      id: `plan_open_${compoundPlanDayKey}`,
      label: '📅 Tagesplan',
      payload: {
        kind: 'ui' as const,
        action: 'show_plan_day',
        data: { dayKey: compoundPlanDayKey },
      },
    };
    const walkBtn = {
      id: `plan_walk_${compoundPlanDayKey}`,
      label: 'Punkte durchgehen',
      payload: {
        kind: 'ui' as const,
        action: 'start_plan_step_loop',
        data: { dayKey: compoundPlanDayKey },
      },
    };
    const rest = buttons.filter(
      (b) =>
        !/tagesplan|plan\s*anzeigen|punkte\s*durchgehen/i.test(b.label || ''),
    );
    buttons = [planBtn, walkBtn, ...rest].slice(0, 4);
  }

  // Multi-Intent: aktuellen Job abhaken; offene kurz ansagen (vor Speech)
  try {
    completeActiveIntent();
    if (hasPendingIntents()) {
      const rest = summarizeOpenIntents();
      const tip = rest.split('|')[0]?.trim();
      if (tip && synthesis.fullDraftForUi && !/als nächstes/i.test(synthesis.fullDraftForUi)) {
        const add = ` Als Nächstes: ${tip}.`;
        synthesis = {
          ...synthesis,
          fullDraftForUi: `${synthesis.fullDraftForUi}${add}`,
        };
        if (logic.spokenDraft) {
          logic.spokenDraft = `${logic.spokenDraft}${add}`;
        }
      }
    }
  } catch {
    /* soft */
  }

  // Speech vor Card/Nav — außer explizite Nav (Say–Do: Nav zuerst)
  const earlySpeech =
    !forceAutoNav &&
    !navPreStarted &&
    streamedSentenceCount === 0 &&
    (synthesis.spokenChunks[0] || synthesis.fullDraftForUi || '').trim();
  if (earlySpeech) {
    await speakStreamedSentence(
      synthesis.spokenChunks[0]?.trim() ||
        synthesis.fullDraftForUi.split(/(?<=[.!?])\s+/)[0] ||
        synthesis.fullDraftForUi,
      0,
    );
  }

  const presented = await presentToUi(
    synthesis.fullDraftForUi,
    synthesis.bullets,
    buttons,
    {
      userText: rewritten,
      // Schon gestartet → nicht nochmal; sonst force wie bisher
      forceAutoNav: navPreStarted ? false : forceAutoNav,
      boardEntities: board.entities,
      boardModule1: board.module1,
      startActionDeep,
    },
  );

  const chunks = synthesis.spokenChunks.filter((c) => c.trim().length > 0);
  const fullSpeech =
    presented.speech.trim() ||
    chunks.join(' ') ||
    synthesis.fullDraftForUi;

  // Rest nachziehen — eine Session: Fast-Hook + Prefetch, kein Satz-für-Satz-Job
  if (streamedSentenceCount === 0) {
    if (fullSpeech.trim()) {
      await speakStreamedSentence(fullSpeech, 0);
    }
  } else if (chunks.length > streamedSentenceCount) {
    for (let i = streamedSentenceCount; i < chunks.length; i++) {
      livePump.push(chunks[i]!);
    }
  } else if (earlySpeech) {
    const rest = remainingSpeechAfterLead(fullSpeech, earlySpeech);
    if (rest) livePump.push(rest);
  }
  if (livePump.hasStarted()) livePump.end();

  let call3DeepFillRan = false;
  try {
    const { maybeRunCall3Enrichment } = await import(
      '../reboot/pipeline/call3Enrichment'
    );
    const { parseCall2Tail } = await import('../reboot/pipeline/call2Tail');
    const { resolveRethinkTail } = await import(
      '../reboot/pipeline/call3Rethink'
    );
    const tailRaw =
      synthesis.call2Tail && typeof synthesis.call2Tail === 'object'
        ? JSON.stringify(synthesis.call2Tail)
        : '';
    const tailParsed = tailRaw ? parseCall2Tail(tailRaw) : null;
    // Completeness → max 1× Call-3-Rethink (Lücken nachziehen, keine neue Absicht)
    const rethinkTail = resolveRethinkTail({
      existing: tailParsed,
      completeness,
    });
    const coords = anchorCoords(rucksack);
    const call3 = await maybeRunCall3Enrichment({
      tail: rethinkTail,
      synthesis,
      buttons,
      userText: rewritten,
      fact,
      jobId,
      rucksack,
      city: turnCityHint,
      lat: coords.lat,
      lng: coords.lng,
      signal,
    });
    if (call3.ran) {
      call3DeepFillRan = true;
      synthesis = call3.synthesis;
      buttons = call3.buttons;
    }
    if (compoundPlanDayKey) {
      const { enrichCompoundPlanFromFacts } = await import(
        '../planning/compoundPlanIngest'
      );
      enrichCompoundPlanFromFacts({
        fact,
        taskResults: 'fastResults' in fanout ? fanout.fastResults : [],
        userText: rewritten,
      });
    }
  } catch {
    /* soft */
  }

  const placeName =
    (typeof fact.meta?.placeName === 'string' && fact.meta.placeName) ||
    (typeof fact.meta?.destName === 'string' && fact.meta.destName) ||
    subject;
  if (placeName) setLastPlaceName(placeName);
  // Follow-up „navigiere mich dahin“ braucht Offer + Koordinaten
  try {
    const { resolveLocalAnchor } = require('../context/shortTermContext') as {
      resolveLocalAnchor: (t: string) => {
        name: string;
        lat: number;
        lng: number;
      } | null;
    };
    const { useFinnusStore } = require('../../store/useFinnusStore') as typeof import('../../store/useFinnusStore');
    const anchor =
      resolveLocalAnchor(placeName || rewritten) ||
      resolveLocalAnchor(rewritten);
    const metaLat =
      typeof fact.meta?.destLat === 'number' ? fact.meta.destLat : null;
    const metaLng =
      typeof fact.meta?.destLng === 'number' ? fact.meta.destLng : null;
    if (
      metaLat != null &&
      metaLng != null &&
      Number.isFinite(metaLat) &&
      Number.isFinite(metaLng) &&
      placeName
    ) {
      useFinnusStore.getState().setPendingNavOffer({
        poiId: -1,
        name: String(placeName),
        lat: metaLat,
        lng: metaLng,
      });
    } else if (anchor) {
      useFinnusStore.getState().setPendingNavOffer({
        poiId: -1,
        name: anchor.name,
        lat: anchor.lat,
        lng: anchor.lng,
      });
      setLastPlaceName(anchor.name);
    }
  } catch {
    /* soft */
  }
  setLastTopic(topicDecision.thread.label || analysis.subject || jobId);

  try {
    commitThreadTurn({
      userText: rewritten,
      assistantSpeech: synthesis.fullDraftForUi,
      intent: jobClass.contract.agentIntent,
      subject: placeName,
      cityHint: turnCityHint,
      cityKey: turnCityKey,
      saidFactLines: synthesis.bullets,
      openLoop: analysis.openLoops[0] ?? null,
    });
  } catch {
    /* soft */
  }

  let deepResearchQueued = false;
  let skipAutoDeep = false;
  try {
    const { getLiveChatTurnContext } = require('../../services/handsFree/liveChatTurnContext') as {
      getLiveChatTurnContext: () => {
        active: boolean;
        askBeforeDeepResearch: boolean;
      };
    };
    const live = getLiveChatTurnContext();
    let forced = false;
    try {
      const { wantsExplicitDeepResearch } = require('../../services/handsFree/liveChatTurnContext') as {
        wantsExplicitDeepResearch: (t: string) => boolean;
      };
      forced = wantsExplicitDeepResearch(rewritten);
    } catch {
      forced =
        /^recherchiere\s+tiefer\b/iu.test(rewritten) ||
        /\btiefer\s+recherch/iu.test(rewritten);
    }
    skipAutoDeep = live.active && live.askBeforeDeepResearch && !forced;
  } catch {
    skipAutoDeep = false;
  }
  // Call 3 hat Deep-Fill schon gemacht → kein zweites Auto-Deep-Fill dieselbe Lücke
  const { shouldQueueAutoDeepFill } = require('../reboot/pipeline/call3Rethink') as {
    shouldQueueAutoDeepFill: (o: {
      call3DeepFillRan: boolean;
      skipAutoDeep: boolean;
      completenessForce: boolean;
      silentSlowPending: boolean;
    }) => boolean;
  };
  const queueAutoDeep = shouldQueueAutoDeepFill({
    call3DeepFillRan,
    skipAutoDeep,
    completenessForce: shouldForceDeepFill(completeness),
    silentSlowPending: fanout.silentSlowPending.length > 0,
  });
  if (call3DeepFillRan) {
    deepResearchQueued = true;
  } else if (queueAutoDeep) {
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

  try {
    const { rememberChoiceTurnContext } = await import('./choiceTurnContext');
    rememberChoiceTurnContext({
      parentTurnId: turnId,
      userText: rewritten,
      jobId,
      analysis,
      factSummary: {
        draftText: synthesis.fullDraftForUi,
        bullets: synthesis.bullets,
        meta: fact.meta ?? undefined,
      },
      bridgeOnce,
      cityKey: turnCityKey,
      cityHint: turnCityHint,
      subject: subject,
      storedAtMs: Date.now(),
    });
  } catch {
    /* soft */
  }

  try {
    const { flushTurnLatency } = await import('../reboot/pipeline/turnLatencyMetrics');
    flushTurnLatency();
  } catch {
    /* soft */
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
