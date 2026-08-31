import * as FileSystem from 'expo-file-system';
import {
  createDefaultProfile,
  normalizeLanguage,
  normalizeVoiceId,
  profileHasFinishedSetup,
  type AudioOutputMode,
  type MobilityPrefs,
  type MustHaveStyleId,
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
  // Legacy openai/local → Cartesia; system only if explicitly forced
  if (raw === 'system') return 'system';
  return 'cartesia';
}

/** Auto/Taxi-Bundle + Legacy-Werte (own_use / own_avoid) normalisieren. */
function normalizeMobilityPrefs(raw: MobilityPrefs | undefined): MobilityPrefs {
  const mp: MobilityPrefs = { ...(raw ?? {}) };
  if (mp.car === 'own_use') mp.car = 'own';
  if (mp.car === 'own_avoid') mp.car = 'none';
  if (
    mp.car !== 'taxi_love' &&
    mp.car !== 'taxi_saves_time' &&
    mp.car !== 'own' &&
    mp.car !== 'none'
  ) {
    mp.car = null;
  }
  // taxi aus car spiegeln, wenn car gesetzt
  if (mp.car === 'taxi_love') mp.taxi = 'love';
  else if (mp.car === 'taxi_saves_time') mp.taxi = 'if_saves_time';
  else if (mp.car === 'own' || mp.car === 'none') mp.taxi = 'no';
  if (
    typeof mp.learnedWalkKmh === 'number' &&
    Number.isFinite(mp.learnedWalkKmh)
  ) {
    mp.learnedWalkKmh = Math.min(12, Math.max(1, mp.learnedWalkKmh));
  } else {
    mp.learnedWalkKmh = mp.learnedWalkKmh ?? null;
  }
  if (
    typeof mp.learnedBikeKmh === 'number' &&
    Number.isFinite(mp.learnedBikeKmh)
  ) {
    mp.learnedBikeKmh = Math.min(35, Math.max(6, mp.learnedBikeKmh));
  } else {
    mp.learnedBikeKmh = mp.learnedBikeKmh ?? null;
  }
  if (
    typeof mp.learnedPaceAtMs === 'number' &&
    Number.isFinite(mp.learnedPaceAtMs)
  ) {
    /* keep */
  } else {
    mp.learnedPaceAtMs = mp.learnedPaceAtMs ?? null;
  }
  return mp;
}

function syncTtsProviderToStore(provider: TtsProvider): void {
  try {
    useFinnusStore.getState().setTtsProvider(provider);
  } catch {
    // Store ggf. noch nicht bereit
  }
}

function syncPremiumToStore(premium: boolean): void {
  try {
    useFinnusStore.getState().setIsPremiumSubscriber(premium);
  } catch {
    /* ignore */
  }
}

