/**
 * Standard-Ausblendung unbesuchter Stempel-Pins nach Profil-Interessen.
 * Transit / Hotels immer; Kirchen nur wenn explizit uninteressant.
 */

import type { UserProfile } from '../../types/userProfile';
import { resolveUserInterestIds } from '../ai/promptBuilder';
import type { StampMapCategory } from './stampMapCategories';

/**
 * Kategorien, die bei „unbesuchte Orte“ initial ausgeblendet werden.
 * Besuchte Pins bleiben immer sichtbar; Legende kann alles wieder einblenden.
 */
export function getHiddenStampCategories(
  profile?: UserProfile | null,
): Set<StampMapCategory> {
  const ids = resolveUserInterestIds(profile);
  const prefs = profile?.experiencePrefs ?? {};
  const hidden = new Set<StampMapCategory>(['transport', 'hotel']);

  // Kirchen: ausblenden wenn „no“ oder nie gewählt; anzeigen wenn „yes“
  if (prefs.kirchen === 'yes' || ids.includes('kirchen')) {
    // keep visible
  } else {
    hidden.add('kirche');
  }

  return hidden;
}
