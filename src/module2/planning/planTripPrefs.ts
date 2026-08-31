/**
 * Modul 5 — Trip-Prefs für den nächsten Trip (Club vs Bar, Puffer, Frühstück…).
 */

import * as FileSystem from 'expo-file-system';

export type PlanTripPrefs = {
  preferClubOverBar?: boolean | null;
  preferBarThenClub?: boolean | null;
  skipBreakfastOften?: boolean | null;
  extraWakeBufferMin?: number | null;
  preferWalkWhenNice?: boolean | null;
  lastPartyGenre?: string | null;
  updatedAtMs?: number;
};

const PATH = `${FileSystem.documentDirectory ?? ''}findus-plan-trip-prefs.json`;

let cache: PlanTripPrefs | null = null;

export function getPlanTripPrefsSync(): PlanTripPrefs {
  return cache ?? {};
}

export async function loadPlanTripPrefs(): Promise<PlanTripPrefs> {
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) {
      cache = {};
      return cache;
    }
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as PlanTripPrefs;
    cache = parsed && typeof parsed === 'object' ? parsed : {};
    return cache;
  } catch {
    cache = {};
    return cache;
  }
}

export async function savePlanTripPrefs(
  patch: Partial<PlanTripPrefs>,
): Promise<PlanTripPrefs> {
  const next: PlanTripPrefs = {
    ...getPlanTripPrefsSync(),
    ...patch,
    updatedAtMs: Date.now(),
  };
  cache = next;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(next));
  } catch {
    /* soft */
  }
  return next;
}

/** Aus User-Text / Clarify ableiten. */
export function inferTripPrefsFromText(text: string): Partial<PlanTripPrefs> {
  const t = (text ?? '').toLowerCase();
  const out: Partial<PlanTripPrefs> = {};
  if (/\b(nur\s+)?club\b/.test(t) && !/\bbar\b/.test(t)) {
    out.preferClubOverBar = true;
    out.preferBarThenClub = false;
  } else if (/\bnur\s+bar\b/.test(t) || (/\bbar\b/.test(t) && !/\bclub\b/.test(t))) {
    out.preferClubOverBar = false;
    out.preferBarThenClub = false;
  } else if (/\bbar\b/.test(t) && /\bclub\b/.test(t)) {
    out.preferBarThenClub = true;
  }
  if (/\b(kein\s+frühstück|kein\s+fruehstueck|frühstück\s+raus|hunger\s+nicht)\b/.test(t)) {
    out.skipBreakfastOften = true;
  }
  if (/\b(früher\s+wecken|halbe\s+stunde\s+früher|länger\s+brauchen)\b/.test(t)) {
    out.extraWakeBufferMin = 30;
  }
  if (/\b(10\s*min|zehn\s+minuten).{0,20}(frühstück|fruehstueck|wach)\b/.test(t)) {
    out.extraWakeBufferMin = 10;
  }
  const genre = t.match(
    /\b(techno|house|schlager|hip[-\s]?hop|rock|latin|charts|elektro)\b/i,
  );
  if (genre?.[1]) out.lastPartyGenre = genre[1].toLowerCase();
  return out;
}

export function prefsBlockForPrompt(): string {
  const p = getPlanTripPrefsSync();
  const bits: string[] = [];
  if (p.preferClubOverBar === true) bits.push('User bevorzugt Club (nicht nur Bar)');
  if (p.preferBarThenClub === true) bits.push('User mag oft Bar dann Club');
  if (p.preferClubOverBar === false && p.preferBarThenClub === false) {
    bits.push('User bevorzugt eher Bar');
  }
  if (p.skipBreakfastOften) bits.push('Frühstück oft streichen');
  if (p.extraWakeBufferMin != null) {
    bits.push(`Wecker-Puffer oft +${p.extraWakeBufferMin} Min`);
  }
  if (p.lastPartyGenre) bits.push(`Party-Genre zuletzt: ${p.lastPartyGenre}`);
  return bits.length ? bits.join('; ') : 'keine';
}
