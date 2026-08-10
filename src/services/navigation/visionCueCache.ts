/**
 * In-memory cue cache for OSM look-ahead lines (not Gemini vision).
 * Kept for lookAheadBuffer compatibility.
 */

const cache = new Map<string, { text: string; at: number }>();
const MAX_ENTRIES = 48;
const TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export function visionCueCacheKey(opts: {
  lat: number;
  lng: number;
  heading: number;
  maneuver: string;
}): string {
  const latK = opts.lat.toFixed(5);
  const lngK = opts.lng.toFixed(5);
  const hK = Math.round(opts.heading / 5) * 5;
  const m = (opts.maneuver ?? 'turn').toLowerCase().slice(0, 24);
  return `${latK}:${lngK}:${hK}:${m}`;
}

export function getCachedVisionCue(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.text;
}

export function putCachedVisionCue(key: string, text: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { text, at: Date.now() });
}

export function clearVisionCueCache(): void {
  cache.clear();
}