function normalizeProfile(parsed: Partial<UserProfile>): UserProfile {
  const base = createDefaultProfile();
  const merged: UserProfile = { ...base, ...parsed, version: 1 };
  merged.language = normalizeLanguage(merged.language as string);
  merged.voiceId = normalizeVoiceId(merged.voiceId as string);
  merged.speechRate = 1; // Systemweit fest — kein Slider
  merged.ttsProvider = normalizeTtsProvider(merged.ttsProvider);
  {
    const { sanitizeNameSpeechHint } = require('./persona/userNameSpeechHint') as {
      sanitizeNameSpeechHint: (raw: string | null | undefined) => string;
    };
    const hint = sanitizeNameSpeechHint(
      typeof parsed.firstNameSpeechHint === 'string'
        ? parsed.firstNameSpeechHint
        : merged.firstNameSpeechHint,
    );
    const written = (merged.firstName || '').trim();
    merged.firstNameSpeechHint =
      hint && hint.toLowerCase() !== written.toLowerCase() ? hint : '';
    merged.firstNameSpeechHintEnabled =
      parsed.firstNameSpeechHintEnabled === true;
  }
  merged.phoneNumber =
    typeof parsed.phoneNumber === 'string'
      ? parsed.phoneNumber
      : base.phoneNumber ?? '';
  merged.gender =
    parsed.gender === 'female' ||
    parsed.gender === 'male' ||
    parsed.gender === 'diverse' ||
    parsed.gender === 'unspecified'
      ? parsed.gender
      : base.gender ?? null;
  merged.storytelling = {
    ...(base.storytelling ?? {}),
    ...(parsed.storytelling ?? {}),
  };
  // Legacy-Duplikat „Berühmte Personen“ → kanonische Pref `personen`
  // Legacy `theater_kultur` → theater / kino / konzert_musical
  {
    const prefs = { ...(merged.experiencePrefs ?? {}) } as Record<
      string,
      string
    >;
    const legacy = prefs.beruehmte_personen;
    if (legacy === 'yes' || legacy === 'no' || legacy === 'neutral') {
      if (prefs.personen == null || prefs.personen === 'neutral') {
        prefs.personen = legacy;
      }
      delete prefs.beruehmte_personen;
    }
    const kultur = prefs.theater_kultur;
    if (kultur === 'yes' || kultur === 'no' || kultur === 'neutral') {
      for (const k of ['theater', 'kino', 'konzert_musical'] as const) {
        if (prefs[k] == null || prefs[k] === 'neutral') {
          prefs[k] = kultur;
        }
      }
    }
    merged.experiencePrefs = prefs as UserProfile['experiencePrefs'];
  }
  merged.learnedFacts = Array.isArray(parsed.learnedFacts)
    ? parsed.learnedFacts.map(String).filter(Boolean).slice(-40)
    : base.learnedFacts ?? [];
  try {
    const { normalizeLearnedRules } = require('./memory/correctionLearning') as {
      normalizeLearnedRules: (raw: unknown) => UserProfile['learnedRules'];
    };
    merged.learnedRules = normalizeLearnedRules(
      parsed.learnedRules ?? base.learnedRules ?? [],
    );
  } catch {
    merged.learnedRules = Array.isArray(parsed.learnedRules)
      ? (parsed.learnedRules as UserProfile['learnedRules'])
      : base.learnedRules ?? [];
  }
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
    parsed.energyLevel === 'high' ||
    parsed.energyLevel === 'extreme'
      ? parsed.energyLevel
      : base.energyLevel ?? null;
  merged.dietaryTags = Array.isArray(parsed.dietaryTags)
    ? parsed.dietaryTags.map(String).filter(Boolean)
    : base.dietaryTags ?? [];
  merged.allergyTags = Array.isArray(parsed.allergyTags)
    ? parsed.allergyTags.map(String).filter(Boolean)
    : base.allergyTags ?? [];
  // Legacy „Kein Fisch“ → Allergie „Fisch“; Chip heißt nur noch „Fisch“ (positiv).
  if (merged.dietaryTags.includes('kein_fisch')) {
    merged.dietaryTags = merged.dietaryTags.filter((t) => t !== 'kein_fisch');
    const allergies = (merged.allergyTags ?? []).filter((t) => t !== 'keine');
    if (!allergies.includes('fisch')) allergies.push('fisch');
    merged.allergyTags = allergies;
  }
  const travelModeAllowed = new Set([
    'auto',
    'bahn',
    'flieger',
    'fahrrad',
    'wandern',
    'reisebus',
  ]);
  merged.travelModes = Array.isArray(parsed.travelModes)
    ? parsed.travelModes
        .map(String)
        .filter((id): id is import('../constants/conciergePrefs').TravelModeId =>
          travelModeAllowed.has(id),
        )
    : base.travelModes ?? [];
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
    parsed.touristMode === 'mix' ||
    parsed.touristMode === 'local_gems'
      ? parsed.touristMode
      : base.touristMode ?? null;
  const mustRaw = Array.isArray(parsed.mustHaveStyles)
    ? parsed.mustHaveStyles.map(String)
    : null;
  const mustAllowed = new Set([
    'tourist',
    'insider',
    'local_gems',
    'nightlife',
  ]);
  merged.mustHaveStyles = (mustRaw
    ? mustRaw.filter((id) => mustAllowed.has(id))
    : base.mustHaveStyles ?? []) as MustHaveStyleId[];
  // Legacy: einzelner touristMode → Must-have-Chip
  if (
    (!merged.mustHaveStyles || merged.mustHaveStyles.length === 0) &&
    merged.touristMode &&
    merged.touristMode !== 'mix'
  ) {
    merged.mustHaveStyles = [merged.touristMode as MustHaveStyleId];
  }
  const navMode = parsed.navExploreMode;
  merged.navExploreMode =
    navMode === 'quiet' || navMode === 'mute_until_dest' || navMode === 'full'
      ? navMode
      : base.navExploreMode ?? 'quiet';
  const m1Story = parsed.module1StoryMode;
  merged.module1StoryMode =
    m1Story === 'brief' || m1Story === 'full'
      ? m1Story
      : base.module1StoryMode ?? 'full';
  merged.notificationsEnabled =
    parsed.notificationsEnabled === undefined
      ? true
      : !!parsed.notificationsEnabled;
  const pa = parsed.proactiveAlerts;
  if (pa && typeof pa === 'object') {
    merged.proactiveAlerts = {
      weather: pa.weather === undefined ? undefined : !!pa.weather,
      parking: pa.parking === undefined ? undefined : !!pa.parking,
      transit: pa.transit === undefined ? undefined : !!pa.transit,
      ambientEvents:
        pa.ambientEvents === undefined ? undefined : !!pa.ambientEvents,
      cityWelcome:
        pa.cityWelcome === undefined ? undefined : !!pa.cityWelcome,
      welcomeBack:
        pa.welcomeBack === undefined ? undefined : !!pa.welcomeBack,
    };
  } else {
    merged.proactiveAlerts = base.proactiveAlerts ?? {};
  }
  merged.dataSaverMode = !!parsed.dataSaverMode;
  merged.audioOutputMode = normalizeAudioOutputMode(parsed.audioOutputMode);
  merged.isPremiumSubscriber = !!parsed.isPremiumSubscriber;
  merged.accountMode =
    parsed.accountMode === 'guest' ||
    parsed.accountMode === 'registered' ||
    parsed.accountMode === null
      ? parsed.accountMode
      : base.accountMode ?? null;
  merged.newsletterOptIn = !!parsed.newsletterOptIn;
  merged.newsletterOptInAt =
    typeof parsed.newsletterOptInAt === 'string'
      ? parsed.newsletterOptInAt
      : parsed.newsletterOptInAt === null
        ? null
        : base.newsletterOptInAt ?? null;

  try {
    const {
      migrateLegacyPersonality,
    } = require('../constants/personalityMatrix') as typeof import('../constants/personalityMatrix');
    const hasMatrix =
      typeof parsed.coreRole === 'string' ||
      typeof parsed.vibeTone === 'string' ||
      typeof parsed.knowledgeStyle === 'string';
    if (hasMatrix) {
      merged.coreRole =
        (parsed.coreRole as UserProfile['coreRole']) ?? base.coreRole;
      merged.vibeTone =
        (parsed.vibeTone as UserProfile['vibeTone']) ?? base.vibeTone;
      merged.knowledgeStyle =
        (parsed.knowledgeStyle as UserProfile['knowledgeStyle']) ??
        base.knowledgeStyle;
      merged.spleens = Array.isArray(parsed.spleens)
        ? (parsed.spleens as UserProfile['spleens'])
        : base.spleens ?? [];
    } else {
      const migrated = migrateLegacyPersonality({
        characters: merged.characters,
        tonalities: merged.tonalities,
      });
      merged.coreRole = migrated.coreRole;
      merged.vibeTone = migrated.vibeTone;
      merged.knowledgeStyle = migrated.knowledgeStyle;
      merged.spleens = migrated.spleens;
    }
  } catch {
    /* soft */
  }
  merged.voicePinnedByUser = !!parsed.voicePinnedByUser;
  merged.humorOk = !!parsed.humorOk;
  merged.geekMode = !!parsed.geekMode;
  merged.freeChatOk = !!parsed.freeChatOk;
  merged.openThreads = Array.isArray(parsed.openThreads)
    ? parsed.openThreads.map(String).filter(Boolean).slice(-20)
    : base.openThreads ?? [];
  merged.mobilityPrefs = normalizeMobilityPrefs(
    parsed.mobilityPrefs && typeof parsed.mobilityPrefs === 'object'
      ? (parsed.mobilityPrefs as UserProfile['mobilityPrefs'])
      : base.mobilityPrefs ?? {},
  );
  merged.tourLengthPref =
    parsed.tourLengthPref === 'more_stops' ||
    parsed.tourLengthPref === 'balanced' ||
    parsed.tourLengthPref === 'fewer_stops' ||
    parsed.tourLengthPref === 'max_stops'
      ? parsed.tourLengthPref
      : base.tourLengthPref ?? null;
  merged.diningLevel =
    parsed.diningLevel === 'fast_cheap' ||
    parsed.diningLevel === 'decent' ||
    parsed.diningLevel === 'highlights'
      ? parsed.diningLevel
      : base.diningLevel ?? null;
  merged.accessibilityCare = !!parsed.accessibilityCare;
  merged.spotifyTopArtists = Array.isArray(parsed.spotifyTopArtists)
    ? parsed.spotifyTopArtists.map(String).filter(Boolean).slice(0, 20)
    : base.spotifyTopArtists ?? [];

  return merged;
}

