/**
 * AudioVoiceService — Cartesia sonic-3.5 (primär) + expo-speech Fallback.
 * Priority-Queue: question > nav > system > explore.
 * Navi unterbricht Explore und setzt danach fort; Fragen preempten alles.
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  getVoice,
  FIXED_SPEECH_RATE,
  VOICES,
  pitchForVoice,
} from '../constants/voices';
import {
  VOICE_SAMPLE_MODULES,
  INTRO_WAV_MODULE,
} from '../constants/voiceSampleAssets';
import type { VoiceId } from '../types/userProfile';
import {
  bootstrapSpeechDeliveryPolicy,
  registerSpeechFlushHandler,
  requestSpeechDelivery,
  type SpeechDeliveryKind,
} from './speech/speechDeliveryPolicy';
import {
  getCachedUserProfile,
  getVoiceSettingsForTour,
} from './userProfileService';
import {
  sentenceEndPauseMs,
  COMMA_PAUSE_MS,
  COLON_PAUSE_MS,
  DASH_PAUSE_MS,
  stripLlmProsodyMarkers,
} from './g2p/germanTtsProsodyRules';
import { stripSpellTrapsAndMarkdownJunk } from './g2p/phoneticTransformer';
import { sentencesFromFullText } from './ai/sentenceStream';
import { scrubInventedVoiceNames } from './ai/spokenNameGuard';
import {
  clearSpeechJobQueue,
  enqueueSpeechJob,
  getCurrentSpeechPriority,
  isSoftAbortRequested,
  isSpeechJobQueueBusy,
  softAbortCurrentSpeechJob,
  type SpeechPriority,
} from './ai/speechJobQueue';
import {
  flushStreamingAudioQueue,
  playStreamingAudioQueue,
} from './audio/streamingAudioQueueService';
import { streamingChunksFromTextStream } from './audio/punctuationChunker';
import { TTS_UNAVAILABLE_MSG } from './ttsPolicy';
import {
  hasCartesiaTtsKey,
  synthesizeCartesiaSpeechWav,
  deleteCartesiaTempAudio,
  type CartesiaGenerationConfig,
} from './cartesiaTtsService';
import { createIntroEmotionResolver } from './tts/introEmotionArc';
import { createLiveEmotionResolver } from './persona/cartesiaEmotionResolver';
import {
  navTrackingAudioCueResult,
  recordFindusSpeechExact,
} from './feedback/executionTracking';
import {
  speakWithExpoSpeech,
  stopExpoSpeech,
} from './expoSpeechFallback';
import {
  createLiveSubtitleFeed,
  mergeSubtitleCarry,
  runEstimatedLiveSubtitles,
} from '../utils/subtitleWholeWords';
import type { TtsProvider } from '../store/useFinnusStore';
import { scrubSpeechForTts } from './agi/speechGuardrails';

export type { SpeechPriority };

type VoiceModelId = string;
function resolveVoiceModelId(_voiceId?: VoiceId | null): VoiceModelId {
  return 'cartesia';
}
function getVoiceModelMeta(_id: VoiceModelId): { lengthScale?: number } {
  return { lengthScale: 1.05 };
}
function engineReady(): boolean {
  return true;
}
function engineLoading(): boolean {
  return false;
}
async function synthesizeLocalPcm(
  _text: string,
  _opts?: { voiceId?: VoiceId; lengthScale?: number },
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  return { pcm: new Float32Array(0), sampleRate: 22050 };
}
async function engineEnsureModel(_modelId: VoiceModelId): Promise<void> {}
function unloadVoiceModel(_modelId: VoiceModelId): void {}
function engineUnloadInactive(_keep: VoiceModelId): void {}
function resetLocalTtsEngine(): void {}
function getActiveVoiceModelId(): VoiceModelId | null {
  return null;
}

export type SpeakVoiceOptions = {
  speechRate?: number;
  voiceId?: VoiceId;
  pitch?: number;
  /** Cartesia generation_config für alle Chunks. */
  generationConfig?: CartesiaGenerationConfig;
  /** Pro Chunk — z. B. Intro nervös→fröhlich. */
  resolveGenerationConfig?: (
    text: string,
    index: number,
  ) => CartesiaGenerationConfig | undefined;
};

export const INTRO_VOICE: SpeakVoiceOptions = {
  voiceId: 'sebastian',
  speechRate: FIXED_SPEECH_RATE,
  pitch: 1,
};

/** @deprecated */
export const MARTIN_PURE = INTRO_VOICE;

const AUDIO_QUEUE_LOOKAHEAD = 1;
const VOICE_SYSTEM_VERSION = 'de-hybrid-v5-personal-4thwall';
const AUDIO_CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}tts-audio/`;
const SAMPLE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}tts/samples/`;
const SAMPLE_CACHE_VER = 'v5-personal-historiker';
const SYSTEM_VERSION_PATH = `${FileSystem.documentDirectory}tts/system.version`;

const sampleReadyKeys = new Set<string>();
let samplePrefetchPromise: Promise<void> | null = null;
let prepareOnboardingPromise: Promise<void> | null = null;
let prepareOnboardingKey: string | null = null;

let sound: Audio.Sound | null = null;
/** Story sound parked while a nav cue plays (Masterbook audio multitasking). */
let suspendedSound: Audio.Sound | null = null;
let warmedUp = false;
let warmupPromise: Promise<void> | null = null;
let playbackGeneration = 0;
let activeTtsSessions = 0;
/** True while a Sound / expo-speech is actually outputting audio. */
let audiblePlaybackActive = false;
/** True while a nav-only cue is playing (not Findus Q&A / story). */
let navCueExclusiveActive = false;
/** Latest turn cue waiting until Findus finishes speaking (questions only). */
let pendingNavCue: {
  text: string;
  voiceOptions?: SpeakVoiceOptions;
} | null = null;

/** Explore (Modul 1) bookmark for resume after nav interrupt. */
let explorePlaybackBookmark: {
  sentences: string[];
  nextIndex: number;
  voiceOptions?: SpeakVoiceOptions;
} | null = null;

function isQuestionsBusyForNav(): boolean {
  const store = useFinnusStore.getState();
  if (store.isGenerating || store.isListening) return true;
  try {
    const { getRuntimeContext } = require('../runtime/orchestrator') as {
      getRuntimeContext: () => { module: string };
    };
    if (getRuntimeContext().module === 'questions') return true;
  } catch {
    /* ignore */
  }
  if (getCurrentSpeechPriority() === 'question') return true;
  return false;
}

