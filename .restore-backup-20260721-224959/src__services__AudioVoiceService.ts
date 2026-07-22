/**
 * AudioVoiceService — dynamisches In-Memory Kokoro Multi-Speaker.
 *
 * Boot: Martin-ONNX + deutsche Basisstimmen (de_thorsten/eva/karl/puck) → RAM.
 * G2P: 3-Tier (Stadt-SQLite → pronunciations.json → findus-espeak).
 * Hörproben/Intro: Metro-gebündelte WAVs (src/assets/audio/samples/) — 0s Play.
 * Live-Tour: Producer-Consumer-Queue, Tempo fest 1.0, G2P espeak-ng (de).
 */
import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';
import { useFinnusStore } from '../store/useFinnusStore';
import { env } from '../config/env';
import {
  BASE_VOICE_PACK_IDS,
  getKokoroVoicePack,
  resolveKokoroPackId,
  resolveKokoroPackUrls,
  type KokoroModelId,
  type KokoroVoicePackId,
} from '../constants/kokoroVoicePacks';
import { getVoice, clampSpeechRate, FIXED_SPEECH_RATE, VOICES, EAGER_SAMPLE_VOICE_IDS } from '../constants/voices';
import { VOICE_SAMPLE_MODULES, INTRO_WAV_MODULE } from '../constants/voiceSampleAssets';
import type { VoiceId } from '../types/userProfile';
import { getCachedUserProfile, getVoiceSettingsForTour } from './userProfileService';
import { phonemizeGermanAsync, warmupGermanG2P } from './g2p';
import { normalizeGermanTtsText } from './g2p/germanTextNormalize';
import { phonemizeWithPronunciationMap } from './g2p/pronunciationMap';
import {
  getCityPronunciationMap,
} from './g2p/fusedPronunciation';
import {
  getPronunciationCache,
  getGlobalPhraseKeys,
  loadPronunciationDictionary,
  lookupPronunciationTier,
} from './tts/pronunciationMap';
import { tokenIdForPhoneme } from '../constants/kokoroVocab';
import {
  KOKORO_DOWNLOAD_MSG,
  KOKORO_UNAVAILABLE_MSG,
} from './ttsPolicy';
import { getLanguagePack } from '../constants/languagePacks';
import { sentencesFromFullText } from './ai/sentenceStream';

const BUNDLED_KOKORO_PREFER = getLanguagePack('de').preferBundled;

export type SpeakVoiceOptions = {
  /** Ignoriert — systemweit immer FIXED_SPEECH_RATE (1.0). */
  speechRate?: number;
  voiceId?: VoiceId;
  pitch?: number;
};

/** Intro: Standard männlich (de_thorsten / Martin), Tempo 1.0. */
export const INTRO_VOICE: SpeakVoiceOptions = {
  voiceId: 'standard_m',
  speechRate: FIXED_SPEECH_RATE,
  pitch: 1,
};

/** @deprecated Alias für Intro / Standard männlich. */
export const MARTIN_PURE = INTRO_VOICE;

const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
const STYLE_FRAMES = 510;
/** Silence-Schwelle für Trim (PCM ~0). */
const SILENCE_THRESHOLD = 0.01;
/** Crossfade-Samples zwischen gemergten Chunks (klickfrei). */
const MERGE_CROSSFADE = 96;
/** Erster Streaming-Chunk: max. Zeichen für Instant-Start. */
const FIRST_CHUNK_MAX_CHARS = 110;
/** v4: einzigartige Stimmen-Packs + EN-ONNX + Aussprache-Map. */
const VOICE_SYSTEM_VERSION = 'de-kokoro-studio-v4';