function normalizeAudioOutputMode(raw: unknown): AudioOutputMode {
  if (raw === 'mute' || raw === 'text_only' || raw === 'normal') return raw;
  return 'normal';
}

/** Sparmodus aktiv (kürzere Antworten, weniger Maps/Research). */
export function isDataSaverActive(): boolean {
  return !!getCachedUserProfile()?.dataSaverMode;
}

/** Aktuelle Audio-Ausgabe aus dem Profil-Cache. */
export function getAudioOutputMode(): AudioOutputMode {
  return normalizeAudioOutputMode(getCachedUserProfile()?.audioOutputMode);
}

/** true = TTS darf laufen (nicht mute / text_only / aktive Stumm-Session). */
export function wantsSpokenAudio(): boolean {
  try {
    // Lazy require avoids circular import with muteSessionService
    const {
      isTemporaryMuteActive,
    } = require('./audio/muteSessionService') as typeof import('./audio/muteSessionService');
    if (isTemporaryMuteActive()) return false;
  } catch {
    /* ignore */
  }
  return getAudioOutputMode() === 'normal';
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
    syncTtsProviderToStore(cached.ttsProvider ?? 'cartesia');
    syncPremiumToStore(!!cached.isPremiumSubscriber);
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
  let next = normalizeProfile(profile);
  // Re-Login / Onboarding-Draft darf ein fertiges Profil nicht zurücksetzen
  if (cached && profileHasFinishedSetup(cached) && !profileHasFinishedSetup(next)) {
    return cached;
  }
  if (cached?.firstMapWelcomeDone && !next.firstMapWelcomeDone) {
    next = { ...next, firstMapWelcomeDone: true };
  }
  if (cached?.setupComplete && !next.setupComplete) {
    next = { ...next, setupComplete: true, completedAt: next.completedAt ?? cached.completedAt };
  }
  cached = next;
  syncTtsProviderToStore(next.ttsProvider ?? 'cartesia');
  syncPremiumToStore(!!next.isPremiumSubscriber);
  notify(next);
  await FileSystem.writeAsStringAsync(
    PROFILE_PATH,
    JSON.stringify(next, null, 2),
    { encoding: FileSystem.EncodingType.UTF8 },
  );
  await syncVoiceSettingsToSqlite(next);
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
    const { runExclusiveDbWrite } = await import('../db/dbWriteLock');
    const db = await getDatabase();
    await runExclusiveDbWrite(async () => {
      await db.runAsync('DELETE FROM user_settings WHERE id = 1');
    });
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
  // In-Memory-Profil zuerst — frisch nach Stimmenwechsel, ohne stale SQLite
  if (cached?.voiceId) {
    return {
      voiceId: normalizeVoiceId(cached.voiceId),
      speechRate: 1,
    };
  }
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
  const profile = await loadUserProfile();
  return {
    voiceId: profile?.voiceId ?? 'alina',
    speechRate: 1,
  };
}
