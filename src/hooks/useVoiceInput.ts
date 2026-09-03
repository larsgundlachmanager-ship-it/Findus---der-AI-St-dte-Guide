import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from '../services/userProfileService';
import { showAudioConsentMissingAlert } from '../utils/permissionAlerts';
import {
  speakAssistantText,
  stopSpeaking,
  getVoiceSettingsForTour,
} from '../services/ttsService';
import {
  destroyStt,
  isCurrentlyListening,
  isSttAwaitingRestart,
  isSttRecognitionLive,
  peekListeningTranscript,
  startListening,
  stopListening,
} from '../services/sttService';
import {
  isStopNavigationIntent,
  stopNavigation,
} from '../services/navigation';
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
import { recordUserSpeechExact } from '../services/feedback/executionTracking';
import { runPreferenceCaptureMiddleware } from '../services/memory/preferenceCaptureMiddleware';
import { noteUserTextForSituation } from '../services/persona/situationGate';

/** Kurz tippen (< Tap) → Tippfeld; darüber → Sprache. */
const TAP_MAX_MS = 220;
/** Kurz nach Loslassen weiterhören — Ziel ~100–150ms. */
const STT_TAIL_MS = 120;
/** Hold ≥ 2 s → Frage gilt; darunter während Yorro spricht = Abbruch (Resume). */
const MIN_VOICE_MS = 2_000;
const STT_FINALIZE_MS = 450;
/** Nach Live-Chat-Stop kein Tippfeld (Nachschlag oft Beenden-Tipp). */
const SUPPRESS_SHORT_PRESS_AFTER_LIVE_STOP_MS = 700;

export type VoiceFallbackReason = 'unavailable' | 'permission' | 'error';

type PressMode = 'idle' | 'pending' | 'voice' | 'locked';

