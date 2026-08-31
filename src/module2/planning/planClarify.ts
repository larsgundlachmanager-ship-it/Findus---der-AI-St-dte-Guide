/**
 * Modul 5 — Clarify vor Pitch (Party zu breit, Frühstück↔Café mergen).
 */

import type { IngestOpenWish } from './planningTypes';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { getPlanTripPrefsSync } from './planTripPrefs';

export function isVaguePartyWish(wish: IngestOpenWish): boolean {
  const blob = `${wish.title} ${wish.context}`.toLowerCase();
  if (!/\b(party|feier|feiern|nightlife|ausgehen|tanzen|club|bar)\b/i.test(blob)) {
    return false;
  }
  // Schon eingegrenzt?
  if (
    /\b(techno|house|schlager|hip[-\s]?hop|rock|latin|nur\s+bar|nur\s+club|bar\s+dann\s+club)\b/i.test(
      blob,
    )
  ) {
    return false;
  }
  const prefs = getPlanTripPrefsSync();
  if (prefs.preferClubOverBar != null || prefs.preferBarThenClub != null) {
    return false; // schon Pref → kein Clarify
  }
  return true;
}

export function partyClarifyShortAnswers(): void {
  usePlanCalendarUiStore.getState().setShortAnswers([
    {
      id: 'party_bar',
      label: 'Nur Bar',
      action: 'prompt',
      prompt: 'Nur Bar, kein Club',
    },
    {
      id: 'party_club',
      label: 'Nur Club',
      action: 'prompt',
      prompt: 'Nur Club',
    },
    {
      id: 'party_both',
      label: 'Bar dann Club',
      action: 'prompt',
      prompt: 'Zuerst Bar, dann Club',
    },
    {
      id: 'party_music',
      label: 'Musik wählen',
      action: 'prompt',
      prompt: 'Ich sag dir noch die Musikrichtung',
    },
  ]);
}

export function canMergeBreakfastIntoCafe(
  breakfast: IngestOpenWish,
  cafeMeeting: IngestOpenWish | { title: string; context: string },
): boolean {
  const b = `${breakfast.title} ${breakfast.context}`.toLowerCase();
  const c = `${cafeMeeting.title} ${cafeMeeting.context}`.toLowerCase();
  const isBreakfast = /\b(frühstück|fruehstueck|kaffee|breakfast)\b/i.test(b);
  const isCafe =
    /\b(café|cafe|meeting|laptop|homeoffice|arbeit)\b/i.test(c) ||
    /\b(café|cafe)\b/i.test(c);
  return isBreakfast && isCafe;
}

export function mergeBreakfastShortAnswers(): void {
  usePlanCalendarUiStore.getState().setShortAnswers([
    {
      id: 'merge_yes',
      label: 'Im Café frühstücken',
      action: 'prompt',
      prompt: 'Frühstück direkt im Meeting-Café, früher da',
    },
    {
      id: 'merge_no',
      label: 'Getrennt suchen',
      action: 'prompt',
      prompt: 'Frühstück getrennt vom Meeting-Café',
    },
  ]);
}

/** Prefs in Wish-Context einweben bevor Pitch. */
export function enrichWishWithPrefs(wish: IngestOpenWish): IngestOpenWish {
  const p = getPlanTripPrefsSync();
  const bits: string[] = [];
  if (p.preferClubOverBar === true) bits.push('nur Club bevorzugt');
  if (p.preferBarThenClub === true) bits.push('Bar dann Club');
  if (p.preferClubOverBar === false && p.preferBarThenClub === false) {
    bits.push('eher Bar');
  }
  if (p.lastPartyGenre) bits.push(`Genre: ${p.lastPartyGenre}`);
  if (!bits.length) return wish;
  return {
    ...wish,
    context: `${wish.context} | Prefs: ${bits.join(', ')}`.slice(0, 400),
  };
}
