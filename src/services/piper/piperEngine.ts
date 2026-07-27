/**
 * Piper VITS-Inferenz über onnxruntime-react-native.
 * Phonemisierung: natives espeak-ng (internes Piper-Phonemize, kein Kokoro-G2P).
 */
import * as FileSystem from 'expo-file-system';
import {
  nativeCopyAssetFile,
  nativeEspeakInitialize,
  nativeEspeakIsReady,
  nativeEspeakTextToPhonemes,
  isNativeEspeakAvailable,
  nativeAssetFileSize,
} from 'findus-espeak';
import {
  getPiperModel,
  piperAssetRelPath,
  resolvePiperModelId,
  PIPER_VOICE_MODELS,
  type PiperVoiceModelId,
} from '../../constants/piperVoices';
import type { VoiceId } from '../../types/userProfile';

export type PiperConfig = {
  audio: { sample_rate: number; quality?: string };
  espeak: { voice: string };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  phoneme_type: string;
  phoneme_id_map: Record<string, number[]>;
  num_speakers: number;
  speaker_id_map?: Record<string, number>;
};

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

/** Peak-Normalisierung + optionaler Extra-Gain (leise Low-Quality-Modelle). */
function applyOutputGain(pcm: Float32Array, volumeGain = 1): Float32Array {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return pcm;
  const scale = Math.min(0.95 / peak, 4) * Math.max(0.5, volumeGain);
  if (Math.abs(scale - 1) < 0.02) return pcm;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-1, Math.min(1, pcm[i] * scale));
  }
  return out;
}

const MODEL_DIR = `${FileSystem.documentDirectory}piper/`;
const sessions = new Map<string, OrtSession>();
const configs = new Map<string, PiperConfig>();
let ortModule: OrtModule | null = null;
let ortTried = false;
let piperReady = false;
let piperLoading = false;
let inferChain: Promise<unknown> = Promise.resolve();
let activeModelId: PiperVoiceModelId | null = null;

/** Expo liefert `file:///…` — natives JNI/ORT braucht absolute FS-Pfade. */
function toNativeFsPath(uriOrPath: string): string {
  let p = uriOrPath.trim();
  if (p.startsWith('file://')) {
    p = p.slice('file://'.length);
    // file:///data/... → /data/...
    if (/^\/[A-Za-z]:\//.test(p)) {
      // Windows-style file:///C:/... — nicht relevant auf Device
      p = p.replace(/^\/([A-Za-z]:)/, '$1');
    }
  }
  return p;
}

function enqueueInfer<T>(task: () => Promise<T>): Promise<T> {
  const run = inferChain.then(task, task);
  inferChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function getOrt(): Promise<OrtModule | null> {
  if (ortTried) return ortModule;
  ortTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ortModule = require('onnxruntime-react-native') as OrtModule;
    return ortModule;
  } catch (err) {
    console.warn('[piper] onnxruntime-react-native nicht geladen:', err);
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

async function ensureModelFiles(modelId: PiperVoiceModelId): Promise<{
  /** Absoluter FS-Pfad für JNI / onnxruntime */
  onnxPath: string;
  jsonPath: string;
  /** Expo-FileSystem-URI (file://…) */
  onnxUri: string;
  jsonUri: string;
}> {
  await ensureDir(MODEL_DIR);
  const model = getPiperModel(modelId);
  const onnxUri = `${MODEL_DIR}${model.onnxFile}`;
  const jsonUri = `${MODEL_DIR}${model.jsonFile}`;
  const onnxNative = toNativeFsPath(onnxUri);
  const jsonNative = toNativeFsPath(jsonUri);

  const onnxInfo = await FileSystem.getInfoAsync(onnxUri);
  if (!onnxInfo.exists || (onnxInfo.size ?? 0) < 1_000_000) {
    const ok = await nativeCopyAssetFile(
      piperAssetRelPath(model.onnxFile),
      onnxNative,
    );
    if (!ok) {
      throw new Error(
        `[piper] Modell fehlt: ${model.onnxFile} (Asset piper/${model.onnxFile} → ${onnxNative})`,
      );
    }
  }

  const jsonInfo = await FileSystem.getInfoAsync(jsonUri);
  if (!jsonInfo.exists || (jsonInfo.size ?? 0) < 100) {
    const ok = await nativeCopyAssetFile(
      piperAssetRelPath(model.jsonFile),
      jsonNative,
    );
    if (!ok) {
      throw new Error(`[piper] Config fehlt: ${model.jsonFile}`);
    }
  }

  return {
    onnxPath: onnxNative,
    jsonPath: jsonNative,
    onnxUri,
    jsonUri,
  };
}

async function loadConfig(modelId: PiperVoiceModelId): Promise<PiperConfig> {
  const key = getPiperModel(modelId).fileBase;
  const cached = configs.get(key);
  if (cached) {
    configs.set(modelId, cached);
    return cached;
  }
  const { jsonUri } = await ensureModelFiles(modelId);
  const raw = await FileSystem.readAsStringAsync(jsonUri);
  const cfg = JSON.parse(raw) as PiperConfig;
  configs.set(key, cfg);
  configs.set(modelId, cfg);
  return cfg;
}

async function getSession(modelId: PiperVoiceModelId): Promise<OrtSession> {
  const key = getPiperModel(modelId).fileBase;
  const existing = sessions.get(key) ?? sessions.get(modelId);
  if (existing) {
    sessions.set(modelId, existing);
    return existing;
  }
  const ort = await getOrt();
  if (!ort) throw new Error('[piper] onnxruntime nicht verfügbar');
  const { onnxPath } = await ensureModelFiles(modelId);
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ['cpu'],
  });
  sessions.set(key, session);
  sessions.set(modelId, session);
  return session;
}

