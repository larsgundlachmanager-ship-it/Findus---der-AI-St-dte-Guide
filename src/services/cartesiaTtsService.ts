/**
 * Cartesia sonic-3.5 TTS — Cloud-Bytes → lokale WAV-Datei.
 * Unterstützt AbortSignal für Queue-Flush.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../config/env';
import {
  CARTESIA_API_VERSION,
  CARTESIA_MODEL_ID,
  CARTESIA_TTS_URL,
  cartesiaVoiceUuid,
} from '../constants/cartesiaVoices';
import type { VoiceId } from '../types/userProfile';
import { trackCartesiaChars } from './cartesiaCostTracker';
import { trackTtsUsage } from './llm/apiUsageTracker';
import { trackDataBytes } from './diagnostics/resourceUsageTracker';
import {
  rememberWavDurationFromFileSize,
  rememberWavDurationMs,
  wavDurationMsFromBytes,
} from '../utils/wavDurationMs';

const AUDIO_CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}tts-cartesia/`;

export class CartesiaAbortError extends Error {
  constructor(message = 'Cartesia TTS aborted') {
    super(message);
    this.name = 'CartesiaAbortError';
  }
}

function resolveApiKey(): string {
  if (env.useLlmProxy()) return '';
  const key = env.cartesiaApiKey();
  if (!key || key.includes('your-key-here') || key.includes('your-cartesia')) {
    return '';
  }
  return key;
}

export function hasCartesiaTtsKey(): boolean {
  if (resolveApiKey()) return true;
  return (
    env.useLlmProxy() &&
    Boolean(env.cartesiaProxyUrl()) &&
    Boolean(env.supabaseAnonKey())
  );
}

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_CACHE_DIR, {
      intermediates: true,
    });
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

/** Cartesia sonic-3 generation_config (Emotion/Speed/Volume). */
export type CartesiaGenerationConfig = {
  /** 0.6–1.5 */
  speed?: number;
  /** 0.5–2.0 */
  volume?: number;
  /** z. B. anxious, frustrated, determined, excited, happy */
  emotion?: string;
};

function sanitizeGenerationConfig(
  cfg?: CartesiaGenerationConfig | null,
): CartesiaGenerationConfig | undefined {
  if (!cfg) return undefined;
  const out: CartesiaGenerationConfig = {};
  if (typeof cfg.speed === 'number' && Number.isFinite(cfg.speed)) {
    out.speed = Math.min(1.5, Math.max(0.6, cfg.speed));
  }
  if (typeof cfg.volume === 'number' && Number.isFinite(cfg.volume)) {
    out.volume = Math.min(2.0, Math.max(0.5, cfg.volume));
  }
  // Kein emotion: Cartesia-Emotion-Tags sind EN-trainiert (Leo/Maya/…).
  // Auf de-DE-Stimmen (Alina/Sebastian) erzeugen sie den US-Akzent.
  // Hörproben senden bewusst kein emotion — Live muss das matchen.
  // Dynamik kommt aus deutschem Text + Interpunktion (Cartesia-Default).
  return out.speed != null || out.volume != null ? out : undefined;
}

