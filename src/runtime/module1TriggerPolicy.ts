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
import { promptWeightForInterest } from '../interests/interestTaxonomy';

export const MODULE1_NEUTRAL_COOLDOWN_MS = 3 * 60_000;
export const MODULE1_HARD_SKIP_SPEED_KMH = 50;
export const MODULE1_HARD_SKIP_SPEED_MS = MODULE1_HARD_SKIP_SPEED_KMH / 3.6;

/** Kategorie → experiencePrefs key (erweitert um gängige Tags). */
const CATEGORY_PREF_KEYS: Record<string, string> = {
  kirche: 'kirchen',
  kirchen: 'kirchen',
  church: 'kirchen',
  museum: 'museen',
  museen: 'museen',
  denkmal: 'denkmäler',
  denkmaeler: 'denkmäler',
  park: 'parks',
  parks: 'parks',
  aussicht: 'aussichten',
  aussichten: 'aussichten',
  strand: 'strand',
  beach: 'strand',
  schloss: 'schlösser',
  schloesser: 'schlösser',
  leuchtturm: 'aussichten',
  landmark: 'aussichten',
};

export type PrefStrength = 'must_have' | 'yes' | 'neutral' | 'no';

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

  let prefKey: string | null =
    CATEGORY_PREF_KEYS[cat] ?? (cat && cat.length > 2 ? cat : null);
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
  const raw = profile.experiencePrefs[prefKey];
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
  const { strength } = resolvePoiPrefStrength(input.poi, input.profile);
  if (strength === 'must_have') {
    return { ok: true, strength, reason: 'must_have' };
  }
  if (strength === 'yes') {
    return { ok: true, strength, reason: 'pref_yes' };
  }
  if (strength === 'no') {
    return { ok: false, strength, reason: 'pref_no' };
  }

  const now = input.nowMs ?? Date.now();
  const last = getLastModule1EventAtMs();
  if (last != null && now - last < MODULE1_NEUTRAL_COOLDOWN_MS) {
    return {
      ok: false,
      strength: 'neutral',
      reason: 'neutral_cooldown_3m',
    };
  }
  return { ok: true, strength: 'neutral', reason: 'neutral_ok' };
}

export function shouldHardSkipForSpeedKmh(speedMs: number | null | undefined): boolean {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs)) return false;
  return speedMs >= MODULE1_HARD_SKIP_SPEED_MS;
}

/** Re-export für Explore nach Fire. */
export { noteModule1Event };

/** Debug: Pref-Gewicht für Interessen (Story-Brief). */
export function debugPrefWeight(prefKey: string): number {
  try {
    return promptWeightForInterest(prefKey);
  } catch {
    return 1;
  }
}