/**
 * Kurz tippen (< TAP_MAX_MS) → Tippfeld (wenn onShortPress); Yorro redet weiter.
 * Press ≥ Tap → Mikro sofort an; Loslassen finalisiert (außer Fixierung).
 * Nach rechts wischen während Hold → Mikro fixieren (Hände frei).
 * Tippen bei Fixierung → senden.
 * Loslassen < 2 s während Yorro spricht → Abbruch (Resume), außer Timeline.
 * Timeline / Yorro still: nach Aufnahme-Start auch bei kürzerem Hold senden.
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
  const suppressShortPressUntilRef = useRef(0);

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
  const cancelFindusBusy = useCallback(async (opts?: { keepMic?: boolean }) => {
    interruptCommittedRef.current = true;
    provisionalPausedRef.current = false;
    questionEpochRef.current += 1;
    setIsGenerating(false);
    setIsFinalizing(false);
    if (!opts?.keepMic) {
      setIsListening(false);
    }
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

  /** Unter 2 s Loslassen: STT weg, Yorro weiter — als nie passiert. */
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
      setIsListening(false);
      try {
        const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
          noteMicActive: (active: boolean) => void;
        };
        noteMicActive(false);
      } catch {
        /* soft */
      }
      onNeedTextFallback?.('permission');
      return;
    }
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      setIsListening(false);
      try {
        const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
          noteMicActive: (active: boolean) => void;
        };
        noteMicActive(false);
      } catch {
        /* soft */
      }
      skipNextPressOutRef.current = true;
      // Ein Popup mit CTA → Settings (kein paralleles QuestionModal)
      showAudioConsentMissingAlert({
        force: true,
        onTypeAsk: () => {
          onShortPress?.();
        },
      });
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

    // Soft-Mute parallel zu STT — Button sofort rot (Listening), nicht blau.
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
      // Hold -> Live-Chat: STT bewusst weiterlaufen lassen.
      try {
        const { isLiveChatActive } = require('../services/handsFree/liveChatSession') as {
          isLiveChatActive: () => boolean;
        };
        if (isLiveChatActive()) return;
      } catch {
        /* soft */
      }
      try {
        await stopListening({ tailMs: 0, finalizeMs: 0 });
      } catch {
        /* soft */
      }
      setIsListening(false);
      setPartialText('');
      try {
        const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
          noteMicActive: (active: boolean) => void;
        };
        noteMicActive(false);
      } catch {
        /* soft */
      }
      return;
    }

    if (!result.ok) {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      setIsListening(false);
      try {
        const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
          noteMicActive: (active: boolean) => void;
        };
        noteMicActive(false);
      } catch {
        /* soft */
      }
      await abortProvisionalMic();
      // permission/unavailable: Alert kommt aus sttService — kein zweites Tippfeld
      if (result.reason === 'error') {
        onNeedTextFallback?.(result.reason);
      }
    }
  }, [
    abortProvisionalMic,
    onNeedTextFallback,
    onShortPress,
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

      // Offene Plan-/Hotel-/Nav-Dialoge = Flags für Call-1, kein Early-Return.

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

      // Stichpunkte / Pitch stehen lassen — neue Antwort ersetzt sie erst beim Present.
      // (Früher Clear beim Mic-Start → UI flackerte leer während Denken.)

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

      // Explizites Tippen / PTT = an Yorro. Side-Chat gilt nur für Always-on.
      // Keine Mic-Bridge: der Manager schreibt Beat 1 nach dem Masterplan.
      try {
        const { clearBesideConversation } = require('../services/handsFree/besideConversationMode') as {
          clearBesideConversation: (r?: string) => void;
        };
        clearBesideConversation('explicit_submit');
      } catch {
        /* soft */
      }

      const withSide = (reply: string) =>
        appendSideChannelAsk(reply, sideAsk ?? undefined);

      // Parkplatz/Hotel-Side-Channel speichert still — Call-1 spricht den ganzen Satz
      // (Ack hängt ggf. an der Haupt-Speech, kein Abbruch).

      try {
        if (!stillCurrent(epoch)) return;

        const state = useFinnusStore.getState();

        // Nav-Stop: still räumen — Manager hört Compound
        // („stopp und bring mich zum Tennisclub“) und startet ggf. neu.
        if (isStopNavigationIntent(text) || state.navActive) {
          const { isNavCorrectionIntent, extractCorrectedQuestion } =
            await import('../services/intent/poiInfoVsNav');
          const { resolveNavDestCorrection } = await import(
            '../services/navigation/navDestCityCorrection'
          );
          const { peekLastStreetNavQuery } = await import(
            '../services/navigation/streetAddressQuery'
          );
          const destCorr = resolveNavDestCorrection({
            userText: text,
            currentDestName: state.navTargetName,
            lastStreetQuery: peekLastStreetNavQuery(),
          });
          const stopOrCorrect =
            !destCorr &&
            (isStopNavigationIntent(text) ||
              (state.navActive &&
                (isNavCorrectionIntent(text) ||
                  /^(nein|nö|noe|doch\s+nicht|falsch)\b/iu.test(text.trim()))));
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
            } else {
              const { isPureStopNavigationIntent, stripStopNavigationForContinue } =
                await import('../services/navigation/hardNavOverride');
              if (isPureStopNavigationIntent(text)) {
                // Reiner Stopp: Module2 darf NICHT nochmal eine Route starten
                // (Call-1/Sticky/In-flight → Sporthalle-Bug).
                const stopReply = 'Alles klar — Navigation ist aus.';
                try {
                  await speakPlain(stopReply, epoch);
                } catch {
                  /* soft */
                }
                try {
                  void withSide(stopReply);
                } catch {
                  /* soft */
                }
                return;
              }
              const cont = stripStopNavigationForContinue(text);
              if (cont) text = cont;
            }
            // Compound: Rest geht an Module2 („… und bring mich zum …“)
          }
        }

        // Street View, Hotel-Ja, Nav-Offer, Affiliate, Flugcode: Call-1 + Flags.

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
      const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
        noteMicActive: (active: boolean) => void;
      };
      noteMicActive(false);
    } catch {
      /* soft */
    }

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
        suppressShortPressUntilRef.current =
          Date.now() + SUPPRESS_SHORT_PRESS_AFTER_LIVE_STOP_MS;
        void live.stopLiveChatSession('mic_tap');
        setIsMicLocked(false);
        setIsListening(false);
        pressModeRef.current = 'idle';
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

    // Listening zuerst — Busy-Cancel erst danach (Mic sofort rot).
    const finnus = useFinnusStore.getState();
    const wasBusy =
      finnus.isGenerating || finnus.isPlayingAudio || isFinalizing;

    provisionalPausedRef.current = false;
    interruptCommittedRef.current = false;
    pressStartedAtRef.current = Date.now();
    pressModeRef.current = 'voice';
    setIsMicLocked(false);
    setPartialText('');
    setIsListening(true);
    setIsGenerating(false);

    try {
      const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
        noteMicActive: (active: boolean) => void;
      };
      noteMicActive(true);
    } catch {
      /* soft */
    }

    if (wasBusy) {
      queueMicrotask(() => {
        void cancelFindusBusy({ keepMic: true });
      });
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

    clearHoldTimer();
    clearCommitTimer();
    void beginVoiceSession();
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
    setIsListening,
    setIsGenerating,
  ]);

  /** Nach rechts wischen während Hold → Hände frei, Mikro bleibt an. */
  const onSwipeLock = useCallback(() => {
    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') return;
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      clearHoldTimer();
      clearCommitTimer();
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      skipNextPressOutRef.current = true;
      showAudioConsentMissingAlert({
        force: true,
        onTypeAsk: () => {
          onShortPress?.();
        },
      });
      return;
    }

    const mode = pressModeRef.current;
    if (mode !== 'voice' && mode !== 'pending') return;
    skipNextPressOutRef.current = true;
    if (mode === 'pending') {
      clearHoldTimer();
      pressModeRef.current = 'voice';
      void beginVoiceSession();
    }
    pressModeRef.current = 'locked';
    setIsMicLocked(true);
    setIsListening(true);
    setIsGenerating(false);
    clearCommitTimer();
    void markMicLockUsed();
    // Kein interruptFindusForMic — das setzt Generating und färbt den Button blau.
    void (async () => {
      try {
        const { discardPausedSpeaking } = await import(
          '../services/AudioVoiceService'
        );
        await discardPausedSpeaking();
      } catch {
        /* soft */
      }
    })();
  }, [
    beginVoiceSession,
    clearCommitTimer,
    clearHoldTimer,
    onShortPress,
    setIsGenerating,
    setIsListening,
  ]);

  /** Nach links wischen → Live-Chat (Mikro bleibt an, Gesprächsfenster). */
  const onSwipeLiveChat = useCallback(() => {
    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') {
      onShortPress?.();
      return;
    }
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      skipNextPressOutRef.current = true;
      clearHoldTimer();
      clearCommitTimer();
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      showAudioConsentMissingAlert({
        force: true,
        onTypeAsk: () => {
          onShortPress?.();
        },
      });
      return;
    }

    skipNextPressOutRef.current = true;
    clearHoldTimer();
    clearCommitTimer();
    pressModeRef.current = 'idle';
    setPartialText('');
    // Sofort Live-Optik — nicht erst nach Import/STT-Stop warten.
    setIsMicLocked(true);
    setIsListening(true);

    // Gerade per Tap beendet: denselben Wisch nicht als Neustart werten.
    if (Date.now() < suppressShortPressUntilRef.current) {
      setIsMicLocked(false);
      setIsListening(false);
      return;
    }
    void (async () => {
      try {
        const { startLiveChatSession } = require('../services/handsFree/liveChatSession') as {
          startLiveChatSession: (
            reason?: string,
          ) => Promise<{ ok: boolean; message?: string }>;
        };
        const r = await startLiveChatSession('swipe_left');
        if (!r.ok) {
          setIsMicLocked(false);
          setIsListening(false);
          if (__DEV__) console.warn('[liveChat] swipe start failed:', r.message);
        }
      } catch (err) {
        setIsMicLocked(false);
        setIsListening(false);
        console.warn('[liveChat] swipe start error:', err);
      }
    })();
  }, [clearCommitTimer, clearHoldTimer, onShortPress]);

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
      // Chip/Quick-Reply: Locked-PTT ohne Finalisieren sofort idle
      m.registerAbortHandsFreeUiHandler(() => {
        pressModeRef.current = 'idle';
        setIsMicLocked(false);
        setIsListening(false);
        setPartialText('');
        partialTextRef.current = '';
        clearHoldTimer();
        clearCommitTimer();
      });
      unsubBus = () => {
        m.registerHandsFreeListenHandler(null);
        m.registerTypedAskHandler(null);
        m.registerAbortHandsFreeUiHandler(null);
      };
    });
    void import('../services/handsFree/devAskPoller').then((m) => {
      m.startDevAskPoller();
    });
    return () => {
      unsubBus?.();
      void import('../services/handsFree/devAskPoller').then((m) => {
        m.stopDevAskPoller();
      });
    };
  }, [clearCommitTimer, clearHoldTimer, startHandsFreeListen, submitUserQuestion]);

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
          // Nur echtes Zuhören ist rot. processing/answering = Nachdenken/Sprechen,
          // sonst Mic rot + blauer Ring gleichzeitig.
          const hearing = phase === 'listening';
          setIsMicLocked(hearing);
          setIsListening(hearing);
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
          setIsListening(false);
          return;
        }
        // Wie onPhaseChange: nur listening = Mic-Optik, sonst kein Fake-Rot
        const hearing = phase === 'listening';
        setIsMicLocked(hearing);
        setIsListening(hearing);
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

  /**
   * Notification-Shade / App-Wechsel: PressOut geht oft verloren → Mic bleibt rot,
   * STT läuft „halb“ (Permission-Dot an, aber kein echtes Zuhören).
   * Hold (voice) abbrechen; Fixierung/Live-Chat bewusst weiterlaufen lassen.
   */
  useEffect(() => {
    let appState: AppStateStatus = AppState.currentState;
    let zombieTicks = 0;
    let uiOrphanTicks = 0;

    const clearUiMic = () => {
      pressModeRef.current = 'idle';
      setIsMicLocked(false);
      setIsListening(false);
      setIsFinalizing(false);
      setPartialText('');
      partialTextRef.current = '';
      try {
        const { noteMicActive } = require('../services/boot/interactiveBootGate') as {
          noteMicActive: (active: boolean) => void;
        };
        noteMicActive(false);
      } catch {
        /* soft */
      }
    };

    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState;
      appState = next;
      if (
        (next === 'inactive' || next === 'background') &&
        (prev === 'active' || prev === 'unknown')
      ) {
        const mode = pressModeRef.current;
        if (mode === 'voice' || mode === 'pending') {
          void abortProvisionalMic();
        }
      }
      if (next === 'active' && prev !== 'active') {
        // Nach Shade: UI-Listening ohne Session → hart bereinigen
        const mode = pressModeRef.current;
        const uiOn = useFinnusStore.getState().isListening;
        if (mode === 'idle' && uiOn && !isCurrentlyListening()) {
          clearUiMic();
        }
      }
    });

    const heal = setInterval(() => {
      let liveChat = false;
      try {
        const live = require('../services/handsFree/liveChatSession') as {
          isLiveChatActive: () => boolean;
        };
        liveChat = live.isLiveChatActive();
      } catch {
        liveChat = false;
      }

      const mode = pressModeRef.current;
      const uiOn =
        useFinnusStore.getState().isListening ||
        mode === 'voice' ||
        mode === 'locked';
      const sttHold = isCurrentlyListening();
      const nativeLive = isSttRecognitionLive();

      // STT hält Mic-Permission, UI aus, kein Live-Chat → Privacy-Dot ohne Nutzen
      if (sttHold && !uiOn && !liveChat && mode === 'idle') {
        void stopListening({ tailMs: 0, finalizeMs: 0 }).catch(() => undefined);
        zombieTicks = 0;
        uiOrphanTicks = 0;
        return;
      }

      // Keep-Alive-Zombie: Hold an, Native tot → OS-Dot flackert / „irgendwie an“
      if (
        sttHold &&
        !nativeLive &&
        !isSttAwaitingRestart() &&
        (uiOn || liveChat)
      ) {
        zombieTicks += 1;
        uiOrphanTicks = 0;
        if (zombieTicks >= 3) {
          zombieTicks = 0;
          void (async () => {
            try {
              await destroyStt();
            } catch {
              /* soft */
            }
            if (!liveChat) clearUiMic();
          })();
        }
        return;
      }
      zombieTicks = 0;

      // UI rot, aber gar kein STT — erst nach ~4s (Start-Race tolerieren)
      if (uiOn && !sttHold && !liveChat && mode !== 'pending') {
        uiOrphanTicks += 1;
        if (uiOrphanTicks >= 3) {
          uiOrphanTicks = 0;
          clearUiMic();
        }
        return;
      }
      uiOrphanTicks = 0;
    }, 1_400);

    return () => {
      sub.remove();
      clearInterval(heal);
    };
  }, [abortProvisionalMic, setIsListening]);

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

    // Kurz-Tipp: Tippfeld — außer Barge-in während Yorro spricht/denkt.
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
      if (findusBusy || interruptCommittedRef.current) {
        return;
      }
      if (Date.now() < suppressShortPressUntilRef.current) {
        return;
      }
      onShortPress?.();
      return;
    }

    // Unter 2 s: früher senden wenn Barge-in (Yorro unterbrochen) oder Timeline offen
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
      const allowEarlySubmit =
        voiceReady &&
        (calendarOpen || !findusBusy || interruptCommittedRef.current);
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
    /** Nur echte Aufnahme — Lock/Hold bleiben rot/orange, nicht blau. */
    isListening,
    isMicLocked,
    isFinalizing,
    isGenerating,
    submitUserQuestion,
    /** Doppel-Tipp Orb / Mic-Tipp: Denken + Sprache hart stoppen → Idle. */
    cancelFindusBusy,
  };
}
