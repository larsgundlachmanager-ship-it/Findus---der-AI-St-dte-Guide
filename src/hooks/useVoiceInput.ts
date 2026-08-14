import { useCallback, useEffect, useRef, useState } from 'react';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from '../services/userProfileService';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import {
  speakAssistantText,
  stopSpeaking,
  getVoiceSettingsForTour,
} from '../services/ttsService';
import {
  isCurrentlyListening,
  peekListeningTranscript,
  startListening,
  stopListening,
} from '../services/sttService';
import {
  isStopNavigationIntent,
  resolveNavOfferFromReply,
  shouldStartNavFromOffer,
  startNavigation,
  stopNavigation,
} from '../services/navigation';
import { handleMemoryIntent } from '../services/intentService';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { presentConciergeResponse } from '../services/concierge/presentConcierge';
import { shouldAcceptPendingAffiliateOffer } from '../services/affiliate/pendingAffiliateOffer';
import {
  alertActionError,
  handleQuickAction,
} from '../services/actionHandlerService';
import { wrapPlainAsConcierge } from '../services/concierge/parseConciergeResponse';
import {
  markMicHoldUsed,
  markMicLockUsed,
  markMicTapUsed,
} from '../services/ui/micHintPrefs';
import { markFeatureTipCompleted } from '../services/ai/featureTips';
import { observeUserQuestionStyle } from '../services/questionStyleService';
import {
  onUserInputEnd,
  onUserInputStart,
} from '../runtime/orchestrator';
import { interruptAudioPipeline } from '../runtime/audioPipeline';
import {
  bargeInFlush,
  runModule2Pipeline,
} from '../module2';
import {
  appendSideChannelAsk,
  captureSideChannelHints,
} from '../services/memory/sideChannelMemory';
import { extractFlightCode, prepareFlightFollowUp } from '../services/flights/flightAdvisor';
import {
  rememberFlightPlanForAlarm,
  wakeOfferForFlightPlan,
} from '../services/alarms/wakeAlarmAdvisor';
import { recordUserSpeechExact } from '../services/feedback/executionTracking';
import { runPreferenceCaptureMiddleware } from '../services/memory/preferenceCaptureMiddleware';
import { noteUserTextForSituation } from '../services/persona/situationGate';

/** Kurz tippen (< Tap) → Tippfeld; darüber → Sprache. */
const TAP_MAX_MS = 320;
/** Kurz nach Loslassen weiterhören — Ziel ~100–150ms. */
const STT_TAIL_MS = 120;
/** Hold ≥ 2 s → Frage gilt; darunter während Findus spricht = Abbruch (Resume). */
const MIN_VOICE_MS = 2_000;
const STT_FINALIZE_MS = 450;

export type VoiceFallbackReason = 'unavailable' | 'permission' | 'error';

type PressMode = 'idle' | 'pending' | 'voice' | 'locked';

/**
 * Kurz tippen (< TAP_MAX_MS) → Tippfeld (wenn onShortPress); Findus redet weiter.
 * Press ≥ Tap → Mikro sofort an; Loslassen finalisiert (außer Fixierung).
 * Nach rechts wischen während Hold → Mikro fixieren (Hände frei).
 * Tippen bei Fixierung → senden.
 * Loslassen < 2 s während Findus spricht → Abbruch (Resume), außer Timeline.
 * Timeline / Findus still: nach Aufnahme-Start auch bei kürzerem Hold senden.
 * Loslassen ≥ 2 s (ohne Lock) → Frage abschicken (Interrupt committed).
 */