function isExploreSpeechActive(): boolean {
  if (getCurrentSpeechPriority() === 'explore') return true;
  try {
    const { getRuntimeContext } = require('../runtime/orchestrator') as {
      getRuntimeContext: () => { module: string };
    };
    const mod = getRuntimeContext().module;
    if (
      (mod === 'explore' || mod === 'idle') &&
      useFinnusStore.getState().isPlayingAudio &&
      !navCueExclusiveActive
    ) {
      // Playing audio while not in questions ≈ explore/system story
      if (mod === 'explore') return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

type ExploreResumeBookmark = {
  sentences: string[];
  nextIndex: number;
  voiceOptions?: SpeakVoiceOptions;
};

/**
 * Navi unterbricht Explore: Playback stoppen, Rest merken.
 * Resume erst NACH dem Nav-Cue enqueuen — sonst überlappen zwei Stimmen.
 */
async function softInterruptExploreForNav(): Promise<ExploreResumeBookmark | null> {
  softAbortCurrentSpeechJob();
  await stopExpoSpeech();
  await flushStreamingAudioQueue();
  await haltCurrentPlayback();
  markAudiblePlayback(false);
  useFinnusStore.getState().setIsPlayingAudio(false);
  useFinnusStore.getState().setIsAudiblySpeaking(false);
  // speakChunkSource setzt Bookmark beim Soft-Abort — kurz warten
  await new Promise((r) => setTimeout(r, 30));
  const bookmark = explorePlaybackBookmark
    ? { ...explorePlaybackBookmark }
    : null;
  explorePlaybackBookmark = null;
  return bookmark && bookmark.nextIndex < bookmark.sentences.length
    ? bookmark
    : null;
}

function enqueueExploreResume(bookmark: ExploreResumeBookmark): void {
  const remaining = bookmark.sentences.slice(bookmark.nextIndex);
  if (remaining.length === 0) return;
  const voice = bookmark.voiceOptions;
  void enqueueSpeechJob(
    async () => {
      await speakChunkSource(remaining, voice, 'explore');
    },
    { priority: 'explore' },
  );
}

/** Irgendeine Findus-Stimme ist hörbar — für Nav-Defer (nicht Queue-Drain). */
function isAnySpeechBusy(): boolean {
  if (navCueExclusiveActive) return true;
  if (isAudiblyPlaying()) return true;
  if (activeTtsSessions > 0) return true;
  const store = useFinnusStore.getState();
  if (store.isAudiblySpeaking) return true;
  // isPlayingAudio allein reicht nicht — kann nach Interrupt kleben
  return false;
}

function maybeNotifyRuntimeSpeechEnded(gen: number): void {
  if (activeTtsSessions !== 0) return;
  // Auch nach Generation-Bump benachrichtigen — sonst bleibt Modul-1-UI auf „Ich erzähle“.
  void import('../runtime/runtimeSync').then((m) => m.notifyRuntimeSpeechEnded());
  void gen;
}

/** True while any TTS session (story / nav cue / sample) is in flight. */
export function getActiveTtsSessionCount(): number {
  return activeTtsSessions;
}

/** True while audio is actually playing (not just synthesizing). */
export function isAudiblyPlaying(): boolean {
  return audiblePlaybackActive;
}

/** Stall-Tracker für Zombie-Playback (isPlaying=true, Position steht). */
let hwProbeLastPos = -1;
let hwProbeStalledSince: number | null = null;

/**
 * Prüft den echten expo-av Sound — nicht nur das Modul-Flag.
 * Android kann didJustFinish verschlucken; UI darf dann nicht auf „redet“ kleben.
 */
export async function probeHardwareAudible(): Promise<boolean> {
  const s = sound ?? suspendedSound;
  if (!s) {
    hwProbeLastPos = -1;
    hwProbeStalledSince = null;
    return false;
  }
  try {
    const status = await s.getStatusAsync();
    if (!status.isLoaded) {
      hwProbeLastPos = -1;
      hwProbeStalledSince = null;
      return false;
    }
    if (!status.isPlaying) {
      hwProbeLastPos = -1;
      hwProbeStalledSince = null;
      return false;
    }
    const dur = status.durationMillis ?? 0;
    const pos = status.positionMillis ?? 0;
    // Am Dateiende oft noch kurz isPlaying=true — zählt als stumm
    if (dur > 0 && pos >= Math.max(0, dur - 80)) {
      hwProbeLastPos = -1;
      hwProbeStalledSince = null;
      return false;
    }
    if (pos === hwProbeLastPos) {
      if (hwProbeStalledSince == null) hwProbeStalledSince = Date.now();
      else if (Date.now() - hwProbeStalledSince >= 1500) {
        return false;
      }
    } else {
      hwProbeLastPos = pos;
      hwProbeStalledSince = null;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * SSOT-Standby: wenn kein echtes Audio läuft → Kreis idle.
 * Idempotent, sicher aus Watchdog / finally aufrufbar.
 */
export async function reconcileSpeakingStandby(): Promise<{
  cleared: boolean;
  reason: string | null;
}> {
  const store = useFinnusStore.getState();
  const sessions = activeTtsSessions;
  const queueBusy = (() => {
    try {
      const { isSpeechJobQueueBusy } = require('./ai/speechJobQueue') as {
        isSpeechJobQueueBusy: () => boolean;
      };
      return isSpeechJobQueueBusy();
    } catch {
      return false;
    }
  })();
  const streamBusy = (() => {
    try {
      const { isStreamingAudioQueueBusy } = require('./audio/streamingAudioQueueService') as {
        isStreamingAudioQueueBusy: () => boolean;
      };
      return isStreamingAudioQueueBusy();
    } catch {
      return false;
    }
  })();
  const hw = await probeHardwareAudible();

  // Echtes Audio → nichts räumen
  if (hw) {
    if (!store.isAudiblySpeaking) markAudiblePlayback(true);
    return { cleared: false, reason: null };
  }

  let cleared = false;
  let reason: string | null = null;

  // Kein Hardware-Audio → UI darf nicht „Ich erzähle“ zeigen
  if (store.isAudiblySpeaking || audiblePlaybackActive) {
    markAudiblePlayback(false);
    cleared = true;
    reason = 'no_hardware_audio';
  }

  // Keine Session, keine Queue, kein Stream → kompletter Standby
  if (sessions === 0 && !queueBusy && !streamBusy) {
    if (store.isPlayingAudio || store.isAudiblySpeaking) {
      store.setIsPlayingAudio(false);
      store.setIsAudiblySpeaking(false);
      cleared = true;
      reason = reason ?? 'session_idle';
    }
  }

  return { cleared, reason };
}

/**
 * UI-Standby-Sync: Kreis nur bei echtem Sound.
 * isPlayingAudio (Session) bleibt davon getrennt.
 * Immer Store syncen — auch wenn Modul-Flag schon passt (Desync-Fix).
 */
export function markAudiblePlayback(active: boolean): void {
  audiblePlaybackActive = active;
  const store = useFinnusStore.getState();
  if (store.isAudiblySpeaking !== active) {
    store.setIsAudiblySpeaking(active);
  }
}

/**
 * UI → Standby, wenn keine TTS-Session mehr läuft.
 * Aufrufer: finally-Blöcke + HomeScreen-Watchdog.
 */
export function releaseSpeakingUiIfIdle(): boolean {
  if (activeTtsSessions > 0) return false;
  markAudiblePlayback(false);
  const store = useFinnusStore.getState();
  if (!store.isPlayingAudio && !store.isAudiblySpeaking) {
    return false;
  }
  store.setIsPlayingAudio(false);
  store.setIsAudiblySpeaking(false);
  maybeNotifyRuntimeSpeechEnded(playbackGeneration);
  return true;
}

/**
 * Hard-Standby: hängendes „Ich erzähle“ / Session-Counter resetten.
 * Nur Watchdog / User-Interrupt — nicht mitten in aktivem Speech.
 * isAudiblySpeaking wird immer über markAudiblePlayback(false) geleert.
 */
export function forceClearSpeakingUi(): void {
  activeTtsSessions = 0;
  markAudiblePlayback(false);
  const store = useFinnusStore.getState();
  store.setIsPlayingAudio(false);
  store.setSubtitleText(null);
  void import('../runtime/runtimeSync').then((m) => m.notifyRuntimeSpeechEnded());
}
let restoreEpoch = 0;
const tempAudioUris = new Set<string>();

/**
 * Android: DoNotMix → AUDIOFOCUS_GAIN (pauses Spotify).
 * DuckOthers only ducks and would not pause — wrong for “pause while Findus talks”.
 * Resume needs an explicit focus abandon (setIsEnabledAsync false→true); MixWithOthers
 * does not exist on InterruptionModeAndroid (only DoNotMix | DuckOthers).
 */
async function applyTtsExclusiveAudioMode(): Promise<void> {
  restoreEpoch += 1;
  // Finish any in-flight restore so audio is re-enabled before we take focus again
  if (restoreAmbientPromise) {
    await restoreAmbientPromise.catch(() => undefined);
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  });
}

let restoreAmbientPromise: Promise<void> | null = null;

const AMBIENT_AUDIO_MODE = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  shouldDuckAndroid: false,
  // Android idle: DuckOthers is the only non-DoNotMix value (no MixWithOthers enum).
  interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
} as const;

/**
 * Musik/Spotify wieder freigeben, wenn Findus fertig spricht.
 * Sound-Unload gibt Focus oft schon ab; setIsEnabledAsync(false) erzwingt
 * abandonAudioFocus auf Android, falls die Session noch hängt.
 */
async function restoreAmbientAudioMode(): Promise<void> {
  if (activeTtsSessions > 0) return;
  if (restoreAmbientPromise) return restoreAmbientPromise;

  const epoch = restoreEpoch;

  restoreAmbientPromise = (async () => {
    const aborted = () =>
      activeTtsSessions > 0 || epoch !== restoreEpoch;

    try {
      if (aborted()) return;

      await Audio.setAudioModeAsync({ ...AMBIENT_AUDIO_MODE });

      if (aborted()) return;

      // Focus freigeben — Spotify & Co. können fortsetzen
      await Audio.setIsEnabledAsync(false);
      await new Promise((r) => setTimeout(r, 100));
      // Immer wieder aktivieren, sonst schlägt nächstes TTS fehl
      await Audio.setIsEnabledAsync(true);

      if (aborted()) return;

      await Audio.setAudioModeAsync({ ...AMBIENT_AUDIO_MODE });
      if (__DEV__) {
        console.log('[voice] ambient audio restored (Spotify darf weiter)');
      }
    } catch (err) {
      console.warn('[voice] restoreAmbientAudioMode failed:', err);
      try {
        await Audio.setIsEnabledAsync(true);
      } catch {
        /* ignore */
      }
    } finally {
      restoreAmbientPromise = null;
    }
  })();

  return restoreAmbientPromise;
}

/** Für STT / andere Caller: Ambient-Modus nach Mikrofon-Nutzung. */
export async function restoreAmbientAudioAfterSpeech(): Promise<void> {
  if (activeTtsSessions > 0) return;
  await restoreAmbientAudioMode();
}

/** Stoppt aktuelles Sound-Objekt und invalidiert die Playback-Generation (ohne Restore). */
async function haltCurrentPlayback(): Promise<number> {
  playbackGeneration += 1;
  await flushStreamingAudioQueue();
  if (suspendedSound) {
    try {
      await suspendedSound.stopAsync();
      await suspendedSound.unloadAsync();
    } catch {
      /* ignore */
    }
    suspendedSound = null;
  }
  if (sound) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    sound = null;
  }
  return playbackGeneration;
}

/**
 * Pause laufende Story für Navi-Zwischenruf — ohne Generation-Bump.
 * @returns true wenn etwas pausiert wurde.
 */
export async function pauseSpeakingForNav(): Promise<boolean> {
  if (suspendedSound) return true;
  if (!sound) return false;
  try {
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return false;
    if (status.isPlaying) {
      await sound.pauseAsync();
    }
    markAudiblePlayback(false);
    suspendedSound = sound;
    sound = null;
    return true;
  } catch {
    return false;
  }
}

/** Story nach Navi-Cue fortsetzen (Legacy — Queue-Pfad braucht das nicht mehr). */
export async function resumeSpeakingAfterNav(): Promise<void> {
  if (!suspendedSound) return;
  if (sound) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      /* ignore */
    }
    sound = null;
  }
  sound = suspendedSound;
  suspendedSound = null;
  activeTtsSessions += 1;
  try {
    useFinnusStore.getState().setIsPlayingAudio(true);
    markAudiblePlayback(true);
    await sound.playAsync();
    // Wait until finished
    await new Promise<void>((resolve) => {
      const s = sound;
      if (!s) {
        resolve();
        return;
      }
      s.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) resolve();
      });
    });
  } catch (err) {
    console.warn('[voice] resume after nav failed:', err);
    try {
      await sound.unloadAsync();
    } catch {
      /* ignore */
    }
    sound = null;
  } finally {
    markAudiblePlayback(false);
    activeTtsSessions = Math.max(0, activeTtsSessions - 1);
    if (activeTtsSessions === 0) {
      useFinnusStore.getState().setIsPlayingAudio(false);
      useFinnusStore.getState().setIsAudiblySpeaking(false);
      await restoreAmbientAudioMode();
      maybeNotifyRuntimeSpeechEnded(playbackGeneration);
    }
  }
}

