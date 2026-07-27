import type { BudgetCategory } from '../types/userProfile';

/** Ungefähre Tagesbudgets — immer mit Euro-Hinweis anzeigen. */
export const BUDGET_AMOUNT_HINT: Record<BudgetCategory, string> = {
  sparsam: 'ca. 40 €/Tag',
  mittel: 'ca. 80 €/Tag',
  komfort: 'ca. 150 €/Tag',
};

export const BUDGET_AMOUNT_SPEECH: Record<BudgetCategory, string> = {
  sparsam: 'ein sparsames Budget von etwa 40 Euro am Tag',
  mittel: 'ein mittleres Budget von etwa 80 Euro am Tag',
  komfort: 'ein komfortables Budget von etwa 150 Euro am Tag',
};

export function budgetSpeechFromProfile(profile: {
  budgetCategory?: BudgetCategory | null;
  experiencePrefs?: Record<string, string>;
}): string {
  if (profile.budgetCategory) {
    return BUDGET_AMOUNT_SPEECH[profile.budgetCategory];
  }
  const b = profile.experiencePrefs?.budget;
  if (b === 'no') return BUDGET_AMOUNT_SPEECH.sparsam;
  if (b === 'yes') return BUDGET_AMOUNT_SPEECH.komfort;
  return BUDGET_AMOUNT_SPEECH.mittel;
}