export function useVoiceInput(options?: {
  onShortPress?: () => void;
  onNeedTextFallback?: (reason: VoiceFallbackReason) => void;
}) {
  const onShortPress = options?.onShortPress;
  const onNeedTextFallback = options?.onNeedTextFallback;

  const [partialText, setPartialText] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isMicLocked, setIsMicLocked] = useState(false);
  const partialTextRef = useRef('');
  const pressModeRef = useRef<PressMode>('idle');
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped on every committed mic interrupt — abandons in-flight answers. */
  const questionEpochRef = useRef(0);
  const voiceStartedAtRef = useRef(0);
  const pressStartedAtRef = useRef(0);
  /** Soft-Pause aktiv (Resume möglich solange nicht committed). */
  const provisionalPausedRef = useRef(false);
  /** Volle Unterbrechung committed (≥ 2 s Hold). */
  const interruptCommittedRef = useRef(false);
  /** Nach Tippen-auf-Fixiert: PressOut nicht als Kurz-Tipp werten. */
  const skipNextPressOutRef = useRef(false);

  const addChatMessage = useFinnusStore((s) => s.addChatMessage);
  const setIsListening = useFinnusStore((s) => s.setIsListening);
  const setIsGenerating = useFinnusStore((s) => s.setIsGenerating);
  const isListening = useFinnusStore((s) => s.isListening);
  const isGenerating = useFinnusStore((s) => s.isGenerating);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const stillCurrent = useCallback((epoch: number) => {
    return questionEpochRef.current === epoch;
  }, []);

  /** Soft: TTS pausieren — kein Denken, kein Epoch-Bump (Abbrechen → Resume). */
  const softMuteFindusForMic = useCallback(async () => {
    provisionalPausedRef.current = false;
    try {
      const { pauseSpeakingForNav } = await import('../services/AudioVoiceService');
      provisionalPausedRef.current = await pauseSpeakingForNav();
    } catch {
      provisionalPausedRef.current = false;
    }
    if (provisionalPausedRef.current) {
      useFinnusStore.getState().setIsPlayingAudio(false);
      useFinnusStore.getState().setIsAudiblySpeaking(false);
      return;
    }
    // Kein pausierbarer Sound → hart stoppen (Resume dann nicht möglich)
    try {
      await stopSpeaking();
    } catch {
      /* ignore */
    }
    try {
      const { forceClearSpeakingUi } = await import('../services/AudioVoiceService');
      forceClearSpeakingUi();
    } catch {
      useFinnusStore.getState().setIsPlayingAudio(false);
    }
  }, []);

  /** Mic = echte Barge-in: TTS weg, Generation abbrechen (nach ≥ 2 s Hold). */
  const interruptFindusForMic = useCallback(async () => {
    interruptCommittedRef.current = true;
    try {
      const { discardPausedSpeaking } = await import('../services/AudioVoiceService');
      await discardPausedSpeaking();
    } catch {
      /* soft */
    }
    provisionalPausedRef.current = false;
    questionEpochRef.current += 1;
    try {
      await onUserInputStart('user_voice');
    } catch {
      setIsGenerating(false);
      try {
        const { interruptNarrationForForce } = await import(
          '../runtime/narrationPipeline'
        );
        await interruptNarrationForForce();
      } catch {
        /* ignore */
      }
    }
    try {
      const { forceClearSpeakingUi } = await import('../services/AudioVoiceService');
      forceClearSpeakingUi();
    } catch {
      useFinnusStore.getState().setIsPlayingAudio(false);
    }
    try {
      await bargeInFlush();
    } catch {
      try {
        await interruptAudioPipeline();
      } catch {
        try {
          await stopSpeaking();
        } catch {
          /* ignore */
        }
      }
    }
  }, [setIsGenerating]);

  /**
   * Nur abbrechen → Idle (kein neues „Nachdenken“).
   * Orb-Doppel-Tipp / Mic-Tipp während busy.
   */
  const cancelFindusBusy = useCallback(async () => {
    interruptCommittedRef.current = true;
    provisionalPausedRef.current = false;
    questionEpochRef.current += 1;
    setIsGenerating(false);
    setIsFinalizing(false);
    setIsListening(false);
    try {
      const { abortActiveModule2Turn } = await import(
        '../module2/pipeline/turnAbort'
      );
      abortActiveModule2Turn('user_cancel_busy');
    } catch {
      /* soft */
    }
    // Laufende Modul-5-Auswahl darf nicht weiterquatschen
    try {
      const { usePlanSessionStore } = await import(
        '../module2/planning/planSessionState'
      );
      usePlanSessionStore.getState().reset();
    } catch {
      /* soft */
    }
    try {
      const { usePlanCalendarUiStore } = await import(
        '../module2/timeline/planCalendarUiStore'
      );
      usePlanCalendarUiStore.getState().clearPendingChoice();
      usePlanCalendarUiStore.getState().setMirroredActions([]);
    } catch {
      /* soft */
    }
    try {
      const { useLivePitchStore } = await import(
        '../module2/pitch/publishPitchUi'
      );
      useLivePitchStore.getState().clear();
    } catch {
      /* soft */
    }
    try {
      const { discardPausedSpeaking } = await import(
        '../services/AudioVoiceService'
      );
      await discardPausedSpeaking();
    } catch {
      /* soft */
    }
    try {
      const { interruptNarrationForForce } = await import(
        '../runtime/narrationPipeline'
      );
      await interruptNarrationForForce();
    } catch {
      /* soft */
    }
    try {
      const { forceClearSpeakingUi } = await import(
        '../services/AudioVoiceService'
      );
      forceClearSpeakingUi();
    } catch {
      useFinnusStore.getState().setIsPlayingAudio(false);
    }
    try {
      await bargeInFlush();
    } catch {
      try {
        await interruptAudioPipeline();
      } catch {
        try {
          await stopSpeaking();
        } catch {
          /* ignore */
        }
      }
    }
    try {
      const { onUserInputEnd } = await import('../runtime/orchestrator');
      onUserInputEnd();
    } catch {
      /* soft */
    }
  }, [setIsGenerating, setIsFinalizing, setIsListening]);

  /** Unter 2 s Loslassen: STT weg, Findus weiter — als nie passiert. */
  const abortProvisionalMic = useCallback(async () => {
    clearCommitTimer();
    pressModeRef.current = 'idle';
    setIsMicLocked(false);
    try {
      if (isCurrentlyListening() || isListening) {
        await stopListening({ tailMs: 0, finalizeMs: 0 });
      }
    } catch {
      /* soft */
    }
    setIsListening(false);
    setIsFinalizing(false);
    setIsGenerating(false);
    setPartialText('');
    partialTextRef.current = '';
    voiceStartedAtRef.current = 0;
    pressStartedAtRef.current = 0;

    const canResume =
      provisionalPausedRef.current && !interruptCommittedRef.current;
    provisionalPausedRef.current = false;
    interruptCommittedRef.current = false;

    if (canResume) {
      try {
        const { resumeSpeakingAfterNav } = await import(
          '../services/AudioVoiceService'
        );
        void resumeSpeakingAfterNav();
      } catch {
        /* soft */
      }
    }
  }, [clearCommitTimer, isListening, setIsGenerating, setIsListening]);

  const beginVoiceSession = useCallback(async () => {
    if (
      pressModeRef.current !== 'voice' &&
      pressModeRef.current !== 'locked'
    ) {
      return;
    }

    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      onNeedTextFallback?.('permission');
      return;
    }
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      showPermissionMissingAlert('audioConsent', { force: true });
      onNeedTextFallback?.('permission');
      return;
    }

    setPartialText('');
    partialTextRef.current = '';
    setIsListening(true);
    voiceStartedAtRef.current = Date.now();
    void markMicHoldUsed();
    void markFeatureTipCompleted('voice_mic');
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserUsedMicHold(),
    );

    // Soft-Mute parallel zu STT — Mikro wird schneller blau
    const muteP = softMuteFindusForMic();
    const result = await startListening((partial) => {
      partialTextRef.current = partial;
      setPartialText(partial);
      try {
        const { notePartialForManagerWarmup } = require('../module2/router/managerWarmup') as {
          notePartialForManagerWarmup: (t: string) => void;
        };
        notePartialForManagerWarmup(partial);
      } catch {
        /* soft */
      }
    }, { keepAlive: true });
    await muteP.catch(() => undefined);

    if (
      pressModeRef.current !== 'voice' &&
      pressModeRef.current !== 'locked'
    ) {
      try {
        await stopListening({ tailMs: 0, finalizeMs: 0 });
      } catch {
        /* soft */
      }
      setIsListening(false);
      setPartialText('');
      return;
    }

    if (!result.ok) {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      setIsListening(false);
      await abortProvisionalMic();
      onNeedTextFallback?.(result.reason);
    }
  }, [
    abortProvisionalMic,
    onNeedTextFallback,
    setIsListening,
    softMuteFindusForMic,
  ]);

  const speakPlain = useCallback(
    async (reply: string, epoch: number) => {
      if (!stillCurrent(epoch) || !reply.trim()) return;
      addChatMessage({ role: 'assistant', content: reply });
      const voiceSettings = await getVoiceSettingsForTour();
      if (!stillCurrent(epoch)) return;
      await speakAssistantText(reply, {
        voiceId: voiceSettings.voiceId,
        speechRate: voiceSettings.speechRate,
      });
    },
    [addChatMessage, stillCurrent],
  );

  const submitUserQuestion = useCallback(
    async (text: string) => {
      const epoch = ++questionEpochRef.current;
      try {
        const { noteTravelPrefsActiveUse } = await import(
          '../services/memory/travelPrefsReview'
        );
        noteTravelPrefsActiveUse();
      } catch {
        /* soft */
      }
      const corrected = (globalThis as { __findusCorrectedQ?: string })
        .__findusCorrectedQ;
      if (corrected) {
        (globalThis as { __findusCorrectedQ?: string }).__findusCorrectedQ =
          undefined;
        text = corrected;
      }

      // Korrektur → strukturierte Regel speichern + Frage für denselben Turn umschreiben
      // (vor Chat-Append, damit lastAssistant noch der vorherige Turn ist)
      const spokenUserText = text;
      try {
        const { runCorrectionLearningCapture } = await import(
          '../services/memory/correctionLearning'
        );
        const correction = await runCorrectionLearningCapture(spokenUserText);
        if (correction.isCorrection && correction.effectiveQuestion) {
          text = correction.effectiveQuestion;
        }
      } catch {
        /* soft */
      }

      // Just-Do-It vor Plan-Gates: Wecker/Timer/Erinnerung/Lautstärke/Nahschauen
      try {
        const { tryEarlyJustDoIt } = await import(
          '../services/concierge/earlyJustDoIt'
        );
        const early = await tryEarlyJustDoIt(text);
        if (early) {
          addChatMessage({ role: 'user', content: spokenUserText });
          setIsGenerating(true);
          try {
            if (!stillCurrent(epoch)) return;
            addChatMessage({
              role: 'assistant',
              content: early.speech,
            });
            await presentConciergeResponse(
              {
                speechText: early.speech,
                visualBullets: early.bullets.slice(0, 3),
                quickActions: early.quickActions.slice(0, 4),
                cardTitle: early.cardTitle,
              },
              { userText: text, skipAutoNav: true },
            );
            return;
          } finally {
            if (stillCurrent(epoch)) setIsGenerating(false);
          }
        }
      } catch (err) {
        console.warn('[voice] early just-do-it failed', err);
      }

      // Planungs-Gates zuerst — nur echte Wartezustände, nicht select_mode
      // (sonst wird „Hotel in Lübeck“ als Frühstücks-Änderung verschluckt)
      try {
        const { usePlanSessionStore } = await import(
          '../module2/planning/planSessionState'
        );
        const s = usePlanSessionStore.getState();
        if (
          s.waitingLocation ||
          s.waitingConfirm ||
          s.waitingConflict ||
          s.phase === 'clarify_location' ||
          s.phase === 'await_confirm' ||
          s.phase === 'await_conflict'
        ) {
          addChatMessage({ role: 'user', content: spokenUserText });
          const { runPlanningModule } = await import(
            '../module2/planning/runPlanningModule'
          );
          await runPlanningModule({ userText: text });
          return;
        }
      } catch {
        /* soft — Concierge-Pfad */
      }

      addChatMessage({ role: 'user', content: spokenUserText });
      void runPreferenceCaptureMiddleware(spokenUserText).catch(() => {});
      noteUserTextForSituation(text);
      void observeUserQuestionStyle(spokenUserText);

      // 3× gleiche Rückfrage-Kategorie → Crowd-Signal (proaktiv für alle)
      // + AutoLearn-Blueprint-Slots (Popcorn-Preis etc.)
      try {
        const {
          detectFollowUpSlots,
          detectFollowUpTopic,
          contributeFollowUpSignal,
        } = await import('../services/memory/collectiveLearning');
        const {
          inferIntentFamily,
          getRecentTurnPair,
        } = await import('../services/memory/correctionLearning');
        const slots = detectFollowUpSlots(spokenUserText);
        if (slots.length) {
          const { lastUser, lastAssistant } = getRecentTurnPair();
          const family = inferIntentFamily(
            spokenUserText,
            lastUser,
            lastAssistant,
          );
          const topic = detectFollowUpTopic(spokenUserText);
          for (const slot of slots) {
            void contributeFollowUpSignal({
              intentFamily: family,
              slot,
              topic,
              userText: spokenUserText,
            });
          }
        }
        const { recordLearnSignal, detectMissingSlotFromFollowUp } =
          await import('../module2/blueprints/autoLearn');
        const missing = detectMissingSlotFromFollowUp(spokenUserText);
        if (missing) {
          const { resolvePersonaVariant } = await import(
            '../module2/blueprints/personaVariants'
          );
          const { resolveBlueprintForText } = await import(
            '../module2/blueprints/aliases'
          );
          const persona = resolvePersonaVariant();
          const bp = resolveBlueprintForText({ userText: spokenUserText });
          const blueprintId = bp.blueprintId || 'cinema';
          const profile = getCachedUserProfile();
          const cityHint = profile?.cityId ?? profile?.cityName ?? null;
          void recordLearnSignal({
            blueprintId,
            personaVariant: persona.variant,
            userText: spokenUserText,
            cityHint: typeof cityHint === 'string' ? cityHint : null,
            missingSlot: missing,
          });
        }
      } catch {
        /* soft */
      }

      if (useFinnusStore.getState().currentPoiId != null) {
        void markFeatureTipCompleted('ask_followups');
      }

      // Neuer Turn mit echtem Text → alte Karte erst jetzt tauschen
      useFinnusStore.getState().setActiveConciergeCard(null);
      try {
        const { useLivePitchStore } = require('../module2/pitch/publishPitchUi') as {
          useLivePitchStore: { getState: () => { clear: () => void } };
        };
        useLivePitchStore.getState().clear();
      } catch {
        /* soft */
      }

      await onUserInputStart('user_text');
      const sideAsk = await captureSideChannelHints(text).catch(() => null);

      // Vorherigen Concierge-Turn hart stoppen (Barge-in / neue Frage)
      // Live-Chat-Cut hat schon geflusht — Ack nicht sofort killen
      let liveChatTurn = false;
      try {
        const { isLiveChatTurnActive } = require('../services/handsFree/liveChatTurnContext') as {
          isLiveChatTurnActive: () => boolean;
        };
        liveChatTurn = isLiveChatTurnActive();
      } catch {
        liveChatTurn = false;
      }
      try {
        const { abortActiveModule2Turn } = await import(
          '../module2/pipeline/turnAbort'
        );
        abortActiveModule2Turn('new_question');
        if (!liveChatTurn) {
          const { bargeInFlush } = await import('../module2/speech/speechQueue');
          await bargeInFlush();
        }
      } catch {
        /* soft */
      }

      // Menschliche Bridge sofort — nicht „ich check“
      // Live-Chat hat ggf. schon Instant-Ack → keine zweite Bridge.
      // Beside-/Side-Human: still, kein Turn.
      try {
        const { isLiveChatTurnActive } = require('../services/handsFree/liveChatTurnContext') as {
          isLiveChatTurnActive: () => boolean;
        };
        if (isLiveChatTurnActive()) {
          /* Live ack already covers bridge */
        } else {
          const { classifyLiveChatAddress } = require('../services/handsFree/liveChatAddress') as {
            classifyLiveChatAddress: (
              t: string,
              o?: { openFloor?: boolean },
            ) => { addressed: boolean; reason: string };
          };
          const addr = classifyLiveChatAddress(text, { openFloor: false });
          if (!addr.addressed) {
            if (__DEV__) {
              console.log('[voice] skip turn (side/beside):', addr.reason);
            }
            return;
          }
          const { speakContextualBridgeFireAndForget } = require('../services/speech/contextualBridge') as {
            speakContextualBridgeFireAndForget: (t: string) => void;
          };
          speakContextualBridgeFireAndForget(text);
        }
      } catch {
        try {
          const { speakLatencyFloskelFireAndForget } = require('../services/speech/floskelEngine') as {
            speakLatencyFloskelFireAndForget: (t: string) => void;
          };
          speakLatencyFloskelFireAndForget(text);
        } catch {
          /* soft */
        }
      }

  // Bridge: Sofort-Ack (Live) + Manager-Bridge — kein Legacy Mic-Bridge.

      const withSide = (reply: string) =>
        appendSideChannelAsk(reply, sideAsk ?? undefined);

      // Parkplatz speichern — Just-Do-It, kurze Bestätigung
      if (sideAsk?.parkingAck) {
        setIsGenerating(true);
        try {
          if (!stillCurrent(epoch)) return;
          await speakPlain(sideAsk.parkingAck, epoch);
        } finally {
          if (stillCurrent(epoch)) setIsGenerating(false);
        }
        return;
      }

      try {
        if (!stillCurrent(epoch)) return;

        const state = useFinnusStore.getState();

        // Nav-Stop: still räumen (kein Early-Return) — Manager hört Compound
        // („stopp und bring mich zum Tennisclub“) und startet ggf. neu.
        if (isStopNavigationIntent(text) || state.navActive) {
          const { isNavCorrectionIntent, extractCorrectedQuestion } =
            await import('../services/intent/poiInfoVsNav');
          const stopOrCorrect =
            isStopNavigationIntent(text) ||
            (state.navActive &&
              (isNavCorrectionIntent(text) ||
                /^(nein|nö|noe|doch\s+nicht|falsch)\b/iu.test(text.trim())));
          if (stopOrCorrect) {
            try {
              const { clearNavigationHard } = await import(
                '../services/navigation'
              );
              await clearNavigationHard({ silent: true });
              await stopNavigation({ silent: true, reason: 'manual' }).catch(
                () => undefined,
              );
              useFinnusStore.getState().patchNavigation({
                navActive: false,
                navVisible: false,
                navMode: null,
                navTargetName: null,
              });
              useFinnusStore.getState().setPendingNavOffer(null);
              useFinnusStore.getState().setPendingNavAlternatives([]);
            } catch {
              /* soft */
            }
            if (isNavCorrectionIntent(text)) {
              text = extractCorrectedQuestion(text) || text;
            } else if (isStopNavigationIntent(text)) {
              // Reiner Stopp — fertig, kein Concierge-Nachlauf
              try {
                await speakPlain('Navigation beendet.', epoch);
              } catch {
                /* soft */
              }
              return;
            }
            // Kein return — Manager entscheidet Speech + ggf. neue Route
          }
        }

        // Street View auf Wunsch (nach Look-Ahead-Angebot)
        try {
          const {
            isStreetViewVoiceAsk,
            fulfillStreetViewVoiceAsk,
          } = await import('../services/navigation/lookAheadBuffer');
          if (isStreetViewVoiceAsk(text)) {
            const r = await fulfillStreetViewVoiceAsk();
            if (r.ok) {
              try {
                await speakPlain(
                  r.message?.trim() || 'Street View ist offen.',
                  epoch,
                );
              } catch {
                /* soft */
              }
              return;
            }
            try {
              await speakPlain(
                r.message ||
                  'Street View finde ich gerade nicht — nutz den Button auf der Karte, wenn er da ist.',
                epoch,
              );
            } catch {
              /* soft */
            }
            return;
          }
        } catch {
          /* soft */
        }

        // Pending hotel Yes/No / name has priority (Dialog-Zustand)
        {
          const s = useUserMemoryStore.getState();
          const prioritizeMemory =
            s.pendingHotelConfirmId != null || s.awaitingHotelName;
          if (prioritizeMemory) {
            const intent = await handleMemoryIntent(text);
            if (!stillCurrent(epoch)) return;
            if (intent.handled && (intent.reply || intent.concierge)) {
              setIsGenerating(true);
              try {
                if (intent.concierge) {
                  addChatMessage({
                    role: 'assistant',
                    content: intent.concierge.speechText,
                  });
                  if (!stillCurrent(epoch)) return;
                  await presentConciergeResponse({
                    ...intent.concierge,
                    speechText: withSide(intent.concierge.speechText),
                  }, { userText: text });
                } else if (intent.reply) {
                  await speakPlain(withSide(intent.reply), epoch);
                }
              } finally {
                if (stillCurrent(epoch)) setIsGenerating(false);
              }
              return;
            }
          }
        }

        if (
          shouldStartNavFromOffer(
            text,
            state.pendingNavOffer,
            state.pendingNavAlternatives,
          )
        ) {
          const offer = resolveNavOfferFromReply(
            text,
            state.pendingNavOffer,
            state.pendingNavAlternatives,
          )!;
          setIsGenerating(true);
          try {
            const { startNavigationFromOffer } = await import(
              '../services/navigation/resolveNavTarget'
            );
            let reply =
              'Dazu krieg ich gerade keine Route hin — versuch es gleich nochmal.';
            if (
              typeof offer.lat === 'number' &&
              typeof offer.lng === 'number' &&
              Number.isFinite(offer.lat) &&
              Number.isFinite(offer.lng)
            ) {
              const started = await startNavigationFromOffer(offer);
              if (started.ok) {
                reply =
                  started.message?.trim() ||
                  `Okay, ich führ dich zu ${offer.name}. Du musst nicht aufs Handy schauen — ich sag dir an Häusern und Abzweigungen, wo's langgeht.`;
              } else if (started.message?.trim()) {
                reply = started.message.trim();
              }
            } else {
              const ok = await startNavigation(offer.poiId);
              if (ok) {
                reply = `Okay, ich führ dich zu ${offer.name}. Du musst nicht aufs Handy schauen — ich sag dir an Häusern und Abzweigungen, wo's langgeht.`;
              }
            }
            if (!stillCurrent(epoch)) return;
            useFinnusStore.getState().setActiveConciergeCard(null);
            await speakPlain(withSide(reply), epoch);
          } finally {
            if (stillCurrent(epoch)) setIsGenerating(false);
          }
          return;
        }

        // Affiliate Voice-Follow-up
        {
          const aff = state.pendingAffiliateOffer;
          const hasNav =
            state.pendingNavOffer != null ||
            (state.pendingNavAlternatives?.length ?? 0) > 0;
          if (shouldAcceptPendingAffiliateOffer(text, aff, hasNav)) {
            setIsGenerating(true);
            try {
              useFinnusStore.getState().setPendingAffiliateOffer(null);
              const result = await handleQuickAction(aff!);
              if (!stillCurrent(epoch)) return;
              const reply = result.ok
                ? result.message ||
                  'Alles klar — ich öffne dir die Buchungsoption.'
                : result.message ||
                  'Das lässt sich gerade nicht öffnen — tipp einfach auf den Button.';
              if (!result.ok) alertActionError(reply);
              await speakPlain(withSide(reply), epoch);
            } finally {
              if (stillCurrent(epoch)) setIsGenerating(false);
            }
            return;
          }
        }

        // Strict flight follow-up only while awaiting details (pure code e.g. LH400)
        {
          const mem = useUserMemoryStore.getState();
          if (mem.awaitingFlightDetails) {
            const code = extractFlightCode(text, { requireContext: false });
            const pure =
              /^[A-Za-z]{1,3}\s?\d{1,4}[A-Za-z]?$/i.test(text.trim()) && code;
            if (pure) {
              setIsGenerating(true);
              try {
                const flight = await prepareFlightFollowUp(text, {
                  flightNumber: code,
                });
                if (!stillCurrent(epoch)) return;
                mem.setAwaitingFlightDetails(false);
                if (flight) {
                  if (flight.plan) rememberFlightPlanForAlarm(flight.plan);
                  let reply = flight.reply;
                  let concierge = wrapPlainAsConcierge(reply, {
                    cardTitle: `Flug ${code}`,
                    visualBullets: flight.plan
                      ? [
                          flight.plan.flight.ident,
                          flight.plan.speechPreFlight.slice(0, 80),
                        ]
                      : [],
                    quickActions: [],
                  });
                  if (flight.plan && flight.offerReminder) {
                    const wake = await wakeOfferForFlightPlan(flight.plan);
                    if (wake?.speech) {
                      reply = `${reply} ${wake.speech}`;
                      concierge = {
                        ...concierge,
                        speechText: reply,
                        visualBullets: [
                          ...concierge.visualBullets,
                          ...(wake.bullets ?? []),
                        ].slice(0, 3),
                        quickActions: [
                          ...concierge.quickActions,
                          ...(wake.quickActions ?? []),
                        ].slice(0, 4),
                      };
                    }
                  }
                  addChatMessage({ role: 'assistant', content: reply });
                  if (!stillCurrent(epoch)) return;
                  await presentConciergeResponse({
                    ...concierge,
                    speechText: withSide(reply),
                  }, { userText: text });
                  return;
                }
              } finally {
                if (stillCurrent(epoch)) setIsGenerating(false);
              }
            }
          }
        }

        // Content-Vorschalter zu — alles zum Manager (auch Timeline)
        // Plan-Kalender = FLAG im Manager, kein eigener Vorschalter.

        if (!stillCurrent(epoch)) return;

        // Say–Do: Wecker/Timer/Erinnerung/Lautstärke/Nahschauen ZUERST echt
        {
          try {
            const { tryEarlyJustDoIt } = await import(
              '../services/concierge/earlyJustDoIt'
            );
            const early = await tryEarlyJustDoIt(text);
            if (early) {
              setIsGenerating(true);
              try {
                if (!stillCurrent(epoch)) return;
                addChatMessage({
                  role: 'assistant',
                  content: early.speech,
                });
                await presentConciergeResponse(
                  {
                    speechText: withSide(early.speech),
                    visualBullets: early.bullets.slice(0, 3),
                    quickActions: early.quickActions.slice(0, 4),
                    cardTitle: early.cardTitle,
                  },
                  { userText: text, skipAutoNav: true },
                );
                return;
              } finally {
                if (stillCurrent(epoch)) setIsGenerating(false);
              }
            }
          } catch (err) {
            console.warn('[voice] just-do-it failed', err);
          }
        }

        if (!stillCurrent(epoch)) return;

        {
          const memStore = useUserMemoryStore.getState();
          const pendingMemory =
            Boolean(memStore.pendingHotelConfirmId) ||
            Boolean(memStore.awaitingHotelName);
          if (pendingMemory) {
            const intent = await handleMemoryIntent(text);
            if (!stillCurrent(epoch)) return;
            if (intent.handled && (intent.reply || intent.concierge)) {
              setIsGenerating(true);
              try {
                if (intent.concierge) {
                  addChatMessage({
                    role: 'assistant',
                    content: intent.concierge.speechText,
                  });
                  if (!stillCurrent(epoch)) return;
                  await presentConciergeResponse(
                    {
                      ...intent.concierge,
                      speechText: withSide(intent.concierge.speechText),
                    },
                    { userText: text },
                  );
                } else if (intent.reply) {
                  if (intent.startedNav) {
                    useFinnusStore.getState().patchNavigation({
                      navActive: true,
                      navVisible: true,
                    });
                    await speakPlain(withSide(intent.reply), epoch);
                  } else {
                    await presentConciergeResponse(
                      wrapPlainAsConcierge(withSide(intent.reply), {
                        cardTitle: 'Findus',
                        visualBullets: [],
                        quickActions: [],
                      }),
                      { userText: text },
                    );
                  }
                }
              } finally {
                if (stillCurrent(epoch)) setIsGenerating(false);
              }
              return;
            }
          }
        }

        if (!stillCurrent(epoch)) return;
        // Modul 2 — Chef entscheidet (Bahn/Nav/Kino/Timeline/…)
        setIsGenerating(true);
        try {
          const turnId = `m2_${epoch}_${Date.now()}`;
          const { beginModule2TurnAbort } = await import(
            '../module2/pipeline/turnAbort'
          );
          const signal = beginModule2TurnAbort();
          const result = await runModule2Pipeline({
            userText: text,
            turnId,
            signal,
          });
          if (!stillCurrent(epoch)) {
            const { abortActiveModule2Turn } = await import(
              '../module2/pipeline/turnAbort'
            );
            abortActiveModule2Turn('stale_epoch');
            return;
          }
          if (result.logic.spokenDraft) {
            void withSide(result.logic.spokenDraft);
          }
        } catch (err) {
          console.warn('[module2] pipeline failed', err);
          const fallback =
            'Da ist kurz etwas schiefgelaufen. Versuch es noch einmal — ich bleibe dran.';
          addChatMessage({ role: 'assistant', content: fallback });
          await speakPlain(withSide(fallback), epoch);
        } finally {
          if (stillCurrent(epoch)) setIsGenerating(false);
        }
      } finally {
        onUserInputEnd();
      }
    },
    [addChatMessage, setIsGenerating, speakPlain, stillCurrent],
  );

  const submitUserQuestionRef = useRef(submitUserQuestion);
  submitUserQuestionRef.current = submitUserQuestion;

  const finalizeVoiceCapture = useCallback(() => {
    const mode = pressModeRef.current;
    if (mode !== 'voice' && mode !== 'locked') {
      if (!isCurrentlyListening() && !isListening) {
        pressModeRef.current = 'idle';
        setIsMicLocked(false);
        return;
      }
    }

    let calendarOpen = false;
    try {
      const {
        usePlanCalendarUiStore,
      } = require('../module2/timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: {
          getState: () => { calendarVisible: boolean };
        };
      };
      calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
    } catch {
      calendarOpen = false;
    }

    pressModeRef.current = 'idle';
    setIsMicLocked(false);
    setIsListening(false);
    setIsFinalizing(true);

    try {
      const { latencyStartTurn } = require('../services/debug/latencyTiming') as {
        latencyStartTurn: (meta?: string) => string | null;
      };
      latencyStartTurn('mic_off');
    } catch {
      /* soft */
    }

    void (async () => {
      try {
        if (!interruptCommittedRef.current) {
          await interruptFindusForMic();
        }

        const peekedBeforeStop = peekListeningTranscript();
        const fromPartial = partialTextRef.current.trim();
        const transcript = await stopListening({
          tailMs: STT_TAIL_MS,
          finalizeMs: STT_FINALIZE_MS,
        });
        const text = (
          transcript.trim() ||
          fromPartial ||
          peekedBeforeStop
        ).trim();
        recordUserSpeechExact(text || transcript, Date.now());
        if (!text) {
          try {
            const { latencyAbortTurn } = require('../services/debug/latencyTiming') as {
              latencyAbortTurn: () => void;
            };
            latencyAbortTurn();
          } catch {
            /* soft */
          }
          setIsGenerating(false);
          if (calendarOpen) {
            try {
              const { enqueueSpeech } = require('../module2/speech/speechQueue') as {
                enqueueSpeech: (o: {
                  kind: string;
                  text: string;
                  turnId: string;
                }) => void;
              };
              enqueueSpeech({
                kind: 'main',
                text: 'Hab dich nicht verstanden — nochmal kurz halten und sprechen.',
                turnId: `mic_empty_${Date.now()}`,
              });
            } catch {
              /* soft */
            }
          }
          return;
        }
        console.log(
          `[voice] submit (${calendarOpen ? 'timeline' : 'main'}):`,
          text.slice(0, 120),
        );
        await submitUserQuestion(text);
      } finally {
        setIsFinalizing(false);
        setIsListening(false);
        setIsMicLocked(false);
        setPartialText('');
        partialTextRef.current = '';
        voiceStartedAtRef.current = 0;
        pressStartedAtRef.current = 0;
        provisionalPausedRef.current = false;
        interruptCommittedRef.current = false;
      }
    })();
  }, [
    interruptFindusForMic,
    isListening,
    setIsGenerating,
    setIsListening,
    submitUserQuestion,
  ]);

  const onPressIn = useCallback(() => {
    try {
      const live = require('../services/handsFree/liveChatSession') as {
        isLiveChatActive: () => boolean;
        stopLiveChatSession: (r?: string) => Promise<void>;
      };
      if (live.isLiveChatActive()) {
        skipNextPressOutRef.current = true;
        void live.stopLiveChatSession('mic_tap');
        setIsMicLocked(false);
        setIsListening(false);
        return;
      }
    } catch {
      /* soft */
    }
    // Fixiert: Tippen = Aufnahme beenden & senden
    if (pressModeRef.current === 'locked') {
      skipNextPressOutRef.current = true;
      finalizeVoiceCapture();
      return;
    }
    if (pressModeRef.current !== 'idle') return;

    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') {
      onShortPress?.();
      return;
    }

    // Busy: Tippen = Soft-Stop UND Tippfeld (nicht nur abbrechen)
    const finnus = useFinnusStore.getState();
    if (
      finnus.isGenerating ||
      finnus.isPlayingAudio ||
      isFinalizing
    ) {
      skipNextPressOutRef.current = true;
      void cancelFindusBusy();
      onShortPress?.();
      return;
    }

    // Warmup schon beim Tippen (TTS/Aussprache) — auch bei Kurz-Tipp ok
    try {
      const { warmupAiOnMicPress } = require('../services/speech/micWarmup') as {
        warmupAiOnMicPress: () => void;
      };
      warmupAiOnMicPress();
    } catch {
      /* soft */
    }

    provisionalPausedRef.current = false;
    interruptCommittedRef.current = false;
    pressStartedAtRef.current = Date.now();
    // Kurz-Tipp = Text; Voice erst nach TAP-Schwelle (sonst startet STT bei jedem Tippen)
    pressModeRef.current = 'pending';
    setIsMicLocked(false);
    setPartialText('');

    clearHoldTimer();
    clearCommitTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (pressModeRef.current !== 'pending') return;
      pressModeRef.current = 'voice';
      void beginVoiceSession();
    }, TAP_MAX_MS + 40);
    // Nach 2 s Hold: Interrupt fest committen (Denken/Pipeline ok)
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      if (
        pressModeRef.current !== 'voice' &&
        pressModeRef.current !== 'locked'
      ) {
        return;
      }
      void interruptFindusForMic();
    }, MIN_VOICE_MS);
  }, [
    beginVoiceSession,
    cancelFindusBusy,
    clearCommitTimer,
    clearHoldTimer,
    finalizeVoiceCapture,
    interruptFindusForMic,
    isFinalizing,
    onShortPress,
  ]);

  /** Nach rechts wischen während Hold → Hände frei, Mikro bleibt an. */
  const onSwipeLock = useCallback(() => {
    const mode = pressModeRef.current;
    if (mode !== 'voice' && mode !== 'pending') return;
    // Falls noch pending (Legacy): sofort Voice starten
    if (mode === 'pending') {
      clearHoldTimer();
      pressModeRef.current = 'voice';
      void beginVoiceSession();
    }
    pressModeRef.current = 'locked';
    setIsMicLocked(true);
    clearCommitTimer();
    void markMicLockUsed();
    void interruptFindusForMic();
  }, [
    beginVoiceSession,
    clearCommitTimer,
    clearHoldTimer,
    interruptFindusForMic,
  ]);

  /** Nach links wischen → Live-Chat (Mikro bleibt an, Gesprächsfenster). */
  const onSwipeLiveChat = useCallback(() => {
    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') return;

    skipNextPressOutRef.current = true;
    clearHoldTimer();
    clearCommitTimer();
    pressModeRef.current = 'idle';
    setIsMicLocked(false);
    setIsListening(false);
    setPartialText('');

    void (async () => {
      try {
        await stopListening({ tailMs: 0, finalizeMs: 200 });
      } catch {
        /* soft */
      }
      try {
        const { startLiveChatSession } = await import(
          '../services/handsFree/liveChatSession'
        );
        const r = await startLiveChatSession('swipe_left');
        if (!r.ok && __DEV__) {
          console.warn('[liveChat] swipe start failed:', r.message);
        }
      } catch (err) {
        console.warn('[liveChat] swipe start error:', err);
      }
    })();
  }, [clearCommitTimer, clearHoldTimer]);

  /**
   * Hands-free: Notification / Deep-Link / Assistent → Mikro locked starten + Cue.
   */
  const startHandsFreeListen = useCallback(() => {
    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') return;

    try {
      const {
        isLiveChatActive,
      } = require('../services/handsFree/liveChatSession') as {
        isLiveChatActive: () => boolean;
      };
      if (isLiveChatActive()) return;
    } catch {
      /* soft */
    }

    // Schon am Sprechen / fixiert → nichts doppelt starten
    if (
      pressModeRef.current === 'voice' ||
      pressModeRef.current === 'locked' ||
      pressModeRef.current === 'pending'
    ) {
      if (pressModeRef.current === 'voice') {
        pressModeRef.current = 'locked';
        setIsMicLocked(true);
      }
      return;
    }

    void (async () => {
      // Cue nicht blockieren — Mikro sofort
      void import('../services/handsFree/micStartCue')
        .then((m) => m.playMicStartCue())
        .catch(() => undefined);
      try {
        const { warmupAiOnMicPress } = require('../services/speech/micWarmup') as {
          warmupAiOnMicPress: () => void;
        };
        warmupAiOnMicPress();
      } catch {
        /* soft */
      }

      provisionalPausedRef.current = false;
      interruptCommittedRef.current = false;
      pressStartedAtRef.current = Date.now();
      clearHoldTimer();
      clearCommitTimer();
      // locked: wie Swipe-Lock — Finger/PressOut beendet die Aufnahme nicht
      pressModeRef.current = 'locked';
      setIsMicLocked(true);
      setPartialText('');
      void beginVoiceSession();
      void markMicLockUsed();
      void interruptFindusForMic();
    })();
  }, [
    beginVoiceSession,
    clearCommitTimer,
    clearHoldTimer,
    interruptFindusForMic,
  ]);

  useEffect(() => {
    let unsubBus: (() => void) | undefined;
    void import('../services/handsFree/handsFreeBus').then((m) => {
      m.registerHandsFreeListenHandler(() => {
        void (async () => {
          try {
            const live = await import('../services/handsFree/liveChatSession');
            const entered = await live.maybeStartLiveChatFromHandsFree();
            if (entered) return;
          } catch {
            /* soft */
          }
          startHandsFreeListen();
        })();
      });
      m.registerTypedAskHandler((text) => {
        void submitUserQuestion(text);
      });
      unsubBus = () => {
        m.registerHandsFreeListenHandler(null);
        m.registerTypedAskHandler(null);
      };
    });
    if (__DEV__) {
      void import('../services/handsFree/devAskPoller').then((m) => {
        m.startDevAskPoller();
      });
    }
    return () => {
      unsubBus?.();
      if (__DEV__) {
        void import('../services/handsFree/devAskPoller').then((m) => {
          m.stopDevAskPoller();
        });
      }
    };
  }, [startHandsFreeListen, submitUserQuestion]);

  // Live-Chat: Submit-Handler einmalig — Ref verhindert Race (null nach Re-Render)
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    void import('../services/handsFree/liveChatSession').then((live) => {
      if (cancelled) return;
      live.registerLiveChatHandlers({
        submitUserQuestion: (text) => submitUserQuestionRef.current(text),
        onPhaseChange: (phase) => {
          if (phase === 'idle') {
            setIsMicLocked(false);
            setIsListening(false);
            return;
          }
          setIsMicLocked(true);
          setIsListening(phase === 'listening' || phase === 'processing');
        },
        onWakeOnly: () => {
          try {
            const { playLiveChatStartCue } = require('../services/handsFree/micStartCue') as {
              playLiveChatStartCue: () => Promise<void>;
            };
            void playLiveChatStartCue();
          } catch {
            /* soft */
          }
        },
      });
      unsub = live.subscribeLiveChat((on, phase) => {
        if (!on || phase === 'idle') {
          setIsMicLocked(false);
          return;
        }
        setIsMicLocked(true);
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
      try {
        const live = require('../services/handsFree/liveChatSession') as {
          registerLiveChatHandlers: (h: null) => void;
        };
        live.registerLiveChatHandlers(null);
      } catch {
        /* soft */
      }
    };
  }, [setIsListening]);

  const onPressOut = useCallback(() => {
    if (skipNextPressOutRef.current) {
      skipNextPressOutRef.current = false;
      return;
    }
    const mode = pressModeRef.current;
    const totalHeldMs = Date.now() - (pressStartedAtRef.current || Date.now());
    clearHoldTimer();
    clearCommitTimer();

    // Fixiert: Finger loslassen ändert nichts — Mikro läuft weiter
    if (mode === 'locked') {
      return;
    }

    let calendarOpen = false;
    try {
      const {
        usePlanCalendarUiStore,
      } = require('../module2/timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: {
          getState: () => { calendarVisible: boolean };
        };
      };
      calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
    } catch {
      calendarOpen = false;
    }

    const store = useFinnusStore.getState();
    const findusBusy =
      store.isAudiblySpeaking || store.isPlayingAudio || store.isGenerating;

    // Ganz kurzer Tipp → Mikro sofort abbrechen, Tippfeld öffnen
    if (totalHeldMs < TAP_MAX_MS) {
      pressModeRef.current = 'idle';
      pressStartedAtRef.current = 0;
      setIsListening(false);
      setPartialText('');
      partialTextRef.current = '';
      void (async () => {
        try {
          await stopListening({ tailMs: 0, finalizeMs: 0 });
        } catch {
          /* soft */
        }
        await abortProvisionalMic();
      })();
      void markMicTapUsed();
      onShortPress?.();
      return;
    }

    // Unter 2 s: Abbruch wenn Findus spricht — außer Timeline / Findus still
    if (totalHeldMs < MIN_VOICE_MS) {
      if (mode === 'pending') {
        pressModeRef.current = 'idle';
        pressStartedAtRef.current = 0;
        void markMicTapUsed();
        onShortPress?.();
        return;
      }
      const voiceReady =
        mode === 'voice' || isCurrentlyListening() || isListening;
      const allowEarlySubmit = voiceReady && (calendarOpen || !findusBusy);
      if (!allowEarlySubmit) {
        void abortProvisionalMic();
        return;
      }
      // fall through → STT finalisieren & senden
    }

    if (mode === 'pending') {
      pressModeRef.current = 'idle';
      void markMicTapUsed();
      onShortPress?.();
      return;
    }

    if (mode !== 'voice' && !isCurrentlyListening() && !isListening) {
      pressModeRef.current = 'idle';
      return;
    }

    finalizeVoiceCapture();
  }, [
    abortProvisionalMic,
    clearCommitTimer,
    clearHoldTimer,
    finalizeVoiceCapture,
    isListening,
    onShortPress,
  ]);

  return {
    onPressIn,
    onPressOut,
    onSwipeLock,
    onSwipeLiveChat,
    startHandsFreeListen,
    partialText,
    /** Nur echte Aufnahme — Finalizing ist Blau (thinking), nicht Rot. */
    isListening,
    isMicLocked,
    isFinalizing,
    isGenerating,
    submitUserQuestion,
    /** Doppel-Tipp Orb / Mic-Tipp: Denken + Sprache hart stoppen → Idle. */
    cancelFindusBusy,
  };
}