/** Soft-Pause verwerfen (Mic-Hold wurde echt — kein Resume). */
export async function discardPausedSpeaking(): Promise<void> {
  if (!suspendedSound) {
    return;
  }
  try {
    await suspendedSound.stopAsync();
  } catch {
    /* ignore */
  }
  try {
    await suspendedSound.unloadAsync();
  } catch {
    /* ignore */
  }
  suspendedSound = null;
}


/** Findus spricht Fragen / denkt / hört — Navi muss warten (nicht Explore). */
export function isFindusSpeechBusyForNav(): boolean {
  if (navCueExclusiveActive) return false;
  return isQuestionsBusyForNav();
}

export function enqueueNavSpeechCue(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Keep latest turn — older micro-cues are obsolete
  pendingNavCue = { text: trimmed, voiceOptions };
  if (__DEV__) {
    console.log('[nav-queue] queued cue (questions busy):', trimmed.slice(0, 60));
  }
}

function withUbrigensPrefix(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (/^\s*übrigens\b/iu.test(t) || /^\s*uebrigens\b/iu.test(t)) return t;
  if (/^\s*kurz\s+fürs\s+navi\b/iu.test(t)) {
    return t.replace(/^\s*kurz\s+fürs\s+navi\s*[:\-–—]?\s*/iu, 'übrigens, ');
  }
  const body = t.charAt(0).toLowerCase() + t.slice(1);
  return `übrigens, ${body}`;
}

/**
 * After questions finished — play queued turn cue once.
 * @param afterSpeechEnd skip isPlayingAudio (just ended; flag may still be true briefly)
 */
export async function flushQueuedNavSpeechCue(opts?: {
  afterSpeechEnd?: boolean;
}): Promise<boolean> {
  if (!pendingNavCue) return false;
  const store = useFinnusStore.getState();
  if (store.isGenerating || store.isListening) return false;
  if (!opts?.afterSpeechEnd && isQuestionsBusyForNav()) return false;
  const next = pendingNavCue;
  pendingNavCue = null;
  const line = withUbrigensPrefix(next.text);
  try {
    await enqueueSpeechJob(
      async () => {
        await speakNavCueBody(line, next.voiceOptions);
      },
      { priority: 'nav' },
    );
    return true;
  } catch (err) {
    console.warn('[nav-queue] flush failed:', err);
    return false;
  }
}

/**
 * Navi-Cue-Priorität:
 * - Andere Stimme aktiv (Fragen/System/…) → hinten anstellen, nie überlappen
 * - Explore aktiv → unterbrechen, Cue in der Speech-Queue, Explore-Rest danach
 * - Idle → Cue über dieselbe globale Queue
 */
export async function speakNavWithMultitask(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const exploreActive =
    isExploreSpeechActive() || getCurrentSpeechPriority() === 'explore';

  // Nie parallel zu laufender Nicht-Explore-Stimme — Cue wartet
  if (!exploreActive && (isQuestionsBusyForNav() || isAnySpeechBusy())) {
    enqueueNavSpeechCue(trimmed, voiceOptions);
    return;
  }

  let exploreResume: ExploreResumeBookmark | null = null;
  if (exploreActive) {
    exploreResume = await softInterruptExploreForNav();
  }

  try {
    await enqueueSpeechJob(
      async () => {
        await speakNavCueBody(trimmed, voiceOptions);
      },
      { priority: 'nav' },
    );
  } catch (err) {
    if (!(err instanceof Error && err.message === 'speech_interrupted')) {
      console.warn('[nav] cue job failed:', err);
    }
  }

  if (exploreResume) {
    enqueueExploreResume(exploreResume);
  }
}

/** Nav-Cue-Körper — nur aus der globalen Speech-Job-Queue aufrufen. */
async function speakNavCueBody(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  const display = prepareDisplayText(text);
  if (!display) return;

  const maySpeak = await requestSpeechDelivery({
    text: display,
    voiceOptions,
    kind: 'nav',
  });
  if (!maySpeak) return;

  let effective = voiceOptions;
  if (!effective?.voiceId || effective.speechRate == null) {
    try {
      const tour = await getVoiceSettingsForTour();
      effective = {
        ...voiceOptions,
        voiceId: voiceOptions?.voiceId ?? tour.voiceId,
        speechRate: voiceOptions?.speechRate ?? tour.speechRate,
      };
    } catch {
      effective = voiceOptions;
    }
  }

  // Harte Exklusivität: Streaming/Expo vor Nav-Clip killen
  await stopExpoSpeech();
  await flushStreamingAudioQueue();

  const store = useFinnusStore.getState();
  store.setSubtitleText(display);
  navCueExclusiveActive = true;
  activeTtsSessions += 1;
  let uri: string | null = null;
  let cueOk = false;
  let cueErrHint: string | undefined;
  try {
    await applyTtsExclusiveAudioMode();
    const forceSystem = resolveActiveTtsProvider() === 'system';
    if (!forceSystem && hasCartesiaTtsKey()) {
      const audioText = prepareAudioText(display);
      recordFindusSpeechExact(audioText, Date.now());
      uri = await synthesizeCartesiaSpeechWav(audioText, effective?.voiceId);
    } else {
      recordFindusSpeechExact(display, Date.now());
      await speakWithExpoSpeech(display, { language: 'de-DE' });
      cueOk = true;
      return;
    }
    if (uri) {
      await playWav(uri, {
        clearPlayingOnEnd: false,
        playbackRate: 1,
        deleteAfter: true,
      });
      cueOk = true;
    } else {
      cueErrHint = 'cartesia_uri_null';
    }
  } catch (err) {
    console.warn('[voice] nav cue Cartesia failed → expo-speech:', err);
    try {
      const { fallbackSpeech } = await import('./debug/fallbackLabel');
      const fb = fallbackSpeech('Nav-Cue-Systemstimme', display.slice(0, 200));
      recordFindusSpeechExact(fb, Date.now());
      await speakWithExpoSpeech(fb, { language: 'de-DE' });
      cueOk = true;
    } catch (err2) {
      console.warn('[voice] nav cue failed:', err2);
      cueOk = false;
      cueErrHint = err2 instanceof Error ? err2.message : String(err2);
    }
  } finally {
    activeTtsSessions = Math.max(0, activeTtsSessions - 1);
    if (activeTtsSessions === 0 && !suspendedSound) {
      useFinnusStore.getState().setIsPlayingAudio(false);
      await restoreAmbientAudioMode();
      maybeNotifyRuntimeSpeechEnded(playbackGeneration);
    }
    navCueExclusiveActive = false;
    if (uri) void deleteCartesiaTempAudio(uri);
    try {
      const { noteFindusOwnSpeechEnded } = require('./navigation/modulePriorityPolicy') as {
        noteFindusOwnSpeechEnded: (at?: number) => void;
      };
      noteFindusOwnSpeechEnded();
    } catch {
      /* ignore */
    }
    navTrackingAudioCueResult({
      ok: cueOk,
      errorHint: cueOk ? undefined : cueErrHint ?? 'nav_cue_failed',
      atMs: Date.now(),
    });
  }
}

/**
 * Hybrid offline: vorgefertigte Cartesia-WAV abspielen (Datei bleibt beim Prefetch).
 * false = nicht abspielbar → Caller fällt auf Live-TTS / expo-speech zurück.
 */