async function fetchWavBuffer(
  apiKey: string,
  transcript: string,
  voiceId: VoiceId | undefined,
  signal?: AbortSignal,
  generationConfig?: CartesiaGenerationConfig,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new CartesiaAbortError();
  const cartesiaId = cartesiaVoiceUuid(voiceId);
  const useProxy = env.useLlmProxy();
  const endpoint = useProxy ? env.cartesiaProxyUrl() : CARTESIA_TTS_URL;
  const anon = env.supabaseAnonKey();
  if (!endpoint) {
    throw new Error('Cartesia TTS: endpoint missing');
  }
  if (useProxy && !anon) {
    throw new Error('Cartesia TTS: proxy needs EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    if (useProxy) {
      xhr.setRequestHeader('Authorization', `Bearer ${anon}`);
      xhr.setRequestHeader('apikey', anon);
    } else {
      xhr.setRequestHeader('X-API-Key', apiKey);
    }
    xhr.setRequestHeader('Cartesia-Version', CARTESIA_API_VERSION);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'arraybuffer';

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      reject(new CartesiaAbortError());
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = '';
        try {
          const text = new TextDecoder().decode(
            new Uint8Array(xhr.response as ArrayBuffer),
          );
          detail = text.slice(0, 200);
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `Cartesia TTS ${xhr.status}${detail ? `: ${detail}` : ''}`,
          ),
        );
        return;
      }
      resolve(new Uint8Array(xhr.response as ArrayBuffer));
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Cartesia TTS network error'));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new CartesiaAbortError());
    };
    const payload: Record<string, unknown> = {
      model_id: CARTESIA_MODEL_ID,
      transcript,
      language: 'de',
      voice: { mode: 'id', id: cartesiaId },
      output_format: {
        container: 'wav',
        encoding: 'pcm_s16le',
        sample_rate: 44100,
      },
    };
    const dictId = env.cartesiaPronunciationDictId();
    if (dictId) payload.pronunciation_dict_id = dictId;
    const gen = sanitizeGenerationConfig(generationConfig);
    if (gen) payload.generation_config = gen;

    xhr.send(JSON.stringify(payload));
  });
}

export type SynthesizeCartesiaOptions = {
  voiceId?: VoiceId;
  signal?: AbortSignal;
  generationConfig?: CartesiaGenerationConfig;
};

/**
 * Synthesizes speech via Cartesia sonic-3.5 → writes WAV temp file → returns URI.
 */
export async function synthesizeCartesiaSpeechWav(
  text: string,
  voiceIdOrOpts?: VoiceId | SynthesizeCartesiaOptions,
): Promise<string> {
  const opts: SynthesizeCartesiaOptions =
    typeof voiceIdOrOpts === 'string' || voiceIdOrOpts == null
      ? { voiceId: voiceIdOrOpts }
      : voiceIdOrOpts;

  const apiKey = resolveApiKey();
  if (!hasCartesiaTtsKey()) {
    throw new Error(
      'Cartesia TTS: Key fehlt — setze EXPO_PUBLIC_CARTESIA_API_KEY oder EXPO_PUBLIC_USE_LLM_PROXY=1.',
    );
  }

  const input = text.replace(/\s+/g, ' ').trim();
  if (!input) {
    throw new Error('Cartesia TTS: leerer Text');
  }

  const clipped = input.length > 8000 ? input.slice(0, 8000) : input;

  // Content-Hash-Cache: gleiche Floskel/Intro/Voice → kein zweiter Cloud-Call
  const voiceKey = String(opts.voiceId ?? 'default');
  const gen = sanitizeGenerationConfig(opts.generationConfig);
  const genKey = gen
    ? `${gen.speed ?? ''}_${gen.volume ?? ''}_${gen.emotion ?? ''}`
    : '';
  const hash = simpleHash(`${voiceKey}|${genKey}|${clipped}`);
  const cacheUri = `${AUDIO_CACHE_DIR}cart_h_${hash}.wav`;
  await ensureCacheDir();
  try {
    const info = await FileSystem.getInfoAsync(cacheUri);
    if (info.exists && (info.size ?? 0) > 44) {
      rememberWavDurationFromFileSize(cacheUri, Number(info.size) || 0);
      return cacheUri;
    }
  } catch {
    /* miss */
  }

  const bytes = await fetchWavBuffer(
    apiKey,
    clipped,
    opts.voiceId,
    opts.signal,
    opts.generationConfig,
  );
  if (bytes.length < 44) {
    throw new Error('Cartesia TTS: leere Audio-Antwort');
  }

  trackCartesiaChars(clipped.length);
  trackTtsUsage(clipped.length, true);
  trackDataBytes('cartesia', bytes.length, clipped.length * 2);

  await FileSystem.writeAsStringAsync(cacheUri, uint8ToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  rememberWavDurationMs(cacheUri, wavDurationMsFromBytes(bytes));
  return cacheUri;
}

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function deleteCartesiaTempAudio(uri: string): Promise<void> {
  // Content-Hash-Cache behalten (Wiederverwendung)
  if (uri.includes('cart_h_')) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}
