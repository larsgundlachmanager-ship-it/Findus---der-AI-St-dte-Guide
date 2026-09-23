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
  getConversationThreadsSync,
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
import {
  kickManagerWarmupForFinal,
  takeManagerWarmupIfMatch,
} from './managerWarmup';
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
  // Alter-Trivia: LLM-Cover durch kurzen Peek-Lead ersetzen (Antwort kommt schnell).
  try {
    if (userText && /\bwie\s+alt\b/iu.test(userText)) {
      const { peekAnswerLeadBridge } = require('../../services/speech/answerLeadBridge') as {
        peekAnswerLeadBridge: (s: string) => string | null;
      };
      const peek = peekAnswerLeadBridge(userText);
      if (peek?.trim()) bridge = peek.trim();
    }
  } catch {
    /* soft */
  }
  // Wetter: kurze Zusage — nie „schau nach wie das Wetter in X wird“ als Bridge-Essay.
  try {
    if (
      userText &&
      /\b(wetter|regnet|regnen|temperatur|wie\s+wird\s+(?:heute|morgen)\b)/iu.test(
        userText,
      )
    ) {
      const t = (bridge || '').toLowerCase();
      if (
        !bridge?.trim() ||
        /schau\w*\s+nach|wie\s+das\s+wetter|in\s+\w+\s+wird|wird\s+folgender|also\s+das\s+wetter/iu.test(
          t,
        ) ||
        (bridge || '').split(/\s+/).length > 12
      ) {
        bridge = /\bregen|regnet|regnen\b/iu.test(userText)
          ? 'Klar, ich check den Regen.'
          : 'Klar, ich check das Wetter.';
      }
    }
  } catch {
    /* soft */
  }
  bridge = clipBridgeToWordLimit(bridge, analysis.bridgeMaxWords);
  const spoken = await speakModuleWaitBridge(bridge, turnId, {
    userText: userText || '',
  });
  return { text: spoken, alreadySpoken: Boolean(spoken) };
}