const MODEL_DIR = `${FileSystem.documentDirectory}kokoro/`;
const AUDIO_CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}kokoro-audio/`;
const VOICES_DIR = `${MODEL_DIR}voices/`;
/** v2: feste speed=1.0 + Metro-WAV-Hörproben. */
const SAMPLE_CACHE_VER = 'v2-instant-1x';
const SYSTEM_VERSION_PATH = `${MODEL_DIR}system.version`;
const MODEL_PATH_MARTIN = `${MODEL_DIR}kokoro-martin.onnx`;
/** Legacy-Pfad (v1/v2) → nach martin migrieren. */
const MODEL_PATH_LEGACY = `${MODEL_DIR}kokoro.onnx`;
const MODEL_ID_PATH = `${MODEL_DIR}model.id`;

/** Ungenutzte EN-/Legacy-Dateien — Purge beim Boot. */
const LEGACY_PURGE_FILES = [
  `${MODEL_DIR}kokoro-english.onnx`,
  `${MODEL_DIR}kokoro-victoria.onnx`,
] as const;

const LEGACY_VOICE_PREFIXES = ['af_', 'am_', 'bm_', 'bf_'] as const;

/** voiceId@rateKey → Sample bereit (Metro-WAVs sind immer gebündelt). */
const sampleReadyKeys = new Set<string>();

async function resolveBundledAssetUri(moduleId: number): Promise<string | null> {
  try {
    const asset = Asset.fromModule(moduleId);
    if (!asset.downloaded) await asset.downloadAsync();
    return asset.localUri ?? asset.uri ?? null;
  } catch (err) {
    console.warn('[voice] Asset-URI:', err);
    return null;
  }
}
let samplePrefetchPromise: Promise<void> | null = null;
let prepareOnboardingPromise: Promise<void> | null = null;
let prepareOnboardingKey: string | null = null;

const FALLBACK_MODEL_URL_MARTIN =
  'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx';

type OrtTensor = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (type: string, data: any, dims: number[]): any;
};

type OrtModule = {
  Tensor: OrtTensor;
  InferenceSession: {
    create: (
      path: string,
      options?: object,
    ) => Promise<{
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
      inputNames: string[];
      outputNames: string[];
    }>;
  };
};

type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

/** Dual-ONNX: männlich (Martin) + weiblich (Victoria, optional). */
const ortSessions: Partial<Record<KokoroModelId, OrtSession>> = {};
/** Style-Vektoren im RAM — Key = Pack-ID. */
const voiceRam = new Map<KokoroVoicePackId, Float32Array>();
let sound: Audio.Sound | null = null;
let warmedUp = false;
let warmupPromise: Promise<void> | null = null;
let playbackGeneration = 0;
let inferChain: Promise<unknown> = Promise.resolve();
/** Temp-WAVs dieser Session — nach Play / Stop löschen. */
const tempAudioUris = new Set<string>();

function enqueueInfer<T>(fn: () => Promise<T>): Promise<T> {
  const next = inferChain.then(fn, fn);
  inferChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function getOrt(): Promise<OrtModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('onnxruntime-react-native') as OrtModule;
  } catch {
    return null;
  }
}

function voicePackFilePath(packId: KokoroVoicePackId): string {
  return `${VOICES_DIR}${getKokoroVoicePack(packId).fileName}`;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODEL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
  }
  const voicesInfo = await FileSystem.getInfoAsync(VOICES_DIR);
  if (!voicesInfo.exists) {
    await FileSystem.makeDirectoryAsync(VOICES_DIR, { intermediates: true });
  }
  const cacheInfo = await FileSystem.getInfoAsync(AUDIO_CACHE_DIR);
  if (!cacheInfo.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_CACHE_DIR, {
      intermediates: true,
    });
  }
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

function trackTempAudio(uri: string): string {
  tempAudioUris.add(uri);
  return uri;
}

async function cleanupTempAudio(uris?: Iterable<string>): Promise<void> {
  const list = uris ? [...uris] : [...tempAudioUris];
  for (const uri of list) {
    tempAudioUris.delete(uri);
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // ignore
    }
  }
}

function markUnavailable(): void {
  useFinnusStore.getState().setKokoroStatusMessage(KOKORO_UNAVAILABLE_MSG);
}

function base64ToBytes(b64: string): Uint8Array {
  const atobFn =
    globalThis.atob ??
    ((data: string) => {
      const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let str = data.replace(/=+$/, '');
      let output = '';
      for (let bc = 0, bs = 0, buffer, i = 0; (buffer = str.charAt(i++)); ) {
        const idx = chars.indexOf(buffer);
        if (idx === -1) continue;
        bs = bc % 4 ? bs * 64 + idx : idx;
        if (bc++ % 4) {
          output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
        }
      }
      return output;
    });
  const binary = atobFn(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const btoaFn =
    globalThis.btoa ??
    ((data: string) => {
      const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      for (let i = 0; i < data.length; i += 3) {
        const a = data.charCodeAt(i);
        const b = data.charCodeAt(i + 1);
        const c = data.charCodeAt(i + 2);
        const bitmap = (a << 16) | ((b || 0) << 8) | (c || 0);
        output +=
          chars.charAt((bitmap >> 18) & 63) +
          chars.charAt((bitmap >> 12) & 63) +
          (Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63)) +
          (Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63));
      }
      return output;
    });
  return btoaFn(binary);
}

function parseNpyFloat32(buf: ArrayBuffer): Float32Array {
  const u8 = new Uint8Array(buf);
  if (u8.length < 10 || u8[0] !== 0x93) {
    throw new Error('[voice] Ungültiges NPY');
  }
  const view = new DataView(buf);
  const headerLen = view.getUint16(8, true);
  const offset = 10 + headerLen;
  const count = Math.floor((buf.byteLength - offset) / 4);
  if (offset % 4 === 0) {
    return new Float32Array(buf, offset, count);
  }
  const copy = u8.slice(offset);
  return new Float32Array(
    copy.buffer,
    copy.byteOffset,
    Math.floor(copy.byteLength / 4),
  );
}

async function ensureVoiceSystemVersion(): Promise<void> {
  await ensureDir();
  let current = '';
  try {
    const info = await FileSystem.getInfoAsync(SYSTEM_VERSION_PATH);
    if (info.exists) {
      current = (await FileSystem.readAsStringAsync(SYSTEM_VERSION_PATH)).trim();
    }
  } catch {
    current = '';
  }
  if (current === VOICE_SYSTEM_VERSION) return;

  // Alte inkompatible Stimmen (de_thorsten/bm_lewis o.ä.) verwerfen — Modell behalten.
  console.log(
    `[voice] Stimmen-Upgrade "${current || '(keine)'}" → "${VOICE_SYSTEM_VERSION}"`,
  );
  voiceRam.clear();
  try {
    const voicesInfo = await FileSystem.getInfoAsync(VOICES_DIR);
    if (voicesInfo.exists) {
      await FileSystem.deleteAsync(VOICES_DIR, { idempotent: true });
    }
  } catch (err) {
    console.warn('[voice] Alte Stimmen löschen:', err);
  }
  await ensureDir();
  await FileSystem.writeAsStringAsync(
    SYSTEM_VERSION_PATH,
    VOICE_SYSTEM_VERSION,
    { encoding: FileSystem.EncodingType.UTF8 },
  );
}

function resolveModelUrl(): string {
  return env.kokoroModelUrl() || FALLBACK_MODEL_URL_MARTIN;
}

function modelPathFor(_id: KokoroModelId = 'martin'): string {
  return MODEL_PATH_MARTIN;
}

/** Deutsche Inferenz: immer langCode `d` (kein EN/US). */
function germanLangCode(): string {
  return 'd';
}

async function migrateLegacyModel(): Promise<void> {
  try {
    const legacy = await FileSystem.getInfoAsync(MODEL_PATH_LEGACY);
    const martin = await FileSystem.getInfoAsync(MODEL_PATH_MARTIN);
    if (legacy.exists && (legacy.size ?? 0) > 1_000_000 && !martin.exists) {
      await FileSystem.moveAsync({
        from: MODEL_PATH_LEGACY,
        to: MODEL_PATH_MARTIN,
      });
      console.log('[voice] Legacy kokoro.onnx → kokoro-martin.onnx');
    }
  } catch {
    // ignore
  }
}

async function tryInstallBundledModel(
  modelId: KokoroModelId,
  expectedId: string,
): Promise<boolean> {
  const dest = modelPathFor(modelId);
  const bundleRoot = FileSystem.bundleDirectory ?? '';
  const candidates = [
    `${bundleRoot}kokoro/kokoro-martin.onnx`,
    `${bundleRoot}kokoro/kokoro.onnx`,
    `${bundleRoot}assets/kokoro/kokoro-martin.onnx`,
    'file:///android_asset/kokoro/kokoro-martin.onnx',
    'file:///android_asset/kokoro/kokoro.onnx',
  ];
  for (const from of candidates) {
    try {
      const info = await FileSystem.getInfoAsync(from);
      if (!info.exists || (info.size ?? 0) < 1_000_000) continue;
      await ensureDir();
      const existing = await FileSystem.getInfoAsync(dest);
      if (existing.exists) {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      }
      await FileSystem.copyAsync({ from, to: dest });
      await FileSystem.writeAsStringAsync(MODEL_ID_PATH, expectedId, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      delete ortSessions[modelId];
      console.log(`[voice] Bundle-Modell ${modelId} installiert`);
      return true;
    } catch {
      // next
    }
  }
  return false;
}

async function downloadModelTo(
  dest: string,
  url: string,
  modelId: KokoroModelId,
): Promise<boolean> {
  if (!url) return false;
  const tmp = `${dest}.tmp`;
  try {
    await ensureDir();
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
    const store = useFinnusStore.getState();
    store.setKokoroDownloadLabel(KOKORO_DOWNLOAD_MSG);
    store.setKokoroDownloadProgress(0.15);
    const result = await FileSystem.downloadAsync(url, tmp);
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
      return false;
    }
    const tmpInfo = await FileSystem.getInfoAsync(tmp);
    if (!tmpInfo.exists || (tmpInfo.size ?? 0) < 1_000_000) {
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
      return false;
    }
    store.setKokoroDownloadProgress(0.9);
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    }
    await FileSystem.moveAsync({ from: tmp, to: dest });
    delete ortSessions[modelId];
    store.setKokoroDownloadProgress(1);
    return true;
  } catch (err) {
    console.warn(`[voice] Modell-Download ${modelId}:`, err);
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
    return false;
  }
}

async function ensureModel(modelId: KokoroModelId = 'martin'): Promise<boolean> {
  await migrateLegacyModel();
  const store = useFinnusStore.getState();
  const dest = modelPathFor(modelId);

  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && (info.size ?? 0) > 1_000_000) {
    store.setKokoroDownloadProgress(null);
    store.setKokoroDownloadLabel(null);
    return true;
  }

  if (BUNDLED_KOKORO_PREFER) {
    if (await tryInstallBundledModel('martin', 'kokoro-martin.onnx')) {
      store.setKokoroDownloadProgress(null);
      store.setKokoroDownloadLabel(null);
      return true;
    }
  }

  const ok = await downloadModelTo(dest, resolveModelUrl(), 'martin');
  store.setKokoroDownloadProgress(null);
  store.setKokoroDownloadLabel(null);
  if (!ok) markUnavailable();
  return ok;
}

async function installVoiceFromNpz(
  npzPath: string,
  destPath: string,
): Promise<boolean> {
  try {
    const b64 = await FileSystem.readAsStringAsync(npzPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const zip = await JSZip.loadAsync(base64ToBytes(b64));
    const npyName = Object.keys(zip.files).find(
      (n) => n.toLowerCase().endsWith('.npy') && !zip.files[n].dir,
    );
    if (!npyName) return false;
    const ab = await zip.files[npyName].async('arraybuffer');
    const floats = parseNpyFloat32(ab);
    if (floats.length < STYLE_DIM) return false;
    const raw = new Uint8Array(
      floats.buffer,
      floats.byteOffset,
      floats.byteLength,
    );
    await FileSystem.writeAsStringAsync(destPath, bytesToBase64(raw), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return true;
  } catch (err) {
    console.warn('[voice] NPZ-Install:', err);
    return false;
  }
}

async function tryInstallBundledVoice(packId: KokoroVoicePackId): Promise<boolean> {
  const pack = getKokoroVoicePack(packId);
  const dest = voicePackFilePath(packId);
  const binCandidates = [
    `${FileSystem.bundleDirectory}kokoro/voices/${pack.fileName}`,
    `${FileSystem.bundleDirectory}assets/kokoro/voices/${pack.fileName}`,
  ];
  for (const from of binCandidates) {
    try {
      const info = await FileSystem.getInfoAsync(from);
      if (!info.exists || (info.size ?? 0) < 1000) continue;
      await ensureDir();
      await FileSystem.copyAsync({ from, to: dest });
      voiceRam.delete(packId);
      return true;
    } catch {
      // next
    }
  }
  if (pack.npzKey === 'martin') {
    for (const npzFrom of [
      `${FileSystem.bundleDirectory}kokoro/voices-martin.npz`,
      `${FileSystem.bundleDirectory}assets/kokoro/voices-martin.npz`,
    ]) {
      try {
        const info = await FileSystem.getInfoAsync(npzFrom);
        if (!info.exists || (info.size ?? 0) < 1000) continue;
        await ensureDir();
        if (await installVoiceFromNpz(npzFrom, dest)) {
          voiceRam.delete(packId);
          return true;
        }
      } catch {
        // next
      }
    }
  }
  return false;
}

async function downloadVoicePack(
  packId: KokoroVoicePackId,
  url: string,
): Promise<boolean> {
  const dest = voicePackFilePath(packId);
  const tmp = `${dest}.tmp`;
  const isNpz = /\.npz(\?|$)/i.test(url);
  const isPt = /\.pt(\?|$)/i.test(url);
  const isGguf = /\.gguf(\?|$)/i.test(url);
  try {
    // .pt / .gguf brauchen Offline-Konvertierung (prepare:voices) — runtime skip
    if (isPt || isGguf) {
      console.warn(
        `[voice] ${packId}: ${isPt ? '.pt' : '.gguf'} nicht runtime-konvertierbar — Bundle/.bin nötig`,
      );
      return false;
    }
    if (isNpz) {
      const npzTmp = `${MODEL_DIR}pack-${packId}.npz`;
      const result = await FileSystem.downloadAsync(url, npzTmp);
      if (result.status < 200 || result.status >= 300) return false;
      const ok = await installVoiceFromNpz(npzTmp, dest);
      await FileSystem.deleteAsync(npzTmp, { idempotent: true }).catch(() => {});
      if (ok) voiceRam.delete(packId);
      return ok;
    }
    const result = await FileSystem.downloadAsync(url, tmp);
    if (result.status < 200 || result.status >= 300) return false;
    const tmpInfo = await FileSystem.getInfoAsync(tmp);
    if (!tmpInfo.exists || (tmpInfo.size ?? 0) < 1000) return false;
    // Roh-.bin (float32)
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: tmp, to: dest });
    voiceRam.delete(packId);
    return true;
  } catch (err) {
    console.warn(`[voice] Pack ${packId}:`, err);
    await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
    return false;
  }
}

export async function ensureVoicePack(
  packId: KokoroVoicePackId,
): Promise<KokoroVoicePackId> {
  await ensureDir();
  const path = voicePackFilePath(packId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists && (info.size ?? 0) > 1000) return packId;

  if (await tryInstallBundledVoice(packId)) return packId;

  for (const url of resolveKokoroPackUrls(getKokoroVoicePack(packId))) {
    if (await downloadVoicePack(packId, url)) return packId;
  }

  // Fallback: Thorsten/Martin-NPZ für männliche Packs
  if (packId !== 'de_thorsten') {
    try {
      await ensureVoicePack('de_thorsten');
      const thor = voicePackFilePath('de_thorsten');
      const thorInfo = await FileSystem.getInfoAsync(thor);
      if (thorInfo.exists) {
        await FileSystem.copyAsync({ from: thor, to: path });
        voiceRam.delete(packId);
        console.warn(`[voice] Fallback ${packId} ← de_thorsten`);
        return packId;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(`[voice] Pack ${packId} nicht verfügbar`);
}

/**
 * Lädt Style-Vektoren von Disk → RAM (einmalig pro Pack).
 */
async function loadVoiceIntoRam(packId: KokoroVoicePackId): Promise<Float32Array> {
  const cached = voiceRam.get(packId);
  if (cached) return cached;

  const resolved = await ensureVoicePack(packId);
  const path = voicePackFilePath(resolved);
  const b64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToBytes(b64);
  const floatCount = Math.floor(bytes.byteLength / 4);
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, floatCount);
  const needed = STYLE_FRAMES * STYLE_DIM;

  let styles: Float32Array;
  if (floats.length >= needed) {
    styles = floats.subarray(0, needed);
  } else if (floats.length >= STYLE_DIM) {
    const expanded = new Float32Array(needed);
    for (let i = 0; i < STYLE_FRAMES; i++) {
      expanded.set(floats.subarray(0, STYLE_DIM), i * STYLE_DIM);
    }
    styles = expanded;
  } else {
    throw new Error(`[voice] Pack ${resolved} ungültig`);
  }

  voiceRam.set(resolved, styles);
  if (packId !== resolved) voiceRam.set(packId, styles);
  return styles;
}

/** Alle 4 Basisstimmen parallel in den RAM. */
async function preloadAllBaseVoices(): Promise<void> {
  await Promise.all(
    BASE_VOICE_PACK_IDS.map(async (id) => {
      try {
        await loadVoiceIntoRam(id);
        console.log(`[voice] RAM: ${id}`);
      } catch (err) {
        console.warn(`[voice] RAM-Load ${id}:`, err);
      }
    }),
  );
}

async function getSession(modelId: KokoroModelId = 'martin'): Promise<OrtSession> {
  const cached = ortSessions.martin;
  if (cached) return cached;

  const ort = await getOrt();
  if (!ort) throw new Error('[voice] onnxruntime-react-native nicht verfügbar');
  const ok = await ensureModel('martin');
  if (!ok) throw new Error('[voice] Modell martin nicht verfügbar');

  const path = modelPathFor('martin');
  const session = await ort.InferenceSession.create(path, {
    executionProviders: ['cpu'],
  });
  ortSessions.martin = session;
  return session;
}

function pickStyle(styles: Float32Array, tokenLen: number): Float32Array {
  const index = Math.min(Math.max(tokenLen, 0), STYLE_FRAMES - 1);
  return styles.subarray(index * STYLE_DIM, index * STYLE_DIM + STYLE_DIM);
}

const IPA_G = '\u0261'; // Kokoro ɡ

/** Deutsche Wörter auf -ing — nicht anglisieren. */
const EN_ING_DENY = new Set([
  'ding',
  'ring',
  'spring',
  'hing',
  'ging',
  'fing',
  'bring',
  'kling',
  'schwing',
  'zwing',
  'dring',
  'sing', // dt. Imperativ / EN-Homograph — lieber espeak
]);

function escapePronunciationRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Grobe EN-Stamm-IPA für Suffix-Heuristik (nicht Dictionary). */
function roughEnglishStemIpa(stem: string): string {
  let s = stem.toLowerCase();
  for (const [re, rep] of [
    [/tion$/g, 'ʃən'],
    [/sion$/g, 'ʒən'],
    [/ture$/g, 'tʃə'],
    [/igh/g, 'aɪ'],
    [/ee|ea/g, 'iː'],
    [/oo/g, 'uː'],
    [/ou|ow/g, 'aʊ'],
    [/ai|ay/g, 'eɪ'],
    [/oi|oy/g, 'ɔɪ'],
    [/ch/g, 'tʃ'],
    [/sh/g, 'ʃ'],
    [/th/g, 'θ'],
    [/ph/g, 'f'],
    [/ck/g, 'k'],
    [/qu/g, 'kw'],
    [/x/g, 'ks'],
    [/c(?=[eiy])/g, 's'],
    [/c/g, 'k'],
    [/g(?=[eiy])/g, 'dʒ'],
    [/j/g, 'dʒ'],
  ] as Array<[RegExp, string]>) {
    s = s.replace(re, rep);
  }
  return s.replace(/g/g, IPA_G);
}

/**
 * Pre-Processing vor der Inferenz (3-Tier-bewusst):
 * 1) Englische Suffix-Heuristik (-ing/-guide/-check/-point) wenn nicht in Stadt/JSON
 * 2) Stadt-Map (Stufe 1) + pronunciations.json (Stufe 2) → IPA-Marker `⟦...⟧`
 * Stufe 3 (espeak) folgt in phonemizeWithPronunciationMap für Rest-Text.
 */
export function applyPronunciationFixes(
  text: string,
  cityMap: Map<string, string> = new Map(),
): string {
  let working = text.normalize('NFKC');
  const global = getPronunciationCache();

  const preserved: string[] = [];
  working = working.replace(/⟦([^⟧]+)⟧/g, (_, ipa: string) => {
    const idx = preserved.length;
    preserved.push(String(ipa).trim());
    return `\uE000${idx}\uE001`;
  });

  const known = (word: string) =>
    cityMap.has(word.toLowerCase()) || global.has(word.toLowerCase());

  // Suffixe nur wenn weder Stadt noch JSON greifen
  working = working.replace(
    /\b([A-Za-z][A-Za-z'-]*?)(guide|check|point)\b/gi,
    (match, stem: string, suffix: string) => {
      if (known(match)) return match;
      const suf = suffix.toLowerCase();
      const suffixIpa =
        suf === 'guide' ? `${IPA_G}aɪd` : suf === 'check' ? 'tʃɛk' : 'pɔɪnt';
      const stemPart = stem.replace(/[-']+$/g, '');
      const stemIpa = stemPart ? roughEnglishStemIpa(stemPart) : '';
      return `⟦${stemIpa}${stemIpa ? ' ' : ''}${suffixIpa}⟧`;
    },
  );

  working = working.replace(/\b([A-Za-z]{2,}?)ing\b/gi, (match, stem: string) => {
    const lower = match.toLowerCase();
    if (EN_ING_DENY.has(lower) || known(lower)) return match;
    if (/[äöüß]/i.test(match)) return match;
    return `⟦${roughEnglishStemIpa(stem)}ɪŋ⟧`;
  });

  // Stufe 1+2: Phrasen (Stadt, dann Global), längste zuerst
  const cityPhrases = [...cityMap.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  const globalPhrases = getGlobalPhraseKeys().filter((k) => !cityMap.has(k));

  for (const phrase of cityPhrases) {
    if (!working.toLowerCase().includes(phrase)) continue;
    const ipa = cityMap.get(phrase);
    if (!ipa) continue;
    const re = new RegExp(`\\b${escapePronunciationRegExp(phrase)}\\b`, 'gi');
    working = working.replace(re, `⟦${ipa}⟧`);
  }
  for (const phrase of globalPhrases) {
    if (!working.toLowerCase().includes(phrase)) continue;
    const ipa = global.get(phrase);
    if (!ipa) continue;
    const re = new RegExp(`\\b${escapePronunciationRegExp(phrase)}\\b`, 'gi');
    working = working.replace(re, `⟦${ipa}⟧`);
  }

  // Einzelwörter O(1) Map-Lookup
  working = working.replace(
    /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß''-]*/g,
    (word) => {
      const hit = lookupPronunciationTier(word, cityMap);
      return hit ? `⟦${hit.ipa}⟧` : word;
    },
  );

  working = working.replace(/\uE000(\d+)\uE001/g, (_, n: string) => {
    return `⟦${preserved[Number(n)] ?? ''}⟧`;
  });

  return working;
}

async function textToTokens(text: string): Promise<BigInt64Array> {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const cityId = getCachedUserProfile()?.cityId ?? null;

  // Boot-Cache sicherstellen, dann strikt 3-Tier
  await loadPronunciationDictionary();
  const cityMap = await getCityPronunciationMap(cityId);

  const preprocessed = applyPronunciationFixes(
    normalizeGermanTtsText(normalized),
    cityMap,
  );
  // phonemize: Stufe 1+2 bereits markiert; Rest → espeak (Stufe 3)
  const phonemes = await phonemizeWithPronunciationMap(
    preprocessed,
    (segment) => phonemizeGermanAsync(segment),
    cityMap,
  );
  if (__DEV__) {
    console.log(
      `[tts/g2p] 3-tier city=${cityId ?? '—'} json=${getPronunciationCache().size} cityEntries=${cityMap.size} (${phonemes.length}): ${phonemes.slice(0, 120)}`,
    );
  }
  const capped = phonemes.slice(0, 480);
  const ids: number[] = [0];
  for (const ch of capped) {
    const id = tokenIdForPhoneme(ch);
    if (id !== undefined) ids.push(id);
    else if (ch === ' ') ids.push(16);
  }
  ids.push(0);
  return BigInt64Array.from(ids.map((n) => BigInt(n)));
}

function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length * 2;
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
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * Speed systemweit unveränderbar 1.0 (kein Slider).
 * Pitch nur Playback; Prosodie über Satzzeichen / G2P-Silence.
 * Deutsche Pipeline: immer Martin-ONNX + langCode `d`.
 */
function resolveSpeakOptions(options?: SpeakVoiceOptions): {
  speed: number;
  pitch: number;
  voiceId: VoiceId;
  packId: KokoroVoicePackId;
  modelId: KokoroModelId;
} {
  const profile = getCachedUserProfile();
  const voiceId = options?.voiceId ?? profile?.voiceId ?? 'standard_m';
  const voice = getVoice(voiceId);
  const pitch = FIXED_SPEECH_RATE;
  const speed = FIXED_SPEECH_RATE;
  const packId = voice.kokoroPackId ?? resolveKokoroPackId(voiceId);
  return {
    speed,
    pitch,
    voiceId,
    packId,
    modelId: 'martin',
  };
}

export async function ensureKokoroAssets(
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.('Stimmen-System prüfen');
  await ensureVoiceSystemVersion();
  onProgress?.('Modell laden');
  await ensureModel('martin');
  onProgress?.('Deutsche Basisstimmen laden');
  for (const id of BASE_VOICE_PACK_IDS) {
    try {
      await ensureVoicePack(id);
    } catch (err) {
      console.warn(`[voice] ensure ${id}:`, err);
    }
  }
}

export function isKokoroReady(): boolean {
  return warmedUp && ortSessions.martin != null && voiceRam.size > 0;
}

export function isKokoroLoading(): boolean {
  return warmupPromise != null && !warmedUp;
}

/**
 * Boot: Modell + 4 Stimmen → RAM. Danach Instant-Inferenz.
 */
export async function warmupKokoro(
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (warmedUp && ortSessions.martin && voiceRam.size > 0) {
    useFinnusStore.getState().setKokoroReady(true);
    return;
  }

  if (!warmupPromise) {
    warmupPromise = (async () => {
      onProgress?.('Deutsche Sprachausgabe vorbereiten');
      // Kein UI-Banner — Warmup läuft unsichtbar im Hintergrund
      useFinnusStore.getState().setKokoroDownloadLabel(null);
      useFinnusStore.getState().setKokoroDownloadProgress(null);
      void purgeLegacyVoiceAssets().catch(() => undefined);
      void warmupGermanG2P();
      void loadPronunciationDictionary().catch((err) =>
        console.warn('[voice] Pronunciation-JSON Load:', err),
      );
      await ensureKokoroAssets(onProgress);

      try {
        onProgress?.('Kokoro Martin + DE-Stimmen in RAM laden');
        await getSession('martin');
        await preloadAllBaseVoices();

        if (voiceRam.size === 0) {
          throw new Error('Keine Stimme im RAM');
        }

        warmedUp = true;
        useFinnusStore.getState().setKokoroReady(true);
        useFinnusStore.getState().setKokoroStatusMessage(null);
        useFinnusStore.getState().setKokoroDownloadLabel(null);
        console.log(
          `[voice] Bereit — Martin-DE, ${voiceRam.size} Stimmen im RAM`,
        );

        void synthesizeWav('Start', INTRO_VOICE).catch(() => {});
        // Hörproben als WAVs in cacheDirectory (Instant-Preview)
        void prefetchVoiceSamples('standard_m');
      } catch (err) {
        console.warn('[voice] Warmup fehlgeschlagen:', err);
        warmedUp = false;
        useFinnusStore.getState().setKokoroReady(false);
        markUnavailable();
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

async function waitReady(timeoutMs = 60_000): Promise<boolean> {
  if (isKokoroReady()) return true;
  const started = Date.now();
  while (!isKokoroReady() && Date.now() - started < timeoutMs) {
    await warmupKokoro();
    if (isKokoroReady()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return isKokoroReady();
}

export async function synthesizeWav(
  text: string,
  options?: SpeakVoiceOptions,
): Promise<string> {
  const pcm = await synthesizePcm(text, options);
  return writeTempWav(pcm);
}

/** ONNX → Float32 PCM (ohne WAV-Header, für Queue-WAV-Schreiben). */
async function synthesizePcm(
  text: string,
  options?: SpeakVoiceOptions,
): Promise<Float32Array> {
  const clean = text.trim();
  if (!clean) throw new Error('[voice] Leerer Text');

  const { speed, packId } = resolveSpeakOptions(options);
  // Strikt: alle deutschen Inferenz-Aufrufe → Martin + lang `d`
  const modelId: KokoroModelId = 'martin';
  const langCode = germanLangCode();

  return enqueueInfer(async () => {
    const ort = await getOrt();
    if (!ort) throw new Error('[voice] onnxruntime nicht verfügbar');

    const session = await getSession(modelId);
    const styles = await loadVoiceIntoRam(packId);
    const tokens = await textToTokens(clean);
    const style = pickStyle(styles, Number(tokens.length));

    console.log(
      `[voice] synth pack=${packId} model=${modelId} lang=${langCode} tokens=${tokens.length}`,
    );
    const feeds: Record<string, unknown> = {};
    const inputNames = session.inputNames;
    const tokenName =
      inputNames.find((n) => /token/i.test(n)) ?? inputNames[0] ?? 'tokens';
    const styleName =
      inputNames.find((n) => /style|voice|ref/i.test(n)) ??
      inputNames[1] ??
      'style';
    const speedName = inputNames.find((n) => /speed/i.test(n));
    const langName = inputNames.find((n) => /lang/i.test(n));

    feeds[tokenName] = new ort.Tensor('int64', tokens, [1, tokens.length]);
    feeds[styleName] = new ort.Tensor('float32', style, [1, STYLE_DIM]);
    if (speedName) {
      feeds[speedName] = new ort.Tensor(
        'float32',
        Float32Array.from([speed]),
        [1],
      );
    }
    if (langName) {
      feeds[langName] = new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(langCode.charCodeAt(0))]),
        [1],
      );
    }

    const results = await session.run(feeds);
    const outName =
      session.outputNames.find((n) => /audio|waveform|output/i.test(n)) ??
      session.outputNames[0];
    const audioData = results[outName]?.data;
    if (!audioData || audioData.length === 0) {
      throw new Error('[voice] Kein Audio');
    }

    return audioData instanceof Float32Array
      ? audioData
      : Float32Array.from(audioData as ArrayLike<number>);
  });
}

/**
 * Satz-Chunking (Fließband): Trennung an . ! ? ;
 * Erster Chunk kurz halten → Instant-Start.
 */
function splitIntoInferenceChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const raw = normalized
    .split(/(?<=[.!?;])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (raw.length === 0) return [normalized];

  // Kurze Fragmente an Vorgänger hängen (außer beim allerersten, wenn der schon lang ist)
  const sentences: string[] = [];
  for (const p of raw) {
    if (
      sentences.length > 0 &&
      p.length < 28 &&
      sentences[sentences.length - 1].length + p.length < 160
    ) {
      sentences[sentences.length - 1] = `${sentences[sentences.length - 1]} ${p}`;
    } else {
      sentences.push(p);
    }
  }

  // Ersten Chunk ggf. weiter splitten an Kommas für <100ms-Feel
  if (sentences.length > 0 && sentences[0].length > FIRST_CHUNK_MAX_CHARS) {
    const first = sentences[0];
    const comma = first.lastIndexOf(',', FIRST_CHUNK_MAX_CHARS);
    const space = first.lastIndexOf(' ', FIRST_CHUNK_MAX_CHARS);
    const cut = comma >= 40 ? comma + 1 : space >= 40 ? space : -1;
    if (cut > 0) {
      const head = first.slice(0, cut).trim();
      const tail = first.slice(cut).trim();
      if (head && tail) {
        sentences[0] = head;
        sentences.splice(1, 0, tail);
      }
    }
  }

  return sentences;
}

function trimTrailingSilence(
  pcm: Float32Array,
  threshold = SILENCE_THRESHOLD,
): Float32Array {
  let end = pcm.length - 1;
  while (end > 0 && Math.abs(pcm[end]) < threshold) end -= 1;
  end = Math.min(pcm.length, end + 32);
  return pcm.subarray(0, Math.max(1, end));
}

function trimLeadingSilence(
  pcm: Float32Array,
  threshold = SILENCE_THRESHOLD,
): Float32Array {
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start += 1;
  start = Math.max(0, start - 16);
  return pcm.subarray(start);
}

/** Leading + trailing Silence weg (PCM ~0). */
function trimSilence(pcm: Float32Array): Float32Array {
  return trimTrailingSilence(trimLeadingSilence(pcm));
}

/**
 * WAV-Bytes → reine PCM-Samples (44-Byte-/fmt-Header strippen).
 * Für den Fall, dass Chunks als WAV vorliegen; Streaming-Pfad nutzt PCM direkt.
 */
function stripWavHeaderToPcm(bytes: Uint8Array): Float32Array {
  if (bytes.length < 44) return new Float32Array(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let dataOffset = 44;
  let dataSize = bytes.length - 44;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2); // word-align
  }
  const sampleCount = Math.floor(dataSize / 2);
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return pcm;
}

/** Nahtloses PCM-Merging mit Mini-Crossfade (kein Knacken). */
function mergePcmBuffers(parts: Float32Array[]): Float32Array {
  const cleaned = parts
    .map((p, i) => {
      let x = p;
      if (i > 0) x = trimLeadingSilence(x);
      if (i < parts.length - 1) x = trimTrailingSilence(x);
      return x;
    })
    .filter((p) => p.length > 0);
  if (cleaned.length === 0) return new Float32Array(0);
  if (cleaned.length === 1) return cleaned[0];

  let acc = cleaned[0];
  for (let i = 1; i < cleaned.length; i++) {
    acc = crossfadeJoin(acc, cleaned[i], MERGE_CROSSFADE);
  }
  return acc;
}

function crossfadeJoin(
  a: Float32Array,
  b: Float32Array,
  fade: number,
): Float32Array {
  const fadeN = Math.min(fade, a.length, b.length);
  if (fadeN <= 0) {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }
  const out = new Float32Array(a.length + b.length - fadeN);
  out.set(a.subarray(0, a.length - fadeN), 0);
  for (let i = 0; i < fadeN; i++) {
    const t = i / fadeN;
    out[a.length - fadeN + i] =
      a[a.length - fadeN + i] * (1 - t) + b[i] * t;
  }
  out.set(b.subarray(fadeN), a.length);
  return out;
}

async function writeTempWav(pcm: Float32Array): Promise<string> {
  await ensureDir();
  const wavBytes = encodeWav(pcm, SAMPLE_RATE);
  const wavPath = `${AUDIO_CACHE_DIR}gapless-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`;
  await FileSystem.writeAsStringAsync(wavPath, bytesToBase64(wavBytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return trackTempAudio(wavPath);
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
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
  });

  if (sound) {
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    sound = null;
  }

  if (gen !== playbackGeneration) return;

  const playbackRate = clampSpeechRate(options.playbackRate ?? 1);
  const { sound: created } = await Audio.Sound.createAsync(
    { uri },
    {
      shouldPlay: true,
      rate: playbackRate,
      shouldCorrectPitch: false,
    },
  );
  sound = created;

  try {
    await new Promise<void>((resolve, reject) => {
      const tick = setInterval(() => {
        if (gen !== playbackGeneration) {
          clearInterval(tick);
          resolve();
        }
      }, 80);

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

export async function stopKokoroPlayback(): Promise<void> {
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
  void cleanupTempAudio();
}

export async function stopSpeaking(): Promise<void> {
  return stopKokoroPlayback();
}

/**
 * Producer-Consumer: Chunks aus AsyncIterable/Array → Queue → Playback.
 * Erster Satz startet Audio sofort, Rest läuft parallel nach.
 */
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
  if (!isKokoroReady()) {
    const ready = await waitReady();
    if (!ready) {
      markUnavailable();
      throw new Error(KOKORO_UNAVAILABLE_MSG);
    }
  }

  await stopKokoroPlayback();
  const gen = playbackGeneration;
  const { pitch } = resolveSpeakOptions(effective);
  const sessionTemps: string[] = [];

  type QueuedChunk = { uri: string; text: string };
  const audioQueue: QueuedChunk[] = [];
  let producerDone = false;
  let producerError: unknown = null;
  let wakeConsumer: (() => void) | null = null;
  let firstSubtitleSet = false;

  const notifyConsumer = () => {
    const wake = wakeConsumer;
    wakeConsumer = null;
    wake?.();
  };

  const waitForQueueItem = (): Promise<void> =>
    new Promise((resolve) => {
      if (
        audioQueue.length > 0 ||
        producerDone ||
        gen !== playbackGeneration
      ) {
        resolve();
        return;
      }
      wakeConsumer = resolve;
    });

  const iterate: AsyncIterable<string> = Array.isArray(source)
    ? (async function* () {
        for (const c of source) yield c;
      })()
    : source;

  store.setIsPlayingAudio(true);

  const producer = (async () => {
    try {
      let i = 0;
      for await (const rawChunk of iterate) {
        if (gen !== playbackGeneration) return;
        const chunk = rawChunk.trim();
        if (!chunk) continue;
        if (!firstSubtitleSet) {
          store.setSubtitleText(chunk);
          firstSubtitleSet = true;
        }
        const t0 = Date.now();
        const pcm = await synthesizePcm(chunk, effective);
        if (gen !== playbackGeneration) return;
        const uri = await writeTempWav(trimSilence(pcm));
        sessionTemps.push(uri);
        if (gen !== playbackGeneration) return;
        audioQueue.push({ uri, text: chunk });
        if (__DEV__) {
          console.log(`[voice] queue+ sentence ${++i} ${Date.now() - t0}ms`);
        }
        notifyConsumer();
      }
    } catch (err) {
      producerError = err;
    } finally {
      producerDone = true;
      notifyConsumer();
    }
  })();

  try {
    while (gen === playbackGeneration) {
      while (
        audioQueue.length === 0 &&
        !producerDone &&
        gen === playbackGeneration
      ) {
        await waitForQueueItem();
      }
      if (gen !== playbackGeneration) break;

      const item = audioQueue.shift();
      if (!item) {
        if (producerError) throw producerError;
        break;
      }

      store.setSubtitleText(item.text);
      await playWav(item.uri, {
        clearPlayingOnEnd: false,
        playbackRate: pitch,
        deleteAfter: false,
      });
    }
  } finally {
    await producer.catch(() => undefined);
  }

  if (gen === playbackGeneration) {
    store.setIsPlayingAudio(false);
    store.setSubtitleText(null);
  }
  await cleanupTempAudio(sessionTemps);
}

export async function speakWithKokoro(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  const clean = text.trim();
  if (!clean) return;

  void warmupKokoro();

  try {
    const chunks = splitIntoInferenceChunks(clean);
    if (chunks.length === 0) return;
    await speakChunkSource(chunks, voiceOptions);
  } catch (error) {
    console.warn('[voice] Inferenz fehlgeschlagen:', error);
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setSubtitleText(null);
    markUnavailable();
    throw error;
  }
}

/**
 * LLM→TTS: Sätze aus AsyncIterable sofort in die Producer-Queue.
 * Satz 1 startet Audio, während weitere Sätze noch generiert werden.
 */
export async function speakSentenceStream(
  sentences: AsyncIterable<string>,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  void warmupKokoro();
  try {
    await speakChunkSource(sentences, voiceOptions);
  } catch (error) {
    console.warn('[voice] Sentence-Stream fehlgeschlagen:', error);
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setSubtitleText(null);
    markUnavailable();
    throw error;
  }
}

export async function speakAssistantText(
  text: string,
  voiceOptions?: SpeakVoiceOptions,
): Promise<void> {
  await speakWithKokoro(text.trim(), voiceOptions);
}

export async function speakTwoPhase(options: {
  introText: string;
  /** Volltext wenn fertig (Legacy). */
  bodyTextPromise?: Promise<string>;
  /** Bevorzugt: Satz-Stream vom LLM — Start bei erstem ., ! oder ?. */
  bodySentenceStream?: AsyncIterable<string>;
  voice?: SpeakVoiceOptions;
}): Promise<void> {
  const intro = options.introText.trim();
  let genAfterIntro = playbackGeneration;

  if (intro) {
    await speakWithKokoro(intro, options.voice);
    genAfterIntro = playbackGeneration;
  }

  if (playbackGeneration !== genAfterIntro) return;

  if (options.bodySentenceStream) {
    await speakSentenceStream(options.bodySentenceStream, options.voice);
    return;
  }

  if (options.bodyTextPromise) {
    const body = (await options.bodyTextPromise).trim();
    if (playbackGeneration !== genAfterIntro) return;
    if (body) await speakWithKokoro(body, options.voice);
  }
}

/**
 * Hörprobe: Metro-gebündelte WAV sofort (0s), Live-Kokoro nur als Fallback.
 */
export async function playVoiceSample(options: {
  voiceId: VoiceId;
  speechRate?: number;
}): Promise<void> {
  const voiceId = options.voiceId;
  const voice = getVoice(voiceId);

  await stopKokoroPlayback();
  const gen = playbackGeneration;
  const store = useFinnusStore.getState();

  const moduleId = VOICE_SAMPLE_MODULES[voiceId];
  if (moduleId) {
    const uri = await resolveBundledAssetUri(moduleId);
    if (uri && gen === playbackGeneration) {
      store.setIsPlayingAudio(true);
      store.setSubtitleText(voice.sample);
      await playWav(uri, {
        clearPlayingOnEnd: true,
        playbackRate: 1,
        deleteAfter: false,
      });
      return;
    }
  }

  const speechRate = FIXED_SPEECH_RATE;
  const { pitch } = resolveSpeakOptions({ voiceId, speechRate });

  await warmupKokoro();
  if (!isKokoroReady()) {
    const ready = await waitReady(60_000);
    if (!ready) {
      markUnavailable();
      throw new Error(KOKORO_UNAVAILABLE_MSG);
    }
  }
  if (gen !== playbackGeneration) return;

  store.setIsPlayingAudio(true);
  store.setSubtitleText(voice.sample);

  try {
    const uri = await synthesizeWav(voice.sample, { voiceId, speechRate });
    if (gen !== playbackGeneration) return;
    await playWav(uri, { clearPlayingOnEnd: true, playbackRate: pitch });
  } catch (error) {
    console.warn('[voice] Hörprobe fehlgeschlagen:', error);
    if (gen === playbackGeneration) {
      store.setIsPlayingAudio(false);
      store.setSubtitleText(null);
    }
    throw error;
  }
}

async function tryPlayBundledIntro(fullText: string): Promise<boolean> {
  try {
    const uri = await resolveBundledAssetUri(INTRO_WAV_MODULE);
    if (!uri) return false;
    await stopKokoroPlayback();
    const store = useFinnusStore.getState();
    store.setIsPlayingAudio(true);
    store.setSubtitleText(fullText);
    await playWav(uri, { clearPlayingOnEnd: true, deleteAfter: false });
    return true;
  } catch (err) {
    console.warn('[voice] Bundled Intro abspielen:', err);
    return false;
  }
}

/** Intro mit Thorsten — zuerst Metro-WAV (0s), sonst Live-Kokoro. */
export async function speakOnboardingIntro(options: {
  fullText: string;
}): Promise<void> {
  const fullText = options.fullText.trim();
  if (!fullText) return;

  if (await tryPlayBundledIntro(fullText)) return;

  void warmupKokoro();
  await speakWithKokoro(fullText, INTRO_VOICE);
}

/**
 * Löscht ungenutzte EN-ONNX-Modelle und af_/am_/bm_-Voice-Dateien vom Gerät.
 */
export async function purgeLegacyVoiceAssets(): Promise<void> {
  console.log('[voice] Purge Legacy EN/Victoria Assets…');
  await ensureDir();

  for (const path of LEGACY_PURGE_FILES) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        await FileSystem.deleteAsync(path, { idempotent: true });
        console.log(`[voice] gelöscht: ${path}`);
      }
    } catch {
      // ignore
    }
  }

  try {
    const listing = await FileSystem.readDirectoryAsync(VOICES_DIR);
    for (const file of listing) {
      const lower = file.toLowerCase();
      if (
        LEGACY_VOICE_PREFIXES.some((p) => lower.startsWith(p)) ||
        /^(af_|am_|bm_|bf_)/i.test(file)
      ) {
        try {
          await FileSystem.deleteAsync(`${VOICES_DIR}${file}`, {
            idempotent: true,
          });
          console.log(`[voice] Voice-Leiche gelöscht: ${file}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // voices dir missing
  }
}

