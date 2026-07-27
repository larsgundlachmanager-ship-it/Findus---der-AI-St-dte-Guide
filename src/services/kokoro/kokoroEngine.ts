/**
 * Kokoro Martin-ONNX + Style-Pack (de_eva) für Frauenstimmen.
 * Phonemisierung: natives espeak → Kokoro-IPA → Vocab-Tokens.
 */
import * as FileSystem from 'expo-file-system';
import {
  nativeCopyAssetFile,
  nativeAssetFileSize,
} from 'findus-espeak';
import {
  getKokoroVoicePack,
  kokoroModelAssetRelPath,
  kokoroVoiceAssetRelPath,
  resolveKokoroPackId,
  kokoroSpeedForVoice,
  type KokoroVoicePackId,
} from '../../constants/kokoroVoicePacks';
import { tokenIdForPhoneme } from '../../constants/kokoroVocab';
import type { VoiceId } from '../../types/userProfile';
import {
  phonemizeGermanAsync,
  warmupGermanG2P,
  prepareAudioText,
  phonemizeWithPronunciationMap,
  getCityPronunciationMap,
  loadPronunciationDictionary,
} from '../g2p';
import { getCachedUserProfile } from '../userProfileService';

const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
const STYLE_FRAMES = 510;
const MODEL_DIR = `${FileSystem.documentDirectory}kokoro/`;
const VOICES_DIR = `${MODEL_DIR}voices/`;
const MODEL_PATH = `${MODEL_DIR}kokoro-martin.onnx`;

type OrtTensor = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (type: string, data: any, dims: number[]): any;
};

type OrtSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
  inputNames: string[];
  outputNames: string[];
};

type OrtModule = {
  Tensor: OrtTensor;
  InferenceSession: {
    create: (path: string, options?: object) => Promise<OrtSession>;
  };
};

let ortModule: OrtModule | null = null;
let ortTried = false;
let session: OrtSession | null = null;
const voiceRam = new Map<KokoroVoicePackId, Float32Array>();
let kokoroReady = false;
let kokoroLoading = false;
let inferChain: Promise<unknown> = Promise.resolve();

