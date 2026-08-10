/**
 * Passive Offline-Fallback: native OS-Stimme via expo-speech.
 * Nur wenn Cartesia fehlschlägt (Funkloch / Key fehlt).
 */

import * as Speech from 'expo-speech';

export async function speakWithExpoSpeech(
  text: string,
  opts?: { language?: string; rate?: number; pitch?: number },
): Promise<void> {
  const input = text.replace(/\s+/g, ' ').trim();
  if (!input) return;

  await new Promise<void>((resolve, reject) => {
    try {
      Speech.stop();
      Speech.speak(input, {
        language: opts?.language ?? 'de-DE',
        rate: opts?.rate ?? 1.0,
        pitch: opts?.pitch ?? 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: (err) =>
          reject(err instanceof Error ? err : new Error(String(err))),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function stopExpoSpeech(): Promise<void> {
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
}

export function isExpoSpeechAvailable(): boolean {
  return typeof Speech?.speak === 'function';
}
