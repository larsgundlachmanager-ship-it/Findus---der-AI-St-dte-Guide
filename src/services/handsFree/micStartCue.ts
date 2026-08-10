/**
 * Kurzes Cue wenn Hands-free / Live-Chat startet (Haptik + weicher Musik-Chime).
 */

import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { getHandsFreePrefsSync, loadHandsFreePrefs } from './handsFreePrefs';

let beepUri: string | null = null;
let sound: Audio.Sound | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return out;
}

/**
 * Weicher zweitöniger Chime (C5 → E5, große Terz) — gläsern, kurz, nicht piepsig.
 * Attack weich, Decay länger, leichte 2. Harmonische für Wärme.
 */
function buildChimeWavBase64(): string {
  const sampleRate = 44100;
  const ms = 340;
  const n = Math.floor((sampleRate * ms) / 1000);
  const dataSize = n * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // C5 → E5 (angenehme große Terz)
  const f1 = 523.25;
  const f2 = 659.25;
  const note2Start = Math.floor(sampleRate * 0.078); // ~78 ms
  const attack = Math.floor(sampleRate * 0.012);
  const release1 = Math.floor(sampleRate * 0.22);
  const release2 = Math.floor(sampleRate * 0.26);

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;

    // Soft raised-cosine attack
    const a1 = i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1;
    const rem1 = n - i;
    const d1 =
      rem1 < release1
        ? 0.5 - 0.5 * Math.cos((Math.PI * rem1) / release1)
        : 1;
    const env1 = a1 * d1 * (i < note2Start + attack ? 1 : 0.55);

    let sample = Math.sin(2 * Math.PI * f1 * t) * 0.22 * env1;
    // warme 2. Harmonische, leise
    sample += Math.sin(2 * Math.PI * f1 * 2 * t) * 0.045 * env1;

    if (i >= note2Start) {
      const j = i - note2Start;
      const a2 = j < attack ? 0.5 - 0.5 * Math.cos((Math.PI * j) / attack) : 1;
      const rem2 = n - i;
      const d2 =
        rem2 < release2
          ? 0.5 - 0.5 * Math.cos((Math.PI * rem2) / release2)
          : 1;
      const env2 = a2 * d2;
      sample += Math.sin(2 * Math.PI * f2 * t) * 0.2 * env2;
      sample += Math.sin(2 * Math.PI * f2 * 2 * t) * 0.04 * env2;
    }

    // sanfter Peak-Limiter
    sample = Math.tanh(sample * 1.15);
    view.setInt16(
      44 + i * 2,
      Math.max(-32767, Math.min(32767, sample * 32767)),
      true,
    );
  }
  return bytesToBase64(new Uint8Array(buf));
}

async function ensureBeepFile(): Promise<string | null> {
  if (beepUri) return beepUri;
  try {
    // v3 = musikalischer Chime (alte Piep-Caches verwerfen)
    const path = `${FileSystem.cacheDirectory}findus-mic-cue-v3.wav`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(path, buildChimeWavBase64(), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    beepUri = path;
    return path;
  } catch {
    return null;
  }
}

export async function playMicStartCue(opts?: {
  force?: boolean;
  /** Live-Chat: etwas weicher / musikalischer Haptic */
  musical?: boolean;
}): Promise<void> {
  await loadHandsFreePrefs();
  if (!opts?.force && !getHandsFreePrefsSync().micStartCue) return;

  try {
    await Haptics.impactAsync(
      opts?.musical
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Soft,
    );
  } catch {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      /* soft */
    }
  }

  try {
    const uri = await ensureBeepFile();
    if (!uri) return;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        /* soft */
      }
      sound = null;
    }
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const created = await Audio.Sound.createAsync(
      { uri },
      {
        shouldPlay: true,
        volume: opts?.musical ? 0.52 : 0.48,
        isLooping: false,
      },
    );
    sound = created.sound;
    sound.setOnPlaybackStatusUpdate((st) => {
      if (!st.isLoaded) return;
      if (st.didJustFinish) {
        void sound?.unloadAsync().catch(() => undefined);
        sound = null;
      }
    });
  } catch {
    /* Haptik reicht */
  }
}

/** Dedizierter Live-Chat-Start: gleicher Chime, weichere Haptik. */
export async function playLiveChatStartCue(opts?: {
  force?: boolean;
}): Promise<void> {
  return playMicStartCue({ force: opts?.force, musical: true });
}
