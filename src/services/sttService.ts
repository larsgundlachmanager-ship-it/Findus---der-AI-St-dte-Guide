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
import {
  restoreAmbientAudioAfterSpeech,
  prepareAudioForMicrophone,
  warmAudioModeForMicrophone,
} from './AudioVoiceService';
import { joinSttSegments } from './sttJoin';
import {
  armMicVadWarmup,
  noteMicVolume,
  resetMicVad,
  setMicVadEnabled,
} from './handsFree/micVad';
import {
  noteMicPipelineReady,
  isMicPipelineReady,
} from './boot/interactiveBootGate';

let permissionsWarmGranted: boolean | null = null;
let recognitionWarmAvailable: boolean | null = null;
let audioModeWarm = false;

export type SttStartFailureReason = 'unavailable' | 'permission' | 'error';

export type SttStartResult =
  | { ok: true }
  | { ok: false; reason: SttStartFailureReason };

/** Max. Hold-Dauer für Spracherkennung (User-Anforderung). */
export const STT_MAX_HOLD_MS = 10 * 60_000;
/** Proaktiv neu starten, bevor Android das Segment killt. */
const SEGMENT_ROTATE_MS = 18_000;
const RESTART_BASE_DELAY_MS = 220;
const RESTART_MAX_ATTEMPTS = 8;

/**
 * Bevorzugte Android-Engines — nur wenn wirklich installiert.
 * Nie eine fehlende Package erzwingen (sonst: „No service found for package …“).
 * Google-Engines vor OEM (Qualcomm VoiceAI oft sofort network/code 4 ohne Google-App).
 */
const ANDROID_PREFERRED_SPEECH_PACKAGES = [
  'com.google.android.googlequicksearchbox',
  'com.google.android.tts',
  'com.google.android.as',
] as const;
/** Nur wenn nichts Google-artiges da ist. */
const ANDROID_LAST_RESORT_SPEECH_PACKAGES = [
  'com.qualcomm.qti.voiceai.speech',
] as const;

/** Packages die in dieser Session hart versagt haben (network / missing). */
const failedAndroidPackages = new Set<string>();

let isStarting = false;
let isActive = false;
/** Fertige Segmente (nach Restart / Rotation). */
let committedTranscript = '';
/** Aktuelles Android-Segment (Interim wächst hier). */
let currentSegment = '';
let partialHandler: ((text: string) => void) | null = null;
/** Live-Chat Handoff: startListening soll Handler nicht ueberschreiben. */
let partialHandlerLocked = false;
let listenersWired = false;
let stopWaiters: Array<(text: string) => void> = [];
/** Hold-to-speak: bei end()/Timeout neu starten. */
let keepAliveHold = false;
let restartQueued = false;
let restartAttempts = 0;
let holdStartedAtMs = 0;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let maxHoldTimer: ReturnType<typeof setTimeout> | null = null;
/** Gewählter Android Speech-Service (rotierend bei no-speech). */
let androidServicePackage: string | null = null;
let androidServiceIndex = 0;
let lastVolumeSample = -99;
let gotPartialThisSegment = false;
/** no-speech + vol≈-2: Fokus, nicht Engine wechseln. */
let quietNoSpeechTries = 0;

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

/**
 * Keep-Alive-Segmente stapeln — SSOT `sttJoin.ts`.
 */
export { joinSttSegments } from './sttJoin';

function fullTranscript(): string {
  return joinSttSegments(committedTranscript, currentSegment);
}

