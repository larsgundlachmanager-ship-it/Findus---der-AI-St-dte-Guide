/**
 * Idle Live-HUD: Findus wählt alle ~30 Min frei, welche optionalen Themen
 * neben Ort/Wetter/Timer/Parken erscheinen (Sunset/Dinner nicht immer).
 */

import { getCachedUserProfile } from '../userProfileService';

export const HUD_THEME_ROTATE_MS = 30 * 60_000;

export type HudOptionalTheme =
  | 'sunset'
  | 'dinner'
  | 'events'
  | 'concerts'
  | 'city_news'
  | 'soft_city'
  | 'user_relevant';

const POOL: HudOptionalTheme[] = [
  'sunset',
  'dinner',
  'events',
  'concerts',
  'city_news',
  'soft_city',
  'user_relevant',
];

/** Deterministischer Mix pro 30-Min-Bucket (stabil beim Re-Render). */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function timeOk(theme: HudOptionalTheme, hour: number): boolean {
  if (theme === 'sunset') return hour >= 15 && hour <= 21;
  // „dinner“-Slot = Meal-Karte (Bäckerei/Lunch/Abend je nach Uhrzeit)
  if (theme === 'dinner') return hour >= 6 && hour <= 22;
  if (theme === 'concerts') return hour >= 14 || hour <= 2;
  if (theme === 'events') return hour >= 9 && hour <= 23;
  return true;
}

/**
 * 1–3 optionale Themen für dieses 30-Min-Fenster.
 * Sunset/Dinner nur manchmal — nie erzwungen.
 */
export function pickIdleHudThemes(nowMs = Date.now()): Set<HudOptionalTheme> {
  const profile = getCachedUserProfile();
  const city = (profile?.cityId || profile?.cityName || 'x').toLowerCase();
  const bucket = Math.floor(nowMs / HUD_THEME_ROTATE_MS);
  const hour = new Date(nowMs).getHours();
  const rand = mulberry32(hashSeed(`${city}|${bucket}`));

  const eligible = POOL.filter((t) => timeOk(t, hour));
  // Shuffle
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  // 1–3 slots (manchmal nur soft/news, ohne sunset/dinner)
  const count = 1 + Math.floor(rand() * 3); // 1..3
  const picked = new Set<HudOptionalTheme>();
  for (const t of shuffled) {
    if (picked.size >= count) break;
    // Sunset/Dinner bewusst seltener (~40% Chance wenn gezogen)
    if ((t === 'sunset' || t === 'dinner') && rand() > 0.4) continue;
    picked.add(t);
  }

  // Mindestens ein „Inhalt“ wenn Filter alles verworfen hat
  if (picked.size === 0 && shuffled[0]) {
    picked.add(
      shuffled.find((t) => t !== 'sunset' && t !== 'dinner') ?? shuffled[0]!,
    );
  }

  return picked;
}

export function hudThemeBucketKey(nowMs = Date.now()): string {
  return String(Math.floor(nowMs / HUD_THEME_ROTATE_MS));
}
