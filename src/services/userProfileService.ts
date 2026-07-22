import * as FileSystem from 'expo-file-system';
import {
  createDefaultProfile,
  normalizeLanguage,
  normalizeVoiceId,
  type UserProfile,
} from '../types/userProfile';
import { getDatabase } from '../db/database';
import {
  loadUserVoiceSettings,
  saveUserVoiceSettings,
} from '../db/userSettings';

/** Lokale Datei „über den User“ */
const PROFILE_PATH = `${FileSystem.documentDirectory}ueber-den-user.json`;

let cached: UserProfile | null = null;
let listeners = new Set<(profile: UserProfile | null) => void>();

function notify(profile: UserProfile | null): void {
  for (const fn of listeners) fn(profile);
}

function normalizeProfile(parsed: Partial<UserProfile>): UserProfile {
  const base = createDefaultProfile();
  const merged: UserProfile = { ...base, ...parsed, version: 1 };
  merged.language = normalizeLanguage(merged.language as string);
  merged.voiceId = normalizeVoiceId(merged.voiceId as string);
  merged.speechRate = 1; // Systemweit fest — kein Slider
  merged.storytelling = {
    ...(base.storytelling ?? {}),
    ...(parsed.storytelling ?? {}),
  };
  return merged;
}

async function syncVoiceSettingsToSqlite(profile: UserProfile): Promise<void> {
  try {
    const db = await getDatabase();
    await saveUserVoiceSettings(db, {
      voiceId: profile.voiceId,
      voiceProfile: profile.voiceId,
      speechRate: profile.speechRate,
    });
  } catch (err) {
    console.warn('[userProfile] user_settings Sync fehlgeschlagen:', err);
  }
}

export function subscribeUserProfile(
  fn: (profile: UserProfile | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCachedUserProfile(): UserProfile | null {
  return cached;
}

export async function loadUserProfile(): Promise<UserProfile | null> {
  try {
    const info = await FileSystem.getInfoAsync(PROFILE_PATH);
    if (!info.exists) {
      // SQLite-Fallback (POI-Touren lesen dieselben Settings)
      try {
        const db = await getDatabase();
        const settings = await loadUserVoiceSettings(db);
        if (settings) {
          const fromDb = normalizeProfile({
            voiceId: settings.voiceId,
            speechRate: settings.speechRate,
          });
          cached = fromDb;
          notify(cached);
          return cached;
        }
      } catch {
        // ignore
      }
      cached = null;
      notify(null);
      return null;
    }
    const raw = await FileSystem.readAsStringAsync(PROFILE_PATH);
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    cached = normalizeProfile(parsed);
    void syncVoiceSettingsToSqlite(cached);
    notify(cached);
    return cached;
  } catch (err) {
    console.warn('[userProfile] Laden fehlgeschlagen:', err);
    cached = null;
    notify(null);
    return null;
  }
}

export async function saveUserProfile(
  profile: UserProfile,
): Promise<UserProfile> {
  const next = normalizeProfile(profile);
  await FileSystem.writeAsStringAsync(
    PROFILE_PATH,
    JSON.stringify(next, null, 2),
    { encoding: FileSystem.EncodingType.UTF8 },
  );
  cached = next;
  await syncVoiceSettingsToSqlite(next);
  notify(next);
  return next;
}

export async function updateUserProfile(
  patch: Partial<UserProfile>,
): Promise<UserProfile> {
  const base = cached ?? (await loadUserProfile()) ?? createDefaultProfile();
  return saveUserProfile({ ...base, ...patch });
}

export async function resetUserProfile(): Promise<void> {
  try {
    await FileSystem.deleteAsync(PROFILE_PATH, { idempotent: true });
  } catch {
    // ignore
  }
  try {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM user_settings WHERE id = 1');
  } catch {
    // ignore
  }
  cached = null;
  notify(null);
}

export function getProfileFilePath(): string {
  return PROFILE_PATH;
}

/** Voice-Settings für POI-Touren (SQLite, immer aktuell). */
export async function getVoiceSettingsForTour(): Promise<{
  voiceId: UserProfile['voiceId'];
  speechRate: number;
}> {
  try {
    const db = await getDatabase();
    const settings = await loadUserVoiceSettings(db);
    if (settings) {
      return {
        voiceId: normalizeVoiceId(settings.voiceId),
        speechRate: 1,
      };
    }
  } catch {
    // fallback
  }
  const profile = cached ?? (await loadUserProfile());
  return {
    voiceId: profile?.voiceId ?? 'standard_m',
    speechRate: 1,
  };
}