function commitCurrentSegment(): void {
  const seg = currentSegment.trim();
  if (!seg) {
    currentSegment = '';
    return;
  }
  committedTranscript = joinSttSegments(committedTranscript, seg);
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

function pickAndroidRecognitionPackage(forceNext = false): string | undefined {
  if (Platform.OS !== 'android') return undefined;
  try {
    const services: string[] =
      ExpoSpeechRecognitionModule.getSpeechRecognitionServices?.() ?? [];
    const available = new Set(services.map((s) => String(s)));
    const skipEarly = (p: string) =>
      p.toLowerCase().includes('bixby') || failedAndroidPackages.has(p);
    const preferred = ANDROID_PREFERRED_SPEECH_PACKAGES.filter(
      (p) => available.has(p) && !failedAndroidPackages.has(p),
    );
    const last = ANDROID_LAST_RESORT_SPEECH_PACKAGES.filter(
      (p) => available.has(p) && !failedAndroidPackages.has(p),
    );
    const mid = services.filter(
      (p) =>
        !skipEarly(p) &&
        !preferred.includes(p as never) &&
        !last.includes(p as never),
    );
    // Nur installierte Packages — sonst lässt Android den Start mit „No service found“ sterben.
    const order = [...preferred, ...mid, ...last].filter((p) => available.has(p));
    if (!order.length) {
      // System-Default (kein androidRecognitionServicePackage)
      androidServicePackage = null;
      return undefined;
    }
    if (forceNext || !androidServicePackage) {
      androidServiceIndex = forceNext
        ? (androidServiceIndex + 1) % order.length
        : 0;
      androidServicePackage = String(order[androidServiceIndex]);
    } else if (!order.includes(androidServicePackage)) {
      androidServicePackage = String(order[0]);
      androidServiceIndex = 0;
    }
    return androidServicePackage ?? undefined;
  } catch {
    androidServicePackage = null;
    return undefined;
  }
}

function startNativeRecognition(): void {
  gotPartialThisSegment = false;
  const androidPkg = pickAndroidRecognitionPackage(false);
  const androidIntentOptions =
    Platform.OS === 'android'
      ? {
          // Längere Pausen erlauben — Live-Chat braucht Luft
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2_800,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1_800,
          EXTRA_LANGUAGE_MODEL: 'free_form' as const,
        }
      : undefined;

  if (androidPkg) {
    console.warn('[stt] androidRecognitionServicePackage:', androidPkg);
  }

  ExpoSpeechRecognitionModule.start({
    lang: 'de-DE',
    interimResults: true,
    // continuous:true + System-Intelligence → oft no-speech ohne Partials.
    // Keep-Alive restartet Segmente zuverlässiger.
    continuous: Platform.OS === 'ios',
    maxAlternatives: 1,
    requiresOnDeviceRecognition: false,
    ...(androidPkg
      ? { androidRecognitionServicePackage: androidPkg }
      : {}),
    volumeChangeEventOptions: {
      enabled: true,
      intervalMillis: 120,
    },
    ...(androidIntentOptions ? { androidIntentOptions } : {}),
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
    gotPartialThisSegment = true;
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
      console.warn(
        '[stt] error:',
        event.error,
        event.message,
        `vol=${lastVolumeSample.toFixed(1)}`,
        `partial=${gotPartialThisSegment}`,
        `svc=${androidServicePackage ?? 'default'}`,
      );
      isActive = false;
      isStarting = false;
      commitCurrentSegment();
      const msg = String(event.message ?? '');
      const svc = androidServicePackage;
      // Fehlende Engine / OEM-Cloud tot → Package für Session sperren + rotieren.
      const hardFail =
        (event.error === 'audio-capture' &&
          /no service found|not found|unknown/i.test(msg)) ||
        (event.error === 'network' && !gotPartialThisSegment) ||
        (event.error === 'server' && !gotPartialThisSegment);
      if (hardFail && svc) {
        failedAndroidPackages.add(svc);
        console.warn('[stt] blacklist recognition package:', svc, event.error);
        androidServicePackage = null;
        androidServiceIndex = 0;
        pickAndroidRecognitionPackage(false);
      }
      // Stille (vol<0) = Audiokanal, nicht falsche Engine.
      if (
        (event.error === 'no-speech' || event.error === 'speech-timeout') &&
        !gotPartialThisSegment &&
        keepAliveHold
      ) {
        if (lastVolumeSample < 0 && quietNoSpeechTries < 2) {
          quietNoSpeechTries += 1;
          void prepareAudioForMicrophone();
        } else {
          quietNoSpeechTries = 0;
          pickAndroidRecognitionPackage(true);
        }
      }
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

  try {
    ExpoSpeechRecognitionModule.addListener(
      'volumechange',
      (event: { value?: number }) => {
        const v = typeof event?.value === 'number' ? event.value : NaN;
        if (Number.isFinite(v)) lastVolumeSample = v;
        noteMicVolume(v);
      },
    );
  } catch (err) {
    console.warn('[stt] volumechange listener unavailable:', err);
  }
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
    void (async () => {
    if (!keepAliveHold || stopWaiters.length > 0) {
      restartQueued = false;
      return;
    }
    if (isActive || isStarting) {
      restartQueued = false;
      return;
    }
    try {
      if (lastVolumeSample < 0) {
        await prepareAudioForMicrophone();
      }
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
    })();
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

/**
 * Boot-Prewarm: Permissions (get only) + Audio-Mode + Recognition-Check.
 * Kein Prompt, wenn noch nicht granted.
 */
export async function warmMicrophonePipeline(): Promise<void> {
  if (isMicPipelineReady() && audioModeWarm && permissionsWarmGranted === true) {
    return;
  }
  try {
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    permissionsWarmGranted = !!current.granted;
  } catch {
    permissionsWarmGranted = null;
  }
  try {
    recognitionWarmAvailable =
      ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    recognitionWarmAvailable = null;
  }
  if (permissionsWarmGranted) {
    try {
      await warmAudioModeForMicrophone();
      audioModeWarm = true;
    } catch {
      audioModeWarm = false;
    }
  }
  noteMicPipelineReady();
}

/** Partial-Handler tauschen ohne STT-Neustart (Hold -> Live-Chat Handoff). */
export function setListeningPartialHandler(
  onPartial?: (text: string) => void,
  opts?: { lock?: boolean },
): void {
  partialHandler = onPartial ?? null;
  if (opts?.lock) partialHandlerLocked = true;
}

export function unlockListeningPartialHandler(): void {
  partialHandlerLocked = false;
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

  const granted =
    permissionsWarmGranted === true
      ? true
      : await requestSpeechPermissions();
  permissionsWarmGranted = granted;
  if (!granted) {
    console.warn('[stt] microphone/speech permission denied');
    showPermissionMissingAlert('microphone');
    return { ok: false, reason: 'permission' };
  }

  logRecognitionDiagnostics();

  const available =
    recognitionWarmAvailable === true
      ? true
      : ExpoSpeechRecognitionModule.isRecognitionAvailable();
  recognitionWarmAvailable = available;
  if (!available) {
    console.warn(
      '[stt] recognition unavailable – Google App / Speech Services fehlen oder Package-Visibility',
    );
    showPermissionMissingAlert('speechUnavailable');
    return { ok: false, reason: 'unavailable' };
  }

  try {
    await prepareAudioForMicrophone();
    audioModeWarm = true;
  } catch (err) {
    console.warn('[stt] prepareAudioForMicrophone failed:', err);
  }

  if (!partialHandlerLocked) {
    partialHandler = onPartial ?? null;
  }
  committedTranscript = '';
  currentSegment = '';
  keepAliveHold = options?.keepAlive !== false;
  restartQueued = false;
  restartAttempts = 0;
  holdStartedAtMs = Date.now();
  isStarting = true;
  lastVolumeSample = -99;
  gotPartialThisSegment = false;
  quietNoSpeechTries = 0;
  // Frischen Service wählen (nicht as/System-Intelligence)
  androidServicePackage = null;
  androidServiceIndex = 0;
  pickAndroidRecognitionPackage(false);
  scheduleMaxHoldCap();

  setMicVadEnabled(true);
  resetMicVad();
  armMicVadWarmup(450);

  try {
    startNativeRecognition();
    return { ok: true };
  } catch (err) {
    console.warn('[stt] start failed:', err);
    isStarting = false;
    isActive = false;
    keepAliveHold = false;
    setMicVadEnabled(false);
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
  partialHandlerLocked = false;

  if (!isActive && !isStarting) {
    const text = partialSnapshot;
    committedTranscript = '';
    currentSegment = '';
    holdStartedAtMs = 0;
    setMicVadEnabled(false);
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
  setMicVadEnabled(false);
  void restoreAmbientAudioAfterSpeech();
  return text;
}

export function isCurrentlyListening(): boolean {
  return isActive || isStarting || keepAliveHold;
}

/** Native Erkennung läuft wirklich — keepAlive-Hold zählt nicht. */
export function isSttRecognitionLive(): boolean {
  return isActive || isStarting;
}

/**
 * Letzter volumechange-Rohwert (-2..10) von expo-speech-recognition.
 * null wenn noch kein Sample seit Start.
 */
export function getLastMicVolume(): number | null {
  if (lastVolumeSample <= -90) return null;
  return lastVolumeSample;
}

/**
 * Normalisierter Mic-Pegel 0..1 fuer UI-Ausschlaege (Listening-Bars).
 * Quelle: STT volumechange (-2 still .. 10 laut).
 */
export function getLastMicLevel(): number {
  const raw = getLastMicVolume();
  if (raw == null) return 0;
  const clamped = Math.min(10, Math.max(-2, raw));
  const linear = (clamped + 2) / 12;
  return Math.min(1, Math.max(0, Math.pow(linear, 0.85)));
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
  partialHandlerLocked = false;
  setMicVadEnabled(false);
  resolveStopWaiters('');
  void restoreAmbientAudioAfterSpeech();
}
