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
import { tryEarlyM5Handoff, tryM5PlanRouteHandoff } from './handoffs/m5Early';
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

  // Sofort-Ack schon gesprochen → keine zweite Bridge (Doppel-Ack vermeiden)
  try {
    const { hadRecentLatencyAck } = require('../../services/speech/floskelEngine') as {
      hadRecentLatencyAck: (ms?: number) => boolean;
    };
    if (hadRecentLatencyAck(2_800)) {
      return { text: null, alreadySpoken: false };
    }
  } catch {
    /* soft */
  }

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
  try {
    const { noteFindusSpokenForEcho } = require('../../services/handsFree/echoGuard') as {
      noteFindusSpokenForEcho: (t: string) => void;
    };
    noteFindusSpokenForEcho(bridge);
  } catch {
    /* soft */
  }
  try {
    const { latencyMark } = require('../../services/debug/latencyTiming') as {
      latencyMark: (m: string, d?: string) => void;
    };
    latencyMark('ack', 'manager_bridge');
  } catch {
    /* soft */
  }
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

  // SSOT: Modul-5-Vision — VOR Manager-LLM / Pitch (ausgelagert)
  {
    const earlyM5 = await tryEarlyM5Handoff({ rewritten, turnId });
    if (earlyM5) return earlyM5;
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
    const m5Route = await tryM5PlanRouteHandoff({ rewritten, turnId });
    if (m5Route) return m5Route;
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
    if (!isExplicitNavIntent(rewritten)) {
      if (
        (usePlanCalendarUiStore.getState().calendarVisible ||
          isPlanningModuleActive() ||
          shouldHandoffConflictToPlanning(rewritten)) &&
        (looksLikePlanEditUtterance(rewritten) ||
          shouldHandoffConflictToPlanning(rewritten))
      ) {
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
      handoff === 'none' &&
      (durationMerged != null || shouldHandoffToTourModule(rewritten));

    if (tourHandoff) {
      // Tour planen → Timeline öffnen + Stopps eintragen (Überblick)
      // Live-Nav startet der User aus der Timeline / per Button.
      const built = durationMerged
        ? {
            request: {
              ...durationMerged,
              uiLayout: 'timeline_stack' as const,
            },
            bridge: null as string | null,
          }
        : buildTourRequestFromText({
            text: rewritten,
            requestId: `m2_tour_${turnId}`,
            uiLayout: 'timeline_stack',
            signal,
          });
      const bridge = built.bridge;
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
      presentToUi(result.spokenText, result.bullets, tourButtons as never, {
        userText: rewritten,
        forceAutoNav: false,
      });
      enqueueSpeech({
        kind: 'main',
        text: result.spokenText,
        turnId,
      });
      const logic: LogicNodeOutput = {
        spokenDraft: result.spokenText,
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

  // Tages-Events: Research + Buttons VOR Speech (nicht Speech-only ohne Links)
  try {
    const { isEventResearchQuery, researchTodaysEvents, synthesizeEventSpeech, eventResearchToActions } =
      await import('../../services/concierge/eventResearchService');
    if (
      isEventResearchQuery(rewritten) &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer'
    ) {
      if (__DEV__) console.log('[events] handoff → researchTodaysEvents', rewritten.slice(0, 80));
      enqueueSpeech({
        kind: 'bridging',
        text: 'Ich check kurz, was heute wirklich läuft.',
        turnId,
        alreadySpoken: false,
      });
      try {
        const { speakRuntimeText } = await import('../../runtime/speechModule');
        const { getVoiceSettingsForTour } = await import('../../services/ttsService');
        const voice = await getVoiceSettingsForTour();
        void speakRuntimeText(
          'Ich check kurz, was heute wirklich läuft.',
          { voiceId: voice.voiceId, speechRate: voice.speechRate },
          { priority: 'system', deliveryKind: 'assistant' },
        );
      } catch {
        /* soft */
      }
      const research = await researchTodaysEvents(rewritten);
      if (research) {
        const seedSpeech = synthesizeEventSpeech(research);
        // Speech zuerst — Geocode/Button-Sync parallel danach
        if (seedSpeech.trim()) {
          try {
            const { speakRuntimeText } = await import('../../runtime/speechModule');
            const { getVoiceSettingsForTour } = await import('../../services/ttsService');
            const voice = await getVoiceSettingsForTour();
            void speakRuntimeText(
              seedSpeech,
              { voiceId: voice.voiceId, speechRate: voice.speechRate },
              { priority: 'question', deliveryKind: 'assistant' },
            );
            enqueueSpeech({
              kind: 'main',
              text: seedSpeech,
              turnId,
              alreadySpoken: true,
            });
          } catch {
            enqueueSpeech({ kind: 'main', text: seedSpeech, turnId });
          }
        }
        const seedActions = eventResearchToActions(research);
        const { reflectAndSyncConciergeActions } = await import(
          '../../services/concierge/actionButtonSync'
        );
        const synced = await reflectAndSyncConciergeActions(
          {
            speechText: seedSpeech,
            visualBullets: research.events.slice(0, 3).map((e) => {
              const t = e.startTime ? `${e.startTime} · ` : '';
              return `${t}${e.title} @ ${e.venue}`;
            }),
            quickActions: seedActions,
            cardTitle: 'Heute vor Ort',
          },
          { eventResearch: research, userText: rewritten },
        );
        const speech = synced.response.speechText || seedSpeech;
        let bullets = synced.response.visualBullets ?? [];
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
        // Nav ohne Koords: Maps-OPEN_URL als Just-Do-It, damit die Karte nie button-leer bleibt
        const hasNavOrMaps = buttonsClean.some(
          (b) =>
            b.payload.kind === 'navigate' ||
            (b.payload.kind === 'deep_link' &&
              /maps\.google|google\.[^/]*\/maps/i.test(String(b.payload.url ?? ''))),
        );
        if (!hasNavOrMaps && research.events.length) {
          for (const e of research.events.slice(0, 2)) {
            const q = encodeURIComponent(`${e.venue} ${research.city}`);
            buttonsClean.push({
              id: `ev_maps_${buttonsClean.length}`,
              label: (() => {
                try {
                  const { shortenActionLabel } = require('../../services/concierge/actionLabelShorten') as {
                    shortenActionLabel: (s: string, max?: number) => string;
                  };
                  return shortenActionLabel(`🗺️ ${e.venue}`);
                } catch {
                  return `🗺️ ${e.venue}`.slice(0, 28);
                }
              })(),
              payload: {
                kind: 'deep_link',
                url: `https://www.google.com/maps/search/?api=1&query=${q}`,
                destName: e.venue,
              },
            });
          }
        }
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
        // Kein belegtes Programm: keine Fake-Stichpunkte aus „Strandbar oder Sport“-Text
        if (!research.events.length) {
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
              label: '🍹 Strandbar',
              payload: {
                kind: 'ui' as const,
                action: 'ask_history',
                data: {
                  prompt:
                    'Was läuft heute Abend in einer Strandbar oder Bar hier — Programm, Route, Tickets.',
                },
              },
            },
            {
              id: 'ev_ask_sport',
              label: '⚽ Sport',
              payload: {
                kind: 'ui' as const,
                action: 'ask_history',
                data: {
                  prompt:
                    'Gibt es heute Abend Sport-Events oder Turniere hier — mit Route und Infos.',
                },
              },
            },
          ];
        }
        await presentToUi(speech, bullets, buttonsClean as never, {
          userText: rewritten,
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
          bridgingText: 'Ich check kurz, was heute wirklich läuft.',
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nightlife_vibe',
        };
      }
    }
  } catch (err) {
    console.warn('[events] handoff failed', err);
  }

  // Auswahl-Pitch (M2): zwei Optionen — auch wenn Manager „blueprint“ sagt
  try {
    const { shouldHandoffToPitchModule } = await import('./handoffs/pitch');
    if (
      shouldHandoffToPitchModule(rewritten) &&
      handoff !== 'm5_plan' &&
      handoff !== 'm3_nav_start' &&
      handoff !== 'm1_poi_offer'
    ) {
      if (__DEV__) console.log('[pitch] handoff → runPitchModule', rewritten.slice(0, 80));
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
      const { request, bridge } = buildPitchRequestFromText({
        text: rewritten,
        requestId: `m2_${turnId}`,
        uiLayout: 'live_split',
        signal,
      });
      if (bridge && !signal?.aborted) {
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
          o.actions.find((a) => a.type === 'START_NAVIGATION') ||
          o.actions.find((a) => a.type === 'OPEN_URL') ||
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
      const pitchBullets = result.options
        .map((o) => o.name)
        .filter(Boolean)
        .slice(0, 3);
      await presentToUi(result.spokenText, pitchBullets, pitchButtons as never, {
        userText: rewritten,
      });
      enqueueSpeech({
        kind: 'main',
        text: result.spokenText,
        turnId,
      });
      const logic: LogicNodeOutput = {
        spokenDraft: result.spokenText,
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

  const fanout = amenityFact
    ? {
        mergedFact: amenityFact,
        silentSlowPending: [] as typeof analysis.tasks,
        spokenSlowPending: [] as typeof analysis.tasks,
      }
    : await runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject,
        city: short.lastMentionedCity,
        signal,
      });
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
            text: String(igHit.draftText).slice(0, 420),
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
    handoff === 'm3_nav_start' ||
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
      })())
  ) {
    fact = {
      ...fact,
      meta: { ...fact.meta, autoStartNav: true, forceAutoNav: true },
    };
  }

  // Say–Do: Navigation VOR der Stimme starten, wenn Ziel-Koordinaten schon da
  let navPreStarted = false;
  if (
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
      if (navPreStarted) {
        const seed =
          typeof fact.meta.distanceM === 'number' && fact.meta.distanceM > 0
            ? Math.round(fact.meta.distanceM)
            : null;
        useFinnusStore.getState().patchNavigation({
          navActive: true,
          navVisible: true,
          ...(seed != null
            ? { navDistanceM: seed, navTotalDistanceM: seed }
            : {}),
        });
        // Speech nicht mehr nach Ziel fragen, wenn Route schon läuft
        if (
          typeof fact.draftText === 'string' &&
          /Wohin soll|Tippe die Route/i.test(fact.draftText)
        ) {
          const dest =
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName
              : 'Ziel';
          const dist =
            typeof fact.meta.distanceM === 'number' && fact.meta.distanceM > 0
              ? ` etwa ${Math.round(fact.meta.distanceM)} Meter`
              : '';
          fact = {
            ...fact,
            draftText: `Alles klar — Route zu ${dest}${dist} startet.`,
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

  let liveTurn = false;
  try {
    const { isLiveChatTurnActive } = await import(
      '../../services/handsFree/liveChatTurnContext'
    );
    liveTurn = isLiveChatTurnActive();
  } catch {
    liveTurn = false;
  }

  let streamedSentenceCount = 0;
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
        const { speakRuntimeText } = await import('../../runtime/speechModule');
        const { getVoiceSettingsForTour } = await import(
          '../../services/ttsService'
        );
        const voice = await getVoiceSettingsForTour();
        void speakRuntimeText(
          sentence,
          { voiceId: voice.voiceId, speechRate: voice.speechRate },
          { priority: 'question', deliveryKind: 'assistant' },
        );
      } catch {
        /* soft */
      }
      enqueueSpeech({
        kind: 'bridging',
        text: sentence,
        turnId,
        alreadySpoken: true,
      });
    } else {
      enqueueSpeech({ kind: 'main', text: sentence, turnId });
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
    synthesis = await synthesizeRebootTurn({
      userText: rewritten,
      fact,
      bridgeOneLiner: bridgeOnce,
      jobId,
      speechBudgetChars: getJobContract(jobId).speechBudgetChars,
      signal,
      onSpeechSentence: liveTurn
        ? (sentence, index) => {
            void speakStreamedSentence(sentence, index);
          }
        : undefined,
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
    fact.meta?.forceAutoNav === true ||
    (fact.meta?.amenityNav === true && fact.meta?.unique === true);
  const seedDistanceM =
    typeof fact.meta?.distanceM === 'number' ? fact.meta.distanceM : null;
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
      seedDistanceM,
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

  // Rest nachziehen — erster Satz ggf. schon via earlySpeech
  if (streamedSentenceCount === 0) {
    if (liveTurn && fullSpeech.trim()) {
      await speakStreamedSentence(fullSpeech, 0);
    } else {
      enqueueSpeech({
        kind: 'main',
        text: fullSpeech,
        turnId,
      });
      try {
        const { latencyMark } = require('../../services/debug/latencyTiming') as {
          latencyMark: (m: string, d?: string) => void;
        };
        latencyMark('tts', 'main_enqueue');
      } catch {
        /* soft */
      }
    }
  } else if (chunks.length > streamedSentenceCount) {
    for (let i = streamedSentenceCount; i < chunks.length; i++) {
      enqueueSpeech({ kind: 'main', text: chunks[i]!, turnId });
    }
  } else if (
    earlySpeech &&
    fullSpeech.trim() &&
    !fullSpeech.trim().startsWith(earlySpeech.slice(0, 40))
  ) {
    // presentToUi hat Speech geändert — Rest nachziehen
    const rest = fullSpeech.replace(earlySpeech, '').trim();
    if (rest) enqueueSpeech({ kind: 'main', text: rest, turnId });
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