export async function resetVoiceSystem(): Promise<void> {
  console.log('[voice] System-Reset');
  try {
    await stopKokoroPlayback();
  } catch {
    // ignore
  }
  ortSessions.martin = undefined;
  voiceRam.clear();
  warmedUp = false;
  warmupPromise = null;
  sampleReadyKeys.clear();
  samplePrefetchPromise = null;
  prepareOnboardingPromise = null;
  prepareOnboardingKey = null;
  useFinnusStore.getState().setKokoroReady(false);

  try {
    const info = await FileSystem.getInfoAsync(MODEL_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(MODEL_DIR, { idempotent: true });
    }
  } catch (err) {
    console.warn('[voice] Cache löschen:', err);
  }
  await ensureDir();
  await FileSystem.writeAsStringAsync(
    SYSTEM_VERSION_PATH,
    VOICE_SYSTEM_VERSION,
    { encoding: FileSystem.EncodingType.UTF8 },
  );
}

/** Boot: Purge → Modell + 4 DE-Stimmen in den RAM + Hörproben-Cache. */
export function startVoiceBuffer(options?: {
  speechRate?: number;
  priorityVoiceId?: VoiceId;
}): void {
  void purgeLegacyVoiceAssets()
    .catch(() => undefined)
    .then(() => warmupKokoro())
    .then(() => {
      const pack = resolveKokoroPackId(options?.priorityVoiceId);
      void loadVoiceIntoRam(pack).catch(() => {});
      void prefetchVoiceSamples(options?.priorityVoiceId);
    });
}

