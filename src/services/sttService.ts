/**
 * Speech-to-Text über expo-speech-recognition (Android SpeechRecognizer / iOS SFSpeechRecognizer).
 * Hold-to-speak: startListening → Live-Partial → stopListening liefert finales Transkript.
 */

import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';

export type SttStartFailureReason = 'unavailable' | 'permission' | 'error';

export type SttStartResult =
  | { ok: true }
  | { ok: false; reason: SttStartFailureReason };

let isStarting = false;
let isActive = false;
let latestTranscript = '';
let partialHandler: ((text: string) => void) | null = null;
let listenersWired = false;
let stopWaiters: Array<(text: string) => void> = [];

function resolveStopWaiters(text: string): void {
  const waiters = stopWaiters;
  stopWaiters = [];
  for (const resolve of waiters) resolve(text);
}

function wireListeners(): void {
  if (listenersWired) return;
  listenersWired = true;

  ExpoSpeechRecognitionModule.addListener('start', () => {
    isActive = true;
    isStarting = false;
    console.log('[stt] recognition started');
  });

  ExpoSpeechRecognitionModule.addListener('result', (event) => {
    const top = event.results?.[0]?.transcript?.trim() ?? '';
    if (!top) return;
    latestTranscript = top;
    partialHandler?.(top);
  });

  ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
    console.warn('[stt] error:', event.error, event.message);
    isActive = false;
    isStarting = false;
    // "no-speech" / aborted beim Loslassen sind ok – Transkript behalten
    if (event.error === 'aborted' || event.error === 'no-speech') {
      resolveStopWaiters(latestTranscript.trim());
      return;
    }
    resolveStopWaiters(latestTranscript.trim());
  });

  ExpoSpeechRecognitionModule.addListener('end', () => {
    isActive = false;
    isStarting = false;
    resolveStopWaiters(latestTranscript.trim());
  });
}

async function requestSpeechPermissions(): Promise<boolean> {
  try {
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    console.log('[stt] permissions status:', {
      granted: current.granted,
      status: current.status,
      canAskAgain: current.canAskAgain,
    });

    if (current.granted) return true;

    const requested = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    console.log('[stt] permissions after request:', {
      granted: requested.granted,
      status: requested.status,
      canAskAgain: requested.canAskAgain,
    });

    if (requested.granted) return true;

    // Fallback: nur Mikrofon (Android kennt keine separate Speech-Permission)
    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    console.log('[stt] microphone-only permission:', {
      granted: mic.granted,
      status: mic.status,
    });
    return mic.granted;
  } catch (err) {
    console.warn('[stt] permission request failed:', err);
    // Letzter Fallback über expo-av
    try {
      const av = await Audio.requestPermissionsAsync();
      return av.granted;
    } catch {
      return false;
    }
  }
}

function logRecognitionDiagnostics(): void {
  try {
    const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    console.log('[stt] isRecognitionAvailable:', available);

    if (Platform.OS === 'android') {
      const services = ExpoSpeechRecognitionModule.getSpeechRecognitionServices();
      const defaultService = ExpoSpeechRecognitionModule.getDefaultRecognitionService();
      console.log('[stt] android speech services:', services);
      console.log('[stt] android default service:', defaultService?.packageName);
    }
  } catch (err) {
    console.warn('[stt] diagnostics failed:', err);
  }
}

export async function isSttAvailable(): Promise<boolean> {
  try {
    logRecognitionDiagnostics();
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch (err) {
    console.warn('[stt] isSttAvailable failed (native module missing?):', err);
    return false;
  }
}

/** Permission → Voice.start('de-DE') mit Live-Partials */
export async function startListening(
  onPartial?: (text: string) => void,
  options?: { replaceActive?: boolean },
): Promise<SttStartResult> {
  wireListeners();

  if (isStarting || isActive) {
    if (options?.replaceActive) {
      await stopListening();
    } else {
      return { ok: false, reason: 'error' };
    }
  }

  const granted = await requestSpeechPermissions();
  if (!granted) {
    console.warn('[stt] microphone/speech permission denied');
    return { ok: false, reason: 'permission' };
  }

  logRecognitionDiagnostics();

  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    console.warn(
      '[stt] recognition unavailable – Google App / Speech Services fehlen oder Package-Visibility',
    );
    return { ok: false, reason: 'unavailable' };
  }

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
  } catch (err) {
    console.warn('[stt] Audio.setAudioModeAsync failed:', err);
  }

  partialHandler = onPartial ?? null;
  latestTranscript = '';
  isStarting = true;

  try {
    ExpoSpeechRecognitionModule.start({
      lang: 'de-DE',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: false,
    });
    return { ok: true };
  } catch (err) {
    console.warn('[stt] start failed:', err);
    isStarting = false;
    isActive = false;
    return { ok: false, reason: 'error' };
  }
}

/** stop() und finales Transkript zurückgeben */
export async function stopListening(): Promise<string> {
  partialHandler = null;

  if (!isActive && !isStarting) {
    const text = latestTranscript.trim();
    latestTranscript = '';
    return text;
  }

  const textPromise = new Promise<string>((resolve) => {
    stopWaiters.push(resolve);
  });

  const timeout = setTimeout(() => {
    resolveStopWaiters(latestTranscript.trim());
  }, 800);

  try {
    ExpoSpeechRecognitionModule.stop();
  } catch (err) {
    console.warn('[stt] stop failed:', err);
    isActive = false;
    isStarting = false;
    resolveStopWaiters(latestTranscript.trim());
  }

  const text = (await textPromise).trim();
  clearTimeout(timeout);
  isActive = false;
  isStarting = false;
  latestTranscript = '';
  return text;
}

export function isCurrentlyListening(): boolean {
  return isActive || isStarting;
}

export async function destroyStt(): Promise<void> {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {
    // ignore
  }
  isActive = false;
  isStarting = false;
  latestTranscript = '';
  partialHandler = null;
  resolveStopWaiters('');
}
