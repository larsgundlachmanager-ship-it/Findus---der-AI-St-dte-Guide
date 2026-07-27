import { useCallback, useRef, useState } from 'react';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from '../services/userProfileService';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import {
  askGeminiConciergeResponse,
  hasGeminiApiKey,
} from '../services/geminiService';
import { askOpenAiSentenceStream } from '../services/openAiService';
import {
  buildFindusSystemPrompt,
  buildPoiResearchContext,
} from '../constants/prompts';
import { FOLLOW_UP_ANSWER_RULES_DE } from '../services/audioGuideScript';
import {
  observeUserQuestionStyle,
  questionStylePromptHint,
} from '../services/questionStyleService';
import {
  speakAssistantText,
  stopSpeaking,
  getVoiceSettingsForTour,
} from '../services/ttsService';
import {
  isCurrentlyListening,
  startListening,
  stopListening,
} from '../services/sttService';

/** Kurz nach Loslassen weiterhören — fängt End-Silben ab, ohne spürbar zu warten. */
const STT_TAIL_MS = 450;
const STT_FINALIZE_MS = 1_300;
import { getPoiWithFacts } from '../db/database';
import { formatSessionMemoryForPrompt } from '../services/ai/sessionMemory';
import {
  isStopNavigationIntent,
  resolveNavOfferFromReply,
  shouldStartNavFromOffer,
  startNavigation,
  stopNavigation,
} from '../services/navigation';
import { handleMemoryIntent } from '../services/intentService';
import {
  formatUserMemoryForPrompt,
  useUserMemoryStore,
} from '../store/useUserMemoryStore';
import {
  isTransitQueryWithLocation,
  prepareTransitFollowUp,
} from '../services/transit/transitAdvisor';
import {
  isFerryQueryWithLocation,
  prepareFerryFollowUp,
  ferryAdviceToConcierge,
} from '../services/transit/ferryAdvisor';
import {
  applyConciergeNavOffers,
  isConciergeQuery,
  prepareConciergeContext,
} from '../services/concierge/conciergeContext';
import {
  enrichWithConciergeOffers,
  presentConciergeResponse,
  transitAdviceToConcierge,
} from '../services/concierge/presentConcierge';
import { shouldAcceptPendingAffiliateOffer } from '../services/affiliate/pendingAffiliateOffer';
import {
  alertActionError,
  handleQuickAction,
} from '../services/actionHandlerService';
import {
  CONCIERGE_JSON_INSTRUCTION,
  wrapPlainAsConcierge,
} from '../services/concierge/parseConciergeResponse';

export type VoiceFallbackReason = 'unavailable' | 'permission' | 'error';

/** Ab dieser Dauer zählt der Druck als Halten (Walkie-Talkie), darunter als kurzer Tipp. */
const HOLD_THRESHOLD_MS = 320;

type PressMode = 'idle' | 'pending' | 'voice';

/**
 * Kurz tippen → Tippfeld öffnen.
 * Gedrückt halten → Voice.start('de-DE'), Live-Text, Loslassen → Frage senden.
 */