export async function playCachedNavCueWav(
  uri: string,
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<boolean> {
  const display = prepareDisplayText(text);
  if (!display || !uri) return false;

  const maySpeak = await requestSpeechDelivery({
    text: display,
    voiceOptions,
    kind: 'nav',
  });
  if (!maySpeak) return false;

  await stopExpoSpeech();
  await flushStreamingAudioQueue();

  const store = useFinnusStore.getState();
  store.setSubtitleText(display);
  navCueExclusiveActive = true;
  activeTtsSessions += 1;
  let cueOk = false;
  try {
    await applyTtsExclusiveAudioMode();
    recordFindusSpeechExact(display, Date.now());
    await playWav(uri, {
      clearPlayingOnEnd: false,
      playbackRate: 1,
      deleteAfter: false,
    });
    cueOk = true;
    return true;
  } catch (err) {
    console.warn('[voice] cached nav cue play failed:', err);
    return false;
  } finally {
    activeTtsSessions = Math.max(0, activeTtsSessions - 1);
    if (activeTtsSessions === 0 && !suspendedSound) {
      useFinnusStore.getState().setIsPlayingAudio(false);
      await restoreAmbientAudioMode();
      maybeNotifyRuntimeSpeechEnded(playbackGeneration);
    }
    navCueExclusiveActive = false;
    try {
      const { noteFindusOwnSpeechEnded } = require('./navigation/modulePriorityPolicy') as {
        noteFindusOwnSpeechEnded: (at?: number) => void;
      };
      noteFindusOwnSpeechEnded();
    } catch {
      /* ignore */
    }
    navTrackingAudioCueResult({
      ok: cueOk,
      errorHint: cueOk ? undefined : 'cached_nav_cue_failed',
      atMs: Date.now(),
    });
  }
}

type ActiveVoiceWarmer = (voiceId?: VoiceId) => Promise<void>;
let activeVoiceWarmer: ActiveVoiceWarmer | null = null;
let activeVoiceReset: (() => void) | null = null;

export function registerActiveVoiceWarmer(
  warm: ActiveVoiceWarmer,
  reset?: () => void,
): void {
  activeVoiceWarmer = warm;
  activeVoiceReset = reset ?? null;
}

async function warmActiveVoiceInternal(voiceId?: VoiceId): Promise<void> {
  if (activeVoiceWarmer) {
    await activeVoiceWarmer(voiceId);
    return;
  }
  // Cartesia braucht kein lokales Warmup — nur Ready-Flag setzen
  useFinnusStore.getState().setTtsReady(true);
  useFinnusStore.getState().setTtsStatusMessage(null);
  markTtsWarmedUp();
}

function sampleCacheKey(voiceId: VoiceId): string {
  return `${SAMPLE_CACHE_VER}_${voiceId}@${Math.round(FIXED_SPEECH_RATE * 100)}`;
}

function markMetroBundledSamplesReady(): void {
  for (const voice of VOICES) {
    sampleReadyKeys.add(sampleCacheKey(voice.id));
  }
}
markMetroBundledSamplesReady();

async function resolveBundledAssetUri(
  moduleId: number,
): Promise<string | null> {
  try {
    const asset = Asset.fromModule(moduleId);
    if (!asset.downloaded) await asset.downloadAsync();
    return asset.localUri ?? asset.uri ?? null;
  } catch (err) {
    console.warn('[voice] Asset-URI:', err);
    return null;
  }
}

function markUnavailable(_engine: 'cartesia' | 'system' | 'any' = 'any'): void {
  useFinnusStore.getState().setTtsStatusMessage(TTS_UNAVAILABLE_MSG);
  useFinnusStore.getState().setTtsReady(false);
}

function isModelUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /onnxruntime|Phonemize|Modell fehlt|Pack fehlt/i.test(
    msg,
  );
}

/**
 * Untertitel / Anzeige: Originalorthografie.
 * Keine Aussprache-Umschreibungen (vibe bleibt vibe, guide bleibt guide).
 * Nur Whitespace + LLM-Regie-Marker entfernen.
 */
export function prepareDisplayText(text: string): string {
  return stripLlmProsodyMarkers(
    text
      .replace(/\s+/g, ' ')
      .replace(/\u00a0/g, ' ')
      // Cartesia-/IPA-Leaks nie in Untertiteln
      .replace(/<<[^>]*>>/g, ' ')
      .replace(/⟦[^⟧]*⟧/g, ' ')
      .replace(/\[[ˈˌ][^\]\n]{0,80}\]/g, ' ')
      // Leere Klammern aus Truncation / LLM-Müll (z. B. „klassischer ()“)
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/\bWegweiser\b/gi, '') // MASTERBOOK V5: Wort „Wegweiser“ nie aussprechen.
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}

/**
 * Aussprache-Hilfe aus — native DE-Cartesia (Alina/Sebastian) braucht
 * keinen Ortho-/IPA-Pfad. Text unverändert lassen.
 */
export function applyVoicePronunciation(text: string): string {
  return text.normalize('NFKC').trim();
}

/**
 * Audio für TTS — Hard-Reboot:
 * Nur Scrub (URLs/Markdown/Regie). Kein IPA, kein EN-Ortho, kein Lexikon-Hack.
 * Alina/Sebastian lesen normales Deutsch mit language: de.
 */
export function prepareAudioText(text: string): string {
  let t = prepareDisplayText(text);
  if (!t) return '';
  t = scrubSpeechForTts(t, {
    urlsAndEmailsOnly: true,
    maxChars: 16_000,
  }).text;
  if (!t) return '';
  t = stripSpellTrapsAndMarkdownJunk(t);
  t = t.replace(/[·•]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** @deprecated Alias */
export function applyPronunciationFixes(text: string): string {
  return prepareAudioText(text);
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function pcmToWavBytes(
  pcm: Float32Array,
  sampleRate: number,
): Uint8Array {
  const samples = floatTo16BitPCM(pcm);
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const bytes = new Uint8Array(buffer);
  bytes.set(new Uint8Array(samples.buffer), 44);
  return bytes;
}

async function ensureAudioCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_CACHE_DIR, { intermediates: true });
  }
}

async function writeWavBytesToTemp(wavBytes: Uint8Array): Promise<string> {
  await ensureAudioCacheDir();
  const uri = `${AUDIO_CACHE_DIR}t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`;
  // expo-file-system expects base64 for binary
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < wavBytes.length; i += chunk) {
    binary += String.fromCharCode(...wavBytes.subarray(i, i + chunk));
  }
  const base64 = globalThis.btoa(binary);
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  tempAudioUris.add(uri);
  return uri;
}

async function writeTempWav(
  pcm: Float32Array,
  sampleRate: number,
): Promise<string> {
  return writeWavBytesToTemp(pcmToWavBytes(pcm, sampleRate));
}

async function cleanupTempAudio(uris?: string[]): Promise<void> {
  const list = uris ?? [...tempAudioUris];
  for (const uri of list) {
    tempAudioUris.delete(uri);
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // ignore
    }
  }
}

function appendSilence(
  pcm: Float32Array,
  sampleRate: number,
  ms: number,
): Float32Array {
  const n = Math.round((sampleRate * ms) / 1000);
  if (n <= 0) return pcm;
  const out = new Float32Array(pcm.length + n);
  out.set(pcm, 0);
  return out;
}

