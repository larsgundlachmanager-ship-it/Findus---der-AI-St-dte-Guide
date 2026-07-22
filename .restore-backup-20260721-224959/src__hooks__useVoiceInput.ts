import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFinnusStore } from '../store/useFinnusStore';
import { askOpenAiSentenceStream } from '../services/openAiService';
import { pickIntro } from '../constants/guideIntros';
import { buildFindusSystemPrompt } from '../constants/prompts';
import { speakTwoPhase, stopSpeaking, getVoiceSettingsForTour } from '../services/ttsService';
import { sentencesFromFullText } from '../services/ai/sentenceStream';
import { createBufferedSentenceQueue } from '../services/ai/bufferedSentenceQueue';
import {
  isCurrentlyListening,
  startListening,
  stopListening,
} from '../services/sttService';

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

    setPartialText('');
    setIsListening(true);

    // Permissions werden in startListening() explizit abgefragt (vor Availability-Check)
    const result = await startListening((partial) => setPartialText(partial));

    if (pressModeRef.current !== 'voice') {
      await stopListening();
      setIsListening(false);
      setPartialText('');
      return;
    }

    if (!result.ok) {
      pressModeRef.current = 'idle';
      setIsListening(false);

      if (result.reason === 'permission') {
        Alert.alert(
          'Mikrofon verweigert',
          'Ohne Mikrofon-Berechtigung kann Findus dich nicht hören. Bitte erlaube den Zugriff in den Systemeinstellungen.',
        );
        onNeedTextFallback?.('permission');
        return;
      }

      if (result.reason === 'unavailable') {
        Alert.alert(
          'Spracherkennung nicht verfügbar',
          'Auf dem Gerät wurde kein Spracherkennungsdienst gefunden. Bitte stelle sicher, dass die Google App bzw. „Speech Services by Google“ installiert und aktiviert ist. Danach App neu bauen (npx expo run:android).',
        );
      }

      onNeedTextFallback?.(result.reason);
    }
  }, [onNeedTextFallback, setIsListening]);

  const submitUserQuestion = useCallback(
    async (text: string) => {
      addChatMessage({ role: 'user', content: text });
      setIsGenerating(true);

      const intro = pickIntro('question');
      const queue = createBufferedSentenceQueue();
      const collected: string[] = [];

      // OpenAI parallel zum Intro streamen
      void (async () => {
        try {
          const history = useFinnusStore.getState().chatHistory;
          const visitedHistory = useFinnusStore.getState().visitedHistory;
          const withPersona = [
            {
              role: 'system' as const,
              content: buildFindusSystemPrompt({ entries: visitedHistory }),
            },
            ...history,
          ];
          for await (const sentence of askOpenAiSentenceStream(withPersona)) {
            collected.push(sentence);
            queue.push(sentence.trim());
          }
          if (collected.length > 0) {
            addChatMessage({
              role: 'assistant',
              content: collected.join(' '),
            });
          }
        } catch (error) {
          console.error('[voice] OpenAI failed:', error);
          const fallback =
            'Ups, die Online-Antwort hat gerade nicht geklappt. Versuch es gleich noch einmal.';
          addChatMessage({ role: 'assistant', content: fallback });
          for await (const s of sentencesFromFullText(fallback)) {
            queue.push(s);
          }
        } finally {
          setIsGenerating(false);
          queue.close();
        }
      })();

      try {
        await stopSpeaking();
        const voiceSettings = await getVoiceSettingsForTour();
        await speakTwoPhase({
          introText: intro,
          bodySentenceStream: queue.iterate(),
          voice: {
            voiceId: voiceSettings.voiceId,
            speechRate: voiceSettings.speechRate,
          },
        });
      } catch (error) {
        console.error('[voice] Kokoro-Audio fehlgeschlagen:', error);
        setIsGenerating(false);
        useFinnusStore.getState().setSubtitleText(null);
        useFinnusStore.getState().setIsPlayingAudio(false);
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
      const transcript = await stopListening();
      setIsListening(false);
      setPartialText('');

      const text = transcript.trim();
      if (!text) return;

      await submitUserQuestion(text);
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
    isListening,
    isGenerating,
    submitUserQuestion,
  };
}
