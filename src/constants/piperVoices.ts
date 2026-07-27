import type { VoiceId } from '../types/userProfile';

/**
 * Deutsche Piper-ONNX-Modelle — Männerstimmen (Hybrid).
 * Frauen (standard_w, prinzessin) → Kokoro de_eva, nicht hier.
 */
export type PiperVoiceModelId =
  | 'de_DE-thorsten-medium'
  | 'de_DE-thorsten_emotional'
  | 'de_DE-thorsten-high'
  | 'de_DE-karl-medium'
  | 'de_DE-m_aishel-medium';

export type PiperVoiceModel = {
  id: PiperVoiceModelId;
  fileBase: string;
  onnxFile: string;
  jsonFile: string;
  espeakVoice: string;
  defaultSpeakerId: number;
  sampleRate: number;
  description: string;
  lengthScale?: number;
  volumeGain?: number;
};

export const PIPER_VOICE_MODELS: Record<PiperVoiceModelId, PiperVoiceModel> = {
  'de_DE-thorsten-medium': {
    id: 'de_DE-thorsten-medium',
    fileBase: 'de_DE-thorsten-medium',
    onnxFile: 'de_DE-thorsten-medium.onnx',
    jsonFile: 'de_DE-thorsten-medium.onnx.json',
    espeakVoice: 'de',
    defaultSpeakerId: 0,
    sampleRate: 22050,
    description: 'Ruhige Guide-Stimme (22 kHz medium)',
    lengthScale: 1.03,
  },
  'de_DE-thorsten_emotional': {
    id: 'de_DE-thorsten_emotional',
    fileBase: 'de_DE-thorsten_emotional',
    onnxFile: 'de_DE-thorsten_emotional.onnx',
    jsonFile: 'de_DE-thorsten_emotional.onnx.json',
    espeakVoice: 'de',
    /** surprised — energischer Teen-Vibe (0=amused). */
    defaultSpeakerId: 6,
    sampleRate: 22050,
    description: 'Lebendig (emotional / surprised) — Gen Z ~16',
    /** Unter 1 = flotter, passt zu Teen-Energy. */
    lengthScale: 0.92,
    volumeGain: 1.12,
  },
  'de_DE-thorsten-high': {
    id: 'de_DE-thorsten-high',
    fileBase: 'de_DE-thorsten-high',
    onnxFile: 'de_DE-thorsten-high.onnx',
    jsonFile: 'de_DE-thorsten-high.onnx.json',
    espeakVoice: 'de',
    defaultSpeakerId: 0,
    sampleRate: 22050,
    description: 'Tiefe Kinostimme',
  },
  'de_DE-karl-medium': {
    id: 'de_DE-karl-medium',
    fileBase: 'de_DE-karl-medium',
    onnxFile: 'de_DE-karl-medium.onnx',
    jsonFile: 'de_DE-karl-medium.onnx.json',
    espeakVoice: 'de',
    defaultSpeakerId: 0,
    sampleRate: 22050,
    description: 'Gemütliche Männerstimme',
  },
  'de_DE-m_aishel-medium': {
    id: 'de_DE-m_aishel-medium',
    fileBase: 'de_DE-m_aishel-medium',
    onnxFile: 'de_DE-m_aishel-medium.onnx',
    jsonFile: 'de_DE-m_aishel-medium.onnx.json',
    espeakVoice: 'de',
    defaultSpeakerId: 0,
    sampleRate: 22050,
    description: 'Akademiker (pavoque) — klar und zügig',
    /** Unter 1.0: weniger gezogen, Silben klarer. */
    lengthScale: 0.96,
    volumeGain: 1.18,
  },
};

export const VOICE_ID_TO_PIPER_MODEL: Partial<
  Record<VoiceId, PiperVoiceModelId>
> = {
  standard_m: 'de_DE-thorsten-medium',
  erzaehler: 'de_DE-thorsten-high',
  dorfaeltester: 'de_DE-karl-medium',
  gen_z: 'de_DE-thorsten_emotional',
  historiker: 'de_DE-m_aishel-medium',
};

export const DEFAULT_PIPER_MODEL: PiperVoiceModelId = 'de_DE-thorsten-medium';

export const ALL_PIPER_MODEL_IDS: readonly PiperVoiceModelId[] = [
  'de_DE-thorsten-medium',
  'de_DE-thorsten_emotional',
  'de_DE-thorsten-high',
  'de_DE-karl-medium',
  'de_DE-m_aishel-medium',
] as const;

export function getPiperModel(id: PiperVoiceModelId): PiperVoiceModel {
  return PIPER_VOICE_MODELS[id];
}

export function resolvePiperModelId(
  voiceId?: VoiceId | null,
): PiperVoiceModelId {
  if (!voiceId) return DEFAULT_PIPER_MODEL;
  return VOICE_ID_TO_PIPER_MODEL[voiceId] ?? DEFAULT_PIPER_MODEL;
}

export function piperAssetRelPath(fileName: string): string {
  return `piper/${fileName}`;
}
