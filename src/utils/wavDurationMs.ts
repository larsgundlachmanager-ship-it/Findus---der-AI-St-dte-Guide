/**
 * WAV-Abspieldauer aus Header / Dateigröße.
 * Cartesia liefert PCM WAV 44100 Hz, 16-bit, mono.
 */
import * as FileSystem from 'expo-file-system';

const cache = new Map<string, number>();

export function wavDurationMsFromBytes(bytes: Uint8Array): number {
  if (bytes.length < 44) return 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = dv.getUint32(28, true);
  const dataBytes = Math.max(0, bytes.length - 44);
  if (byteRate > 0) {
    return Math.max(0, Math.round((dataBytes / byteRate) * 1000));
  }
  const sampleRate = dv.getUint32(24, true);
  const channels = Math.max(1, dv.getUint16(22, true));
  const bits = Math.max(8, dv.getUint16(34, true));
  const bytesPerSec = sampleRate * channels * (bits / 8);
  if (bytesPerSec <= 0) return 0;
  return Math.round((dataBytes / bytesPerSec) * 1000);
}

export function rememberWavDurationMs(uri: string, ms: number): void {
  if (uri && ms > 0) cache.set(uri, ms);
}

export function peekWavDurationMs(uri: string): number | undefined {
  return cache.get(uri);
}

export function rememberWavDurationFromFileSize(
  uri: string,
  size: number,
): number {
  if (size <= 44) return 0;
  const ms = Math.round(((size - 44) / (44100 * 2)) * 1000);
  if (ms > 0) {
    cache.set(uri, ms);
    return ms;
  }
  return 0;
}

export async function resolveWavDurationMs(uri: string): Promise<number> {
  const hit = cache.get(uri);
  if (hit && hit > 0) return hit;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    const size =
      info.exists && 'size' in info ? Number(info.size) || 0 : 0;
    return rememberWavDurationFromFileSize(uri, size);
  } catch {
    return 0;
  }
}
