/**
 * Speech-to-Text über expo-speech-recognition (Android SpeechRecognizer / iOS SFSpeechRecognizer).
 * Hold-to-speak: startListening → Live-Partial → stopListening liefert finales Transkript.
 *
 * Lange Holds (bis 10 Min): Android bricht Segmente oft nach ~20–40 s ab —
 * Keep-Alive + proaktive Segment-Rotation stapeln den Text.
 */

import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import { restoreAmbientAudioAfterSpeech } from './AudioVoiceService';

export type SttStartFailureReason = 'unavailable' | 'permission' | 'error';

export type SttStartResult =
  | { ok: true }
  | { ok: false; reason: SttStartFailureReason };

/** Max. Hold-Dauer für Spracherkennung (User-Anforderung). */
export const STT_MAX_HOLD_MS = 10 * 60_000;
/** Proaktiv neu starten, bevor Android das Segment killt. */
const SEGMENT_ROTATE_MS = 22_000;
const RESTART_BASE_DELAY_MS = 220;
const RESTART_MAX_ATTEMPTS = 8;

let isStarting = false;
let isActive = false;
/** Fertige Segmente (nach Restart / Rotation). */
let committedTranscript = '';
/** Aktuelles Android-Segment (Interim wächst hier). */
let currentSegment = '';
let partialHandler: ((text: string) => void) | null = null;
let listenersWired = false;
let stopWaiters: Array<(text: string) => void> = [];
/** Hold-to-speak: bei end()/Timeout neu starten. */
let keepAliveHold = false;
let restartQueued = false;
let restartAttempts = 0;
let holdStartedAtMs = 0;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let maxHoldTimer: ReturnType<typeof setTimeout> | null = null;

function clearRotateTimer(): void {
  if (rotateTimer) {
    clearTimeout(rotateTimer);
    rotateTimer = null;
  }
}

function clearMaxHoldTimer(): void {
  if (maxHoldTimer) {
    clearTimeout(maxHoldTimer);
    maxHoldTimer = null;
  }
}

function resolveStopWaiters(text: string): void {
  const waiters = stopWaiters;
  stopWaiters = [];
  for (const resolve of waiters) resolve(text);
}

function fullTranscript(): string {
  return pickBestTranscript(committedTranscript, currentSegment).trim();
}

function commitCurrentSegment(): void {
  const seg = currentSegment.trim();
  if (!seg) {
    currentSegment = '';
    return;
  }
  if (!committedTranscript) {
    committedTranscript = seg;
  } else if (
    committedTranscript.includes(seg) ||
    seg.includes(committedTranscript)
  ) {
    committedTranscript =
      seg.length >= committedTranscript.length ? seg : committedTranscript;
  } else {
    committedTranscript = `${committedTranscript} ${seg}`
      .replace(/\s+/g, ' ')
      .trim();
  }
  currentSegment = '';
}

function emitPartial(): void {
  const best = fullTranscript();
  if (best) partialHandler?.(best);
}

function holdBudgetLeftMs(): number {
  if (!holdStartedAtMs) return STT_MAX_HOLD_MS;
  return Math.max(0, STT_MAX_HOLD_MS - (Date.now() - holdStartedAtMs));
}

function startNativeRecognition(): void {
  const androidIntentOptions =
    Platform.OS === 'android'
      ? {
          // Längere Pausen erlauben — aber nicht 8–12s (fühlt sich tot an)
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2_200,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1_400,
        }
      : undefined;

  ExpoSpeechRecognitionModule.start({
    lang: 'de-DE',
    interimResults: true,
    continuous: true,
    maxAlternatives: 1,
    requiresOnDeviceRecognition: false,
    ...(androidIntentOptions
      ? { androidIntentOptions }
      : {}),
  });
}

