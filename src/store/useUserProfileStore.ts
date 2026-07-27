/**
 * Zustand-Store für das User-Profil (4 Säulen + gelernte Fakten).
 * Persistenz läuft über userProfileService (FileSystem).
 */

import { create } from 'zustand';
import {
  createDefaultProfile,
  type FindusToneStyle,
  type PersonaEngineOverrides,
  type PersonaEngineProfile,
  type UserProfile,
} from '../types/userProfile';
import {
  getCachedUserProfile,
  loadUserProfile,
  saveUserProfile,
  subscribeUserProfile,
  updateUserProfile,
} from '../services/userProfileService';
import { resolvePersonaEngine } from '../services/personaEngine';

type UserProfileState = {
  profile: UserProfile | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setProfile: (profile: UserProfile) => Promise<UserProfile>;
  patchProfile: (patch: Partial<UserProfile>) => Promise<UserProfile>;
  addLearnedFact: (fact: string) => Promise<UserProfile>;
  setPersonaOverrides: (
    overrides: PersonaEngineOverrides,
  ) => Promise<UserProfile>;
  applyPreferencePatch: (opts: {
    learnedFact?: string;
    dietaryRestriction?: string;
    dislike?: string;
    experiencePref?: { key: string; value: 'yes' | 'no' | 'neutral' };
    toneStyle?: FindusToneStyle;
    tonalities?: string[];
  }) => Promise<UserProfile>;
  getEngine: () => PersonaEngineProfile;
};

function normalizeFact(fact: string): string {
  return fact.replace(/\s+/g, ' ').trim();
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: getCachedUserProfile(),
  hydrated: false,

  hydrate: async () => {
    const profile = await loadUserProfile();
    set({ profile, hydrated: true });
  },

  setProfile: async (profile) => {
    const saved = await saveUserProfile(profile);
    set({ profile: saved });
    return saved;
  },

  patchProfile: async (patch) => {
    const saved = await updateUserProfile(patch);
    set({ profile: saved });
    return saved;
  },

  addLearnedFact: async (fact) => {
    const clean = normalizeFact(fact);
    if (!clean) {
      return get().profile ?? createDefaultProfile();
    }
    const base =
      get().profile ?? (await loadUserProfile()) ?? createDefaultProfile();
    const existing = base.learnedFacts ?? [];
    const key = clean.toLowerCase();
    if (existing.some((f) => f.toLowerCase() === key)) {
      set({ profile: base });
      return base;
    }
    const saved = await saveUserProfile({
      ...base,
      learnedFacts: [...existing, clean].slice(-40),
    });
    set({ profile: saved });
    return saved;
  },

  setPersonaOverrides: async (overrides) => {
    const base =
      get().profile ?? (await loadUserProfile()) ?? createDefaultProfile();
    const saved = await saveUserProfile({
      ...base,
      personaEngine: {
        ...(base.personaEngine ?? {}),
        ...overrides,
        preferences: {
          ...(base.personaEngine?.preferences ?? {}),
          ...(overrides.preferences ?? {}),
        },
      },
    });
    set({ profile: saved });
    return saved;
  },

  applyPreferencePatch: async (opts) => {
    const base =
      get().profile ?? (await loadUserProfile()) ?? createDefaultProfile();
    let learnedFacts = [...(base.learnedFacts ?? [])];
    if (opts.learnedFact) {
      const clean = normalizeFact(opts.learnedFact);
      if (
        clean &&
        !learnedFacts.some((f) => f.toLowerCase() === clean.toLowerCase())
      ) {
        learnedFacts = [...learnedFacts, clean].slice(-40);
      }
    }

    const pe = {
      ...(base.personaEngine ?? {}),
      preferences: {
        ...(base.personaEngine?.preferences ?? {}),
      },
    };
    if (opts.dietaryRestriction) {
      const diet = [
        ...(pe.preferences.dietaryRestrictions ?? []),
        opts.dietaryRestriction,
      ];
      pe.preferences.dietaryRestrictions = [
        ...new Set(diet.map((d) => d.trim()).filter(Boolean)),
      ];
    }
    if (opts.dislike) {
      const dis = [...(pe.preferences.dislikes ?? []), opts.dislike];
      pe.preferences.dislikes = [
        ...new Set(dis.map((d) => d.trim()).filter(Boolean)),
      ];
    }

    const experiencePrefs = { ...base.experiencePrefs };
    if (opts.experiencePref) {
      experiencePrefs[opts.experiencePref.key] = opts.experiencePref.value;
    }

    const tonalities = opts.tonalities ?? base.tonalities;
    const resolvedTone =
      opts.toneStyle ?? pe.toneStyle ?? base.personaEngine?.toneStyle;

    const saved = await saveUserProfile({
      ...base,
      learnedFacts,
      tonalities,
      personaEngine: {
        ...pe,
        ...(resolvedTone ? { toneStyle: resolvedTone } : {}),
      },
      experiencePrefs,
    });
    set({ profile: saved });
    return saved;
  },

  getEngine: () => resolvePersonaEngine(get().profile),
}));

/** Einmalig am App-Start: Store mit FileSystem synchronisieren. */
let subscribed = false;
export function ensureUserProfileStoreSync(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeUserProfile((profile) => {
    useUserProfileStore.setState({ profile, hydrated: true });
  });
  void useUserProfileStore.getState().hydrate();
}