/**
 * Initialisiert Piper: ort + aktives Modell + internes Phonemize (espeak-ng-data).
 * espeak bleibt nur Engine-Interna — kein Kokoro-G2P mehr.
 */
export async function warmupPiper(options?: {
  voiceId?: VoiceId;
  onProgress?: (label: string) => void;
}): Promise<void> {
  if (piperReady && activeModelId) {
    const want = resolvePiperModelId(options?.voiceId);
    if (want === activeModelId) return;
  }
  if (piperLoading) return;
  piperLoading = true;
  try {
    options?.onProgress?.('Piper-Engine starten');
    const ort = await getOrt();
    if (!ort) throw new Error('[piper] onnxruntime fehlt');

    // Phonemize: espeak-ng-data aus APK (via bestehendes Native-Modul)
    if (isNativeEspeakAvailable() && !nativeEspeakIsReady()) {
      const dataParent = `${FileSystem.documentDirectory}`;
      const dataDir = `${dataParent}espeak-ng-data`;
      const info = await FileSystem.getInfoAsync(`${dataDir}/phontab`);
      if (!info.exists) {
        // Plugin legt espeak-ng-data in APK-assets — copy tree lazily via single marker
        // Initialize with asset path hint; FindusEspeak extracts if needed
        await nativeEspeakInitialize(FileSystem.documentDirectory ?? '', 'de');
      } else {
        await nativeEspeakInitialize(dataParent, 'de');
      }
    }

    const modelId = resolvePiperModelId(options?.voiceId);
    options?.onProgress?.(`Piper-Modell ${modelId}`);
    await getSession(modelId);
    await loadConfig(modelId);
    activeModelId = modelId;
    piperReady = true;
    console.log(`[piper] Bereit — ${modelId}`);
  } finally {
    piperLoading = false;
  }
}

export function isPiperReady(): boolean {
  return piperReady && sessions.size > 0;
}

export function isPiperLoading(): boolean {
  return piperLoading;
}

export function getActivePiperModelId(): PiperVoiceModelId | null {
  return activeModelId;
}

export async function ensurePiperModel(
  modelId: PiperVoiceModelId,
): Promise<void> {
  await getSession(modelId);
  await loadConfig(modelId);
  activeModelId = modelId;
  piperReady = true;
}

export function unloadPiperModel(modelId: PiperVoiceModelId): void {
  const key = getPiperModel(modelId).fileBase;
  sessions.delete(modelId);
  sessions.delete(key);
  configs.delete(modelId);
  configs.delete(key);
  if (activeModelId === modelId || activeModelId && getPiperModel(activeModelId).fileBase === key) {
    activeModelId = null;
    piperReady = sessions.size > 0;
  }
}

export function unloadInactivePiperModels(keep: PiperVoiceModelId): void {
  const keepKey = getPiperModel(keep).fileBase;
  for (const id of Object.keys(PIPER_VOICE_MODELS) as PiperVoiceModelId[]) {
    if (getPiperModel(id).fileBase === keepKey) continue;
    unloadPiperModel(id);
  }
  for (const key of [...sessions.keys()]) {
    if (key === keep || key === keepKey) continue;
    sessions.delete(key);
    configs.delete(key);
  }
}