function scheduleSegmentRotate(): void {
  clearRotateTimer();
  if (!keepAliveHold) return;
  const left = holdBudgetLeftMs();
  if (left < 3_000) return;
  const delay = Math.min(SEGMENT_ROTATE_MS, left - 1_000);
  rotateTimer = setTimeout(() => {
    rotateTimer = null;
    if (!keepAliveHold || stopWaiters.length > 0) return;
    if (!isActive && !isStarting) {
      queueKeepAliveRestart('idle-rotate');
      return;
    }
    // Segment committen und nativ neu starten
    commitCurrentSegment();
    emitPartial();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      queueKeepAliveRestart('rotate-stop-fail');
    }
    // end-Listener übernimmt Restart via keepAlive
  }, delay);
}

function scheduleMaxHoldCap(): void {
  clearMaxHoldTimer();
  if (!keepAliveHold) return;
  maxHoldTimer = setTimeout(() => {
    maxHoldTimer = null;
    if (!keepAliveHold) return;
    console.log('[stt] max hold 10 min reached — stop accepting new audio');
    keepAliveHold = false;
    clearRotateTimer();
    commitCurrentSegment();
    emitPartial();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* soft */
    }
  }, holdBudgetLeftMs());
}

function wireListeners(): void {
  if (listenersWired) return;
  listenersWired = true;

  ExpoSpeechRecognitionModule.addListener('start', () => {
    isActive = true;
    isStarting = false;
    restartQueued = false;
    restartAttempts = 0;
    console.log('[stt] recognition started');
    scheduleSegmentRotate();
  });

  ExpoSpeechRecognitionModule.addListener('result', (event) => {
    const results = event.results ?? [];
    let best = '';
    for (const r of results) {
      const t = r?.transcript?.trim() ?? '';
      if (t.length > best.length) best = t;
    }
    if (!best) return;
    // Interim wächst im aktuellen Segment — nicht an committed anhängen
    if (
      !currentSegment ||
      best.length >= currentSegment.length ||
      best.includes(currentSegment) ||
      currentSegment.includes(best)
    ) {
      currentSegment =
        best.length >= currentSegment.length ? best : currentSegment;
    } else {
      // Unerwarteter Sprung: als neues Teilsegment behandeln
      commitCurrentSegment();
      currentSegment = best;
    }
    if (event.isFinal) {
      commitCurrentSegment();
    }
    emitPartial();
  });

  ExpoSpeechRecognitionModule.addListener(
    'error',
    (event: ExpoSpeechRecognitionErrorEvent) => {
      console.warn('[stt] error:', event.error, event.message);
      isActive = false;
      isStarting = false;
      commitCurrentSegment();
      if (
        keepAliveHold &&
        stopWaiters.length === 0 &&
        event.error !== 'aborted' &&
        holdBudgetLeftMs() > 1_000
      ) {
        queueKeepAliveRestart(`error:${event.error}`);
        return;
      }
      resolveStopWaiters(fullTranscript());
    },
  );

  ExpoSpeechRecognitionModule.addListener('end', () => {
    isActive = false;
    isStarting = false;
    commitCurrentSegment();
    emitPartial();
    if (keepAliveHold && stopWaiters.length === 0 && holdBudgetLeftMs() > 1_000) {
      queueKeepAliveRestart('end');
      return;
    }
    resolveStopWaiters(fullTranscript());
  });
}