function concatPcmParts(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Einfacher Pitch-Shift (Resample): >1 = höher/jünger.
 * Tempo wird etwas knackiger — passt zu Gen-Z.
 */
function applyPcmPitch(pcm: Float32Array, pitch: number): Float32Array {
  if (!Number.isFinite(pitch) || Math.abs(pitch - 1) < 0.02) return pcm;
  const factor = Math.max(0.85, Math.min(1.35, pitch));
  const outLen = Math.max(1, Math.floor(pcm.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * factor;
    const i0 = Math.floor(src);
    const f = src - i0;
    const a = pcm[i0] ?? 0;
    const b = pcm[Math.min(i0 + 1, pcm.length - 1)] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** Klauseln an Komma / Doppelpunkt / Gedankenstrich — inkl. Pause-Länge danach. */
function splitClausesForProsody(
  text: string,
): Array<{ clause: string; pauseAfterMs: number }> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const segments: Array<{ clause: string; pauseAfterMs: number }> = [];
  let buf = '';

  const flush = (pauseAfterMs: number) => {
    const clause = buf.replace(/\s+/g, ' ').trim();
    if (clause) segments.push({ clause, pauseAfterMs });
    buf = '';
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1] ?? '';

    if (ch === ':' ) {
      buf += ch;
      flush(COLON_PAUSE_MS);
      while (clean[i + 1] === ' ') i += 1;
      continue;
    }

    if (ch === '–' || ch === '—') {
      buf += ch;
      flush(DASH_PAUSE_MS);
      while (clean[i + 1] === ' ') i += 1;
      continue;
    }

    // ASCII " - " als Gedankenstrich (bereits normalisiert zu –, Fallback)
    if (ch === '-' && /\s/.test(buf.slice(-1)) && (next === ' ' || next === '')) {
      buf = buf.trimEnd() + ' –';
      flush(DASH_PAUSE_MS);
      while (clean[i + 1] === ' ') i += 1;
      continue;
    }

    if (ch === ',') {
      buf += ch;
      // Keine Komma-Splits unter 40 Zeichen — sonst Name/Floskeln mit Pausen
      if (buf.trim().length >= 40) {
        flush(COMMA_PAUSE_MS);
        while (clean[i + 1] === ' ') i += 1;
      }
      continue;
    }

    buf += ch;
  }

  flush(0);

  if (segments.length === 0) return [{ clause: clean, pauseAfterMs: 0 }];

  // Winzige Fragmente an Nachbarn kleben (außer Pause-Träger :/–)
  const merged: Array<{ clause: string; pauseAfterMs: number }> = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && seg.clause.length < 8 && !/[:–—]$/.test(prev.clause)) {
      prev.clause = `${prev.clause} ${seg.clause}`.replace(/\s+/g, ' ').trim();
      prev.pauseAfterMs = Math.max(prev.pauseAfterMs, seg.pauseAfterMs);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

async function synthesizeCompleteSentencePcm(
  text: string,
  options?: SpeakVoiceOptions,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const audio = prepareAudioText(text);
  if (!audio) return { pcm: new Float32Array(0), sampleRate: 22050 };

  const voiceId = options?.voiceId ?? getCachedUserProfile()?.voiceId;
  const clauses = splitClausesForProsody(audio);
  const parts: Float32Array[] = [];
  let sampleRate = 22050;
  const lengthScale = voiceId
    ? getVoiceModelMeta(resolveVoiceModelId(voiceId)).lengthScale ?? 1.05
    : 1.05;

  for (let i = 0; i < clauses.length; i++) {
    const { clause, pauseAfterMs } = clauses[i];
    if (!clause) continue;
    const syn = await synthesizeLocalPcm(clause, {
      voiceId,
      lengthScale,
    });
    sampleRate = syn.sampleRate;
    parts.push(syn.pcm);
    if (pauseAfterMs > 0 && i < clauses.length - 1) {
      parts.push(
        new Float32Array(Math.round((sampleRate * pauseAfterMs) / 1000)),
      );
    }
  }

  let pcm = concatPcmParts(parts);
  const pitch = options?.pitch ?? pitchForVoice(voiceId);
  pcm = applyPcmPitch(pcm, pitch);
  pcm = appendSilence(
    pcm,
    sampleRate,
    sentenceEndPauseMs(audio, voiceId),
  );
  return { pcm, sampleRate };
}

export async function ensureVoiceModel(
  modelId: VoiceModelId,
): Promise<void> {
  await engineEnsureModel(modelId);
}

/** @deprecated */
export async function ensureVoicePack(
  packId: VoiceModelId,
): Promise<VoiceModelId> {
  await ensureVoiceModel(packId);
  return packId;
}

export async function loadVoiceIntoRam(
  modelId: VoiceModelId,
): Promise<void> {
  await ensureVoiceModel(modelId);
}

export function unloadVoiceFromRam(modelId: VoiceModelId): void {
  unloadVoiceModel(modelId);
}

export function unloadInactiveVoicePacks(keep: VoiceModelId): void {
  unloadInactiveVoiceModels(keep);
}

export function unloadInactiveVoiceModels(keep: VoiceModelId): void {
  engineUnloadInactive(keep);
}

export function isVoicePackInRam(modelId: VoiceModelId): boolean {
  return getActiveVoiceModelId() === modelId && engineReady();
}

export async function ensureMartinOrtSession(): Promise<void> {
  await ensureVoiceModel(resolveVoiceModelId('sebastian'));
}

export function markTtsWarmedUp(): void {
  warmedUp = true;
  useFinnusStore.getState().setTtsReady(true);
  useFinnusStore.getState().setTtsStatusMessage(null);
  useFinnusStore.getState().setTtsDownloadLabel(null);
}





export async function ensureTtsReady(
  onProgress?: (label: string) => void,
): Promise<void> {
  await warmupTtsEngine(onProgress);
}

export function isTtsReady(): boolean {
  return warmedUp && engineReady();
}



export function isTtsLoading(): boolean {
  return engineLoading() || warmupPromise != null;
}



export async function warmupTtsEngine(
  onProgressOrOptions?:
    | ((label: string) => void)
    | { voiceId?: VoiceId },
  maybeOnProgress?: (label: string) => void,
): Promise<void> {
  const onProgress =
    typeof onProgressOrOptions === 'function'
      ? onProgressOrOptions
      : maybeOnProgress;
  const options =
    typeof onProgressOrOptions === 'object' && onProgressOrOptions
      ? onProgressOrOptions
      : undefined;

  const voiceId =
    options?.voiceId ?? getCachedUserProfile()?.voiceId ?? 'alina';

  // Cartesia-only product path — no local TTS/ONNX warmup.
  onProgress?.('Stimme vorbereiten');
  useFinnusStore.getState().setTtsReady(true);
  useFinnusStore.getState().setTtsStatusMessage(null);
  useFinnusStore.getState().setTtsDownloadLabel(null);
  useFinnusStore.getState().setTtsDownloadProgress(null);
  markTtsWarmedUp();
  await warmActiveVoiceInternal(voiceId);
  void prefetchVoiceSamples(voiceId);
}



export async function waitReady(timeoutMs = 60_000): Promise<boolean> {
  // Cartesia braucht kein lokales Modell — sofort bereit (System-Fallback sonst).
  void timeoutMs;
  useFinnusStore.getState().setTtsReady(true);
  markTtsWarmedUp();
  return true;
}

/** Prefetch buffer: synthesize PCM without playing (100 m warm). */
export async function synthesizePrefetchPcm(
  text: string,
  options?: SpeakVoiceOptions,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  return synthesizeCompleteSentencePcm(text, options);
}

/** Instant play of a pre-buffered PCM clip (20 m trigger, ~0 ms synth latency). */
export async function playPrefetchedPcm(
  pcm: Float32Array,
  sampleRate: number,
  displayText: string,
): Promise<void> {
  if (!pcm.length) throw new Error('[prefetch] empty pcm');

  // Fragen haben Vorrang — Teaser nicht darüberlegen
  if (isQuestionsBusyForNav() || getCurrentSpeechPriority() === 'question') {
    return;
  }

  try {
    await enqueueSpeechJob(
      async () => {
        await stopExpoSpeech();
        await flushStreamingAudioQueue();
        const store = useFinnusStore.getState();
        const gen = playbackGeneration;
        activeTtsSessions += 1;
        store.setIsPlayingAudio(true);
        const display = prepareDisplayText(displayText) || displayText.trim();
        const feed = createLiveSubtitleFeed(display, (t) =>
          store.setSubtitleText(t),
        );
        feed.showInitial();
        const durMs = Math.max(
          400,
          Math.round((pcm.length / Math.max(1, sampleRate)) * 1000),
        );
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (gen !== playbackGeneration) return;
          feed.updateProgress(Math.min(1, (Date.now() - t0) / durMs));
        }, 70);
        const temps: string[] = [];
        try {
          await applyTtsExclusiveAudioMode();
          if (gen !== playbackGeneration || isSoftAbortRequested()) return;
          const wavBytes = pcmToWavBytes(pcm, sampleRate);
          const uri = await writeWavBytesToTemp(wavBytes);
          temps.push(uri);
          markAudiblePlayback(true);
          await playWav(uri, {
            clearPlayingOnEnd: false,
            playbackRate: 1,
            deleteAfter: false,
          });
        } finally {
          clearInterval(iv);
          feed.showFinal();
          markAudiblePlayback(false);
          activeTtsSessions = Math.max(0, activeTtsSessions - 1);
          if (activeTtsSessions === 0) {
            store.setIsPlayingAudio(false);
            store.setIsAudiblySpeaking(false);
            await restoreAmbientAudioMode();
            maybeNotifyRuntimeSpeechEnded(gen);
          }
          await cleanupTempAudio(temps);
        }
      },
      { priority: 'explore' },
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'speech_interrupted') return;
    throw err;
  }
}

export async function synthesizeWav(
  text: string,
  options?: SpeakVoiceOptions,
): Promise<string> {
  const display = prepareDisplayText(text);
  if (!display) throw new Error('[voice] Leerer Text');

  const parts: { pcm: Float32Array; sampleRate: number }[] = [];
  for await (const sentence of sentencesFromFullText(display)) {
    const audio = prepareAudioText(sentence);
    if (!audio) continue;
    parts.push(await synthesizeCompleteSentencePcm(audio, options));
  }
  if (parts.length === 0) throw new Error('[voice] Leerer Text');
  const sampleRate = parts[0].sampleRate;
  const total = parts.reduce((n, p) => n + p.pcm.length, 0);
  const merged = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    merged.set(p.pcm, o);
    o += p.pcm.length;
  }
  return writeTempWav(merged, sampleRate);
}

