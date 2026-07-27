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
import { showPermissionMissingAlert } from '../utils/permissionAlerts';

export type SttStartFailureReason = 'unavailable' | 'permission' | 'error';

export type SttStartResult =
  | { ok: true }
  | { ok: false; reason: SttStartFailureReason };

let isStarting = false;
let isActive = false;
let latestTranscript = '';
/** Längster Zwischenstand — fängt verzögerte End-Silben ab. */
let longestTranscript = '';
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
    const results = event.results ?? [];
    let best = '';
    for (const r of results) {
      const t = r?.transcript?.trim() ?? '';
      if (t.length > best.length) best = t;
    }
    if (!best) return;
    latestTranscript = best;
    if (best.length >= longestTranscript.length) {
      longestTranscript = best;
    }
    partialHandler?.(longestTranscript);
  });

  ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
    console.warn('[stt] error:', event.error, event.message);
    isActive = false;
    isStarting = false;
    // "no-speech" / aborted beim Loslassen sind ok – Transkript behalten
    if (event.error === 'aborted' || event.error === 'no-speech') {
      resolveStopWaiters(pickBestTranscript(latestTranscript, longestTranscript));
      return;
    }
    resolveStopWaiters(pickBestTranscript(latestTranscript, longestTranscript));
  });

  ExpoSpeechRecognitionModule.addListener('end', () => {
    isActive = false;
    isStarting = false;
    resolveStopWaiters(pickBestTranscript(latestTranscript, longestTranscript));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Finales Transkript mit Zwischenstand mergen — STT hinkt oft 1–2 Wörter hinterher.
 */
export function pickBestTranscript(finalText: string, partialText: string): string {
  const f = finalText.trim();
  const p = partialText.trim();
  if (!p) return f;
  if (!f) return p;
  if (f === p) return f;
  if (p.length > f.length && (p.startsWith(f) || f.startsWith(p.slice(0, Math.min(12, p.length))))) {
    return p;
  }
  if (f.length > p.length && f.includes(p)) return f;
  if (p.includes(f)) return p;
  return f.length >= p.length ? f : p;
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
    showPermissionMissingAlert('microphone');
    return { ok: false, reason: 'permission' };
  }

  logRecognitionDiagnostics();

  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    console.warn(
      '[stt] recognition unavailable – Google App / Speech Services fehlen oder Package-Visibility',
    );
    showPermissionMissingAlert('speechUnavailable');
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
  longestTranscript = '';
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

/** Nach Loslassen kurz weiterhören, dann auf finales Ergebnis warten. */
const DEFAULT_TAIL_MS = 450;
const DEFAULT_FINALIZE_MS = 1_300;

export type StopListeningOptions = {
  /** Mikro bleibt noch kurz offen (letzte Silben). */
  tailMs?: number;
  /** Max. Wartezeit auf finales STT nach stop(). */
  finalizeMs?: number;
};

/** stop() und finales Transkript zurückgeben */
export async function stopListening(
  opts?: StopListeningOptions,
): Promise<string> {
  const tailMs = opts?.tailMs ?? 0;
  const finalizeMs = opts?.finalizeMs ?? DEFAULT_FINALIZE_MS;
  const partialSnapshot = longestTranscript.trim();

  if (tailMs > 0 && (isActive || isStarting)) {
    await sleep(tailMs);
  }

  partialHandler = null;

  if (!isActive && !isStarting) {
    const text = pickBestTranscript(latestTranscript.trim(), partialSnapshot);
    latestTranscript = '';
    longestTranscript = '';
    return text;
  }

  const textPromise = new Promise<string>((resolve) => {
    stopWaiters.push(resolve);
  });

  const timeout = setTimeout(() => {
    resolveStopWaiters(
      pickBestTranscript(latestTranscript.trim(), partialSnapshot),
    );
  }, finalizeMs);

  try {
    ExpoSpeechRecognitionModule.stop();
  } catch (err) {
    console.warn('[stt] stop failed:', err);
    isActive = false;
    isStarting = false;
    resolveStopWaiters(
      pickBestTranscript(latestTranscript.trim(), partialSnapshot),
    );
  }

  const text = pickBestTranscript(
    (await textPromise).trim(),
    partialSnapshot,
  );
  clearTimeout(timeout);
  isActive = false;
  isStarting = false;
  latestTranscript = '';
  longestTranscript = '';
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
  longestTranscript = '';
  partialHandler = null;
  resolveStopWaiters('');
}
