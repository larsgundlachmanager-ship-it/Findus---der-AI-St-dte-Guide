/**
 * Hybrid nav TTS prefetch — Cartesia-WAV für die nächsten Speak-Points
 * lokal cachen, damit Funkloch / Metro-Tunnel die richtige Stimme behält.
 */

import * as FileSystem from 'expo-file-system';
import {
  getVoiceSettingsForTour,
  playCachedNavCueWav,
} from '../ttsService';
import {
  hasCartesiaTtsKey,
  synthesizeCartesiaSpeechWav,
} from '../cartesiaTtsService';
import { closedVocabWarmList } from '../tts/offlinePhraseBank';

type TurnPrefetchSlot = {
  key: string;
  text: string;
  uri: string | null;
  played: boolean;
  warmedAtMs: number;
};

/** Sliding window: next speak points + status cues. */
const MAX_SLOTS = 14;
const slots = new Map<string, TurnPrefetchSlot>();
const warming = new Set<string>();

export const HYBRID_SPEAK_PREFETCH_AHEAD = 10;

export function turnPrefetchKey(
  waypointIndex: number,
  cueFingerprint: string,
): string {
  return `${waypointIndex}:${cueFingerprint.slice(0, 48)}`;
}

export function hybridStatusPrefetchKey(
  kind: 'offline_status' | 'offline_reroute',
  fingerprint: string,
): string {
  return `hybrid:${kind}:${fingerprint.slice(0, 40)}`;
}

async function deleteUri(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* ignore */
  }
}

async function evictOldestIfNeeded(): Promise<void> {
  while (slots.size >= MAX_SLOTS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, s] of slots) {
      if (k.startsWith('hybrid:')) continue;
      if (s.warmedAtMs < oldestAt) {
        oldestAt = s.warmedAtMs;
        oldestKey = k;
      }
    }
    if (!oldestKey) {
      // nur Status-Slots → ältesten Status raus
      for (const [k, s] of slots) {
        if (s.warmedAtMs < oldestAt) {
          oldestAt = s.warmedAtMs;
          oldestKey = k;
        }
      }
    }
    if (!oldestKey) break;
    const victim = slots.get(oldestKey);
    slots.delete(oldestKey);
    await deleteUri(victim?.uri ?? null);
  }
}

/**
 * Text + Cartesia-WAV vorwärmen (richtige Stimme offline).
 * Ohne Cartesia-Key: nur Text (expo-speech Fallback beim Speak).
 */
export async function warmNavTurnCue(
  key: string,
  text: string,
): Promise<void> {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed || warming.has(key)) return;

  const existing = slots.get(key);
  if (existing?.uri && existing.text === trimmed) return;
  if (existing && existing.text === trimmed && !hasCartesiaTtsKey()) return;

  warming.add(key);
  try {
    if (existing?.uri && existing.text !== trimmed) {
      await deleteUri(existing.uri);
    }

    let uri: string | null = null;
    if (hasCartesiaTtsKey()) {
      try {
        const voice = await getVoiceSettingsForTour();
        uri = await synthesizeCartesiaSpeechWav(trimmed, voice.voiceId);
      } catch (err) {
        if (__DEV__) {
          console.warn('[nav-prefetch] Cartesia warm failed:', err);
        }
        uri = null;
      }
    }

    await evictOldestIfNeeded();
    slots.set(key, {
      key,
      text: trimmed,
      uri,
      played: false,
      warmedAtMs: Date.now(),
    });
  } finally {
    warming.delete(key);
  }
}

/** true = Audio aus Prefetch-WAV gestartet (Cartesia-Stimme offline). */
export async function playPrefetchedNavTurnIfReady(
  key: string,
): Promise<boolean> {
  const slot = slots.get(key);
  if (!slot?.uri || slot.played) return false;
  try {
    const ok = await playCachedNavCueWav(slot.uri, slot.text);
    if (ok) {
      slot.played = true;
      return true;
    }
  } catch (err) {
    if (__DEV__) console.warn('[nav-prefetch] play failed:', err);
  }
  return false;
}

/** Prefetch per Speak-Point-Index (Fingerprint darf leicht abweichen). */
export async function playPrefetchedSpeakPoint(
  waypointIndex: number,
): Promise<boolean> {
  const prefix = `${waypointIndex}:`;
  for (const key of slots.keys()) {
    if (!key.startsWith(prefix)) continue;
    const played = await playPrefetchedNavTurnIfReady(key);
    if (played) return true;
  }
  return false;
}

export function takeNavTurnCueText(key: string): string | null {
  return slots.get(key)?.text ?? null;
}

export function hasPrefetchedNavAudio(key: string): boolean {
  const s = slots.get(key);
  return Boolean(s?.uri && !s.played);
}

export function countPreparedNavAudioSlots(): number {
  let n = 0;
  for (const s of slots.values()) {
    if (s.uri && !s.played && !s.key.startsWith('hybrid:')) n += 1;
  }
  return n;
}

let closedVocabWarmStarted = false;

/** Häufige Nav-/Wetter-/Halt-Sätze in den Cartesia-Dateicache — nicht in die 14 Nav-Slots. */
export async function warmClosedVocabPhrases(): Promise<void> {
  if (closedVocabWarmStarted) return;
  closedVocabWarmStarted = true;
  if (!hasCartesiaTtsKey()) return;
  try {
    const voice = await getVoiceSettingsForTour();
    for (const text of closedVocabWarmList()) {
      try {
        await synthesizeCartesiaSpeechWav(text, voice.voiceId);
      } catch {
        /* einzelne Zeile darf fehlen */
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[nav-prefetch] vocab warm failed:', err);
  }
}

export function clearNavTurnPrefetch(): void {
  const uris = [...slots.values()].map((s) => s.uri);
  slots.clear();
  warming.clear();
  for (const uri of uris) {
    void deleteUri(uri);
  }
}