async function playWav(
  uri: string,
  options: {
    clearPlayingOnEnd: boolean;
    playbackRate?: number;
    deleteAfter?: boolean;
  },
): Promise<void> {
  const gen = playbackGeneration;
  try {
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch {
        // ignore
      }
      sound = null;
    }
    const { sound: created } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate: options.playbackRate ?? 1, shouldCorrectPitch: true },
    );
    sound = created;
    markAudiblePlayback(true);
    let sawPlaying = false;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const startedAt = Date.now();
      let lastPos = -1;
      let stalledSince: number | null = null;
      const clearUiOnEnd = () => {
        if (options.clearPlayingOnEnd && gen === playbackGeneration) {
          useFinnusStore.getState().setIsPlayingAudio(false);
          useFinnusStore.getState().setIsAudiblySpeaking(false);
          // Untertitel bleiben für Idle-Fade
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        markAudiblePlayback(false);
        resolve();
      };
      const tick = setInterval(() => {
        if (gen !== playbackGeneration) {
          finish();
          return;
        }
        void created
          .getStatusAsync()
          .then((status) => {
            if (settled || !status.isLoaded) return;
            const dur = status.durationMillis ?? 0;
            const pos = status.positionMillis ?? 0;
            // Auch bei isPlaying=true am Dateiende beenden (Android-Zombie)
            if (dur > 0 && pos >= Math.max(0, dur - 50)) {
              clearUiOnEnd();
              finish();
              return;
            }
            if (status.isPlaying) {
              sawPlaying = true;
              if (pos === lastPos) {
                if (stalledSince == null) stalledSince = Date.now();
                else if (Date.now() - stalledSince >= 1500) {
                  clearUiOnEnd();
                  finish();
                }
              } else {
                lastPos = pos;
                stalledSince = null;
              }
              return;
            }
            if (status.didJustFinish) {
              clearUiOnEnd();
              finish();
              return;
            }
            if (sawPlaying && !status.isPlaying) {
              clearUiOnEnd();
              finish();
              return;
            }
            const capMs = (dur > 0 ? dur : 30_000) + 2500;
            if (Date.now() - startedAt >= capMs) {
              clearUiOnEnd();
              finish();
            }
          })
          .catch(() => undefined);
      }, 200);
      created.setOnPlaybackStatusUpdate((status) => {
        if (settled) return;
        if (!status.isLoaded) {
          if ('error' in status && status.error) {
            clearInterval(tick);
            settled = true;
            markAudiblePlayback(false);
            reject(new Error(String(status.error)));
          }
          return;
        }
        if (status.isPlaying) sawPlaying = true;
        if (status.didJustFinish) {
          clearUiOnEnd();
          finish();
          return;
        }
        const dur = status.durationMillis ?? 0;
        const pos = status.positionMillis ?? 0;
        if (dur > 0 && pos >= Math.max(0, dur - 50)) {
          clearUiOnEnd();
          finish();
        }
      });
    });
  } finally {
    markAudiblePlayback(false);
    if (options.deleteAfter) {
      void cleanupTempAudio([uri]);
    }
  }
}

