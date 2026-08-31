/**
 * Hintergrund-Speech: Link-Open ODER Modul-1-Pref „Immer“ / Kopfhörer.
 * Sonst (Home / andere App ohne Pref) → TTS stoppen.
 */

import { AppState, type AppStateStatus, Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { shouldKeepTalkingOnAction } from './keepTalkingOnAction';

export { shouldKeepTalkingOnAction } from './keepTalkingOnAction';

let linkArmUntilMs = 0;
let linkArmReason = '';
let bootstrapped = false;
let lastState: AppStateStatus = AppState.currentState;

const DEFAULT_ARM_MS = 10 * 60_000;

export function armLinkBackgroundSpeech(opts?: {
  ttlMs?: number;
  reason?: string;
}): void {
  linkArmUntilMs = Date.now() + (opts?.ttlMs ?? DEFAULT_ARM_MS);
  linkArmReason = (opts?.reason || 'OPEN_URL').slice(0, 40);
  if (__DEV__) {
    console.log(`[bgSpeech] armed (${linkArmReason})`);
  }
  void ensureBackgroundAudioStayAlive();
}

export function clearLinkBackgroundSpeech(): void {
  linkArmUntilMs = 0;
  linkArmReason = '';
}

export function isLinkBackgroundSpeechArmed(): boolean {
  return Date.now() < linkArmUntilMs;
}

export function getLinkBackgroundSpeechReason(): string | null {
  return isLinkBackgroundSpeechArmed() ? linkArmReason || 'OPEN_URL' : null;
}

/** Darf laufende Speech im Hintergrund weiterlaufen? */
export function shouldContinueSpeechInBackground(): boolean {
  if (isLinkBackgroundSpeechArmed()) return true;
  // Navigation / Tour: Sperrbildschirm darf Ansagen nicht killen
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    if (useFinnusStore.getState().navActive) return true;
  } catch {
    /* soft */
  }
  try {
    const {
      getModule1BackgroundSpeechModeSync,
    } = require('./module1BackgroundSpeechPrefs') as {
      getModule1BackgroundSpeechModeSync: () => 'always' | 'headphones' | 'app_open';
    };
    const mode = getModule1BackgroundSpeechModeSync();
    if (mode === 'always') return true;
    if (mode === 'headphones') {
      // Sync-Pfad: kein Jack-Check — Sperre/Hintergrund nicht killen.
      return (
        AppState.currentState === 'inactive' ||
        AppState.currentState === 'background'
      );
    }
  } catch {
    /* Prefs optional */
  }
  return false;
}

async function ensureBackgroundAudioStayAlive(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    });
  } catch {
    /* soft */
  }
}

async function stopSpeechForBackgroundLeave(reason: string): Promise<void> {
  // Erwartetes Verhalten (kein Fehler) — nicht als User-Fallback-Banner zeigen
  if (__DEV__) {
    console.log(`[bgSpeech] stop (${reason})`);
  }
  try {
    const { stopListening } = await import('../sttService');
    await stopListening({ tailMs: 0, finalizeMs: 0 });
  } catch {
    /* soft */
  }
  try {
    const { bargeInFlush } = await import('../../module2/speech/speechQueue');
    await bargeInFlush();
  } catch {
    /* soft */
  }
  try {
    const { stopSpeaking } = await import('../ttsService');
    await stopSpeaking();
  } catch {
    /* soft */
  }
}

async function onLeaveForeground(next: AppStateStatus): Promise<void> {
  // Session immer merken (Kill / Resume)
  try {
    const { persistSessionSnapshot } = await import(
      '../session/sessionResumeService'
    );
    await persistSessionSnapshot({ leaveKind: next });
  } catch {
    /* soft */
  }

  // iOS Control-Center / Android Custom-Tab oft nur inactive
  if (next === 'inactive') {
    if (shouldContinueSpeechInBackground()) {
      await ensureBackgroundAudioStayAlive();
      return;
    }
    if (Platform.OS === 'ios') return;
  }

  if (shouldContinueSpeechInBackground()) {
    await ensureBackgroundAudioStayAlive();
    return;
  }

  // Notification / Home / andere App / Wegwischen-Vorbereitung
  await stopSpeechForBackgroundLeave(
    next === 'background' ? 'background_ohne_Link' : `leave_${next}`,
  );
}

function onAppState(next: AppStateStatus): void {
  const prev = lastState;
  lastState = next;

  if (
    prev === 'active' &&
    (next === 'background' || next === 'inactive')
  ) {
    void onLeaveForeground(next);
    return;
  }

  if (next === 'active' && prev !== 'active') {
    // Zurück: alten Debug-Banner weg (z. B. veralteter Hintergrund-Stop)
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => {
            ttsStatusMessage: string | null;
            setTtsStatusMessage: (m: string | null) => void;
          };
        };
      };
      const msg = useFinnusStore.getState().ttsStatusMessage ?? '';
      if (/TTS-Hintergrund-Stop|background_ohne_Link/i.test(msg)) {
        useFinnusStore.getState().setTtsStatusMessage(null);
      }
    } catch {
      /* soft */
    }
    // Arm behalten bis TTL (User kann Browser schließen und weiterhören)
    void (async () => {
      try {
        const { maybeOfferSessionResume } = await import(
          '../session/sessionResumeService'
        );
        await maybeOfferSessionResume();
      } catch {
        /* soft */
      }
    })();
  }
}

export function bootstrapBackgroundSpeechPolicy(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  lastState = AppState.currentState;
  AppState.addEventListener('change', onAppState);
  try {
    const { loadModule1BackgroundSpeechPrefs } = require('./module1BackgroundSpeechPrefs') as {
      loadModule1BackgroundSpeechPrefs: () => Promise<unknown>;
    };
    void loadModule1BackgroundSpeechPrefs();
  } catch {
    /* Prefs optional */
  }
}
