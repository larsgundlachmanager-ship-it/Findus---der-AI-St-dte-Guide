/**
 * Modul-1 Pref-/Cooldown-Gates (Reboot).
 * must_have / yes → immer (nach Stamp/Speed/Away)
 * neutral → nur wenn seit letztem M1 ≥ 3 min
 * no → skip (außer Override woanders)
 */

import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { isMustHavePoi, resolvePlaceTiers } from '../interests/placeTiers';
import { parseTagsJson } from '../services/geo/triggerPolicy';
import {
  getLastModule1EventAtMs,
  noteModule1Event,
} from '../services/navigation/modulePriorityPolicy';
import {
  matchingDimensions,
  promptWeightForInterest,
} from '../interests/interestTaxonomy';

export const MODULE1_NEUTRAL_COOLDOWN_MS = 3 * 60_000;
export const MODULE1_HARD_SKIP_SPEED_KMH = 50;
export const MODULE1_HARD_SKIP_SPEED_MS = MODULE1_HARD_SKIP_SPEED_KMH / 3.6;

/** Legacy-Keys → neue Pref-Keys (Settings/Onboarding-Migration). */
const LEGACY_PREF_ALIASES: Record<string, string[]> = {
  theater_kultur: ['theater', 'kino', 'konzert_musical'],
  denkmäler: ['denkmaeler'],
  parks: ['natur'],
  schlösser: ['architektur'],
};

/** Kategorie → experiencePrefs key (Fallback wenn Taxonomy nicht trifft). */
const CATEGORY_PREF_KEYS: Record<string, string> = {
  theater: 'theater',
  theater_kultur: 'theater',
  kino: 'kino',
  cinema: 'kino',
  konzert: 'konzert_musical',
  musical: 'konzert_musical',
  kirche: 'kirchen',
  kirchen: 'kirchen',
  church: 'kirchen',
  museum: 'museen',
  museen: 'museen',
  denkmal: 'denkmaeler',
  denkmaeler: 'denkmaeler',
  cafe: 'cafes',
  café: 'cafes',
  park: 'natur',
  parks: 'natur',
  aussicht: 'aussichten',
  aussichten: 'aussichten',
  strand: 'strand',
  beach: 'strand',
  sport: 'sport',
  freizeit: 'aktivitaeten',
  freizeitpark: 'aktivitaeten',
  schloss: 'architektur',
  schloesser: 'architektur',
  leuchtturm: 'aussichten',
  landmark: 'aussichten',
};

export type PrefStrength = 'must_have' | 'yes' | 'neutral' | 'no';

function readPref(
  prefs: Record<string, string | undefined> | undefined,
  key: string,
): 'yes' | 'no' | 'neutral' | null {
  if (!prefs) return null;
  const raw = prefs[key];
  if (raw === 'yes' || raw === 'no') return raw;
  if (raw === 'neutral') return 'neutral';
  // Legacy: theater_kultur deckt Theater/Kino/Konzert ab
  if (
    key === 'theater' ||
    key === 'kino' ||
    key === 'konzert_musical'
  ) {
    const legacy = prefs.theater_kultur;
    if (legacy === 'yes' || legacy === 'no') return legacy;
  }
  for (const [legacy, targets] of Object.entries(LEGACY_PREF_ALIASES)) {
    if (targets.includes(key)) {
      const v = prefs[legacy];
      if (v === 'yes' || v === 'no') return v;
    }
  }
  return null;
}

export function resolvePoiPrefStrength(
  poi: Poi,
  profile?: UserProfile | null,
): { strength: PrefStrength; prefKey: string | null } {
  if (isMustHavePoi(poi) || resolvePlaceTiers(poi).includes('landmark')) {
    return { strength: 'must_have', prefKey: 'must_have' };
  }
  const tags = parseTagsJson(poi.tags_json);
  const cat = (poi.category ?? '').trim().toLowerCase();
  const blob = `${cat} ${tags.join(' ')}`.toLowerCase();

  const dims = matchingDimensions(tags, cat);
  let prefKey: string | null =
    dims.sort(
      (a, b) => promptWeightForInterest(b.prefKey) - promptWeightForInterest(a.prefKey),
    )[0]?.prefKey ?? null;

  if (!prefKey) {
    prefKey = CATEGORY_PREF_KEYS[cat] ?? null;
  }
  if (!prefKey) {
    for (const [k, v] of Object.entries(CATEGORY_PREF_KEYS)) {
      if (blob.includes(k)) {
        prefKey = v;
        break;
      }
    }
  }

  if (!prefKey || !profile?.experiencePrefs) {
    return { strength: 'neutral', prefKey };
  }
  const raw = readPref(profile.experiencePrefs as Record<string, string>, prefKey);
  if (raw === 'no') return { strength: 'no', prefKey };
  if (raw === 'yes') return { strength: 'yes', prefKey };
  return { strength: 'neutral', prefKey };
}

export type Module1PrefGate =
  | { ok: true; strength: PrefStrength; reason: string }
  | { ok: false; strength: PrefStrength; reason: string };

/**
 * Pref-Pyramide nach Stamp/Away/Speed.
 * must_have + yes: immer ok (Neutral-3min greift nicht).
 * neutral: nur wenn last M1 ≥ 3 min.
 * no: block (Override läuft separat in TourDirector).
 */
export function evaluateModule1PrefGate(input: {
  poi: Poi;
  profile?: UserProfile | null;
  nowMs?: number;
  force?: boolean;
}): Module1PrefGate {
  if (input.force) {
    return { ok: true, strength: 'yes', reason: 'force' };
  }
  const { strength, prefKey } = resolvePoiPrefStrength(input.poi, input.profile);
  if (strength === 'must_have') {
    return { ok: true, strength, reason: 'must_have' };
  }
  if (strength === 'yes') {
    return { ok: true, strength, reason: `pref_yes:${prefKey ?? 'x'}` };
  }
  if (strength === 'no') {
    return { ok: false, strength, reason: `pref_no:${prefKey ?? 'x'}` };
  }
  const now = input.nowMs ?? Date.now();
  const last = getLastModule1EventAtMs();
  if (last != null && now - last < MODULE1_NEUTRAL_COOLDOWN_MS) {
    return {
      ok: false,
      strength: 'neutral',
      reason: 'neutral_cooldown',
    };
  }
  return { ok: true, strength: 'neutral', reason: 'neutral_ok' };
}

export function noteModule1PrefFired(): void {
  noteModule1Event();
}
