/**
 * AudioVoiceService — Hybrid TTS:
 * Provider-Switch: OpenAI Speech (nova) | lokal Piper/Kokoro
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  resolvePiperModelId,
  getPiperModel,
  type PiperVoiceModelId,
  ALL_PIPER_MODEL_IDS,
} from '../constants/piperVoices';
import {
  getVoice,
  FIXED_SPEECH_RATE,
  VOICES,
  resolveTtsEngine,
  pitchForVoice,
} from '../constants/voices';
import {
  isKokoroVoice,
  resolveKokoroPackId,
} from '../constants/kokoroVoicePacks';
import {
  VOICE_SAMPLE_MODULES,
  INTRO_WAV_MODULE,
} from '../constants/voiceSampleAssets';
import type { VoiceId } from '../types/userProfile';
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
  applyPiperProsody,
} from './g2p/germanTtsProsodyRules';
import {
  applyEnglishOrthoPronunciations,
} from './g2p/phoneticTransformer';
import { sentencesFromFullText } from './ai/sentenceStream';
import {
  ensurePhoneticEngineSync,
  initMultilingualPhoneticEngine,
  transformMultilingualTerms,
} from './ai/multilingualPhoneticEngine';
import { scrubInventedVoiceNames } from './ai/spokenNameGuard';
import { createAudioPlayQueue } from './ai/audioPlayQueue';
import {
  PIPER_DOWNLOAD_MSG,
  PIPER_UNAVAILABLE_MSG,
  KOKORO_UNAVAILABLE_MSG,
} from './ttsPolicy';
import {
  hasOpenAiTtsKey,
  synthesizeOpenAiSpeechMp3,
  deleteOpenAiTempAudio,
} from './openaiTtsService';
import type { TtsProvider } from '../store/useFinnusStore';
import {
  warmupPiper,
  isPiperReady as engineReady,
  isPiperLoading as engineLoading,
  synthesizePiperPcm,
  ensurePiperModel as engineEnsureModel,
  unloadPiperModel,
  unloadInactivePiperModels as engineUnloadInactive,
  resetPiperEngine,
  getActivePiperModelId,
} from './piper/piperEngine';
import {
  warmupKokoroEngine,
  isKokoroEngineReady,
  synthesizeKokoroPcm,
  ensureKokoroPack,
  unloadKokoroEngine,
  resetKokoroEngine,
} from './kokoro/kokoroEngine';

export type SpeakVoiceOptions = {
  speechRate?: number;
  voiceId?: VoiceId;
  pitch?: number;
};

export const INTRO_VOICE: SpeakVoiceOptions = {
  voiceId: 'standard_m',
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
let warmedUp = false;
let warmupPromise: Promise<void> | null = null;
let playbackGeneration = 0;
let activeTtsSessions = 0;
const tempAudioUris = new Set<string>();

async function applyTtsExclusiveAudioMode(): Promise<void> {
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  });
}

/** Musik/Spotify wieder freigeben, wenn Findus fertig spricht. */
async function restoreAmbientAudioMode(): Promise<void> {
  if (activeTtsSessions > 0) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.MixWithOthers,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    });
  } catch {
    /* ignore */
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
  const persona =
    voiceId ?? getCachedUserProfile()?.voiceId ?? 'standard_m';
  if (isKokoroVoice(persona)) {
    await ensureKokoroPack(resolveKokoroPackId(persona));
    unloadInactivePiperModels(resolvePiperModelId('standard_m'));
  } else {
    await engineEnsureModel(resolvePiperModelId(persona));
    unloadKokoroEngine();
  }
  markPiperWarmedUp();
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

function markUnavailable(engine: 'piper' | 'kokoro' | 'any' = 'any'): void {
  const msg =
    engine === 'kokoro' ? KOKORO_UNAVAILABLE_MSG : PIPER_UNAVAILABLE_MSG;
  useFinnusStore.getState().setKokoroStatusMessage(msg);
  useFinnusStore.getState().setKokoroReady(false);
}

function isModelUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /onnxruntime|Piper|piper|Kokoro|kokoro|Phonemize|Modell fehlt|Pack fehlt/i.test(
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
      // Leere Klammern aus Truncation / LLM-Müll (z. B. „klassischer ()“)
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}

/**
 * Stufe A (Audio-only, kurz vor der Stimme):
 * Nur Wörter anpassen, die deutsches Piper/espeak falsch lesen würde
 * (Anglizismen, EU-Orte, User-Scan). Untertitel bleiben unberührt.
 */
export function applyVoicePronunciation(text: string): string {
  let t = text.normalize('NFKC');
  if (!t) return '';
  ensurePhoneticEngineSync();
  // 1) Orte / User-Custom
  t = transformMultilingualTerms(t);
  // 2) Kuratiertes EN-Ortho (vibe→Vaib, guide→Geid, Bus→Buss …) gewinnt
  t = applyEnglishOrthoPronunciations(t);
  return t;
}

/**
 * Audio für Piper — zwei Stufen nach Display-Basis:
 * A) Aussprache nur für problematische Fremdwörter
 * B) Prosodie: Emotion, Pausen, Spannung (Satzzeichen)
 */
export function prepareAudioText(text: string): string {
  let t = prepareDisplayText(text);
  if (!t) return '';
  t = applyVoicePronunciation(t);
  t = applyPiperProsody(t);
  return t;
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
  const useKokoro = resolveTtsEngine(voiceId) === 'kokoro';
  const clauses = splitClausesForProsody(audio);
  const parts: Float32Array[] = [];
  let sampleRate = useKokoro ? 24000 : 22050;
  const piperLengthScale =
    !useKokoro && voiceId
      ? getPiperModel(resolvePiperModelId(voiceId)).lengthScale ?? 1.05
      : 1.05;

  for (let i = 0; i < clauses.length; i++) {
    const { clause, pauseAfterMs } = clauses[i];
    if (!clause) continue;
    const syn = useKokoro
      ? await synthesizeKokoroPcm(clause, {
          voiceId: voiceId ?? 'standard_w',
        })
      : await synthesizePiperPcm(clause, {
          voiceId,
          lengthScale: piperLengthScale,
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
  if (!useKokoro) {
    const pitch = options?.pitch ?? pitchForVoice(voiceId);
    pcm = applyPcmPitch(pcm, pitch);
  }
  pcm = appendSilence(
    pcm,
    sampleRate,
    sentenceEndPauseMs(audio, voiceId),
  );
  return { pcm, sampleRate };
}

export async function ensurePiperModel(
  modelId: PiperVoiceModelId,
): Promise<void> {
  await engineEnsureModel(modelId);
}

/** @deprecated */
export async function ensureVoicePack(
  packId: PiperVoiceModelId,
): Promise<PiperVoiceModelId> {
  await ensurePiperModel(packId);
  return packId;
}

export async function loadVoiceIntoRam(
  modelId: PiperVoiceModelId,
): Promise<void> {
  await ensurePiperModel(modelId);
}

export function unloadVoiceFromRam(modelId: PiperVoiceModelId): void {
  unloadPiperModel(modelId);
}

export function unloadInactiveVoicePacks(keep: PiperVoiceModelId): void {
  unloadInactivePiperModels(keep);
}

export function unloadInactivePiperModels(keep: PiperVoiceModelId): void {
  engineUnloadInactive(keep);
}

export function isVoicePackInRam(modelId: PiperVoiceModelId): boolean {
  return getActivePiperModelId() === modelId && engineReady();
}

export async function ensureMartinOrtSession(): Promise<void> {
  await ensurePiperModel(resolvePiperModelId('standard_m'));
}

export function markPiperWarmedUp(): void {
  warmedUp = true;
  useFinnusStore.getState().setKokoroReady(true);
  useFinnusStore.getState().setKokoroStatusMessage(null);
  useFinnusStore.getState().setKokoroDownloadLabel(null);
}

/** @deprecated */
export function markKokoroWarmedUp(): void {
  markPiperWarmedUp();
}

export async function ensureKokoroAssets(
  _onProgress?: (label: string) => void,
): Promise<void> {
  await warmupKokoroEngine({ voiceId: 'standard_w' });
}

export async function ensurePiperAssets(
  onProgress?: (label: string) => void,
): Promise<void> {
  await warmupPiperEngine(onProgress);
}

export function isPiperReady(): boolean {
  return warmedUp && (engineReady() || isKokoroEngineReady());
}

/** @deprecated */
export function isKokoroReady(): boolean {
  return isPiperReady();
}

export function isPiperLoading(): boolean {
  return engineLoading() || warmupPromise != null;
}

/** @deprecated */
export function isKokoroLoading(): boolean {
  return isPiperLoading();
}

export async function warmupPiperEngine(
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
    options?.voiceId ?? getCachedUserProfile()?.voiceId ?? 'standard_m';
  const useKokoro = isKokoroVoice(voiceId);

  if (
    warmedUp &&
    (useKokoro ? isKokoroEngineReady() : engineReady())
  ) {
    useFinnusStore.getState().setKokoroReady(true);
    useFinnusStore.getState().setKokoroStatusMessage(null);
    await warmActiveVoiceInternal(voiceId);
    return;
  }

  if (!warmupPromise) {
    warmupPromise = (async () => {
      try {
        useFinnusStore.getState().setKokoroDownloadLabel(PIPER_DOWNLOAD_MSG);
        useFinnusStore.getState().setKokoroDownloadProgress(0.2);
        await applyTtsExclusiveAudioMode();

        if (useKokoro) {
          onProgress?.('Kokoro Frauenstimme laden');
          await warmupKokoroEngine({ voiceId, onProgress });
        } else {
          onProgress?.('Piper DE-Stimmen laden');
          await warmupPiper({ voiceId, onProgress });
        }

        await warmActiveVoiceInternal(voiceId);
        markPiperWarmedUp();
        useFinnusStore.getState().setKokoroDownloadProgress(1);
        useFinnusStore.getState().setKokoroDownloadLabel(null);
        void prefetchVoiceSamples(voiceId);
        console.log(
          `[voice] ${useKokoro ? 'Kokoro' : 'Piper'} bereit — ${voiceId}`,
        );
      } catch (err) {
        console.warn('[voice] Warmup fehlgeschlagen:', err);
        warmedUp = false;
        warmupPromise = null;
        useFinnusStore.getState().setKokoroReady(false);
        markUnavailable(useKokoro ? 'kokoro' : 'piper');
      } finally {
        useFinnusStore.getState().setKokoroDownloadProgress(null);
      }
    })().catch((err) => {
      warmupPromise = null;
      warmedUp = false;
      useFinnusStore.getState().setKokoroReady(false);
      markUnavailable();
      console.warn('[voice] Warmup Fehler:', err);
    });
  }

  await warmupPromise;
}

/** @deprecated */
export async function warmupKokoro(
  onProgressOrOptions?:
    | ((label: string) => void)
    | { voiceId?: VoiceId },
  maybeOnProgress?: (label: string) => void,
): Promise<void> {
  return warmupPiperEngine(onProgressOrOptions, maybeOnProgress);
}

async function waitReady(timeoutMs = 60_000): Promise<boolean> {
  if (isPiperReady()) return true;
  const started = Date.now();
  while (!isPiperReady() && Date.now() - started < timeoutMs) {
    await warmupPiperEngine();
    if (isPiperReady()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return isPiperReady();
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
    await new Promise<void>((resolve, reject) => {
      const tick = setInterval(() => {
        if (gen !== playbackGeneration) {
          clearInterval(tick);
          resolve();
        }
      }, 200);
      created.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if ('error' in status && status.error) {
            clearInterval(tick);
            reject(new Error(String(status.error)));
          }
          return;
        }
        if (status.didJustFinish) {
          clearInterval(tick);
          if (options.clearPlayingOnEnd && gen === playbackGeneration) {
            useFinnusStore.getState().setIsPlayingAudio(false);
            useFinnusStore.getState().setSubtitleText(null);
          }
          resolve();
        }
      });
    });
  } finally {
    if (options.deleteAfter) {
      void cleanupTempAudio([uri]);
    }
  }
}

export async function stopPiperPlayback(): Promise<void> {
  playbackGeneration += 1;
  if (sound) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    sound = null;
  }
  useFinnusStore.getState().setIsPlayingAudio(false);
  useFinnusStore.getState().setSubtitleText(null);
  activeTtsSessions = Math.max(0, activeTtsSessions - 1);
  void cleanupTempAudio();
  void restoreAmbientAudioMode();
}

/** @deprecated */
export async function stopKokoroPlayback(): Promise<void> {
  return stopPiperPlayback();
}

export async function stopSpeaking(): Promise<void> {
  return stopPiperPlayback();
}

function resolveActiveTtsProvider(): TtsProvider {
  const fromStore = useFinnusStore.getState().ttsProvider;
  if (fromStore === 'kokoro' || fromStore === 'openai') return fromStore;
  const fromProfile = getCachedUserProfile()?.ttsProvider;
  return fromProfile === 'kokoro' ? 'kokoro' : 'openai';
}

async function speakChunkSource(
  source: AsyncIterable<string> | string[],
  voiceOptions?: SpeakVoiceOptions,
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

  const store = useFinnusStore.getState();
  const ttsProvider = resolveActiveTtsProvider();
  const useOpenAi = ttsProvider === 'openai' && hasOpenAiTtsKey();
  if (ttsProvider === 'openai' && !hasOpenAiTtsKey()) {
    console.warn(
      '[voice] ttsProvider=openai, aber kein OpenAI-Key — Fallback auf lokale TTS',
    );
  }

  if (!useOpenAi) {
    if (!isPiperReady()) {
      const ready = await waitReady();
      if (!ready) {
        markUnavailable();
        throw new Error(PIPER_UNAVAILABLE_MSG);
      }
    } else {
      store.setKokoroStatusMessage(null);
    }
  } else {
    store.setKokoroStatusMessage(null);
    store.setKokoroReady(true);
  }

  await stopPiperPlayback();
  const gen = playbackGeneration;
  const sessionTemps: string[] = [];
  // Vorlauf: während Satz N spielt, TTS für N+1 und N+2 schon fertig machen
  const LOOKAHEAD = useOpenAi ? 2 : 2;
  const audioQueue = createAudioPlayQueue(LOOKAHEAD);
  let firstSubtitleSet = false;

  const iterate: AsyncIterable<string> = Array.isArray(source)
    ? (async function* () {
        for (const c of source) yield c;
      })()
    : source;

  /**
   * Kurze Sätze mergen (nicht die ganze Story) → schneller Start,
   * weniger API-Gaps als Einzelsätze.
   */
  async function* mergedChunks(): AsyncGenerator<string, void, unknown> {
    const TARGET = useOpenAi ? 280 : 220;
    const FIRST_TARGET = useOpenAi ? 120 : 90;
    let buf = '';
    let isFirst = true;
    for await (const raw of iterate) {
      const t = prepareDisplayText(raw);
      if (!t) continue;
      const limit = isFirst ? FIRST_TARGET : TARGET;
      if (!buf) {
        buf = t;
        continue;
      }
      if (`${buf} ${t}`.length <= limit) {
        buf = `${buf} ${t}`;
      } else {
        yield buf;
        buf = t;
        isFirst = false;
      }
    }
    if (buf) yield buf;
  }

  store.setIsPlayingAudio(true);
  activeTtsSessions += 1;
  await applyTtsExclusiveAudioMode();

  const producer = (async () => {
    try {
      let i = 0;
      for await (const display of mergedChunks()) {
        if (gen !== playbackGeneration) return;
        const audio = prepareAudioText(display);
        if (!audio) continue;
        if (!firstSubtitleSet) {
          store.setSubtitleText(display);
          firstSubtitleSet = true;
        }

        // Slot frei? Sonst warten — Consumer spielt und gibt Platz frei
        await audioQueue.waitForSlot();
        if (gen !== playbackGeneration) return;

        const t0 = Date.now();

        if (useOpenAi) {
          const mp3Uri = await synthesizeOpenAiSpeechMp3(audio);
          if (gen !== playbackGeneration) {
            await deleteOpenAiTempAudio(mp3Uri);
            return;
          }
          audioQueue.push({
            wavBytes: new Uint8Array(0),
            text: display,
            openAiUri: mp3Uri,
          });
          if (__DEV__) {
            console.log(
              `[voice] openai queue-ready #${++i} ${Date.now() - t0}ms (${display.length}c) q=${audioQueue.size}`,
            );
          }
        } else {
          const { pcm, sampleRate } = await synthesizeCompleteSentencePcm(
            audio,
            effective,
          );
          const wavBytes = pcmToWavBytes(pcm, sampleRate);
          if (gen !== playbackGeneration) return;

          audioQueue.push({ wavBytes, text: display });

          if (__DEV__) {
            console.log(
              `[voice] piper queue-ready #${++i} ${Date.now() - t0}ms (${wavBytes.length}B) q=${audioQueue.size}`,
            );
          }
        }
      }
    } catch (err) {
      audioQueue.close(err);
    } finally {
      audioQueue.close();
    }
  })();

  try {
    while (gen === playbackGeneration) {
      const item = await audioQueue.take();
      if (!item) break;
      store.setSubtitleText(item.text);
      let uri: string;
      if (item.openAiUri) {
        uri = item.openAiUri;
      } else {
        uri = await writeWavBytesToTemp(item.wavBytes);
      }
      sessionTemps.push(uri);
      await playWav(uri, {
        clearPlayingOnEnd: false,
        playbackRate: 1,
        deleteAfter: false,
      });
    }
  } finally {
    await producer.catch(() => undefined);
    activeTtsSessions = Math.max(0, activeTtsSessions - 1);
    if (gen === playbackGeneration) {
      store.setIsPlayingAudio(false);
      store.setSubtitleText(null);
      await restoreAmbientAudioMode();
    }
  }

  await cleanupTempAudio(sessionTemps);
}

export async function speakWithPiper(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  const display = prepareDisplayText(text);
  if (!display) return;
  const useOpenAi =
    resolveActiveTtsProvider() === 'openai' && hasOpenAiTtsKey();
  if (!useOpenAi) {
    void warmupPiperEngine({ voiceId: voiceOptions?.voiceId });
  }
  try {
    await speakChunkSource(sentencesFromFullText(display), voiceOptions);
  } catch (error) {
    console.warn('[voice] TTS-Inferenz fehlgeschlagen:', error);
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setSubtitleText(null);
    if (!useOpenAi && (isModelUnavailableError(error) || !isPiperReady())) {
      markUnavailable(
        isKokoroVoice(voiceOptions?.voiceId) ? 'kokoro' : 'piper',
      );
    }
    throw error;
  }
}

/** @deprecated */
export async function speakWithKokoro(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  return speakWithPiper(text, voiceOptions);
}

export async function speakSentenceStream(
  sentences: AsyncIterable<string>,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  const useOpenAi =
    resolveActiveTtsProvider() === 'openai' && hasOpenAiTtsKey();
  if (!useOpenAi) {
    void warmupPiperEngine();
  }
  try {
    await speakChunkSource(sentences, voiceOptions);
  } catch (error) {
    console.warn('[voice] Sentence-Stream fehlgeschlagen:', error);
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setSubtitleText(null);
    if (!useOpenAi && (isModelUnavailableError(error) || !isPiperReady())) {
      markUnavailable();
    }
    throw error;
  }
}

export async function speakAssistantText(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  await speakWithPiper(text.trim(), voiceOptions);
}

/**
 * Fast-Hook Two-Phase: Intro sofort via Piper, Body als Satz-Queue parallel.
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
    await speakWithPiper(intro, options.voice);
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
    if (body) await speakWithPiper(body, options.voice);
  }
}

export async function playVoiceSample(options: {
  voiceId: VoiceId;
  speechRate?: number;
}): Promise<void> {
  const voiceId = options.voiceId;
  const voice = getVoice(voiceId);

  await stopPiperPlayback();
  const gen = playbackGeneration;
  const store = useFinnusStore.getState();

  const moduleId = VOICE_SAMPLE_MODULES[voiceId];
  if (moduleId != null) {
    const uri = await resolveBundledAssetUri(moduleId);
    if (uri && gen === playbackGeneration) {
      store.setIsPlayingAudio(true);
      store.setSubtitleText(voice.sample);
      try {
        await playWav(uri, {
          clearPlayingOnEnd: true,
          playbackRate: 1,
          deleteAfter: false,
        });
      } finally {
        if (gen === playbackGeneration) {
          store.setIsPlayingAudio(false);
          store.setSubtitleText(null);
        }
      }
      return;
    }
  }

  // Fallback: live Synth (Piper oder Kokoro)
  await warmupPiperEngine({ voiceId });
  if (!isPiperReady()) {
    markUnavailable(isKokoroVoice(voiceId) ? 'kokoro' : 'piper');
    return;
  }
  await speakWithPiper(voice.sample, { voiceId });
}

export async function speakOnboardingIntro(options: {
  fullText?: string;
  fullWelcomeDe?: string;
}): Promise<void> {
  await stopPiperPlayback();
  const store = useFinnusStore.getState();

  // Metro-Intro-WAV hat Vorrang (vorgerendert mit Piper)
  const uri = await resolveBundledAssetUri(INTRO_WAV_MODULE);
  if (uri) {
    store.setIsPlayingAudio(true);
    try {
      await playWav(uri, {
        clearPlayingOnEnd: true,
        playbackRate: 1,
      });
    } finally {
      store.setIsPlayingAudio(false);
    }
    return;
  }

  const text = (
    options.fullText ??
    options.fullWelcomeDe ??
    'Hallo und herzlich willkommen. Ich bin Findus.'
  ).trim();
  void warmupPiperEngine();
  await speakWithPiper(text, INTRO_VOICE);
}

export async function purgeLegacyVoiceAssets(): Promise<void> {
  // Kokoro-Assets NICHT löschen — Frauenstimmen brauchen Martin + de_eva.
  const legacyFiles = [
    `${FileSystem.documentDirectory}kokoro/kokoro-english.onnx`,
    `${FileSystem.documentDirectory}kokoro/kokoro-victoria.onnx`,
  ];
  for (const file of legacyFiles) {
    try {
      const info = await FileSystem.getInfoAsync(file);
      if (info.exists) {
        await FileSystem.deleteAsync(file, { idempotent: true });
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
  await stopPiperPlayback();
  resetPiperEngine();
  resetKokoroEngine();
  warmedUp = false;
  warmupPromise = null;
  activeVoiceReset?.();
  useFinnusStore.getState().setKokoroReady(false);
}

export function startVoiceBuffer(options?: {
  speechRate?: number;
  priorityVoiceId?: VoiceId;
}): void {
  void warmupPiperEngine({ voiceId: options?.priorityVoiceId });
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
  void warmupPiperEngine();
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
  void warmupPiperEngine({ voiceId: options?.priorityVoiceId });
  void warmActiveVoiceInternal(options?.priorityVoiceId);
  prepareOnboardingPromise = prefetchVoiceSamples(options?.priorityVoiceId);
  return prepareOnboardingPromise;
}

const EAGER_IDS = VOICES.map((v) => v.id);

export async function prefetchAllPiperModels(): Promise<void> {
  for (const id of ALL_PIPER_MODEL_IDS) {
    try {
      await ensurePiperModel(id);
    } catch (err) {
      console.warn('[voice] Prefetch Modell:', id, err);
    }
  }
}

/** @deprecated */
export async function prefetchAllKokoroVoicePacks(): Promise<void> {
  // Nur aktives Modell im RAM — Rest auf Disk via Assets
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

export function isUsingGermanPiper(): boolean {
  return true;
}

/** @deprecated */
export function isUsingGermanKokoro(): boolean {
  return isUsingGermanPiper();
}

export function prefetchSystemTtsVoice(_voiceId?: VoiceId): void {
  // no-op — Piper only
}

export { ONBOARDING_INTRO_HEAD_DE } from '../i18n';
export { sentencesFromFullText };