/** Ein Wait-Ack pro Turn — nie Sofort-Floskel + „kurz Geduld“ + Queue-Replay. */
async function speakModuleWaitBridge(
  line: string | null | undefined,
  turnId: string,
  opts?: { force?: boolean; userText?: string },
): Promise<string | null> {
  let t = (line || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  try {
    const {
      sanitizeBridgeText,
      scrubBridgeCityLeak,
      scrubTriviaClarifyBridge,
      scrubPrematureTriviaFacts,
      scrubAffiliateMonetizationSpeech,
      scrubMetaPraiseBridge,
    } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubPrematureTriviaFacts: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubAffiliateMonetizationSpeech: (s: string | null | undefined) => string;
      scrubMetaPraiseBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
    };
    // Call-1 Bridge 1:1 — keine Floskel-Notbremse / kein Ersatz-Text
    t = sanitizeBridgeText(t) || '';
    if (t && opts?.userText) {
      t = scrubMetaPraiseBridge({ bridge: t, userText: opts.userText }) || '';
    }
    if (t && opts?.userText) {
      t = scrubTriviaClarifyBridge({ bridge: t, userText: opts.userText }) || '';
    }
    if (t && opts?.userText) {
      t = scrubPrematureTriviaFacts({ bridge: t, userText: opts.userText }) || '';
    }
    if (t) {
      t = scrubAffiliateMonetizationSpeech(t) || '';
    }
    // Scrub leer → still (kein Code-Peek/Floskel). Call-1-LLM liefert Bridge.
    if (t) {
      const gpsCities: string[] = [];
      try {
        const { readRucksackSync } = require('../rucksack/rucksackStore') as {
          readRucksackSync: () => { cityHint?: string | null };
        };
        const hint = readRucksackSync()?.cityHint;
        if (hint) gpsCities.push(hint);
      } catch {
        /* soft */
      }
      try {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: {
            getState: () => { cityName?: string | null; cityId?: string | null };
          };
        };
        const st = useFinnusStore.getState();
        if (st.cityName) gpsCities.push(String(st.cityName));
      } catch {
        /* soft */
      }
      // speakModuleWaitBridge: userText für GPS-Stadt-Leak-Scrub
      const ut = opts?.userText || '';
      if (ut) {
        t = scrubBridgeCityLeak({
          bridge: t,
          userText: ut,
          gpsCities,
        });
      }
    }
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

  // Pace: Bridge gestartet → Sprechdauer aus Wörtern (nicht Research-Budget)
  try {
    const {
      notePaceBridgeStarted,
    } = require('../reboot/pipeline/paceTurnSession') as {
      notePaceBridgeStarted: (at?: number, speechMs?: number) => void;
    };
    const words = t.split(/\s+/).filter(Boolean).length;
    const speechMs = Math.max(1400, Math.min(6000, Math.round(words * 380)));
    notePaceBridgeStarted(Date.now(), speechMs);
  } catch {
    /* soft */
  }

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
  // Threads sofort parallel — nicht serial vor Call-1.
  void loadConversationThreads().catch(() => undefined);
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
  let call1ComposeShape: import('./call1JobShape').Call1JobShape | null = null;

  // Isolation: Yorros Reisebüro ist eigener Raum — kein Modul-2-Antwortpfad.
  try {
    const { useReisebueroStore } = require('../../reisebuero/store') as {
      useReisebueroStore: { getState: () => { overlayOpen?: boolean } };
    };
    if (useReisebueroStore.getState().overlayOpen) {
      if (__DEV__) console.log('[runConciergeTurn] blocked — Reisebüro isoliert');
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
        synthesis: {
          spokenChunks: [],
          bullets: [],
          buttons: [],
          fullDraftForUi: '',
        },
        deepResearchQueued: false,
        jobId: 'reisebuero_isolated',
      };
    }
  } catch {
    /* soft */
  }

  // Manager-Verfassung: KEIN Pre-Call-1 Bypass (kein Nav-Stop-Return, keine Early-Floskel
  // vor Analyze, kein Mode-Switch vor Analyze). Beat-1 startet MIT Call-1 (parallel zum Stream).
  let earlyBridgePromise: Promise<string | null> = Promise.resolve(null);
  let bridgeSpokenDuringAnalyze = false;
  let beat1Locked = false;
  let call1LeadEarly: string | null = null;
  let earlyNavModeSwitchPromise: Promise<{
    ok: boolean;
    speech: string;
    bullets: string[];
    mode: 'foot' | 'bike';
    destName: string;
  } | null> | null = null;
  let earlyNavModeSwitchBridge: string | null = null;

  // Call-1 Speech immer sofort — Peek TTS fire-and-forget, Worker parallel,
  // nie auf Follow-Through / Analyze / Speech-Ende warten. Call-2 klebt fused.
  try {
    const rawLead = String(input.userText || '').replace(/\s+/g, ' ').trim();
    const microAck =
      /^(ja|nein|ok|okay|passt|genau|mach\s+das|los|klar|bitte|danke)[.!?]?$/iu.test(
        rawLead,
      );
    const { shouldSuppressBridge } = require('../reboot/managerTurn') as {
      shouldSuppressBridge: (o: {
        topicMode: null;
        jobId: string;
        userText: string;
      }) => boolean;
    };
    if (
      !microAck &&
      !shouldSuppressBridge({
        topicMode: null,
        jobId: '',
        userText: input.userText,
      })
    ) {
      const { peekAnswerLeadBridgeOrCommit } = require('../../services/speech/answerLeadBridge') as {
        peekAnswerLeadBridgeOrCommit: (s: string) => string;
      };
      const peek = peekAnswerLeadBridgeOrCommit(input.userText)?.trim();
      if (peek) {
        call1LeadEarly = peek;
        beat1Locked = true;
        try {
          const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
            markBridgeFirst: () => void;
          };
          markBridgeFirst();
        } catch {
          /* soft */
        }
        earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
          userText: input.userText,
        }).then((spoken) => {
          if (spoken) bridgeSpokenDuringAnalyze = true;
          else beat1Locked = false;
          return spoken;
        });
      }
    }
  } catch {
    /* soft */
  }
  try {
    const { kickCall1ParallelWork } = require('../../services/concierge/kickCall1ParallelWork') as {
      kickCall1ParallelWork: (o: {
        userText: string;
        rewritten?: string | null;
      }) => void;
    };
    kickCall1ParallelWork({ userText: input.userText });
  } catch {
    /* soft */
  }

  // Call-1 Prep parallel — Bridge-Token nicht hinter FS/Import-Serial.
  const threadsP = loadConversationThreads().catch(() => getConversationThreadsSync());
  const flightP = import('../../services/flights/flightTripSession')
    .then((m) => m.hydrateFlightTripSession())
    .catch(() => undefined);
  const followThroughP = import('./missionFollowThrough')
    .then((m) => m.ensureFollowThroughHydrated())
    .catch(() => undefined);
  const bulletP = import('../reboot/pipeline/bulletUiBudget')
    .then((m) => m.loadBulletUiBudget())
    .catch(() => null);
  const placeCtxP = import('../context/placeContext');
  const rucksackModP = import('../reboot/pipeline/turnRucksack');
  const goldModP = import('./call1OwnerGoldCatalog');

  const rucksack = readRucksackSync();
  // Snapshot erst nach Call-1 Isolation lesen — sonst leakt Tennis/Amsterdam trotz scrub.
  let short = getShortTerm();
  noteUserUtterance(input.userText);

  // Threads: Sync-Peek für Korrektur; max ~100 ms Soft-Wait wenn Cache kalt.
  // Follow-Through Persist: hart awaiten (Resume „wieder Taxi“ nach Kill).
  let prevFg = getForegroundThread();
  try {
    await followThroughP;
  } catch {
    /* soft */
  }
  if (!prevFg) {
    await Promise.race([
      threadsP.then(() => undefined),
      new Promise<void>((r) => setTimeout(r, 100)),
    ]);
    prevFg = getForegroundThread();
  }

  const { resolveCityChatScope } = await placeCtxP;
  const cityScope = resolveCityChatScope(input.userText);
  const turnCityHint = cityScope.cityHint;
  const turnCityKey = cityScope.cityKey;

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
    const { looksLikeInstantAnswerLeadQuery } = require('../kernel/instantAnswerLeadQuery') as {
      looksLikeInstantAnswerLeadQuery: (s: string) => boolean;
    };
    let quick = false;
    try {
      quick = looksLikeInstantAnswerLeadQuery(rawForRewrite);
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

  // Flug-Session: Soft-Budget — Call-1 nicht hinter Disk warten.
  try {
    await Promise.race([
      flightP,
      new Promise<void>((r) => setTimeout(r, 80)),
    ]);
  } catch {
    /* soft */
  }

  // Manager-Verfassung: Call 1 sieht den ROHEN UserText (nur Korrektur-Merge als Hint).
  // Kein rewriteQuery / Live-Inventory vor Analyze — Isolation entscheidet Call 1.
  let rewritten = String(rawForRewrite || input.userText || '').trim();
  const rawUserTextForCall1 = String(input.userText || '').trim() || rewritten;

  // Solo-Flug A→B: sticky Nav/ÖPNV sofort killen — sonst „Fahrt nach Hamburg nach Split“
  try {
    const { isSoloFlightAbSearch, isFlightTripQuery } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
      isFlightTripQuery: (s: string) => boolean;
    };
    const flightAsk =
      isSoloFlightAbSearch(rawUserTextForCall1) ||
      isSoloFlightAbSearch(rewritten) ||
      isFlightTripQuery(rawUserTextForCall1);
    if (flightAsk && useFinnusStore.getState().navActive) {
      try {
        const { stopNavigation } = require('../../services/navigation/navigationService') as {
          stopNavigation: (o?: { silent?: boolean }) => void | Promise<void>;
        };
        void stopNavigation({ silent: true });
      } catch {
        /* soft */
      }
      try {
        const { clearMultiStopTour } = require('../../services/navigation/multiStopTour') as {
          clearMultiStopTour: () => void;
        };
        clearMultiStopTour();
      } catch {
        /* soft */
      }
    }
  } catch {
    /* soft */
  }

  // Speculative Call-1 parallel zu Rucksack/Gold — auch wenn Mic vor STABLE_MS losließ.
  try {
    let kickNav = Boolean(useFinnusStore.getState().navActive);
    let kickCal = false;
    try {
      const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
      };
      kickCal = usePlanCalendarUiStore.getState().calendarVisible;
    } catch {
      kickCal = false;
    }
    kickManagerWarmupForFinal(rawUserTextForCall1, {
      cityHint: turnCityHint,
      navActive: kickNav,
      calendarOpen: kickCal,
    });
  } catch {
    /* soft */
  }

  // Kontext-Hygiene (kein Answer-Bypass): Wetter ohne Deixis → Sticky-POI/Pitch/Nav-Laden weg vor Call 1.
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const diningPrimary =
      detectPitchKind(rawUserTextForCall1) === 'food' ||
      looksLikeAyceQuery(rawUserTextForCall1);
    if (
      !diningPrimary &&
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

  // Straße+Hausnummer ist bereits ein vollständiger Nav-Auftrag: dieselbe dynamische
  // Nav-Bridge wie bei lokalen Ankern sofort starten. Geocode/Route laufen danach
  // parallel und dürfen den ersten TTS-Hook nicht durch synchrone Modul-Loads verzögern.
  try {
    const { extractStreetAddressFromUtterance } = require('../../services/navigation/streetAddressQuery') as {
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    const address =
      extractStreetAddressFromUtterance(rawUserTextForCall1) ||
      extractStreetAddressFromUtterance(rewritten);
    if (address && !beat1Locked) {
      const { resolveNavDestSpeechName } = require('../../services/navigation/navDestSpeechName') as {
        resolveNavDestSpeechName: (o: {
          query?: string;
          geoLabel?: string;
        }) => string;
      };
      const { buildExplicitNavBridgeSpeech } = require('../../services/navigation/navStartSpeech') as {
        buildExplicitNavBridgeSpeech: (n: string) => string;
      };
      const speechName = resolveNavDestSpeechName({
        query: address,
        geoLabel: address,
      });
      const peek = buildExplicitNavBridgeSpeech(speechName);
      call1LeadEarly = peek;
      beat1Locked = true;
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
      } catch {
        /* soft */
      }
      // Geocode + Pin/Route sofort parallel zur Bridge — Karte malt während TTS.
      try {
        const { kickInstantMapNav } = require('../../services/navigation/navDestPrefetch') as {
          kickInstantMapNav: (o: {
            destLabel: string;
            userText?: string | null;
          }) => void;
        };
        kickInstantMapNav({
          destLabel: address,
          userText: rewritten || rawUserTextForCall1,
        });
      } catch {
        /* soft */
      }
      try {
        const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
          markBridgeFirst: () => void;
        };
        markBridgeFirst();
      } catch {
        /* soft */
      }
      earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
        userText: rewritten || rawUserTextForCall1,
      }).then((spoken) => {
        if (spoken) bridgeSpokenDuringAnalyze = true;
        else beat1Locked = false;
        return spoken;
      });
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] early address nav bridge', err);
  }

  // Call-1 Parallel-Work: Wetter/Nav/Pitch-IO — parallel zu Analyze+Bridge.
  try {
    const { kickCall1ParallelWork } = require('../../services/concierge/kickCall1ParallelWork') as {
      kickCall1ParallelWork: (o: {
        userText: string;
        rewritten?: string | null;
      }) => void;
    };
    kickCall1ParallelWork({
      userText: rawUserTextForCall1,
      rewritten,
    });
  } catch {
    /* soft */
  }

  // Call-1 sieht JEDEN Satz (auch 5k / Plan-Ja / Hamburg-Tag).
  // M5 / Pitch / Tour sind Backends NACH Call-1, keine Early-Weiche.

  // Explore-Hold / Travel-Mode / Nav-Choice: parallel zu Call-1 — nicht davor blocken.
  void (async () => {
    try {
      const { holdExploreForUserQuestion } = await import(
        '../../runtime/exploreHold'
      );
      if (rawUserTextForCall1.length >= 4) {
        holdExploreForUserQuestion(60_000, 'concierge_turn');
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
      const mode = detectTravelModeVoiceOverride(rawUserTextForCall1);
      if (mode === 'bike') forceBikeModeFromVoice();
      else if (mode === 'foot') setPreferredTravelMode('foot');
    } catch {
      /* soft */
    }
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
  })();

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

  // Plan/Tour/Reisebüro erst NACH dem Manager — keine Keyword-Weiche vor der KI.

  let turnRucksack: import('../reboot/pipeline/turnRucksack').TurnRucksackV1 | null =
    null;
  try {
    const { buildTurnRucksack } = await rucksackModP;
    const { peekBulletUiBudget } = await import(
      '../reboot/pipeline/bulletUiBudget'
    );
    // Soft: Budget parallel; Peek für Call-1 (kein AsyncStorage-Block).
    void bulletP;
    const bulletBudget = peekBulletUiBudget();
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
      const { formatRucksackLine } = await rucksackModP;
      rucksackLine = formatRucksackLine(turnRucksack);
    }
    const { formatOwnerGoldCatalogForCall1, inferOwnerGoldFamilyHints } =
      await goldModP;
    const goldHints = inferOwnerGoldFamilyHints(rewritten);
    const goldBlock = formatOwnerGoldCatalogForCall1(
      undefined,
      goldHints[0] ?? null,
      goldHints,
    );
    if (goldBlock) {
      rucksackLine = [rucksackLine, goldBlock].filter(Boolean).join('\n');
    }
    try {
      const { buildUnifiedLearnFacade } = await import('../playbooks/learnFacade');
      const facade = await buildUnifiedLearnFacade({ userText: rewritten });
      if (facade.promptBlock?.trim()) {
        rucksackLine = [rucksackLine, facade.promptBlock].filter(Boolean).join('\n');
      }
    } catch {
      /* playbooks optional */
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

  // Threads für listResumableThreads: Soft-Wait, Call-1 startet trotzdem.
  await Promise.race([
    threadsP.then(() => undefined),
    new Promise<void>((r) => setTimeout(r, 50)),
  ]);

  // Timer/Wecker: VOR Choice + Call-1-Nav — sticky Pitch/Nav darf den Auftrag nicht fressen.
  try {
    const { isTimerIntent } = require('../../services/alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
    };
    let forceClock = isTimerIntent(rewritten);
    if (!forceClock) {
      try {
        const { isLocalTimeAsk } = require('../../services/alarms/localTimeAsk') as {
          isLocalTimeAsk: (s: string) => boolean;
        };
        forceClock = isLocalTimeAsk(rewritten);
      } catch {
        /* soft */
      }
    }
    if (!forceClock) {
      try {
        const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
          isWakeAlarmIntent: (s: string) => boolean;
          hasClockHint: (s: string) => boolean;
        };
        const { looksLikeClockIntentLite } = require('../kernel/turnKernel') as {
          looksLikeClockIntentLite: (s: string) => boolean;
        };
        forceClock =
          (isWakeAlarmIntent(rewritten) && hasClockHint(rewritten)) ||
          looksLikeClockIntentLite(rewritten);
      } catch {
        forceClock = false;
      }
    }
    if (forceClock) {
      try {
        const { takeChoiceFastPath } = await import('./choiceTurnContext');
        // Armed Choice verwerfen — Timer/Wecker schlägt Options-Tap.
        takeChoiceFastPath();
      } catch {
        /* soft */
      }
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      let earlyClock: Awaited<ReturnType<typeof tryEarlyJustDoIt>> = null;
      try {
        const { takeEarlyJustDoItKick } = require('../../services/concierge/kickCall1ParallelWork') as {
          takeEarlyJustDoItKick: (
            s: string,
          ) => Promise<Awaited<ReturnType<typeof tryEarlyJustDoIt>>> | null;
        };
        earlyClock = await (takeEarlyJustDoItKick(rewritten) ||
          takeEarlyJustDoItKick(rawUserTextForCall1) ||
          tryEarlyJustDoIt(rewritten));
      } catch {
        earlyClock = await tryEarlyJustDoIt(rewritten);
      }
      if (
        earlyClock?.speech &&
        (earlyClock.kind === 'timer' || earlyClock.kind === 'wake' || earlyClock.kind === 'local_time')
      ) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: earlyClock.speech,
            visualBullets: (earlyClock.bullets ?? []).slice(0, 1),
            quickActions: (earlyClock.quickActions ?? []).slice(0, 5),
            cardTitle: earlyClock.cardTitle,
          },
          {
            userText: rewritten,
            skipAutoNav: true,
            skipButlerRemind: true,
            skipAlarmBackgroundTasks: true,
          },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: earlyClock.speech,
          bullets: (earlyClock.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: earlyClock.speech,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: earlyClock.kind === 'timer' || earlyClock.kind === 'wake' ? 'memory' : 'day_plan_budget',
        };
      }
    }
  } catch (err) {
    console.warn('[runConciergeTurn] early timer/wake failed', err);
  }

  // Instant-Rechnung: Lead sofort + Zahl als Call-2 — kein LLM-Bridge-Warten.
  // Ergebnis steht lokal fest, bevor irgendeine Bridge fertig wäre.
  try {
    const { tryLocalMathAnswer } = require('../../services/speech/localInstantAnswer') as {
      tryLocalMathAnswer: (s: string) => {
        lead: string;
        speech: string;
        bullets: string[];
      } | null;
    };
    const localArithEarly = tryLocalMathAnswer(rawUserTextForCall1);
    if (localArithEarly) {
      const { presentChatLaneResult } = await import('../chat/presentChatLane');
      return await presentChatLaneResult({
        turnId,
        result: {
          speech: localArithEarly.speech,
          bullets: localArithEarly.bullets,
          buttons: [],
          bridgeSpoken: localArithEarly.lead,
          blueprintId: null,
          personaVariant: 'default',
          needsResearch: 'quick',
          celestial: false,
          nextHandoff: null,
        },
        bridgeFromRouter: localArithEarly.lead,
        userText: rewritten,
      });
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] early local math', err);
  }

  // Instant Call-1 Lead: Peek = Call 1 → TTS sofort,
  // Backend (Analyze + Research) parallel — kein Warten auf Gemini-Bridge-Feld.
  // Wetter/Flug/Recherche/Nav: Mini-Zusage sofort, nicht erst nach Stream.
  try {
    if (!(beat1Locked || call1LeadEarly)) {
    let wantPeek = /\bwie\s+alt\b/iu.test(rawUserTextForCall1) || /\bwie\s+gro/iu.test(rawUserTextForCall1);
    if (!wantPeek) {
      try {
        const { looksLikeInstantAnswerLeadQuery } = require('../kernel/instantAnswerLeadQuery') as {
          looksLikeInstantAnswerLeadQuery: (s: string) => boolean;
        };
        wantPeek = looksLikeInstantAnswerLeadQuery(rawUserTextForCall1);
      } catch {
        wantPeek = false;
      }
    }
    if (!wantPeek) {
      try {
        const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
          classifyUtteranceFamily: (s: string) => { family: string };
        };
        const fam = classifyUtteranceFamily(rawUserTextForCall1).family;
        wantPeek =
          fam === 'weather' ||
          fam === 'flight' ||
          fam === 'knowledge' ||
          fam === 'nav' ||
          fam === 'pitch';
      } catch {
        /* soft */
      }
    }
    if (!wantPeek) {
      try {
        const { peekAnswerLeadBridge } = require('../../services/speech/answerLeadBridge') as {
          peekAnswerLeadBridge: (s: string) => string | null;
        };
        wantPeek = !!peekAnswerLeadBridge(rawUserTextForCall1)?.trim();
      } catch {
        /* soft */
      }
    }
    if (wantPeek) {
      let peek: string | null = null;
      try {
        const { peekAnswerLeadBridge } = require('../../services/speech/answerLeadBridge') as {
          peekAnswerLeadBridge: (s: string) => string | null;
        };
        peek = peekAnswerLeadBridge(rawUserTextForCall1)?.trim() || null;
      } catch {
        peek = null;
      }
      if (!peek) {
        try {
          const { peekFlightBeat1Bridge } = require('../../services/flights/flightTripAdvisor') as {
            peekFlightBeat1Bridge: (s: string) => string | null;
          };
          peek = peekFlightBeat1Bridge(rawUserTextForCall1)?.trim() || null;
        } catch {
          /* soft */
        }
      }
      if (peek) {
        call1LeadEarly = peek;
        beat1Locked = true;
        try {
          const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
            markBridgeFirst: () => void;
          };
          markBridgeFirst();
        } catch {
          /* soft */
        }
        earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
          userText: rewritten || rawUserTextForCall1,
        }).then((spoken) => {
          if (spoken) bridgeSpokenDuringAnalyze = true;
          else beat1Locked = false;
          return spoken;
        });
      }
    }
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] early call1 lead', err);
  }

  // Known Local Go-To: Ziel klar → Bridge sofort („hab ich / starte Navigation“),
  // Route/Karte parallel (kickCall1ParallelWork), Timeline still.
  try {
    if (!call1LeadEarly) {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (s: string) => boolean;
      };
      const { isPrematureNavStart } = require('./call1TaskBrief') as {
        isPrematureNavStart: (s: string) => boolean;
      };
      const ut = rewritten || rawUserTextForCall1;
      if (isExplicitNavIntent(ut) && !isPrematureNavStart(ut)) {
        const { resolveLocalAnchor } = require('../context/shortTermContext') as {
          resolveLocalAnchor: (s: string) => {
            name: string;
            lat: number;
            lng: number;
          } | null;
        };
        const anchor =
          resolveLocalAnchor(ut) || resolveLocalAnchor(rawUserTextForCall1);
        if (anchor) {
          const { resolveNavDestSpeechName } = require('../../services/navigation/navDestSpeechName') as {
            resolveNavDestSpeechName: (o: {
              query?: string;
              geoLabel?: string;
            }) => string;
          };
          const { buildExplicitNavBridgeSpeech } = require('../../services/navigation/navStartSpeech') as {
            buildExplicitNavBridgeSpeech: (n: string) => string;
          };
          const speechName = resolveNavDestSpeechName({
            query: anchor.name,
            geoLabel: anchor.name,
          });
          const peek = buildExplicitNavBridgeSpeech(speechName);
          call1LeadEarly = peek;
          beat1Locked = true;
          try {
            useFinnusStore.getState().setNavRouteLoading(true);
          } catch {
            /* soft */
          }
          try {
            const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
              markBridgeFirst: () => void;
            };
            markBridgeFirst();
          } catch {
            /* soft */
          }
          earlyBridgePromise = speakModuleWaitBridge(peek, turnId, {
            userText: ut,
          }).then((spoken) => {
            if (spoken) bridgeSpokenDuringAnalyze = true;
            else beat1Locked = false;
            return spoken;
          });
        }
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] early named nav bridge', err);
  }

  // choiceFast VOR Analyze (kein TDZ). Beat-1 startet mit Call-1 (nicht erst nach JSON).
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
    // Beat-1 = Call-1 Bridge (Stream onBridge) — außer Peek schon als Call 1 TTS.
    // Keine Floskel vor Call 1: Peek = derselbe Antwort-Einstieg, nur ohne Stream-Warten.
    if (!call1LeadEarly) {
      beat1Locked = false;
      earlyBridgePromise = Promise.resolve(null);
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
          if (!bridge?.trim() || bridgeSpokenDuringAnalyze || beat1Locked) return;
          // Mode-Switch-Bridge hat Zusagen+ETA schon — kein zweites Stream-Bridge
          if (earlyNavModeSwitchBridge) return;
          if (!(streamBridgeMaxWords > 0)) return;
          beat1Locked = true;
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
            else beat1Locked = false;
          });
        },
      }));
  }
  // Early Bridge: TTS parallel — Backend/Call-2 nicht auf Enqueue/Playback warten.
  {
    void earlyBridgePromise.catch(() => null);
    let pumpLive = false;
    try {
      const { getFusedTurnPump } = require('../speech/fusedTurnSpeech') as {
        getFusedTurnPump: () => { hasStarted: () => boolean };
      };
      pumpLive = getFusedTurnPump().hasStarted();
    } catch {
      pumpLive = false;
    }
    if (
      call1LeadEarly ||
      bridgeSpokenDuringAnalyze ||
      pumpLive ||
      beat1Locked
    ) {
      analysis = { ...analysis, bridgeSpokenEarly: true };
    }
    if (call1LeadEarly) {
      analysis = {
        ...analysis,
        bridge: call1LeadEarly,
        bridgeSpokenEarly: true,
      };
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

  // Call-1 Orchestrator: curatedContext, askBack, Timing-Brief; Phase C work[] → execution
  let call1BriefBlock: string | null = null;
  let call1OrchBrief: import('./call1TaskBrief').Call1TaskBrief | null = null;
  try {
    const {
      resolveCall1Task,
      formatBriefForCall2,
      reconcileExecutionWithOrchestrator,
      managerTasksFromWork,
    } = await import('./call1WorkOrchestrator');
    const orch = resolveCall1Task({
      analysis,
      userText: rawUserTextForCall1,
      call2Tips: analysis.call2Brief ? [analysis.call2Brief] : null,
    });
    try {
      const {
        isCriticalSlotAskBack,
        resolveBridgeCompleteFlag,
      } = require('./call1BridgeCompleteGate') as {
        isCriticalSlotAskBack: (a: string | null, u: string) => boolean;
        resolveBridgeCompleteFlag: (o: {
          userText: string;
          claimedComplete: boolean;
          askBack: string | null;
          runnableWorkCount: number;
          novelRequiresDeepWeb?: boolean;
        }) => boolean;
      };
      if (
        orch.brief.askBack &&
        !isCriticalSlotAskBack(orch.brief.askBack, rawUserTextForCall1)
      ) {
        orch.brief.askBack = null;
      }
      orch.brief.bridgeComplete = resolveBridgeCompleteFlag({
        userText: rawUserTextForCall1,
        claimedComplete:
          Boolean(analysis.bridgeComplete) || orch.brief.bridgeComplete,
        askBack: orch.brief.askBack,
        runnableWorkCount: orch.brief.runnableWork.length,
        novelRequiresDeepWeb: orch.brief.openWorld?.novelRequiresDeepWeb,
      });
    } catch {
      if (orch.brief.runnableWork.length > 0) {
        orch.brief.bridgeComplete = false;
        orch.brief.askBack = null;
      }
    }
    call1OrchBrief = orch.brief;
    const reconciled = reconcileExecutionWithOrchestrator(
      call1Execution,
      orch,
      rawUserTextForCall1,
    );
    call1Execution = reconciled;
    // Solo-Flug: nur flight_only — nie Reisebüro/Paket überschreiben
    try {
      const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
        isSoloFlightAbSearch: (s: string) => boolean;
      };
      const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
        isFindusReisebueroHandoff: (s: string) => boolean;
      };
      const { inferCall1JobShape, jobShapeNeedsCompose } = require('./call1JobShape') as {
        inferCall1JobShape: (s: string) => string;
        jobShapeNeedsCompose: (s: string) => boolean;
      };
      const shape = inferCall1JobShape(rawUserTextForCall1 || rewritten);
      if (jobShapeNeedsCompose(shape as never)) {
        call1Execution = 'task_fanout';
        call1ComposeShape = shape as import('./call1JobShape').Call1JobShape;
      } else if (
        reconciled !== 'reisebuero' &&
        !isFindusReisebueroHandoff(rawUserTextForCall1) &&
        !isFindusReisebueroHandoff(rewritten) &&
        shape === 'flight_only' &&
        (isSoloFlightAbSearch(rawUserTextForCall1) ||
          isSoloFlightAbSearch(rewritten))
      ) {
        call1Execution = 'flight_advisor';
      } else if (
        isFindusReisebueroHandoff(rawUserTextForCall1) ||
        isFindusReisebueroHandoff(rewritten) ||
        shape === 'trip_package'
      ) {
        call1Execution = 'reisebuero';
      }
    } catch {
      /* soft */
    }
    let nextTasks = analysis.tasks;
    if (
      (reconciled === 'task_fanout' || orch.brief.runnableWork.length >= 2) &&
      (!(analysis.tasks?.length) || analysis.tasks.length === 0)
    ) {
      const synthesized = managerTasksFromWork(orch.brief.runnableWork);
      if (synthesized.length) nextTasks = synthesized;
    }
    let nextBridgeComplete = orch.brief.bridgeComplete;
    analysis = {
      ...analysis,
      execution: call1Execution,
      curatedContext: orch.brief.curatedContext,
      selfQuestions: orch.brief.selfQuestions,
      // Brief gewinnt: null = kein LLM-AskBack-Leak (Medical/Just-Do-It/Ambiguity)
      askBack: orch.brief.askBack,
      bridgeComplete: nextBridgeComplete,
      tasks: nextTasks,
    };
    if (call1ComposeShape) {
      try {
        const { augmentAnalysisForCompose } = require('./composeRunner') as typeof import('./composeRunner');
        analysis = augmentAnalysisForCompose(
          analysis,
          rawUserTextForCall1 || rewritten,
          call1ComposeShape,
        );
        call1Execution = 'task_fanout';
      } catch {
        /* soft */
      }
    }
    try {
      const { scheduleWriteExecutionHint } = require('../timeline/timelineUpsert') as typeof import('../timeline/timelineUpsert');
      if (
        scheduleWriteExecutionHint(rawUserTextForCall1 || rewritten) ===
          'plan_module' &&
        call1Execution !== 'flight_advisor' &&
        call1Execution !== 'reisebuero'
      ) {
        call1Execution = 'plan_module';
        analysis = { ...analysis, execution: 'plan_module' };
      }
    } catch {
      /* soft */
    }
    // Phase 3 Belt: Ambiguity-/Permission-Ask nie als Bridge sprechen
    if (orch.brief.askBack) {
      try {
        const {
          looksLikeAmbiguityAskBack,
          looksLikePermissionAskBack,
        } = require('../mission/resolveMissionAskBack') as {
          looksLikeAmbiguityAskBack: (s: string) => boolean;
          looksLikePermissionAskBack: (s: string) => boolean;
        };
        const ageClear =
          /\bwie\s+alt\b/iu.test(rewritten) &&
          /\b(papst|pope|leo|neuer|müller|mueller)\b/iu.test(rewritten);
        if (
          ageClear ||
          looksLikeAmbiguityAskBack(orch.brief.askBack) ||
          looksLikePermissionAskBack(orch.brief.askBack)
        ) {
          analysis = { ...analysis, askBack: null };
        } else if (!analysis.bridge || analysis.bridge.length < 8) {
          analysis = { ...analysis, bridge: orch.brief.askBack };
        }
      } catch {
        if (!analysis.bridge || analysis.bridge.length < 8) {
          analysis = { ...analysis, bridge: orch.brief.askBack };
        }
      }
    }
    call1BriefBlock = formatBriefForCall2(orch.brief, rawUserTextForCall1);
  } catch {
    call1BriefBlock = null;
  }

  // Research/Fanout SOFORT parallel zur Call-1-Bridge — nicht hinter Nav/Pitch-Fallthrough.
  let earlyFanoutPromise: ReturnType<typeof runManagerTaskFanout> | null = null;
  try {
    const wantFanout =
      !choiceFast &&
      (call1Execution === 'task_fanout' ||
        call1Execution === 'nav_execute' ||
        ((analysis.tasks?.length ?? 0) > 0 &&
          call1Execution !== 'chat_lane' &&
          call1Execution !== 'events_research' &&
          call1Execution !== 'pitch_module' &&
          call1Execution !== 'reisebuero'));
    if (wantFanout) {
      earlyFanoutPromise = runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject: analysis.subject || null,
        city: short.lastMentionedCity,
        signal,
      });
    }
  } catch {
    earlyFanoutPromise = null;
  }
  // Bridge fire-and-forget falls Stream sie noch nicht gesprochen hat.
  try {
    if (
      !bridgeSpokenDuringAnalyze &&
      !analysis.bridgeSpokenEarly &&
      (analysis.bridge || '').trim() &&
      analysis.bridgeComplete !== true
    ) {
      analysis = { ...analysis, bridgeSpokenEarly: true };
      bridgeSpokenDuringAnalyze = true;
      void speakBridgeFromAnalysis(
        analysis,
        turnId,
        rewritten,
        'new',
      );
    }
  } catch {
    /* soft */
  }

  // Pace-Turn-Session (Autonomy Reboot) — Bridge-Budget ↔ Collective
  try {
    const { beginPaceTurn } = require('../reboot/pipeline/paceTurnSession') as {
      beginPaceTurn: (o: {
        turnId: string;
        userText: string;
        execution?: string | null;
        lane?: string | null;
        jobHint?: string | null;
        bridgeBudgetSec?: number | null;
      }) => void;
    };
    beginPaceTurn({
      turnId,
      userText: rewritten,
      execution: call1Execution,
      lane: analysis.chatLane,
      jobHint: analysis.jobHint,
      bridgeBudgetSec: analysis.researchBudgetSec ?? null,
    });
  } catch {
    /* soft */
  }

  // Root-Ziel / Thread-Spine (Autonomy Reboot) — hält Follow-ups zusammen.
  try {
    const {
      noteSessionRootGoal,
      getSessionRootGoal,
      appendSessionThreadSpine,
      clearSessionRootGoal,
    } = require('../context/shortTermContext') as {
      noteSessionRootGoal: (g: string | null) => void;
      getSessionRootGoal: () => string | null;
      appendSessionThreadSpine: (b: string | null) => void;
      clearSessionRootGoal: () => void;
    };
    const isNew =
      analysis.session === 'new' ||
      analysis.topicScope?.mode === 'new' ||
      (analysis.topicScope?.turnsForCall2 ?? 1) <= 0;
    if (isNew) {
      clearSessionRootGoal();
      try {
        const {
          onTopicBoundaryPreserveFollowThrough,
        } = require('./missionFollowThrough') as {
          onTopicBoundaryPreserveFollowThrough: (t: string) => void;
        };
        onTopicBoundaryPreserveFollowThrough(rawUserTextForCall1 || '');
      } catch {
        /* soft */
      }
      const goal =
        (analysis.call2Brief || analysis.intentSummary || rawUserTextForCall1 || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 220);
      if (goal) noteSessionRootGoal(goal);
    } else if (!getSessionRootGoal()) {
      noteSessionRootGoal(
        (analysis.intentSummary || rawUserTextForCall1 || '').slice(0, 220),
      );
    } else {
      appendSessionThreadSpine(
        (analysis.intentSummary || rawUserTextForCall1 || '').slice(0, 80),
      );
    }
  } catch {
    /* soft */
  }

  // Wetter-Opener: Call-1 Isolation erzwingen (auch wenn LLM session=continue sagt).
  // Nie bei Gastro/AYCE — sonst „heute Abend essen“ → Wetter-Chat.
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
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const diningPrimary =
      detectPitchKind(rawUserTextForCall1) === 'food' ||
      looksLikeAyceQuery(rawUserTextForCall1);
    if (
      !diningPrimary &&
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
    await scrubStickyAfterCall1(analysis, rawUserTextForCall1);
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
      // Immer feste Stop-Ansagen — nie LLM „behalte im Blick“ als Bridge
      const text = 'Alles klar — Navigation ist aus.';
      try {
        void speakModuleWaitBridge(text, turnId, {
          force: true,
          userText: rawUserTextForCall1,
        }).then((spoken) => {
          if (spoken) bridgeSpokenDuringAnalyze = true;
        });
        analysis = {
          ...analysis,
          bridge: text,
          bridgeSpokenEarly: true,
          bridgeComplete: true,
          execution: 'nav_execute',
        };
        bridgeSpokenDuringAnalyze = true;
      } catch {
        analysis = {
          ...analysis,
          bridge: text,
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
            speechText: '',
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
        spokenDraft: '',
        bullets: [],
        buttons: [],
        moneyEur: [],
        warnings: [],
      };
      return {
        turnId,
        tasks: [],
        bridgingText: text,
        logic,
        synthesis: synthesizeOutput(logic),
        deepResearchQueued: false,
        jobId: 'nav_stop',
      };
    }
  } catch (err) {
    console.warn('[runConciergeTurn] call1 nav-stop failed', err);
  }

  // Trivia/Quick-Lookup: nie Klärfrage + nie Call-2 skip (Papst-Alter u.ä.).
  try {
    const { looksLikeNamedTriviaSubject } = require('../kernel/turnKernel') as {
      looksLikeNamedTriviaSubject: (s: string) => boolean;
    };
    const { looksLikeInstantAnswerLeadQuery } = require('../kernel/instantAnswerLeadQuery') as {
      looksLikeInstantAnswerLeadQuery: (s: string) => boolean;
    };
    const triviaAsk =
      looksLikeInstantAnswerLeadQuery(rawUserTextForCall1) ||
      looksLikeNamedTriviaSubject(rawUserTextForCall1);
    if (triviaAsk) {
      analysis = {
        ...analysis,
        bridgeComplete: false,
        execution: 'chat_lane',
        chatLane: 'chat',
        pace: 'instant',
        bridgeMaxWords: Math.min(analysis.bridgeMaxWords ?? 18, 18),
        needsResearch: 'quick',
      };
      call1Execution = 'chat_lane';
      // Klärfrage / Recherche-Theater verwerfen — Call-1 soll Antwort einleiten
      const br = String(analysis.bridge || '');
      if (
        /\b(wen|was|welche[rn]?)\s+(genau\s+)?meinst\b|\bwen\s+genau\b|\bwie\s+alt\s+ist\s+wer\b/iu.test(
          br,
        ) ||
        /\b(finde\s+(gerne\s+)?heraus|schau\s+mal\s+wer|recherchier|gute\s+frage|spannende\s+frage|tolle\s+frage)\b/iu.test(
          br,
        )
      ) {
        // Meta/Klärfrage verwerfen — kein Code-Ersatz; Call 2 liefert den Fakt.
        analysis = {
          ...analysis,
          bridge: null,
          bridgeSpokenEarly: Boolean(bridgeSpokenDuringAnalyze),
        };
      }
    }
  } catch {
    /* soft */
  }

  // Explizite Nav: Bridge darf Zusagen, aber bridgeComplete darf den Start nicht killen.
  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (
      analysis.bridgeComplete === true &&
      isExplicitNavIntent(rawUserTextForCall1)
    ) {
      analysis = {
        ...analysis,
        bridgeComplete: false,
        execution: 'nav_execute',
        chatLane: 'nav',
      };
      call1Execution = 'nav_execute';
    }
  } catch {
    /* soft */
  }

  // bridgeComplete → Call 2 skip NUR bei echten Blockern (Gate).
  // Touristen-Invent / runnable Work / Novel-Web → weiter recherchieren.
  if (analysis.bridgeComplete === true) {
    let allowSkip = true;
    try {
      const {
        shouldSkipCall2ForBridgeComplete,
      } = require('./call1BridgeCompleteGate') as {
        shouldSkipCall2ForBridgeComplete: (o: {
          userText: string;
          claimedComplete: boolean;
          askBack: string | null;
          runnableWorkCount: number;
          novelRequiresDeepWeb?: boolean;
        }) => boolean;
      };
      allowSkip = shouldSkipCall2ForBridgeComplete({
        userText: rawUserTextForCall1,
        claimedComplete: true,
        askBack: analysis.askBack ?? call1OrchBrief?.askBack ?? null,
        runnableWorkCount: call1OrchBrief?.runnableWork?.length ?? 0,
        novelRequiresDeepWeb: call1OrchBrief?.openWorld?.novelRequiresDeepWeb,
      });
    } catch {
      if ((call1OrchBrief?.runnableWork?.length ?? 0) > 0) allowSkip = false;
    }
    if (!allowSkip) {
      analysis = { ...analysis, bridgeComplete: false, askBack: null };
    }
  }
  if (analysis.bridgeComplete === true) {
    const text = (analysis.bridge || '').trim();
    if (text && !analysis.bridgeSpokenEarly && !bridgeSpokenDuringAnalyze) {
      try {
        void speakModuleWaitBridge(text, turnId, {
          force: true,
          userText: rawUserTextForCall1,
        }).then((spoken) => {
          if (spoken) bridgeSpokenDuringAnalyze = true;
        });
        analysis = { ...analysis, bridgeSpokenEarly: true };
        bridgeSpokenDuringAnalyze = true;
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

  // Hotel-Follow-up auf leerem Pitch — kein stilles Leerlauf / kein Fake-Hotel
  try {
    const { resolveHotelEmptyFollowUp } = await import('./hotelPitchFollowUp');
    const hotelEmpty = resolveHotelEmptyFollowUp({
      userText: rewritten,
      turnId,
      inheritInventory: analysis.topicScope?.inheritLiveInventory === true,
    });
    if (hotelEmpty && 'retryQuery' in hotelEmpty) {
      rewritten = hotelEmpty.retryQuery;
      analysis = {
        ...analysis,
        execution: 'pitch_module',
        session: 'continue',
        topicScope: {
          mode: 'followup',
          turnsForCall2: Math.max(2, analysis.topicScope?.turnsForCall2 ?? 3),
          inheritLiveInventory: true,
        },
      };
      call1Execution = 'pitch_module';
      rememberLiveInventoryQuery(rewritten, 'hotel');
      try {
        const { noteLastLiveInventory } = require('../context/shortTermContext') as {
          noteLastLiveInventory: (o: {
            kind: 'hotel';
            query: string;
            hotelRetried?: boolean;
          }) => void;
        };
        noteLastLiveInventory({
          kind: 'hotel',
          query: rewritten,
          hotelRetried: true,
        });
      } catch {
        /* soft */
      }
    } else if (hotelEmpty && 'turnId' in hotelEmpty) {
      return hotelEmpty;
    }
  } catch {
    /* soft */
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
    if (!call1ComposeShape) {
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
          const { replanHintFromCorrection, playbookCandidateFromCorrection } =
            await import('../playbooks/correctionReplan');
          const replan = replanHintFromCorrection(cap.rule);
          if (replan) {
            analysis = {
              ...analysis,
              intentSummary: `${analysis.intentSummary || ''} ${replan}`.trim(),
            };
          }
          void playbookCandidateFromCorrection(cap.rule, {
            hasBookingLink: (cap.rule.expect ?? []).includes('booking_url'),
          });
        } catch {
          /* soft */
        }
        try {
          const { scrubStickyAfterCall1 } = await import('./call1ManagerIsolation');
          await scrubStickyAfterCall1(
            {
              ...analysis,
              session: 'new',
              topicScope: {
                mode: 'new',
                turnsForCall2: 0,
                inheritLiveInventory: false,
              },
            },
            rawUserTextForCall1,
          );
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
    const rainTitle =
      useFinnusStore.getState().activeConciergeCard?.cardTitle ?? '';
    const rainCard = /^regenwarnung$/i.test(rainTitle) || /^wetter$/i.test(rainTitle);
    if (
      isRainDontCareUtterance(rewritten) ||
      (rainCard && /^\s*(ist mir )?egal\.?\s*$/i.test(rewritten))
    ) {
      useFinnusStore.getState().setActiveConciergeCard(null);
      try {
        const { markRainDontCareUntilMorning } = await import(
          '../../services/weather/rainWarnSessionGate'
        );
        markRainDontCareUntilMorning();
      } catch {
        /* soft */
      }
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

  // Absichtsticket (actions/place/topic). Phrasen nur wenn Call 1 kein Ticket schrieb.
  try {
    const cruiseUtRaw = rewritten || rawUserTextForCall1 || input.userText;
    const heard = String(analysis.heardAs || '').trim();
    const { executeIntentAct } = await import('./intentActExecute');
    const done = await executeIntentAct({
      act: analysis.order?.act,
      userText: cruiseUtRaw,
      heardAs: heard,
    });
    if (done?.speech) {
      const { presentConciergeResponse } = await import(
        '../../services/concierge/presentConcierge'
      );
      await presentConciergeResponse(
        {
          speechText: done.speech,
          visualBullets: done.bullets.slice(0, 3),
          quickActions: [],
          cardTitle: done.cardTitle,
        },
        { userText: cruiseUtRaw, skipAutoNav: true },
      );
      const logic: LogicNodeOutput = {
        spokenDraft: done.speech,
        bullets: done.bullets.slice(0, 3),
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
  } catch (err) {
    console.warn('[runConciergeTurn] intent act failed', err);
  }

  // Call-1 sagte nav_execute → Hard-Dest / Mode-Switch. Kein Keyword-Steal mehr.
  try {
    let skipNavForClock = false;
    try {
      const { isTimerIntent } = require('../../services/alarms/timerService') as {
        isTimerIntent: (s: string) => boolean;
      };
      skipNavForClock = isTimerIntent(rewritten);
      if (!skipNavForClock) {
        const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
          isWakeAlarmIntent: (s: string) => boolean;
          hasClockHint: (s: string) => boolean;
        };
        skipNavForClock = isWakeAlarmIntent(rewritten) && hasClockHint(rewritten);
      }
    } catch {
      skipNavForClock = false;
    }
    if (call1Execution === 'nav_execute' && !skipNavForClock && !call1ComposeShape) {
      // Solo-Flug A→B darf nie Hard-Nav/ÖPNV werden (dest „Hamburg nach Split vom 27“)
      let skipNavForFlight = false;
      try {
        const { isSoloFlightAbSearch, isFlightTripQuery } = require('../../services/flights/flightTripIntent') as {
          isSoloFlightAbSearch: (s: string) => boolean;
          isFlightTripQuery: (s: string) => boolean;
        };
        skipNavForFlight =
          isSoloFlightAbSearch(rewritten) ||
          isSoloFlightAbSearch(rawUserTextForCall1) ||
          isFlightTripQuery(rewritten) ||
          isFlightTripQuery(rawUserTextForCall1);
      } catch {
        skipNavForFlight = false;
      }
      if (!skipNavForFlight) {
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
      const ticketPlace = analysis.order?.act?.place?.trim() || '';
      const dest =
        (ticketPlace.length >= 2 ? ticketPlace : null) ||
        detectHardNavOverride(rewritten, navCtx) ||
        detectHardNavOverride(input.userText, navCtx) ||
        extractNamedDestinationLabel(rewritten) ||
        extractNamedDestinationLabel(input.userText);
      const gastroNamed =
        /\b(restaurant|café|cafe|bistro|imbiss)\b/iu.test(rewritten) ||
        /\b(tisch|reservier|speisekarte)\b/iu.test(rewritten);
      if (dest && !gastroNamed && !detectChainedNavIntent(rewritten)) {
        // Route SOFORT parallel zur Bridge — Karte malt während TTS (nicht erst danach).
        const navPromise = hardOverrideNavigationTo(dest, {
          userText: rewritten || input.userText,
        });
        let earlyBridgeSpoken = Boolean(
          bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly,
        );
        let speechName = dest;
        try {
          const { resolveNavDestSpeechName } = require('../../services/navigation/navDestSpeechName') as {
            resolveNavDestSpeechName: (o: { query?: string; geoLabel?: string }) => string;
          };
          const { buildExplicitNavBridgeSpeech } = require('../../services/navigation/navStartSpeech') as {
            buildExplicitNavBridgeSpeech: (n: string) => string;
          };
          speechName = resolveNavDestSpeechName({ query: dest, geoLabel: dest });
          if (!earlyBridgeSpoken) {
            const bridgeLine = buildExplicitNavBridgeSpeech(speechName);
            presentToUi(bridgeLine, [], [], {
              skipBulletDerive: true,
              skipConciergeCard: true,
              userText: rewritten || input.userText,
            });
            enqueueSpeech({ kind: 'main', text: bridgeLine, turnId });
            earlyBridgeSpoken = true;
          }
        } catch {
          /* soft */
        }
        const result = await navPromise;
        let text = result.reply;
        // Kurze Nav-Speech: Zusagen + ETA — kein Pack/M1-Roman
        if (result.ok) {
          // Timeline still spiegeln — nie ansagen
          try {
            const {
              allowLiveNavMirror,
              upsertLiveNavFromStore,
              purgeStaleJourneysForHardNav,
            } = require('../../module2/timeline/syncLiveNavToPlan') as {
              allowLiveNavMirror: () => void;
              upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
              purgeStaleJourneysForHardNav: (dest?: string | null) => void;
            };
            allowLiveNavMirror();
            purgeStaleJourneysForHardNav(result.name || dest);
            upsertLiveNavFromStore({ force: true });
          } catch {
            /* soft */
          }
          try {
            await new Promise((r) => setTimeout(r, 280));
            let etaMin = useFinnusStore.getState().navEtaMin;
            try {
              const { resolveNavSpeechEtaMin } = require('../../services/navigation/navHudEta') as {
                resolveNavSpeechEtaMin: (o?: { storeEtaMin?: number | null }) => number | null;
              };
              const hud = resolveNavSpeechEtaMin({ storeEtaMin: etaMin });
              if (hud != null) etaMin = hud;
            } catch {
              /* soft */
            }
            const safeName = (() => {
              try {
                const { resolveNavDestSpeechName } = require('../../services/navigation/navDestSpeechName') as {
                  resolveNavDestSpeechName: (o: { query?: string; geoLabel?: string }) => string;
                };
                return resolveNavDestSpeechName({
                  query: dest,
                  geoLabel: result.name,
                });
              } catch {
                return speechName || result.name;
              }
            })();
            const bridgeAlready = earlyBridgeSpoken;
            if (typeof etaMin === 'number' && etaMin > 0) {
              try {
                const {
                  buildExplicitNavBridgeSpeech: mkBridge,
                  buildExplicitNavEtaSpeech: mkEta,
                } = require('../../services/navigation/navStartSpeech') as {
                  buildExplicitNavBridgeSpeech: (n: string) => string;
                  buildExplicitNavEtaSpeech: (o: {
                    etaMin: number | null;
                    mode?: 'foot' | 'bike' | 'drive' | null;
                  }) => string;
                };
                const etaLine = mkEta({ etaMin, mode: 'foot' });
                text = bridgeAlready
                  ? etaLine
                  : `${mkBridge(safeName)} ${etaLine}`.trim();
              } catch {
                const dur = formatDurationMinutesDe(etaMin, 'speech');
                text = bridgeAlready
                  ? `Dauert etwa ${dur}.`
                  : `Alles klar — ich navigiere dich zu ${safeName}. Dauert etwa ${dur}.`;
              }
            } else if (bridgeAlready) {
              // Bridge hat Zusagen schon — keine zweite „Alles klar“-Schleife
              text = '';
            } else if (!result.replaced) {
              text = `Alles klar — ich navigiere dich zu ${safeName}.`;
            }
          } catch {
            if (!result.replaced && !earlyBridgeSpoken) {
              text = `Alles klar — ich navigiere dich zu ${result.name}.`;
            } else if (earlyBridgeSpoken) {
              text = '';
            }
          }
        }
        if (text) {
          presentToUi(text, [], [], {
            skipBulletDerive: true,
            skipConciergeCard: true,
            userText: rewritten || input.userText,
          });
          enqueueSpeech({ kind: 'main', text, turnId });
        }
        // Kein Spickzettel / „5 Minuten“-Card — ETA steht im Nav-HUD.
        try {
          useFinnusStore.getState().setActiveConciergeCard(null);
        } catch {
          /* soft */
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
      } else {
        analysis = {
          ...analysis,
          execution: 'flight_advisor',
          chatLane: 'flight',
        };
      } // !skipNavForFlight
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
      let clockBlocksNavOffer = false;
      try {
        const { isTimerIntent } = require('../../services/alarms/timerService') as {
          isTimerIntent: (s: string) => boolean;
        };
        clockBlocksNavOffer = isTimerIntent(rewritten);
      } catch {
        clockBlocksNavOffer = false;
      }
      const {
        shouldStartNavFromOffer,
        resolveNavOfferFromReply,
      } = await import('../../services/navigation/pendingOffer');
      const store = useFinnusStore.getState();
      if (
        !clockBlocksNavOffer &&
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

  // Travel schedule harden: Hotel / Cruise / Bahn / Flug / FlixBus / Event → Timeline
  try {
    const {
      looksLikeTravelScheduleWriteJob,
      runTravelScheduleHarden,
    } = require('../timeline/travelScheduleHarden') as {
      looksLikeTravelScheduleWriteJob: (s: string) => boolean;
      runTravelScheduleHarden: (o: {
        userText: string;
        lat?: number | null;
        lng?: number | null;
        cityHint?: string | null;
      }) => Promise<{
        kind: string | null;
        ok: boolean;
        speech: string;
        bullets: string[];
        actions?: Array<{
          type: 'OPEN_URL';
          label: string;
          payload: { url: string };
        }>;
      } | null>;
    };
    const ut = rawUserTextForCall1 || rewritten;
    if (looksLikeTravelScheduleWriteJob(ut)) {
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: {
            getState: () => { lastGpsLat?: number | null; lastGpsLng?: number | null };
          };
        };
        const st = useFinnusStore.getState();
        lat = st.lastGpsLat ?? null;
        lng = st.lastGpsLng ?? null;
      } catch {
        /* soft */
      }
      const hardened = await runTravelScheduleHarden({
        userText: ut,
        lat,
        lng,
      });
      if (hardened?.speech) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: hardened.speech,
            visualBullets: (hardened.bullets ?? []).slice(0, 3),
            quickActions: (hardened.actions ?? []).slice(0, 4),
            cardTitle:
              hardened.kind === 'cruise_glance'
                ? 'Kreuzfahrt'
                : hardened.kind === 'hotel_stamm'
                  ? 'Hotel'
                  : 'Timeline',
          },
          { userText: rewritten, skipAutoNav: true },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: hardened.speech,
          bullets: (hardened.bullets ?? []).slice(0, 3),
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
    }
  } catch (err) {
    console.warn('[pipeline] travel schedule harden failed', err);
  }

  // Just-Do-It (Wecker/Lautstärke/Timer/Wiederholen).
  // Wecker+klare Zeit: IMMER Native stellen — nie nur LLM „gestellt“ + Reminder-Button.
  try {
    const { shouldAbortTurnForEarlyJustDoIt, looksLikeClockIntentLite } =
      require('../kernel/turnKernel') as {
        shouldAbortTurnForEarlyJustDoIt: (s: string) => boolean;
        looksLikeClockIntentLite: (s: string) => boolean;
      };
    let isRepeatAsk = false;
    try {
      const { isRepeatLastSpeechIntent } = require('../../services/speech/lastReplayableSpeech') as {
        isRepeatLastSpeechIntent: (s: string) => boolean;
      };
      isRepeatAsk = isRepeatLastSpeechIntent(rewritten);
    } catch {
      isRepeatAsk = false;
    }
    let forceWakeClock = false;
    try {
      const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
        isWakeAlarmIntent: (s: string) => boolean;
        hasClockHint: (s: string) => boolean;
      };
      const { isTimerIntent } = require('../../services/alarms/timerService') as {
        isTimerIntent: (s: string) => boolean;
      };
      forceWakeClock =
        (isWakeAlarmIntent(rewritten) && hasClockHint(rewritten)) ||
        isTimerIntent(rewritten) ||
        looksLikeClockIntentLite(rewritten);
    } catch {
      forceWakeClock = looksLikeClockIntentLite(rewritten);
    }
    let forceReminder = false;
    let forceTransit = false;
    try {
      const { classifyTimeCareIntent } = require('../../services/concierge/timeCareIntent') as {
        classifyTimeCareIntent: (s: string) => { kind: string } | null;
      };
      const { userAsksRemind } = require('../../services/concierge/reminderActionPolicy') as {
        userAsksRemind: (s: string) => boolean;
      };
      const careKind = classifyTimeCareIntent(rewritten)?.kind;
      forceReminder = careKind === 'reminder' || userAsksRemind(rewritten);
      forceTransit =
        careKind === 'transit_leave' || careKind === 'compound_wake_transit';
    } catch {
      forceReminder = false;
      forceTransit = false;
    }
    const call1AllowsJustDoIt =
      call1Execution === 'memory' ||
      call1Execution === 'chat_lane' ||
      call1Execution === 'task_fanout' ||
      call1Execution === 'plan_module' ||
      isRepeatAsk ||
      forceWakeClock ||
      forceReminder ||
      forceTransit;
    if (
      !choiceFast &&
      (isRepeatAsk ||
        forceWakeClock ||
        forceTransit ||
        (call1AllowsJustDoIt &&
          shouldAbortTurnForEarlyJustDoIt(rewritten) &&
          managerLane !== 'nav' &&
          managerLane !== 'pitch' &&
          managerLane !== 'plan' &&
          managerLane !== 'm1'))
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
            visualBullets: (early.bullets ?? []).slice(0, 1),
            quickActions: (early.quickActions ?? []).slice(0, 5),
            cardTitle: early.cardTitle,
          },
          {
            userText: rewritten,
            skipAutoNav: true,
            skipNoteReplayable: early.kind === 'repeat',
            skipButlerRemind: early.kind === 'wake' || early.kind === 'timer',
            // Nur skippen wenn Native-Confirm schon in der Speech steckt —
            // sonst force-wake in presentConcierge (kein LLM-Fake).
            skipAlarmBackgroundTasks: (() => {
              if (early.kind === 'timer') return true;
              if (early.kind !== 'wake') return false;
              try {
                const {
                  looksLikeNativeWakeSpeech,
                } = require('../../services/alarms/ensureWakeNativePresent') as {
                  looksLikeNativeWakeSpeech: (s: string) => boolean;
                };
                return looksLikeNativeWakeSpeech(early.speech);
              } catch {
                return true;
              }
            })(),
          },
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
          jobId: early.kind === 'wake' || early.kind === 'timer' ? 'memory' : 'day_plan_budget',
        };
      }
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
        let speech =
          'Das klären wir im Reisebüro — ich mach da den Plan mit euch, ohne dass wir hier abdriften.';
        try {
          const { parseBriefSlots } = await import('../../reisebuero/parseBriefSlots');
          const { mergeLedger, cloneEmptyLedger } = await import('../../reisebuero/slotLedger');
          const { inventoryRecapHint, isInventoryGapFill } = await import(
            '../../reisebuero/inventoryRecap'
          );
          const led = mergeLedger(cloneEmptyLedger(), parseBriefSlots(rewritten));
          if (isInventoryGapFill(led)) {
            const hint = inventoryRecapHint(led);
            speech = hint
              ? `Mach ich im Reisebüro — ${hint}, den Rest hole ich nach.`
              : 'Mach ich im Reisebüro — was schon da ist, lasse ich, und fülle nur die Lücken.';
          }
        } catch {
          /* soft bridge */
        }
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: speech,
            visualBullets: ['Yorros Reisebüro', 'Plan sammeln, dann suchen'],
            quickActions: [],
            cardTitle: 'Yorros Reisebüro',
          },
          { userText: rewritten, skipAutoNav: true },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: speech,
          bullets: ['Yorros Reisebüro'],
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

  // Fanout schon früh gestartet — hier nur nachziehen wenn noch nicht, mit frischem subject.
  if (!earlyFanoutPromise) {
    const prefetchFanout =
      !choiceFast &&
      (call1Execution === 'task_fanout' ||
        call1Execution === 'nav_execute' ||
        ((analysis.tasks?.length ?? 0) > 0 &&
          call1Execution !== 'chat_lane' &&
          call1Execution !== 'events_research' &&
          call1Execution !== 'pitch_module' &&
          call1Execution !== 'reisebuero'));
    if (prefetchFanout) {
      earlyFanoutPromise = runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject,
        city: short.lastMentionedCity,
        signal,
      });
    }
  }

  // Manager-Bridge = Beat 1 — TTS fire-and-forget; Research/Call-2 parallel (nicht await).
  // Safety: Early-Flag ohne laufende Session → nochmal Bridge kick (sonst Stille bis Call 2).
  if (analysis.bridgeSpokenEarly) {
    try {
      const { fusedBridgeCommitted } = require('../speech/fusedTurnSpeech') as {
        fusedBridgeCommitted: () => boolean;
      };
      // Nie clearen nur weil Pump nach Bridge-Satz ended — sonst 2. Bridge + 2. Antwort.
      if (!fusedBridgeCommitted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly && (analysis.bridge || '').trim()) {
    // Sofort markieren → Call-2/Fanout starten parallel zur Bridge-TTS.
    analysis = { ...analysis, bridgeSpokenEarly: true };
    bridgeSpokenDuringAnalyze = true;
    void speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    ).then((br) => {
      if (!br?.alreadySpoken && !br?.text) {
        /* soft — Flag bleibt; fused kann trotzdem laufen */
      }
    });
  }

  let compoundPlanDayKey: string | null = null;
  try {
    const { shouldIngestCompoundPlan, ingestCompoundDayPlan } = await import(
      '../planning/compoundPlanIngest'
    );
    let blockExploreForFlight = call1Execution === 'flight_advisor';
    try {
      const { blocksExploreDriftForFlight } = require('../../services/flights/flightTripIntent') as {
        blocksExploreDriftForFlight: (s: string) => boolean;
      };
      if (blocksExploreDriftForFlight(rewritten)) blockExploreForFlight = true;
    } catch {
      /* soft */
    }
    if (!blockExploreForFlight && shouldIngestCompoundPlan(rewritten)) {
      const ingested = await ingestCompoundDayPlan({
        userText: rewritten,
        frame: analysis.frame ?? null,
        openCalendar: true,
      });
      if (ingested?.targetDate) {
        compoundPlanDayKey = ingested.targetDate;
      }
      // Auto: Timeline auf + Step-Loop — nicht auf Button „Punkte durchgehen“ warten
      if (
        ingested &&
        (ingested.openWishesQueue?.length ?? 0) > 0 &&
        call1Execution !== 'flight_advisor'
      ) {
        if (__DEV__) {
          console.log(
            '[m5] compound ingest → auto step-loop',
            rewritten.slice(0, 100),
          );
        }
        const { startPlanStepLoop } = await import(
          '../planning/planSessionOrchestrator'
        );
        await startPlanStepLoop({ plan: ingested });
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
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] compound plan ingest', err);
  }

  // Force-Tagesplan ohne Compound-Skelett → Modul 5 (Call-1 Bridge schon raus)
  if (!compoundPlanDayKey && call1Execution !== 'flight_advisor') {
    try {
      const { shouldForceModul5Handoff } = await import(
        '../planning/planHandoffGuard'
      );
      if (shouldForceModul5Handoff(rewritten)) {
        if (__DEV__) {
          console.log(
            '[m5] post-call1 force → runPlanningModule',
            rewritten.slice(0, 100),
          );
        }
        const { runPlanningModule } = await import(
          '../planning/runPlanningModule'
        );
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
    } catch (err) {
      if (__DEV__) console.warn('[runConciergeTurn] post-call1 m5 force', err);
    }
  }

  // --- Instant-Rechnung Fallback (Early-Path oben deckt den Normalfall) ---
  try {
    const { tryLocalMathAnswer } = require('../../services/speech/localInstantAnswer') as {
      tryLocalMathAnswer: (s: string) => {
        lead: string;
        speech: string;
        bullets: string[];
      } | null;
    };
    const localArith = tryLocalMathAnswer(rawUserTextForCall1);
    if (localArith) {
      const bridgeAlready =
        bridgeSpokenDuringAnalyze || Boolean(analysis.bridgeSpokenEarly);
      const speech = bridgeAlready
        ? localArith.speech
        : `${localArith.lead} ${localArith.speech}`.replace(/\s+/g, ' ').trim();
      const presented = await presentChatLaneResult({
        turnId,
        result: {
          speech,
          bullets: localArith.bullets,
          buttons: [],
          bridgeSpoken: bridgeAlready ? analysis.bridge : null,
          blueprintId: analysis.blueprintId,
          personaVariant: analysis.personaVariant || 'default',
          needsResearch: 'quick',
          celestial: false,
          nextHandoff: null,
        },
        bridgeFromRouter: null,
        userText: rewritten,
      });
      return presented;
    }
  } catch {
    /* soft */
  }

  // --- Call-2 Chat-Lane: nur wenn Call-1 execution=chat_lane ---
  let chatHandoffToPitch = false;
  let chatHandoffToEvents = false;
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
        execution: call1Execution,
        chatLane: analysis.chatLane,
      });

      // Chat hat selbst Live-Recherche angefordert → nicht die Chat-Erfindung vorlesen
      if (
        chatResult.nextHandoff === 'pitch' ||
        chatResult.nextHandoff === 'events'
      ) {
        chatHandoffToPitch = chatResult.nextHandoff === 'pitch';
        chatHandoffToEvents = chatResult.nextHandoff === 'events';
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

        // Hotel-Chat ohne benannte Optionen merken (Follow-up „erstes Hotel“)
        try {
          const invKind = detectLiveInventoryKind(rewritten);
          if (
            invKind === 'hotel' ||
            /\bhotel\b/iu.test(rewritten) ||
            String(analysis.blueprintId || '').startsWith('hotel')
          ) {
            const { inferHotelPitchOutcomeFromSpeech, noteHotelPitchOutcome } =
              await import('./hotelPitchFollowUp');
            const outcome = inferHotelPitchOutcomeFromSpeech(
              chatResult.speech || '',
              chatResult.bullets || [],
            );
            noteHotelPitchOutcome({
              query: rewritten,
              outcome,
            });
          }
        } catch {
          /* soft */
        }

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
              execution: call1Execution,
              chatLane: next.lane || analysis.chatLane,
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
      (call1Execution === 'events_research' || chatHandoffToEvents) &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer'
    ) {
      if (__DEV__) console.log('[events] handoff → researchTodaysEvents', rewritten.slice(0, 80));
      rememberLiveInventoryQuery(rewritten, 'events');
      const eventCity =
        analysis.frame?.destCity ||
        analysis.cityScope?.researchCity ||
        resolveEventResearchCity(rewritten);
      // Bridge + Event-Research parallel — kein Warten auf Intro vor dem Fetch.
      const eventWaitP = speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const researchP = researchTodaysEvents(rewritten, {
        cityHint: eventCity,
        force: true,
        call2Brief: analysis.call2Brief ?? null,
        authorIntent: analysis.authorIntent ?? analysis.call2Brief ?? null,
      });
      const [eventWait, researchRaw] = await Promise.all([eventWaitP, researchP]);
      const research =
        researchRaw ||
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

  // Auswahl-Pitch (M2): Call-1 pitch_module ODER Chat-Handoff → Pitch
  try {
    if (
      (call1Execution === 'pitch_module' || chatHandoffToPitch) &&
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
      let pitchText = rewritten;
      try {
        const { normalizeAyceStt } = await import('../pitch/ayceIntent');
        pitchText = normalizeAyceStt(rewritten);
      } catch {
        /* soft */
      }
      const introText = resolveHandoffIntro(analysis);
      // Bridge-TTS + Pitch-Recherche parallel — nicht erst Intro abwarten.
      const introP = speakHandoffIntro({
        analysis,
        userText: pitchText,
        turnId,
      });
      const owMusts: string[] = [];
      try {
        const { buildOpenWorldContract } = await import('./call1OpenWorldContract');
        const ow = buildOpenWorldContract({
          userText: pitchText,
          authorIntent: analysis.authorIntent || analysis.intentSummary,
          mustHaves: [
            ...(analysis.order?.must ?? []),
            ...(analysis.order?.avoid ?? []),
            ...(analysis.mustHaves ?? []),
            ...(analysis.frame?.mustHaves ?? []),
          ],
          order: analysis.order ?? null,
        });
        owMusts.push(...ow.must);
      } catch {
        /* soft */
      }
      const { request, bridge } = buildPitchRequestFromText({
        text: pitchText,
        requestId: `m2_${turnId}`,
        uiLayout: 'live_split',
        signal,
        continueFromBridge: introText,
        call1MustHaves: [
          ...owMusts,
          ...(analysis.order?.must ?? []),
          ...(analysis.order?.avoid ?? []),
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
        call1Order: analysis.order ?? null,
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
      const [intro, result] = await Promise.all([
        introP,
        runPitchModule(request),
      ]);
      void intro;
      // Order.ui.startNav — erste harte Option nach Pitch (optional delay)
      if (
        analysis.order?.ui?.startNav &&
        !result.softFail &&
        result.options[0]
      ) {
        const first = result.options[0];
        const go = async () => {
          try {
            const { startNavigationFromOffer } = await import(
              '../../services/navigation/resolveNavTarget'
            );
            await startNavigationFromOffer({
              poiId: -1,
              lat: first.lat,
              lng: first.lng,
              name: first.name,
            });
          } catch {
            /* soft */
          }
        };
        const d = analysis.order.ui.delayMs;
        if (typeof d === 'number' && d > 0) {
          setTimeout(() => {
            void go();
          }, Math.min(15_000, d));
        } else {
          void go();
        }
      }
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
      try {
        const pitchKind = (() => {
          try {
            const { useLivePitchStore } = require('../pitch/publishPitchUi') as {
              useLivePitchStore: {
                getState: () => { pitchKind?: string | null };
              };
            };
            return useLivePitchStore.getState().pitchKind;
          } catch {
            return null;
          }
        })();
        if (
          pitchKind === 'hotel' ||
          detectLiveInventoryKind(rewritten) === 'hotel'
        ) {
          const { noteHotelPitchOutcome, inferHotelPitchOutcomeFromSpeech } =
            await import('./hotelPitchFollowUp');
          const names = result.options.map((o) => o.name).filter(Boolean);
          const outcome = inferHotelPitchOutcomeFromSpeech(
            result.spokenText,
            pitchBullets,
            names,
          );
          noteHotelPitchOutcome({
            query: rewritten,
            outcome,
            hotelNames: names,
          });
        }
      } catch {
        /* soft */
      }
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
    const coords = anchorCoords(rucksack);
    const offer = await buildM1PoiOffer({
      userText: rewritten,
      lat: coords.lat,
      lng: coords.lng,
      headingDeg: null,
    });
    if (!(offer.speech || '').trim() && !offer.poiId) {
      const chatResult = await runChatLane({
        userText: rewritten,
        turnId,
        bridgeFromRouter: analysis.bridge,
        blueprintId: analysis.blueprintId,
        nearestBlueprint: analysis.nearestBlueprint,
        blueprintStage: analysis.blueprintStage,
        needsResearch: 'deep',
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
        execution: 'chat_lane',
        chatLane: 'chat',
      });
      return await presentChatLaneResult({
        turnId,
        result: chatResult,
        bridgeFromRouter: analysis.bridgeSpokenEarly ? null : analysis.bridge,
        userText: rewritten,
      });
    }
    if (!analysis.bridgeSpokenEarly && (analysis.bridge || '').trim()) {
      analysis = { ...analysis, bridgeSpokenEarly: true };
      void speakBridgeFromAnalysis(
        analysis,
        turnId,
        rewritten,
        topicDecision.mode,
      );
    }
    const bridge = analysis.bridge;
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
    : earlyFanoutPromise ??
      runManagerTaskFanout({
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
      const { fusedBridgeCommitted } = require('../speech/fusedTurnSpeech') as {
        fusedBridgeCommitted: () => boolean;
      };
      // Nie clearen nur weil Pump nach Bridge-Satz ended — sonst 2. Bridge + 2. Antwort.
      if (!fusedBridgeCommitted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly && (analysis.bridge || '').trim()) {
    bridgingText = analysis.bridge;
    analysis = { ...analysis, bridgeSpokenEarly: true };
    bridgeSpokenDuringAnalyze = true;
    void speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
  } else if (!bridgingText) {
    bridgingText = analysis.bridge;
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

  if (call1ComposeShape && 'fastResults' in fanout) {
    try {
      const { mergeComposeSpeechFromResults } = require('./composeRunner') as typeof import('./composeRunner');
      const composed = mergeComposeSpeechFromResults(fanout.fastResults);
      if (composed.speech.trim()) {
        fact = {
          ...fact,
          draftText: composed.speech,
          bullets: composed.bullets.length
            ? composed.bullets
            : (fact?.bullets ?? []).slice(0, 3),
        };
      }
    } catch {
      /* soft */
    }
  }

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
          try {
            const { fusedEnqueue } = require('../speech/fusedTurnSpeech') as {
              fusedEnqueue: (o: {
                kind: 'bridging' | 'main';
                text: string;
                turnId: string;
              }) => Promise<boolean>;
            };
            void fusedEnqueue({
              kind: 'main',
              text: String(igHit.draftText).slice(0, 1200),
              turnId,
            });
          } catch {
            enqueueSpeech({
              kind: 'main',
              text: String(igHit.draftText).slice(0, 1200),
              turnId: `${turnId}_ig`,
            });
          }
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
          try {
            const { fusedEnqueue } = require('../speech/fusedTurnSpeech') as {
              fusedEnqueue: (o: {
                kind: 'bridging' | 'main';
                text: string;
                turnId: string;
              }) => Promise<boolean>;
            };
            void fusedEnqueue({ kind: 'main', text: extra, turnId });
          } catch {
            enqueueSpeech({
              kind: 'main',
              text: extra,
              turnId: `${turnId}_slow`,
            });
          }
          return;
        }
        if (fanout.spokenSlowPending.some((t) => t.lane === 'instagram')) {
          try {
            const { fusedEnqueue } = require('../speech/fusedTurnSpeech') as {
              fusedEnqueue: (o: {
                kind: 'bridging' | 'main';
                text: string;
                turnId: string;
              }) => Promise<boolean>;
            };
            void fusedEnqueue({
              kind: 'main',
              text: 'Auf Instagram war öffentlich nichts Brauchbares dazu — ich bleibe bei den Web-Quellen.',
              turnId,
            });
          } catch {
            enqueueSpeech({
              kind: 'main',
              text: 'Auf Instagram war öffentlich nichts Brauchbares dazu — ich bleibe bei den Web-Quellen.',
              turnId: `${turnId}_ig_empty`,
            });
          }
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
      const destLabel =
        typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
          ? fact.meta.destName.trim()
          : 'Ziel';
      // Call-2 SOFORT — nicht auf FOSSGIS/Enrich warten (Live: Lücke nach „alles klar“).
      // Target-Name setzen: sonst denkt presentToUi „neues Ziel“ und awaitet commit nochmal (~30s).
      useFinnusStore.getState().patchNavigation({
        navActive: true,
        navVisible: true,
        navTargetName: destLabel,
      });
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
      } catch {
        /* soft */
      }
      try {
        useFinnusStore.getState().setPendingNavOffer({
          poiId: -1,
          name: destLabel,
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          source: 'concierge',
        });
      } catch {
        /* soft */
      }
      navPreStarted = true;
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
            destName: destLabel,
            etaMin,
            mode,
            arriveHm,
            bridgeAlreadySpoken: Boolean(
              bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly,
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
        fact = {
          ...fact,
          draftText: `Alles klar, ich starte die Navigation zum ${destLabel}.`,
          bullets: [],
          buttons: [],
        };
      }
      void commitHandsFreeNavStart(
        {
          poiId: -1,
          name: destLabel,
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          userQuery: rewritten,
        },
        { skipClosingGate: true },
      ).then((started) => {
        if (__DEV__) {
          console.log(
            '[runConciergeTurn] pre-start nav',
            started.ok,
            'via=' + (started as { via?: string }).via,
            'name=' + started.name,
          );
        }
      }).catch((err) => {
        console.warn('[runConciergeTurn] pre-start nav failed', err);
      });
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
      try {
        const {
          notePaceCall2Ready,
          notePaceBridgeEnded,
          getPaceTurn,
        } = require('../reboot/pipeline/paceTurnSession') as {
          notePaceCall2Ready: () => void;
          notePaceBridgeEnded: (at?: number) => void;
          getPaceTurn: () => { bridgeEndedAtMs: number | null } | null;
        };
        // Bridge gilt als „fertig genug“ sobald Call-2 Speech startet
        const pt = getPaceTurn();
        if (pt && pt.bridgeEndedAtMs == null) {
          notePaceBridgeEnded(Date.now());
        } else if (pt?.bridgeEndedAtMs && Date.now() > pt.bridgeEndedAtMs) {
          /* already estimated */
        }
        notePaceCall2Ready();
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
    // Call-2 primary: Hard-Cap nach Bridge — Interim aus Logic, Synthese läuft weiter
    let allowSynthStream = true;
    const synthPromise = synthesizeRebootTurn({
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
      call1OrderBlock: (() => {
        try {
          const { formatCall1OrderTicketForPrompt } = require('./call1OrderTicket') as {
            formatCall1OrderTicketForPrompt: (o: unknown) => string;
          };
          return formatCall1OrderTicketForPrompt(analysis.order) || null;
        } catch {
          return null;
        }
      })(),
      bulletBudgetMax: analysis.order?.bulletBudget?.max ?? 3,
      curatedContext: analysis.curatedContext ?? null,
      call1TaskBriefBlock: call1BriefBlock,
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
      call1ReferentsBlock: (() => {
        try {
          const { formatCall1ReferentsForPrompt } = require('./call1Referents') as {
            formatCall1ReferentsForPrompt: (
              r: NonNullable<ManagerAnalysis['frame']>['referents'],
            ) => string;
          };
          return formatCall1ReferentsForPrompt(analysis.frame?.referents) || null;
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
        if (!allowSynthStream) return;
        void speakStreamedSentence(sentence, index);
      },
    });
    try {
      const {
        raceCall2ReadyOrGapCap,
      } = require('./call2AfterBridge') as {
        raceCall2ReadyOrGapCap: <T>(o: {
          ready: Promise<T>;
          bridgeEndedAtMs: number;
        }) => Promise<{ value: T | null; forcedByGapCap: boolean }>;
      };
      const {
        getPaceTurn,
        notePaceForcedByGapCap,
        notePaceBridgeEnded,
      } = require('../reboot/pipeline/paceTurnSession') as {
        getPaceTurn: () => {
          bridgeEndedAtMs: number | null;
          bridgeStartedAtMs: number | null;
          bridgeBudgetSec: number;
        } | null;
        notePaceForcedByGapCap: () => void;
        notePaceBridgeEnded: (at?: number) => void;
      };
      const pt = getPaceTurn();
      let bridgeEnd =
        pt?.bridgeEndedAtMs ??
        (pt?.bridgeStartedAtMs != null
          ? pt.bridgeStartedAtMs + Math.max(1500, pt.bridgeBudgetSec * 1000)
          : null);
      if (bridgeEnd == null && pt) {
        bridgeEnd = Date.now() + Math.max(1500, pt.bridgeBudgetSec * 1000);
        notePaceBridgeEnded(bridgeEnd);
      }
      if (bridgeEnd != null) {
        const raced = await raceCall2ReadyOrGapCap({
          ready: synthPromise,
          bridgeEndedAtMs: bridgeEnd,
        });
        if (raced.value) {
          synthesis = raced.value;
        } else {
          notePaceForcedByGapCap();
          allowSynthStream = false;
          const interim = synthesizeOutput(logic);
          synthesis = interim;
          void synthPromise
            .then((full) => {
              if (!full?.fullDraftForUi?.trim()) return;
              synthesis = {
                ...full,
                fullDraftForUi: full.fullDraftForUi,
                bullets: full.bullets?.length ? full.bullets : interim.bullets,
                buttons: full.buttons?.length ? full.buttons : interim.buttons,
              };
              try {
                const rest = remainingSpeechAfterLead(
                  full.fullDraftForUi,
                  interim.fullDraftForUi,
                );
                if (rest && livePump.hasStarted() && !livePump.isEnded()) {
                  livePump.push(rest.slice(0, 1200));
                }
              } catch {
                /* soft */
              }
            })
            .catch(() => undefined);
        }
      } else {
        synthesis = await synthPromise;
      }
    } catch {
      synthesis = await synthPromise;
    }
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
          openCalendar: true,
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

  // Multi-Intent: aktuellen Job abhaken; nächsten Block natürlich (kein Permission-Ritual)
  try {
    const { completeActiveAndPeekNatural } = require('./intentQueue') as {
      completeActiveAndPeekNatural: () => {
        next: unknown;
        softBrief: string | null;
      };
    };
    const { softBrief } = completeActiveAndPeekNatural();
    if (
      softBrief &&
      synthesis.fullDraftForUi &&
      !/als nächstes|dann kümmern|weiter im plan/i.test(synthesis.fullDraftForUi)
    ) {
      const add = ` ${softBrief}`;
      synthesis = {
        ...synthesis,
        fullDraftForUi: `${synthesis.fullDraftForUi}${add}`,
      };
      if (logic.spokenDraft) {
        logic.spokenDraft = `${logic.spokenDraft}${add}`;
      }
    }
  } catch {
    /* soft */
  }

  // Speech vor Card/Nav — außer explizite Nav (Say–Do: Nav zuerst)
  // Wake: Native VOR erstem TTS-Satz (sonst LLM-Fake im earlySpeech).
  try {
    const { ensureWakeNativeBeforePresent } = await import(
      '../../services/alarms/ensureWakeNativePresent'
    );
    const ensured = await ensureWakeNativeBeforePresent(
      rewritten,
      synthesis.fullDraftForUi || '',
    );
    if (ensured) {
      synthesis = {
        ...synthesis,
        fullDraftForUi: ensured.speech,
        spokenChunks: [ensured.speech],
        bullets: (ensured.bullets ?? []).slice(0, 3),
      };
      if (logic.spokenDraft != null) logic.spokenDraft = ensured.speech;
    }
  } catch {
    /* soft */
  }

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

  // Explizite Nav: Call-2 JETZT — nie hinter presentToUi/Geocode/FOSSGIS (Live: 30s Stille).
  if (
    navPreStarted &&
    streamedSentenceCount === 0 &&
    (synthesis.fullDraftForUi || fact.draftText || '').trim()
  ) {
    const call2 =
      (typeof fact.draftText === 'string' && fact.draftText.trim()) ||
      synthesis.fullDraftForUi.trim();
    await speakStreamedSentence(call2, 0);
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
      skipConciergeCard: navPreStarted === true,
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
    // Mic/Blau an, solange Call-3 noch läuft (auch nach Call-2-Speech)
    let call3KeepBlue = false;
    try {
      const { shouldRunCall3Rethink } = require('../reboot/pipeline/call3Rethink') as {
        shouldRunCall3Rethink: (t: typeof rethinkTail) => boolean;
      };
      call3KeepBlue = shouldRunCall3Rethink(rethinkTail);
      if (call3KeepBlue) {
        const { useFinnusStore } = require('../../store/useFinnusStore') as {
          useFinnusStore: { getState: () => { setIsGenerating: (v: boolean) => void } };
        };
        useFinnusStore.getState().setIsGenerating(true);
      }
    } catch {
      call3KeepBlue = false;
    }
    try {
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
        try {
          const { notePaceUsedCall3 } = require('../reboot/pipeline/paceTurnSession') as {
            notePaceUsedCall3: () => void;
          };
          notePaceUsedCall3();
        } catch {
          /* soft */
        }
      }
    } finally {
      if (call3KeepBlue) {
        try {
          const { useFinnusStore } = require('../../store/useFinnusStore') as {
            useFinnusStore: {
              getState: () => { setIsGenerating: (v: boolean) => void };
            };
          };
          useFinnusStore.getState().setIsGenerating(false);
        } catch {
          /* soft */
        }
      }
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
  try {
    const { flushPaceTurnSample } = require('../reboot/pipeline/paceTurnSession') as {
      flushPaceTurnSample: () => Promise<void>;
    };
    void flushPaceTurnSample();
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