export async function stopSpeakingInternal(): Promise<void> {
  clearSpeechJobQueue();
  void stopExpoSpeech();
  pendingNavCue = null;
  // haltCurrentPlayback → flushStreamingAudioQueue + Generation-Bump
  const stopGen = await haltCurrentPlayback();
  markAudiblePlayback(false);
  useFinnusStore.getState().setIsPlayingAudio(false);
  useFinnusStore.getState().setIsAudiblySpeaking(false);
  useFinnusStore.getState().setSubtitleText(null);
  void cleanupTempAudio();
  const deadline = Date.now() + 500;
  while (activeTtsSessions > 0 && Date.now() < deadline) {
    if (playbackGeneration !== stopGen) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  if (playbackGeneration !== stopGen) return;
  if (activeTtsSessions > 0) {
    activeTtsSessions = 0;
  }
  await restoreAmbientAudioMode();
}

/** @deprecated */


export async function stopSpeaking(): Promise<void> {
  return stopSpeakingInternal();
}

/**
 * Bei App-/Audio-Interrupt: TTS hart stoppen und Ambient-Focus zurückgeben
 * (Spotify darf weiterlaufen).
 */
export async function resetTtsOnInterruption(): Promise<void> {
  return stopSpeakingInternal();
}

/**
 * Cost Control: Cartesia sonic-3.5 is primary.
 * 'system' = force expo-speech (Dev / offline test).
 */
function resolveActiveTtsProvider(): TtsProvider {
  const fromStore = useFinnusStore.getState().ttsProvider;
  if (fromStore === 'system') return 'system';
  if (fromStore === 'cartesia') return 'cartesia';
  const fromProfile = getCachedUserProfile()?.ttsProvider;
  return fromProfile === 'system' ? 'system' : 'cartesia';
}

/**
 * Internal chunk playback — Cartesia StreamingAudioQueue (prefetch + gapless).
 * Callers must go through enqueueSpeechJob (speakText / speakSentenceStream).
 * Explore: materialisiert Sätze + Bookmark für Navi-Interrupt/Resume.
 */
async function speakChunkSource(
  source: AsyncIterable<string> | string[],
  voiceOptions?: SpeakVoiceOptions,
  priority: SpeechPriority = 'system',
): Promise<void> {
  let effective = voiceOptions;
  if (!effective?.voiceId || effective.speechRate == null) {
    try {
      const tour = await getVoiceSettingsForTour();
      effective = {
        ...voiceOptions,
        voiceId: voiceOptions?.voiceId ?? tour.voiceId,
        speechRate: voiceOptions?.speechRate ?? tour.speechRate,
      };
    } catch {
      effective = voiceOptions;
    }
  }
  if (!effective?.resolveGenerationConfig) {
    effective = {
      ...effective,
      resolveGenerationConfig: createLiveEmotionResolver(effective?.voiceId),
    };
  }

  const store = useFinnusStore.getState();
  const forceSystem = resolveActiveTtsProvider() === 'system';
  const useCartesia = !forceSystem && hasCartesiaTtsKey();

  store.setTtsStatusMessage(null);
  store.setTtsReady(true);

  const gen = playbackGeneration;

  // Nie parallel zu Expo/Rest-Audio — eine Stimme zur Zeit
  await stopExpoSpeech();

  store.setIsPlayingAudio(true);
  activeTtsSessions += 1;
  try {
    await applyTtsExclusiveAudioMode();

    const materialize =
      priority === 'explore' || Array.isArray(source);
    let chunks: string[] | null = null;
    if (materialize) {
      chunks = [];
      if (Array.isArray(source)) {
        for (const c of source) {
          const d = prepareDisplayText(c);
          if (d) chunks.push(d);
        }
      } else {
        for await (const raw of streamingChunksFromTextStream(source)) {
          const d = prepareDisplayText(raw);
          if (d) chunks.push(d);
        }
      }
      if (chunks.length === 0) return;
    }

    // Offline / forced system: sequential expo-speech
    if (!useCartesia) {
      const iterate: AsyncIterable<string> = chunks
        ? (async function* () {
            for (const c of chunks!) yield c;
          })()
        : Array.isArray(source)
          ? (async function* () {
              for (const c of source) yield c;
            })()
          : source;
      let idx = 0;
      const list = chunks;
      let subtitleCarry: string | null = null;
      for await (const raw of streamingChunksFromTextStream(iterate)) {
        if (gen !== playbackGeneration || isSoftAbortRequested()) {
          if (priority === 'explore' && list) {
            explorePlaybackBookmark = {
              sentences: list,
              nextIndex: idx,
              voiceOptions: effective,
            };
          }
          return;
        }
        const display = prepareDisplayText(raw);
        if (!display) continue;
        if (priority === 'explore' && list) {
          explorePlaybackBookmark = {
            sentences: list,
            nextIndex: idx,
            voiceOptions: effective,
          };
        }
        recordFindusSpeechExact(display, Date.now());
        markAudiblePlayback(true);
        const carry = subtitleCarry;
        try {
          await runEstimatedLiveSubtitles(
            display,
            (t) => store.setSubtitleText(mergeSubtitleCarry(carry, t)),
            () => speakWithExpoSpeech(display, { language: 'de-DE' }),
            () => gen === playbackGeneration && !isSoftAbortRequested(),
          );
        } finally {
          markAudiblePlayback(false);
        }
        subtitleCarry = mergeSubtitleCarry(subtitleCarry, display);
        idx += 1;
      }
      if (priority === 'explore') explorePlaybackBookmark = null;
      return;
    }

    if (priority === 'explore' && chunks) {
      let exploreCarry: string | null = null;
      for (let i = 0; i < chunks.length; i += 1) {
        if (gen !== playbackGeneration || isSoftAbortRequested()) {
          explorePlaybackBookmark = {
            sentences: chunks,
            nextIndex: i,
            voiceOptions: effective,
          };
          return;
        }
        explorePlaybackBookmark = {
          sentences: chunks,
          nextIndex: i,
          voiceOptions: effective,
        };
        await playStreamingAudioQueue([chunks[i]], {
          voiceId: effective?.voiceId,
          generationConfig: effective?.generationConfig,
          resolveGenerationConfig: effective?.resolveGenerationConfig,
          prefetchLookahead: 1,
          prepareDisplayText,
          prepareAudioText,
          isGenerationActive: () =>
            gen === playbackGeneration && !isSoftAbortRequested(),
          priorSubtitle: exploreCarry,
          onSubtitleCarry: (c) => {
            exploreCarry = c;
          },
          onSubtitle: (t) => {
            store.setSubtitleText(t);
            if (t) {
              recordFindusSpeechExact(prepareAudioText(t), Date.now());
            }
          },
          onAudibleChange: markAudiblePlayback,
          bindActiveSound: (s) => {
            sound = s;
          },
        });
      }
      explorePlaybackBookmark = null;
      return;
    }

    await playStreamingAudioQueue(chunks ?? source, {
      voiceId: effective?.voiceId,
      generationConfig: effective?.generationConfig,
      resolveGenerationConfig: effective?.resolveGenerationConfig,
      prefetchLookahead: 2,
      prepareDisplayText,
      prepareAudioText,
      // Modul-2 / Fragen: fertige Sätze nicht in Mini-Hooks zerlegen
      // (sonst stirbt die Antwort oft nach dem ersten Cartesia-Fail mitten drin)
      skipPhraseResplit: priority === 'question' && Array.isArray(chunks),
      isGenerationActive: () => gen === playbackGeneration,
      onSubtitle: (t) => {
        store.setSubtitleText(t);
        if (t) {
          recordFindusSpeechExact(prepareAudioText(t), Date.now());
        }
      },
      onAudibleChange: markAudiblePlayback,
      bindActiveSound: (s) => {
        sound = s;
      },
    });
  } finally {
    if (priority === 'explore' && !isSoftAbortRequested()) {
      explorePlaybackBookmark = null;
    }
    markAudiblePlayback(false);
    activeTtsSessions = Math.max(0, activeTtsSessions - 1);
    // SSOT: UI folgt Session-Count — nie „Ich erzähle“ mit 0 Sessions
    if (activeTtsSessions === 0) {
      store.setIsPlayingAudio(false);
      store.setIsAudiblySpeaking(false);
      await restoreAmbientAudioMode();
      maybeNotifyRuntimeSpeechEnded(gen);
    }
  }
}

export async function speakText(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
  opts?: {
    bypassDeliveryPolicy?: boolean;
    deliveryKind?: SpeechDeliveryKind;
    priority?: SpeechPriority;
  },
): Promise<void> {
  const display = prepareDisplayText(text);
  if (!display) return;

  if (!opts?.bypassDeliveryPolicy) {
    const maySpeak = await requestSpeechDelivery({
      text: display,
      voiceOptions,
      kind: opts?.deliveryKind ?? 'assistant',
    });
    if (!maySpeak) return;
  }

  const priority = opts?.priority ?? 'system';
  try {
    await enqueueSpeechJob(
      async () => {
        try {
          await speakChunkSource(
            sentencesFromFullText(display),
            voiceOptions,
            priority,
          );
        } catch (error) {
          console.warn('[voice] Cartesia TTS fehlgeschlagen:', error);
          try {
            const { fallbackSpeech } = await import('./debug/fallbackLabel');
            const fb = fallbackSpeech(
              'TTS-Systemstimme',
              display.slice(0, 400),
            );
            useFinnusStore.getState().setIsPlayingAudio(false);
            useFinnusStore.getState().setIsPlayingAudio(true);
            markAudiblePlayback(true);
            await applyTtsExclusiveAudioMode();
            await runEstimatedLiveSubtitles(
              fb,
              (t) => useFinnusStore.getState().setSubtitleText(t),
              () => speakWithExpoSpeech(fb, { language: 'de-DE' }),
              () => true,
            );
          } catch (fbErr) {
            console.warn('[voice] expo-speech Fallback fehlgeschlagen:', fbErr);
            throw fbErr;
          } finally {
            markAudiblePlayback(false);
            useFinnusStore.getState().setIsPlayingAudio(false);
            useFinnusStore.getState().setIsAudiblySpeaking(false);
            if (activeTtsSessions === 0) {
              await restoreAmbientAudioMode();
            }
          }
        }
      },
      { priority },
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'speech_interrupted') return;
    throw err;
  }
}



export async function speakSentenceStream(
  sentences: AsyncIterable<string>,
  voiceOptions?: SpeakVoiceOptions,
  opts?: {
    bypassDeliveryPolicy?: boolean;
    deliveryKind?: SpeechDeliveryKind;
    priority?: SpeechPriority;
  },
): Promise<void> {
  const priority = opts?.priority ?? 'system';

  if (!opts?.bypassDeliveryPolicy) {
    const { wantsSpokenAudio } = await import('./userProfileService');
    if (!wantsSpokenAudio()) {
      const parts: string[] = [];
      for await (const s of sentences) {
        if (s?.trim()) parts.push(s.trim());
      }
      const full = parts.join(' ').trim();
      if (full) {
        await requestSpeechDelivery({
          text: full,
          voiceOptions,
          kind: opts?.deliveryKind ?? 'assistant',
        });
      }
      return;
    }

    const { canSpeakAloudNow } = await import('./speech/deviceAudioRoute');
    let allow = true;
    try {
      allow = await canSpeakAloudNow();
    } catch {
      allow = true;
    }
    if (!allow) {
      const parts: string[] = [];
      for await (const s of sentences) {
        if (s?.trim()) parts.push(s.trim());
      }
      const full = parts.join(' ').trim();
      if (full) {
        await requestSpeechDelivery({
          text: full,
          voiceOptions,
          kind: opts?.deliveryKind ?? 'assistant',
        });
      }
      return;
    }
  }

  // Explore always buffers (bookmark/resume). Questions may stream when idle.
  const { isSpeechJobQueueBusy } = await import('./ai/speechJobQueue');
  const shouldBuffer =
    priority === 'explore' || isSpeechJobQueueBusy();

  if (!shouldBuffer) {
    // Materialisieren für Fallback (wie buffered-Pfad) — sonst Stille nach Chunk-1-Fail
    const streamed: string[] = [];
    for await (const s of sentences) {
      if (s?.trim()) streamed.push(s.trim());
    }
    if (streamed.length === 0) return;
    try {
      await enqueueSpeechJob(
        async () => {
          try {
            await speakChunkSource(streamed, voiceOptions, priority);
          } catch (error) {
            console.warn('[voice] Sentence-Stream fehlgeschlagen:', error);
            markAudiblePlayback(false);
            useFinnusStore.getState().setIsPlayingAudio(false);
            useFinnusStore.getState().setIsAudiblySpeaking(false);
            try {
              useFinnusStore.getState().setIsPlayingAudio(true);
              markAudiblePlayback(true);
              await applyTtsExclusiveAudioMode();
              const fb = streamed.join(' ');
              await runEstimatedLiveSubtitles(
                fb,
                (t) => useFinnusStore.getState().setSubtitleText(t),
                () => speakWithExpoSpeech(fb, { language: 'de-DE' }),
                () => true,
              );
            } finally {
              markAudiblePlayback(false);
              useFinnusStore.getState().setIsPlayingAudio(false);
              useFinnusStore.getState().setIsAudiblySpeaking(false);
              if (activeTtsSessions === 0) {
                await restoreAmbientAudioMode();
              }
            }
          }
        },
        { priority },
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'speech_interrupted') return;
      throw err;
    }
    return;
  }

  const buffered: string[] = [];
  for await (const s of sentences) {
    if (s?.trim()) buffered.push(s.trim());
  }
  if (buffered.length === 0) return;

  try {
    await enqueueSpeechJob(
      async () => {
        try {
          await speakChunkSource(buffered, voiceOptions, priority);
        } catch (error) {
          console.warn('[voice] Sentence-Stream fehlgeschlagen:', error);
          markAudiblePlayback(false);
          useFinnusStore.getState().setIsPlayingAudio(false);
          useFinnusStore.getState().setIsAudiblySpeaking(false);
          try {
            useFinnusStore.getState().setIsPlayingAudio(true);
            markAudiblePlayback(true);
            await applyTtsExclusiveAudioMode();
            const fb = buffered.join(' ');
            await runEstimatedLiveSubtitles(
              fb,
              (t) => useFinnusStore.getState().setSubtitleText(t),
              () => speakWithExpoSpeech(fb, { language: 'de-DE' }),
              () => true,
            );
          } finally {
            markAudiblePlayback(false);
            useFinnusStore.getState().setIsPlayingAudio(false);
            useFinnusStore.getState().setIsAudiblySpeaking(false);
            if (activeTtsSessions === 0) {
              await restoreAmbientAudioMode();
            }
          }
        }
      },
      { priority },
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'speech_interrupted') return;
    throw err;
  }
}

export async function speakAssistantText(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
  opts?: { deliveryKind?: SpeechDeliveryKind; priority?: SpeechPriority },
): Promise<void> {
  let trimmed = text.trim();
  if (!trimmed) return;
  try {
    const { scrubSpeechForTts } = require('./agi/speechGuardrails') as {
      scrubSpeechForTts: (
        s: string,
        o?: { maxChars?: number },
      ) => { text: string };
    };
    trimmed = scrubSpeechForTts(trimmed, { maxChars: 2200 }).text.trim();
  } catch {
    trimmed = trimmed
      .replace(/\bCheck\.?\b/giu, ' ')
      .replace(/\bIch\s+habe\s+die\s+Teile\s+geprüft[.!]?/giu, ' ')
      .replace(/(?:Speech\s*text|Card\s*title|Type|Payload)\s*:[^\n]*/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!trimmed) return;
  try {
    const { onSpeechStart } = await import('../runtime/orchestrator');
    onSpeechStart();
  } catch {
    /* tests / headless */
  }
  const mergedVoice: SpeakVoiceOptions = {
    ...voiceOptions,
    resolveGenerationConfig:
      voiceOptions?.resolveGenerationConfig ??
      createLiveEmotionResolver(voiceOptions?.voiceId),
  };
  await speakText(trimmed, mergedVoice, {
    deliveryKind: opts?.deliveryKind ?? 'assistant',
    priority: opts?.priority ?? 'question',
  });
}

/**
 * Fast-Hook Two-Phase: Intro sofort via TTS, Body als Satz-Queue parallel.
 */
export async function speakTwoPhase(options: {
  introText: string;
  bodyTextPromise?: Promise<string>;
  bodySentenceStream?: AsyncIterable<string>;
  voice?: SpeakVoiceOptions;
}): Promise<void> {
  let intro = options.introText.trim();
  let genAfterIntro = playbackGeneration;

  // Intro endet auf Initiale („… C.“) → ersten Body-Satz ankleben, sonst Name-Riss
  let bodyStream = options.bodySentenceStream;
  if (bodyStream && /(?:^|[\s(])[A-ZÄÖÜ]\.$/.test(intro)) {
    const iter = bodyStream[Symbol.asyncIterator]();
    const first = await iter.next();
    if (!first.done && first.value) {
      intro = `${intro} ${String(first.value).trim()}`.replace(/\s+/g, ' ');
    }
    async function* rest(): AsyncGenerator<string, void, unknown> {
      while (true) {
        const n = await iter.next();
        if (n.done) break;
        const t = String(n.value ?? '').trim();
        if (t) yield t;
      }
    }
    bodyStream = rest();
  }

  if (intro) {
    await speakText(intro, options.voice);
    genAfterIntro = playbackGeneration;
  }

  if (playbackGeneration !== genAfterIntro) return;

  if (bodyStream) {
    await speakSentenceStream(bodyStream, options.voice);
    return;
  }

  if (options.bodyTextPromise) {
    const body = (await options.bodyTextPromise).trim();
    if (playbackGeneration !== genAfterIntro) return;
    if (body) await speakText(body, options.voice);
  }
}

export async function playVoiceSample(options: {
  voiceId: VoiceId;
  speechRate?: number;
}): Promise<void> {
  const voiceId = options.voiceId;
  const voice = getVoice(voiceId);

  // Sample preview may interrupt — intentional user action
  clearSpeechJobQueue();
  const gen = await haltCurrentPlayback();
  const store = useFinnusStore.getState();

  // Live Cartesia Hörprobe hat Vorrang (gebündelte WAVs sind Legacy)
  if (hasCartesiaTtsKey() && resolveActiveTtsProvider() !== 'system') {
    await speakText(voice.sample, { voiceId }, { bypassDeliveryPolicy: true });
    return;
  }

  const moduleId = VOICE_SAMPLE_MODULES[voiceId];
  if (moduleId != null) {
    const uri = await resolveBundledAssetUri(moduleId);
    if (uri && gen === playbackGeneration) {
      store.setIsPlayingAudio(true);
      store.setSubtitleText(voice.sample);
      activeTtsSessions += 1;
      try {
        await applyTtsExclusiveAudioMode();
        await playWav(uri, {
          clearPlayingOnEnd: true,
          playbackRate: 1,
          deleteAfter: false,
        });
      } finally {
        markAudiblePlayback(false);
        activeTtsSessions = Math.max(0, activeTtsSessions - 1);
        if (activeTtsSessions === 0) {
          store.setIsPlayingAudio(false);
          store.setIsAudiblySpeaking(false);
          await restoreAmbientAudioMode();
          maybeNotifyRuntimeSpeechEnded(gen);
        }
      }
      return;
    }
  }

  // Live Cartesia Hörprobe (oder expo-speech Fallback)
  await speakText(voice.sample, { voiceId }, { bypassDeliveryPolicy: true });
}

export async function speakOnboardingIntro(options: {
  fullText?: string;
  fullWelcomeDe?: string;
}): Promise<void> {
  const text = (
    options.fullText ??
    options.fullWelcomeDe ??
    'Kennst du das?'
  ).trim();
  // Live mit Sebastian — Premium-Erzähler-Bogen (neugierig → genervt → bestimmt → begeistert → warm)
  await speakText(
    text,
    {
      ...INTRO_VOICE,
      resolveGenerationConfig: createIntroEmotionResolver(),
    },
    { bypassDeliveryPolicy: true, priority: 'question' },
  );
}

export async function purgeLegacyVoiceAssets(): Promise<void> {
  // Alte lokale Engine-Caches vom Gerät entfernen (historische Ordnernamen inkl. Kokoro)
  const legacyPaths = [
    `${FileSystem.documentDirectory}kokoro`,
    `${FileSystem.cacheDirectory}kokoro`,
    `${FileSystem.documentDirectory}piper`,
    `${FileSystem.cacheDirectory}piper`,
  ];
  for (const dir of legacyPaths) {
    if (!dir || dir.includes('undefined')) continue;
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (info.exists) {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      }
    } catch {
      // ignore
    }
  }
  try {
    await FileSystem.writeAsStringAsync(
      SYSTEM_VERSION_PATH,
      VOICE_SYSTEM_VERSION,
    );
  } catch {
    // ignore
  }
}

export async function resetVoiceSystem(): Promise<void> {
  await stopSpeakingInternal();
  resetLocalTtsEngine();
  warmedUp = false;
  warmupPromise = null;
  activeVoiceReset?.();
  useFinnusStore.getState().setTtsReady(false);
}

export function startVoiceBuffer(options?: {
  speechRate?: number;
  priorityVoiceId?: VoiceId;
}): void {
  void warmupTtsEngine({ voiceId: options?.priorityVoiceId });
  void warmActiveVoiceInternal(options?.priorityVoiceId);
}

export function prefetchOnboardingIntro(_fullWelcomeDe: string): Promise<void> {
  return Promise.resolve();
}

export function prefetchOnboardingAudioBundle(
  _fullWelcomeDe?: string,
  _speechRate?: number,
): Promise<void> {
  markMetroBundledSamplesReady();
  void warmupTtsEngine();
  return Promise.resolve();
}

export function prefetchVoiceSamples(
  _priorityVoiceId?: VoiceId,
): Promise<void> {
  if (samplePrefetchPromise) return samplePrefetchPromise;
  samplePrefetchPromise = (async () => {
    markMetroBundledSamplesReady();
  })();
  return samplePrefetchPromise;
}

export function prepareOnboardingVoiceSamples(options?: {
  speechRate?: number;
  priorityVoiceId?: VoiceId;
  voiceIds?: VoiceId[];
}): Promise<void> {
  const key = (options?.voiceIds ?? EAGER_IDS).join(',');
  if (prepareOnboardingPromise && prepareOnboardingKey === key) {
    return prepareOnboardingPromise;
  }
  prepareOnboardingKey = key;
  markMetroBundledSamplesReady();
  void warmupTtsEngine({ voiceId: options?.priorityVoiceId });
  void warmActiveVoiceInternal(options?.priorityVoiceId);
  prepareOnboardingPromise = prefetchVoiceSamples(options?.priorityVoiceId);
  return prepareOnboardingPromise;
}

const EAGER_IDS = VOICES.map((v) => v.id);

export async function prefetchAllVoiceModels(): Promise<void> {
  // TTS entfernt — no-op (Cartesia).
  return Promise.resolve();
}



export async function prefetchSingleVoiceSample(
  voiceId: VoiceId,
): Promise<void> {
  sampleReadyKeys.add(sampleCacheKey(voiceId));
}

export async function hydrateSampleCacheFromDisk(): Promise<void> {
  markMetroBundledSamplesReady();
  try {
    const info = await FileSystem.getInfoAsync(SAMPLE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(SAMPLE_DIR, { intermediates: true });
    }
  } catch {
    // ignore
  }
}

export function isVoiceSampleReady(voiceId?: VoiceId): boolean {
  if (!voiceId) return sampleReadyKeys.size > 0;
  return sampleReadyKeys.has(sampleCacheKey(voiceId));
}

export function isOnboardingIntroHeadReady(): boolean {
  return INTRO_WAV_MODULE != null;
}

export function isUsingGermanTts(): boolean {
  return true;
}

export function prefetchSystemTtsVoice(_voiceId?: VoiceId): void {
  // no-op — Cartesia has no local voice pack
}

export { ONBOARDING_INTRO_HEAD_DE } from '../i18n';
export { sentencesFromFullText };

// Speech delivery policy: flush queued text after unlock / notification tap
registerSpeechFlushHandler((text, voice) =>
  speakText(text, voice, { bypassDeliveryPolicy: true }),
);
bootstrapSpeechDeliveryPolicy();
try {
  const { bootstrapBackgroundSpeechPolicy } = require('./speech/backgroundSpeechPolicy') as {
    bootstrapBackgroundSpeechPolicy: () => void;
  };
  bootstrapBackgroundSpeechPolicy();
} catch {
  /* soft */
}
