/**
 * OpenAI Speech API (tts-1 / voice nova) — Cloud-TTS für Findus.
 */

import * as FileSystem from 'expo-file-system';
import { env } from '../config/env';

export const OPENAI_TTS_MODEL = 'tts-1';
export const OPENAI_TTS_VOICE = 'nova';
export const OPENAI_TTS_SPEED = 1.0;
export const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

const AUDIO_CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}tts-openai/`;

function resolveApiKey(): string {
  const key = env.openAiApiKey();
  if (!key || key.includes('your-key-here')) return '';
  return key;
}

export function hasOpenAiTtsKey(): boolean {
  return Boolean(resolveApiKey());
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

/**
 * Binary fetch — React Native: XHR arraybuffer ist robuster als response.arrayBuffer().
 */
async function fetchMp3Buffer(
  apiKey: string,
  input: string,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', OPENAI_TTS_URL);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`OpenAI TTS ${xhr.status}`));
        return;
      }
      resolve(new Uint8Array(xhr.response as ArrayBuffer));
    };
    xhr.onerror = () => reject(new Error('OpenAI TTS network error'));
    xhr.send(
      JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input,
        speed: OPENAI_TTS_SPEED,
        response_format: 'mp3',
      }),
    );
  });
}

/**
 * Synthesizes speech via OpenAI TTS → writes MP3 temp file → returns URI.
 */
export async function synthesizeOpenAiSpeechMp3(
  text: string,
): Promise<string> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      'OpenAI TTS: EXPO_PUBLIC_OPENAI_API_KEY fehlt oder ist Platzhalter.',
    );
  }

  const input = text.replace(/\s+/g, ' ').trim();
  if (!input) {
    throw new Error('OpenAI TTS: leerer Text');
  }

  // OpenAI limit ~4096 chars
  const clipped = input.length > 4000 ? input.slice(0, 4000) : input;
  const bytes = await fetchMp3Buffer(apiKey, clipped);
  if (bytes.length < 32) {
    throw new Error('OpenAI TTS: leere Audio-Antwort');
  }

  await ensureCacheDir();
  const uri = `${AUDIO_CACHE_DIR}oai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
  await FileSystem.writeAsStringAsync(uri, uint8ToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

export async function deleteOpenAiTempAudio(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}
