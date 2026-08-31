/**
 * Lernt, welche Event-Zielgruppen der User mag / überspringen will.
 * Stadt-agnostisch — Tags, keine Orts-Hardcodes.
 */

import * as FileSystem from 'expo-file-system';
import type { UserProfile } from '../../types/userProfile';
import type { TemporaryLiveSpot } from './temporaryLiveSpots';

const PATH = `${FileSystem.documentDirectory}findus-event-pitch-memory.json`;

export type EventPitchMemory = {
  softSkipTags: string[];
  softLikeTags: string[];
  recentPitchTags: string[];
  lastPitchAtMs: number | null;
  lastPitchName: string | null;
};

const EMPTY: EventPitchMemory = {
  softSkipTags: [],
  softLikeTags: [],
  recentPitchTags: [],
  lastPitchAtMs: null,
  lastPitchName: null,
};

function uniq(list: string[], max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function read(): Promise<EventPitchMemory> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return { ...EMPTY };
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as Partial<EventPitchMemory>;
    return {
      softSkipTags: Array.isArray(parsed.softSkipTags)
        ? uniq(parsed.softSkipTags.map(String))
        : [],
      softLikeTags: Array.isArray(parsed.softLikeTags)
        ? uniq(parsed.softLikeTags.map(String))
        : [],
      recentPitchTags: Array.isArray(parsed.recentPitchTags)
        ? uniq(parsed.recentPitchTags.map(String), 24)
        : [],
      lastPitchAtMs:
        typeof parsed.lastPitchAtMs === 'number' ? parsed.lastPitchAtMs : null,
      lastPitchName:
        typeof parsed.lastPitchName === 'string' ? parsed.lastPitchName : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function write(mem: EventPitchMemory): Promise<void> {
  await FileSystem.writeAsStringAsync(PATH, JSON.stringify(mem));
}

export async function loadEventPitchMemory(): Promise<EventPitchMemory> {
  return read();
}

export function softSkipTagsForUser(
  memory: EventPitchMemory,
  profile: UserProfile | null,
): string[] {
  const fromProfile: string[] = [];
  const about = (profile?.aboutMe || '').toLowerCase();
  const avoid = (profile?.avoidExperience || '').toLowerCase();
  const blob = `${about} ${avoid}`;
  if (/\b(kein(?:e)?\s+kinder|ohne\s+kinder|nicht\s+mit\s+kind|kein\s+familien)\b/iu.test(blob)) {
    fromProfile.push('kids', 'family');
  }
  if (/\b(kein(?:e)?\s+party|kein\s+club|kein\s+techno|kein\s+nightlife)\b/iu.test(blob)) {
    fromProfile.push('nightlife', 'techno');
  }
  if (/\b(ü\s*30|ue\s*30|ü\s*40|ue\s*40)\b/iu.test(blob) && (profile?.age ?? 30) < 28) {
    fromProfile.push('ue30');
  }
  return uniq([...memory.softSkipTags, ...fromProfile]);
}

export async function noteEventPitchSpoken(
  spot: TemporaryLiveSpot,
): Promise<void> {
  const mem = await read();
  const tags = [
    ...(spot.audienceTags ?? []),
    spot.kindHint,
  ].filter(Boolean);
  mem.recentPitchTags = uniq([...tags, ...mem.recentPitchTags], 24);
  mem.lastPitchAtMs = Date.now();
  mem.lastPitchName = spot.name.slice(0, 80);
  await write(mem);
}

/**
 * Aus User-Äußerungen lernen (nach Pitch oder allgemein zu Events).
 */
export async function learnEventAudienceFromUserText(
  text: string,
): Promise<void> {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return;
  const mem = await read();
  let changed = false;

  const skipKids =
    /\b(zu\s+kindisch|für\s+kinder|kinderkram|spielstadt|nicht\s+mein\s+ding|uninteressant|kein\s+bock\s+auf\s+(?:so\s+)?(?:kinder|spiel)|nichts\s+für\s+mich)\b/iu.test(
      t,
    );
  if (skipKids) {
    mem.softSkipTags = uniq([...mem.softSkipTags, 'kids', 'family', 'spielstadt']);
    changed = true;
  }

  const skipUe30 =
    /\b(ü\s*30|ue\s*30|ü\s*40|zu\s+alt(?:modisch)?|rentner\s*party)\b/iu.test(t) &&
    /\b(nicht|kein|ohne|lass)\b/iu.test(t);
  if (skipUe30) {
    mem.softSkipTags = uniq([...mem.softSkipTags, 'ue30', 'seniors']);
    changed = true;
  }

  const skipNight =
    /\b(kein(?:e)?\s+(?:techno|rave|club|party)|zu\s+laut|underground\s+nicht)\b/iu.test(
      t,
    );
  if (skipNight) {
    mem.softSkipTags = uniq([...mem.softSkipTags, 'nightlife', 'techno']);
    changed = true;
  }

  const likeNight =
    /\b(techno|rave|club|feiern|party)\b/iu.test(t) &&
    /\b( mag|liebe|geil|bock|lass\s+uns|cool)\b/iu.test(t);
  if (likeNight) {
    mem.softLikeTags = uniq([...mem.softLikeTags, 'nightlife', 'techno']);
    mem.softSkipTags = mem.softSkipTags.filter(
      (x) => x !== 'nightlife' && x !== 'techno',
    );
    changed = true;
  }

  const likeCulture =
    /\b(konzert|ausstellung|theater|lesung|kultur)\b/iu.test(t) &&
    /\b(mag|liebe|bock|cool|spannend)\b/iu.test(t);
  if (likeCulture) {
    mem.softLikeTags = uniq([...mem.softLikeTags, 'culture']);
    changed = true;
  }

  if (changed) await write(mem);
}