export function useVoiceInput(options?: {
  onShortPress?: () => void;
  onNeedTextFallback?: (reason: VoiceFallbackReason) => void;
}) {
  const onShortPress = options?.onShortPress;
  const onNeedTextFallback = options?.onNeedTextFallback;

  const [partialText, setPartialText] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const partialTextRef = useRef('');
  const pressModeRef = useRef<PressMode>('idle');
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const beginVoiceSession = useCallback(async () => {
    if (pressModeRef.current !== 'voice') return;

    const profile = getCachedUserProfile();
    if (profile?.micListenMode === 'dont_hear') {
      pressModeRef.current = 'idle';
      onNeedTextFallback?.('permission');
      return;
    }
    if (!profile?.hasAcceptedAudioConsent || profile?.micListenMode !== 'hear') {
      pressModeRef.current = 'idle';
      showPermissionMissingAlert('audioConsent', { force: true });
      onNeedTextFallback?.('permission');
      return;
    }

    setPartialText('');
    partialTextRef.current = '';
    setIsListening(true);
    await stopSpeaking();

    const result = await startListening((partial) => {
      partialTextRef.current = partial;
      setPartialText(partial);
    });

    if (pressModeRef.current !== 'voice') {
      await stopListening();
      setIsListening(false);
      setPartialText('');
      return;
    }

    if (!result.ok) {
      pressModeRef.current = 'idle';
      setIsListening(false);
      // Popup kommt bereits aus sttService (microphone / speechUnavailable)
      onNeedTextFallback?.(result.reason);
    }
  }, [onNeedTextFallback, setIsListening]);

  const submitUserQuestion = useCallback(
    async (text: string) => {
      addChatMessage({ role: 'user', content: text });
      void observeUserQuestionStyle(text);
      // Karte bleibt sichtbar bis die neue Antwort kommt — weniger Layout-Sprünge

      const state = useFinnusStore.getState();

      if (isStopNavigationIntent(text) && state.navActive) {
        setIsGenerating(true);
        try {
          await stopNavigation();
          await stopSpeaking();
          const voiceSettings = await getVoiceSettingsForTour();
          const reply = 'Alles klar — Navigation ist aus.';
          addChatMessage({ role: 'assistant', content: reply });
          await speakAssistantText(reply, {
            voiceId: voiceSettings.voiceId,
            speechRate: voiceSettings.speechRate,
          });
        } finally {
          setIsGenerating(false);
        }
        return;
      }

      // Hotel-Confirm / Namensfrage hat Vorrang vor generischem Nav-Offer
      {
        const s = useUserMemoryStore.getState();
        const prioritizeMemory =
          s.pendingHotelConfirmId != null || s.awaitingHotelName;
        if (prioritizeMemory) {
          const intent = await handleMemoryIntent(text);
          if (intent.handled && intent.reply) {
            setIsGenerating(true);
            try {
              await stopSpeaking();
              const voiceSettings = await getVoiceSettingsForTour();
              addChatMessage({ role: 'assistant', content: intent.reply });
              await speakAssistantText(intent.reply, {
                voiceId: voiceSettings.voiceId,
                speechRate: voiceSettings.speechRate,
              });
            } finally {
              setIsGenerating(false);
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
          // Kompass ZUERST — User sieht Pfeil sofort, Stimme danach parallel
          const ok = await startNavigation(offer.poiId);
          useFinnusStore.getState().setActiveConciergeCard(null);
          await stopSpeaking();
          const voiceSettings = await getVoiceSettingsForTour();
          const reply = ok
            ? `Okay, ich führ dich zu ${offer.name}. Du musst nicht aufs Handy schauen — ich sag dir an Häusern und Abzweigungen, wo's langgeht.`
            : 'Dazu krieg ich gerade keine Route hin — versuch es gleich nochmal.';
          addChatMessage({ role: 'assistant', content: reply });
          await speakAssistantText(reply, {
            voiceId: voiceSettings.voiceId,
            speechRate: voiceSettings.speechRate,
          });
        } finally {
          setIsGenerating(false);
        }
        return;
      }

      // Affiliate Voice-Follow-up: „Ja, buchen“ / „Zeig mir das“
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
            await stopSpeaking();
            const voiceSettings = await getVoiceSettingsForTour();
            const reply = result.ok
              ? result.message ||
                'Alles klar — ich öffne dir die Buchungsoption.'
              : result.message ||
                'Das lässt sich gerade nicht öffnen — tipp einfach auf den Button.';
            if (!result.ok) alertActionError(reply);
            addChatMessage({ role: 'assistant', content: reply });
            await speakAssistantText(reply, {
              voiceId: voiceSettings.voiceId,
              speechRate: voiceSettings.speechRate,
            });
            if (result.followUpPrompt) {
              // SHOW_MORE o.ä. — als neue Frage weiterreichen
            }
          } finally {
            setIsGenerating(false);
          }
          return;
        }
      }

      // Hotel-Resolver / History-Recall / Memory-Nav (vor Gemini)
      {
        const intent = await handleMemoryIntent(text);
        if (intent.handled && intent.reply) {
          setIsGenerating(true);
          try {
            await stopSpeaking();
            addChatMessage({ role: 'assistant', content: intent.reply });
            if (intent.startedNav) {
              // Kompass ist schon an (intent) — sichtbar halten, Stimme parallel
              useFinnusStore.getState().patchNavigation({
                navActive: true,
                navVisible: true,
              });
              const voiceSettings = await getVoiceSettingsForTour();
              await speakAssistantText(intent.reply, {
                voiceId: voiceSettings.voiceId,
                speechRate: voiceSettings.speechRate,
              });
            } else {
              // Speech sagt evtl. trotzdem Navigation zu → auto-start in present
              await presentConciergeResponse(
                wrapPlainAsConcierge(intent.reply, {
                  cardTitle: 'Navigation',
                  visualBullets: [],
                  quickActions: [],
                }),
              );
            }
          } finally {
            setIsGenerating(false);
          }
          return;
        }
      }

      // Fähre: tideabhängiger Fahrplan (GPS + Wortlaut)
      if (await isFerryQueryWithLocation(text)) {
        const ferry = await prepareFerryFollowUp(text);
        if (ferry) {
          setIsGenerating(true);
          try {
            await stopSpeaking();
            const structured = ferryAdviceToConcierge(ferry.advice, ferry.reply);
            addChatMessage({ role: 'assistant', content: ferry.reply });
            await presentConciergeResponse(structured);
          } finally {
            setIsGenerating(false);
          }
          return;
        }
      }

      // ÖPNV: Speech + Visual Card (Stimme zuerst)
      if (await isTransitQueryWithLocation(text)) {
        const transit = await prepareTransitFollowUp(text);
        if (transit) {
          setIsGenerating(true);
          try {
            await stopSpeaking();
            const structured = transitAdviceToConcierge(
              transit.advice,
              transit.reply,
              transit.offerNavigation,
            );
            addChatMessage({ role: 'assistant', content: transit.reply });
            await presentConciergeResponse(structured);
          } finally {
            setIsGenerating(false);
          }
          return;
        }
      }

      // Concierge / allgemeine Rückfrage → strukturiertes JSON
      setIsGenerating(true);
      const navSnapshot = useFinnusStore.getState().navActive
        ? {
            navActive: true,
            navVisible: useFinnusStore.getState().navVisible,
          }
        : null;
      try {
        await stopSpeaking();

        const live = useFinnusStore.getState();
        const history = live.chatHistory;
        const memory = formatSessionMemoryForPrompt({
          entries: live.visitedHistory,
        });
        const longTerm = formatUserMemoryForPrompt();
        const told = live.toldFactKeys.slice(-40).join(' | ');

        let poiBlock = '';
        if (live.currentPoiId != null) {
          const poi = await getPoiWithFacts(live.currentPoiId);
          if (poi) {
            poiBlock = `\n\n${buildPoiResearchContext(poi)}`;
          }
        }

        let conciergeCtx = null as Awaited<
          ReturnType<typeof prepareConciergeContext>
        >;
        let conciergeBlock = '';
        if (isConciergeQuery(text)) {
          conciergeCtx = await prepareConciergeContext(text);
          if (conciergeCtx) {
            conciergeBlock = `\n\n${conciergeCtx.promptBlock}`;
            applyConciergeNavOffers(conciergeCtx);
          }
        }

        const system = `${buildFindusSystemPrompt()}

${FOLLOW_UP_ANSWER_RULES_DE}

${questionStylePromptHint()}

## Session-Memory
${memory}

## Langzeitgedächtnis (Hotels, Restaurants, Dwell-Stops)
${longTerm}

Bereits gesagte Fakt-Keys (nicht wiederholen): ${told || '—'}
${poiBlock}
${conciergeBlock}

${CONCIERGE_JSON_INSTRUCTION}

Der User stellt eine Rückfrage. Fülle speechText für die Stimme — visualBullets/quickActions nur fürs Display.`;

        const withPersona = [
          { role: 'system' as const, content: system },
          ...history,
        ];

        let response = hasGeminiApiKey()
          ? await askGeminiConciergeResponse(withPersona)
          : null;

        if (!response) {
          const parts: string[] = [];
          for await (const sentence of askOpenAiSentenceStream(withPersona)) {
            parts.push(sentence);
          }
          response = wrapPlainAsConcierge(
            parts.join(' ').trim() ||
              'Dazu hab ich gerade keinen frischen Beleg — versuch es gleich noch einmal.',
          );
        }

        response = await enrichWithConciergeOffers(response, conciergeCtx);
        addChatMessage({
          role: 'assistant',
          content: response.speechText,
        });
        useFinnusStore
          .getState()
          .addToldFactKeys([response.speechText.slice(0, 120)]);

        // Stimme zuerst, dann Spickzettel-Karte
        await presentConciergeResponse(response);

        if (navSnapshot && !isStopNavigationIntent(text)) {
          useFinnusStore.getState().patchNavigation(navSnapshot);
        }
      } catch (error) {
        console.error('[voice] Concierge follow-up failed:', error);
        const fallback =
          'Dazu hab ich gerade keinen frischen Beleg — versuch es gleich noch einmal.';
        addChatMessage({ role: 'assistant', content: fallback });
        const voiceSettings = await getVoiceSettingsForTour();
        await speakAssistantText(fallback, {
          voiceId: voiceSettings.voiceId,
          speechRate: voiceSettings.speechRate,
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [addChatMessage, setIsGenerating],
  );

  const onPressIn = useCallback(() => {
    if (isGenerating || pressModeRef.current !== 'idle') return;

    pressModeRef.current = 'pending';
    setPartialText('');

    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (pressModeRef.current !== 'pending') return;
      pressModeRef.current = 'voice';
      void beginVoiceSession();
    }, HOLD_THRESHOLD_MS);
  }, [beginVoiceSession, clearHoldTimer, isGenerating]);

  const onPressOut = useCallback(() => {
    const mode = pressModeRef.current;
    clearHoldTimer();

    if (mode === 'pending') {
      pressModeRef.current = 'idle';
      onShortPress?.();
      return;
    }

    if (mode !== 'voice' && !isCurrentlyListening() && !isListening) {
      pressModeRef.current = 'idle';
      return;
    }

    pressModeRef.current = 'idle';

    void (async () => {
      setIsFinalizing(true);
      try {
        const transcript = await stopListening({
          tailMs: STT_TAIL_MS,
          finalizeMs: STT_FINALIZE_MS,
        });
        const text = transcript.trim();
        if (!text) return;
        await submitUserQuestion(text);
      } finally {
        setIsFinalizing(false);
        setIsListening(false);
        setPartialText('');
        partialTextRef.current = '';
      }
    })();
  }, [
    clearHoldTimer,
    isListening,
    onShortPress,
    setIsListening,
    submitUserQuestion,
  ]);

  return {
    onPressIn,
    onPressOut,
    partialText,
    isListening: isListening || isFinalizing,
    isFinalizing,
    isGenerating,
    submitUserQuestion,
  };
}