export function prefetchOnboardingIntro(_fullWelcomeDe: string): Promise<void> {
  markMetroBundledSamplesReady();
  return Promise.resolve();
}

export function prefetchOnboardingAudioBundle(
  _fullWelcomeDe: string,
  _speechRate?: number,
): Promise<void> {
  markMetroBundledSamplesReady();
  void warmupKokoro();
  return Promise.resolve();
}

/**
 * Metro-WAVs sind gebündelt — kein Inferenz-Prefetch nötig.
 */
export function prefetchVoiceSamples(
  _priorityVoiceId: VoiceId = 'standard_m',
): Promise<void> {
  markMetroBundledSamplesReady();
  return Promise.resolve();
}

function allEagerSamplesReady(): boolean {
  return EAGER_SAMPLE_VOICE_IDS.every((id) =>
    sampleReadyKeys.has(sampleCacheKey(id)),
  );
}

/**
 * Ab App-Start / Sprachwahl: Warmup + 8 Metro-Hörproben (0s Play).
 */
export function prepareOnboardingVoiceSamples(options?: {
  speechRate?: number;
  priorityVoiceId?: VoiceId;
}): Promise<void> {
  markMetroBundledSamplesReady();
  void warmupKokoro();
  void loadVoiceIntoRam(
    resolveKokoroPackId(options?.priorityVoiceId ?? 'standard_m'),
  ).catch(() => undefined);
  return Promise.resolve();
}

