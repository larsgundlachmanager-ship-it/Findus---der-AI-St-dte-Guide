import * as FileSystem from 'expo-file-system';
import {
  createDefaultProfile,
  normalizeLanguage,
  normalizeVoiceId,
  type TtsProvider,
  type UserProfile,
} from '../types/userProfile';
import { getDatabase } from '../db/database';
import {
  loadUserVoiceSettings,
  saveUserVoiceSettings,
} from '../db/userSettings';
import { useFinnusStore } from '../store/useFinnusStore';

/** Lokale Datei „über den User“ */
const PROFILE_PATH = `${FileSystem.documentDirectory}ueber-den-user.json`;

let cached: UserProfile | null = null;
let listeners = new Set<(profile: UserProfile | null) => void>();

function notify(profile: UserProfile | null): void {
  for (const fn of listeners) fn(profile);
}

function normalizeTtsProvider(raw: unknown): TtsProvider {
  return raw === 'kokoro' ? 'kokoro' : 'openai';
}

function syncTtsProviderToStore(provider: TtsProvider): void {
  try {
    useFinnusStore.getState().setTtsProvider(provider);
  } catch {
    // Store ggf. noch nicht bereit
  }
}

function normalizeProfile(parsed: Partial<UserProfile>): UserProfile {
  const base = createDefaultProfile();
  const merged: UserProfile = { ...base, ...parsed, version: 1 };
  merged.language = normalizeLanguage(merged.language as string);
  merged.voiceId = normalizeVoiceId(merged.voiceId as string);
  merged.speechRate = 1; // Systemweit fest — kein Slider
  merged.ttsProvider = normalizeTtsProvider(merged.ttsProvider);
  merged.phoneNumber =
    typeof parsed.phoneNumber === 'string'
      ? parsed.phoneNumber
      : base.phoneNumber ?? '';
  merged.storytelling = {
    ...(base.storytelling ?? {}),
    ...(parsed.storytelling ?? {}),
  };
  merged.learnedFacts = Array.isArray(parsed.learnedFacts)
    ? parsed.learnedFacts.map(String).filter(Boolean).slice(-40)
    : base.learnedFacts ?? [];
  merged.personaEngine = {
    ...(base.personaEngine ?? {}),
    ...(parsed.personaEngine ?? {}),
    preferences: {
      ...(base.personaEngine?.preferences ?? {}),
      ...(parsed.personaEngine?.preferences ?? {}),
    },
  };
  merged.onboardingMode =
    parsed.onboardingMode === 'express' || parsed.onboardingMode === 'standard'
      ? parsed.onboardingMode
      : base.onboardingMode ?? null;
  merged.travelPeriod =
    typeof parsed.travelPeriod === 'string'
      ? parsed.travelPeriod
      : base.travelPeriod ?? '';
  merged.budgetCategory =
    parsed.budgetCategory === 'sparsam' ||
    parsed.budgetCategory === 'mittel' ||
    parsed.budgetCategory === 'komfort'
      ? parsed.budgetCategory
      : base.budgetCategory ?? null;
  merged.micListenMode =
    parsed.micListenMode === 'hear' || parsed.micListenMode === 'dont_hear'
      ? parsed.micListenMode
      : base.micListenMode ?? null;
  merged.hasAcceptedPrivacyPolicy = !!parsed.hasAcceptedPrivacyPolicy;
  merged.privacyAcceptedAt =
    typeof parsed.privacyAcceptedAt === 'string'
      ? parsed.privacyAcceptedAt
      : null;
  merged.hasAcceptedAudioConsent = !!parsed.hasAcceptedAudioConsent;
  merged.audioConsentAt =
    typeof parsed.audioConsentAt === 'string' ? parsed.audioConsentAt : null;
  merged.travelParty =
    parsed.travelParty === 'solo' ||
    parsed.travelParty === 'couple' ||
    parsed.travelParty === 'date' ||
    parsed.travelParty === 'family' ||
    parsed.travelParty === 'friends'
      ? parsed.travelParty
      : base.travelParty ?? null;
  merged.mobilityMode =
    parsed.mobilityMode === 'foot' ||
    parsed.mobilityMode === 'bike' ||
    parsed.mobilityMode === 'public_transit' ||
    parsed.mobilityMode === 'car'
      ? parsed.mobilityMode
      : base.mobilityMode ?? null;
  merged.energyLevel =
    parsed.energyLevel === 'low' ||
    parsed.energyLevel === 'medium' ||
    parsed.energyLevel === 'high'
      ? parsed.energyLevel
      : base.energyLevel ?? null;
  merged.dietaryTags = Array.isArray(parsed.dietaryTags)
    ? parsed.dietaryTags.map(String).filter(Boolean)
    : base.dietaryTags ?? [];
  merged.allergies =
    typeof parsed.allergies === 'string'
      ? parsed.allergies
      : base.allergies ?? '';
  merged.answerStyle =
    parsed.answerStyle === 'short' || parsed.answerStyle === 'detailed'
      ? parsed.answerStyle
      : base.answerStyle ?? null;
  merged.touristMode =
    parsed.touristMode === 'tourist' ||
    parsed.touristMode === 'insider' ||
    parsed.touristMode === 'mix'
      ? parsed.touristMode
      : base.touristMode ?? null;
  merged.notificationsEnabled =
    parsed.notificationsEnabled === undefined
      ? true
      : !!parsed.notificationsEnabled;
  merged.dataSaverMode = !!parsed.dataSaverMode;
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
    syncTtsProviderToStore(cached.ttsProvider ?? 'openai');
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
  syncTtsProviderToStore(next.ttsProvider ?? 'openai');
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