function enqueueInfer<T>(fn: () => Promise<T>): Promise<T> {
  const next = inferChain.then(fn, fn);
  inferChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function toNativeFsPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) {
    return decodeURIComponent(uriOrPath.replace(/^file:\/\//, ''));
  }
  return uriOrPath;
}

async function getOrt(): Promise<OrtModule | null> {
  if (ortTried) return ortModule;
  ortTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ortModule = require('onnxruntime-react-native') as OrtModule;
    return ortModule;
  } catch (err) {
    console.warn('[kokoro] onnxruntime nicht geladen:', err);
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function ensureMartinModel(): Promise<string> {
  await ensureDir(MODEL_DIR);
  const info = await FileSystem.getInfoAsync(MODEL_PATH);
  if (info.exists && (info.size ?? 0) > 1_000_000) {
    return toNativeFsPath(MODEL_PATH);
  }
  const ok = await nativeCopyAssetFile(
    kokoroModelAssetRelPath(),
    toNativeFsPath(MODEL_PATH),
  );
  if (!ok) {
    throw new Error(
      `[kokoro] Modell fehlt: kokoro-martin.onnx (Asset ${kokoroModelAssetRelPath()})`,
    );
  }
  return toNativeFsPath(MODEL_PATH);
}

async function ensureVoicePack(packId: KokoroVoicePackId): Promise<string> {
  await ensureDir(VOICES_DIR);
  const pack = getKokoroVoicePack(packId);
  const dest = `${VOICES_DIR}${pack.fileName}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && (info.size ?? 0) > 10_000) {
    return dest;
  }
  const ok = await nativeCopyAssetFile(
    kokoroVoiceAssetRelPath(packId),
    toNativeFsPath(dest),
  );
  if (!ok) {
    throw new Error(
      `[kokoro] Pack fehlt: ${pack.fileName} (Asset ${kokoroVoiceAssetRelPath(packId)})`,
    );
  }
  return dest;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadVoiceIntoRam(
  packId: KokoroVoicePackId,
): Promise<Float32Array> {
  const cached = voiceRam.get(packId);
  if (cached) return cached;

  const path = await ensureVoicePack(packId);
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
    throw new Error(`[kokoro] Pack ${packId} ungültig (${floats.length} floats)`);
  }

  voiceRam.set(packId, styles);
  return styles;
}

function pickStyle(styles: Float32Array, tokenLen: number): Float32Array {
  const index = Math.min(Math.max(tokenLen, 0), STYLE_FRAMES - 1);
  return styles.subarray(index * STYLE_DIM, index * STYLE_DIM + STYLE_DIM);
}

async function getSession(): Promise<OrtSession> {
  if (session) return session;
  const ort = await getOrt();
  if (!ort) throw new Error('[kokoro] onnxruntime nicht verfügbar');
  const path = await ensureMartinModel();
  session = await ort.InferenceSession.create(path, {
    executionProviders: ['cpu'],
  });
  return session;
}

async function textToTokens(text: string): Promise<BigInt64Array> {
  const normalized = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const cityId = getCachedUserProfile()?.cityId ?? null;
  await loadPronunciationDictionary();
  const cityMap = await getCityPronunciationMap(cityId);

  // Satzzeichen einzeln phonemisieren + Kokoro-Pause-Tokens reinsetzen.
  // espeak liefert sonst nur IPA ohne , . ! ? → „ohne Punkt und Komma“.
  const chunks = normalized.split(/([,.!?;:…–—])/);
  const phonemeChunks: string[] = [];
  for (const chunk of chunks) {
    const part = chunk.trim();
    if (!part) continue;
    if (/^[,.!?;:…–—]$/.test(part)) {
      const punct =
        part === '…' || part === '–' || part === '—' || part === ';' || part === ':'
          ? ','
          : part;
      phonemeChunks.push(punct);
      continue;
    }
    const ph = await phonemizeWithPronunciationMap(
      part,
      (segment) => phonemizeGermanAsync(segment),
      cityMap,
    );
    if (ph.trim()) phonemeChunks.push(ph.trim());
  }
  const phonemes = phonemeChunks.join(' ');
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

export async function warmupKokoroEngine(options?: {
  voiceId?: VoiceId;
  onProgress?: (label: string) => void;
}): Promise<void> {
  if (kokoroReady && session) {
    const pack = resolveKokoroPackId(options?.voiceId);
    await loadVoiceIntoRam(pack);
    return;
  }
  if (kokoroLoading) return;
  kokoroLoading = true;
  try {
    options?.onProgress?.('Kokoro Frauenstimme laden');
    await warmupGermanG2P();
    await getOrt();
    await getSession();
    const pack = resolveKokoroPackId(options?.voiceId);
    await loadVoiceIntoRam(pack);
    kokoroReady = true;
    console.log(`[kokoro] Bereit — ${pack}`);
  } finally {
    kokoroLoading = false;
  }
}

export function isKokoroEngineReady(): boolean {
  return kokoroReady && session != null;
}

export function isKokoroEngineLoading(): boolean {
  return kokoroLoading;
}

export async function ensureKokoroPack(
  packId: KokoroVoicePackId,
): Promise<void> {
  await getSession();
  await loadVoiceIntoRam(packId);
  kokoroReady = true;
}

export async function synthesizeKokoroPcm(
  text: string,
  options?: { voiceId?: VoiceId; speed?: number },
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const prepared = prepareAudioText(text);
  const clean = prepared.trim();
  if (!clean) throw new Error('[kokoro] Leerer Text');

  const packId = resolveKokoroPackId(options?.voiceId);
  const speed =
    options?.speed ?? kokoroSpeedForVoice(options?.voiceId);

  return enqueueInfer(async () => {
    const ort = await getOrt();
    if (!ort) throw new Error('[kokoro] onnxruntime nicht verfügbar');

    const sess = await getSession();
    const styles = await loadVoiceIntoRam(packId);
    const tokens = await textToTokens(clean);
    if (tokens.length < 3) {
      throw new Error('[kokoro] Zu wenige Tokens');
    }
    const style = pickStyle(styles, Number(tokens.length));

    const feeds: Record<string, unknown> = {};
    const inputNames = sess.inputNames;
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
        BigInt64Array.from([BigInt('d'.charCodeAt(0))]),
        [1],
      );
    }

    const results = await sess.run(feeds);
    const outName =
      sess.outputNames.find((n) => /audio|waveform|output/i.test(n)) ??
      sess.outputNames[0];
    const audioData = results[outName]?.data;
    if (!audioData?.length) throw new Error('[kokoro] Kein Audio');

    const pcmRaw =
      audioData instanceof Float32Array
        ? audioData
        : Float32Array.from(audioData as ArrayLike<number>);

    return { pcm: softNormalize(pcmRaw), sampleRate: SAMPLE_RATE };
  });
}

function softNormalize(pcm: Float32Array, targetPeak = 0.88): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return pcm;
  const scale = Math.min(targetPeak / peak, 2.5);
  if (Math.abs(scale - 1) < 0.03) return pcm;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-1, Math.min(1, pcm[i] * scale));
  }
  return out;
}

export async function kokoroAssetsBundled(): Promise<boolean> {
  const modelSize = await nativeAssetFileSize(kokoroModelAssetRelPath());
  const voiceSize = await nativeAssetFileSize(kokoroVoiceAssetRelPath('de_eva'));
  return modelSize > 1_000_000 && voiceSize > 10_000;
}

export function unloadKokoroEngine(): void {
  session = null;
  voiceRam.clear();
  kokoroReady = false;
}

export function resetKokoroEngine(): void {
  unloadKokoroEngine();
  ortTried = false;
  ortModule = null;
}