export async function prefetchAllKokoroVoicePacks(): Promise<void> {
  await preloadAllBaseVoices();
}

export async function prefetchSingleVoiceSample(
  _voiceId: VoiceId,
  _speechRate: number = FIXED_SPEECH_RATE,
): Promise<void> {
  markMetroBundledSamplesReady();
}

export async function hydrateSampleCacheFromDisk(): Promise<void> {
  markMetroBundledSamplesReady();
  try {
    const legacyDir = `${MODEL_DIR}samples/`;
    const legacyInfo = await FileSystem.getInfoAsync(legacyDir);
    if (legacyInfo.exists) {
      await FileSystem.deleteAsync(legacyDir, { idempotent: true });
    }
  } catch {
    // ignore
  }
}

export function isVoiceSampleReady(
  voiceId: VoiceId,
  _speechRate: number = FIXED_SPEECH_RATE,
): boolean {
  return sampleReadyKeys.has(sampleCacheKey(voiceId));
}

export function isOnboardingIntroHeadReady(): boolean {
  return true;
}

export function isUsingGermanKokoro(): boolean {
  return isKokoroReady();
}

export function prefetchSystemTtsVoice(_voiceId?: VoiceId): void {
  // absichtlich leer — kein System-TTS
}

export { ONBOARDING_INTRO_HEAD_DE } from '../i18n';
export { sentencesFromFullText };