function queueKeepAliveRestart(reason: string): void {
  if (!keepAliveHold || restartQueued) return;
  if (holdBudgetLeftMs() < 800) {
    keepAliveHold = false;
    return;
  }
  restartQueued = true;
  clearRotateTimer();
  const attempt = restartAttempts;
  const delay = Math.min(
    2_500,
    RESTART_BASE_DELAY_MS * Math.pow(1.45, Math.min(attempt, 6)),
  );
  setTimeout(() => {
    if (!keepAliveHold || stopWaiters.length > 0) {
      restartQueued = false;
      return;
    }
    if (isActive || isStarting) {
      restartQueued = false;
      return;
    }
    try {
      isStarting = true;
      restartAttempts = attempt + 1;
      startNativeRecognition();
      console.log(`[stt] keep-alive restart (${reason}, try ${restartAttempts})`);
      if (restartAttempts > RESTART_MAX_ATTEMPTS) {
        // Zähler zurücksetzen, solange Hold noch im 10-Min-Budget
        restartAttempts = 0;
      }
    } catch (err) {
      console.warn('[stt] keep-alive restart failed:', err);
      isStarting = false;
      restartQueued = false;
      if (keepAliveHold && holdBudgetLeftMs() > 1_500) {
        queueKeepAliveRestart('retry-after-fail');
      }
    }
  }, delay);
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
  if (
    p.length > f.length &&
    (p.startsWith(f) || f.startsWith(p.slice(0, Math.min(12, p.length))))
  ) {
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

    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    console.log('[stt] microphone-only permission:', {
      granted: mic.granted,
      status: mic.status,
    });
    return mic.granted;
  } catch (err) {
    console.warn('[stt] permission request failed:', err);
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
      const defaultService =
        ExpoSpeechRecognitionModule.getDefaultRecognitionService();
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

/** Permission → Voice.start('de-DE') mit Live-Partials (bis 10 Min Hold). */
export async function startListening(
  onPartial?: (text: string) => void,
  options?: { replaceActive?: boolean; keepAlive?: boolean },
): Promise<SttStartResult> {
  wireListeners();

  if (isStarting || isActive || keepAliveHold) {
    if (options?.replaceActive) {
      keepAliveHold = false;
      await stopListening({ tailMs: 0, finalizeMs: 400 });
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
  committedTranscript = '';
  currentSegment = '';
  keepAliveHold = options?.keepAlive !== false;
  restartQueued = false;
  restartAttempts = 0;
  holdStartedAtMs = Date.now();
  isStarting = true;
  scheduleMaxHoldCap();

  try {
    startNativeRecognition();
    return { ok: true };
  } catch (err) {
    console.warn('[stt] start failed:', err);
    isStarting = false;
    isActive = false;
    keepAliveHold = false;
    clearMaxHoldTimer();
    clearRotateTimer();
    return { ok: false, reason: 'error' };
  }
}

/** Nach Loslassen kurz weiterhören, dann auf finales Ergebnis warten. */
const DEFAULT_TAIL_MS = 650;
const DEFAULT_FINALIZE_MS = 1_800;

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
  keepAliveHold = false;
  restartQueued = false;
  clearRotateTimer();
  clearMaxHoldTimer();
  commitCurrentSegment();
  const partialSnapshot = fullTranscript();

  if (tailMs > 0 && (isActive || isStarting)) {
    await sleep(tailMs);
  }

  partialHandler = null;

  if (!isActive && !isStarting) {
    const text = partialSnapshot;
    committedTranscript = '';
    currentSegment = '';
    holdStartedAtMs = 0;
    return text;
  }

  const textPromise = new Promise<string>((resolve) => {
    stopWaiters.push(resolve);
  });

  const timeout = setTimeout(() => {
    commitCurrentSegment();
    resolveStopWaiters(fullTranscript() || partialSnapshot);
  }, finalizeMs);

  try {
    ExpoSpeechRecognitionModule.stop();
  } catch (err) {
    console.warn('[stt] stop failed:', err);
    isActive = false;
    isStarting = false;
    commitCurrentSegment();
    resolveStopWaiters(fullTranscript() || partialSnapshot);
  }

  const text = pickBestTranscript(
    (await textPromise).trim(),
    partialSnapshot,
  );
  clearTimeout(timeout);
  isActive = false;
  isStarting = false;
  committedTranscript = '';
  currentSegment = '';
  holdStartedAtMs = 0;
  void restoreAmbientAudioAfterSpeech();
  return text;
}

export function isCurrentlyListening(): boolean {
  return isActive || isStarting || keepAliveHold;
}

/** Aktueller Partial inkl. Keep-Alive-Segmente — Fallback wenn stop() leer. */
export function peekListeningTranscript(): string {
  return fullTranscript();
}

export async function destroyStt(): Promise<void> {
  keepAliveHold = false;
  restartQueued = false;
  clearRotateTimer();
  clearMaxHoldTimer();
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {
    // ignore
  }
  isActive = false;
  isStarting = false;
  committedTranscript = '';
  currentSegment = '';
  holdStartedAtMs = 0;
  partialHandler = null;
  resolveStopWaiters('');
  void restoreAmbientAudioAfterSpeech();
}