/** IPA/Phoneme von espeak → Piper phoneme_id_map IDs inkl. ^…$ Padding. */
export function phonemesToIds(
  phonemeStr: string,
  idMap: Record<string, number[]>,
): bigint[] {
  const ids: number[] = [];
  const bos = idMap['^'] ?? [1];
  const eos = idMap['$'] ?? [2];
  const pad = idMap['_'] ?? [0];
  ids.push(...bos);
  ids.push(...pad);

  for (const ch of phonemeStr) {
    const mapped = idMap[ch];
    if (mapped?.length) {
      ids.push(...mapped);
      ids.push(...pad);
    }
  }

  ids.push(...eos);
  return ids.map((n) => BigInt(n));
}

async function phonemizeForPiper(
  text: string,
  espeakVoice: string,
): Promise<string> {
  if (!isNativeEspeakAvailable()) {
    throw new Error(
      '[piper] Native Phonemize fehlt — Dev Client mit findus-espeak neu bauen.',
    );
  }
  if (!nativeEspeakIsReady()) {
    await nativeEspeakInitialize(FileSystem.documentDirectory ?? '', espeakVoice);
  }
  return nativeEspeakTextToPhonemes(text, espeakVoice);
}

/**
 * Text → Float32 PCM (Sample-Rate aus Modell-Config, typ. 22050).
 */
export async function synthesizePiperPcm(
  text: string,
  options?: { voiceId?: VoiceId; lengthScale?: number },
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('[piper] Leerer Text');

  const modelId = resolvePiperModelId(options?.voiceId);
  return enqueueInfer(async () => {
    const ort = await getOrt();
    if (!ort) throw new Error('[piper] onnxruntime nicht verfügbar');

    const cfg = await loadConfig(modelId);
    const session = await getSession(modelId);
    const meta = getPiperModel(modelId);

    const phonemes = await phonemizeForPiper(
      clean,
      cfg.espeak?.voice ?? meta.espeakVoice,
    );
    if (!phonemes.trim()) {
      throw new Error('[piper] Phonemize lieferte leer');
    }

    const idArr = phonemesToIds(phonemes, cfg.phoneme_id_map);
    if (idArr.length < 3) {
      throw new Error('[piper] Zu wenige Phonem-IDs');
    }

    const noiseScale = cfg.inference?.noise_scale ?? 0.667;
    const lengthScale =
      options?.lengthScale ??
      meta.lengthScale ??
      cfg.inference?.length_scale ??
      1.0;
    const noiseW = cfg.inference?.noise_w ?? 0.8;

    const feeds: Record<string, unknown> = {};
    const names = session.inputNames;

    const inputName =
      names.find((n) => n === 'input' || /input$/i.test(n)) ?? names[0];
    const lengthsName =
      names.find((n) => /input_lengths|length/i.test(n)) ?? names[1];
    const scalesName =
      names.find((n) => /scales/i.test(n)) ?? names[2];
    const sidName = names.find((n) => /sid|speaker/i.test(n));

    feeds[inputName] = new ort.Tensor('int64', BigInt64Array.from(idArr), [
      1,
      idArr.length,
    ]);
    feeds[lengthsName] = new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(idArr.length)]),
      [1],
    );
    feeds[scalesName] = new ort.Tensor(
      'float32',
      Float32Array.from([noiseScale, lengthScale, noiseW]),
      [3],
    );
    if (sidName && (cfg.num_speakers ?? 1) > 1) {
      feeds[sidName] = new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(meta.defaultSpeakerId)]),
        [1],
      );
    }

    const results = await session.run(feeds);
    const outName =
      session.outputNames.find((n) => /audio|output|wav/i.test(n)) ??
      session.outputNames[0];
    const audioData = results[outName]?.data;
    if (!audioData?.length) throw new Error('[piper] Kein Audio');

    const pcmRaw =
      audioData instanceof Float32Array
        ? audioData
        : Float32Array.from(audioData as ArrayLike<number>);
    const pcm = applyOutputGain(pcmRaw, meta.volumeGain ?? 1);

    return {
      pcm,
      sampleRate: cfg.audio?.sample_rate ?? meta.sampleRate,
    };
  });
}

export async function assetBundled(modelId: PiperVoiceModelId): Promise<boolean> {
  const model = getPiperModel(modelId);
  const size = await nativeAssetFileSize(piperAssetRelPath(model.onnxFile));
  return size > 1_000_000;
}

export function resetPiperEngine(): void {
  sessions.clear();
  configs.clear();
  activeModelId = null;
  piperReady = false;
  piperLoading = false;
}
