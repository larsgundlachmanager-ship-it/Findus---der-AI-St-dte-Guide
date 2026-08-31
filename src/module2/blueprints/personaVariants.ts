/**
 * Persona-Segmente für Blaupausen-Varianten (Familie / Party / Solo / Default).
 */

import type { PersonaVariant } from '../router/routeAllowlist';

export type PersonaHint = {
  variant: PersonaVariant;
  reason: string;
  extraFactHints: string[];
};

/** Soft aus Profil — keine erfundenen sensiblen Annahmen. */
export function resolvePersonaVariant(): PersonaHint {
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => {
        travelParty?: string | null;
        personaEngine?: {
          travelParty?: string | null;
          preferences?: Record<string, unknown>;
        } | null;
      } | null;
    };
    const p = getCachedUserProfile();
    const party = String(
      p?.travelParty || p?.personaEngine?.travelParty || '',
    ).toLowerCase();

    if (party === 'family') {
      return {
        variant: 'family_kids',
        reason: 'travelParty=family',
        extraFactHints: [
          'Familienfreundlich: Sitzerhöhung / Kinderwagen / Wickelmöglichkeit wenn belegt',
          'Lautstärke / Altersfreigabe wenn belegt',
        ],
      };
    }
    if (party === 'friends' || party === 'date') {
      const prefs = p?.personaEngine?.preferences || {};
      const nightlife =
        prefs.nightlife === true ||
        prefs.party === true ||
        String(prefs.vibe || '').toLowerCase().includes('party');
      if (nightlife || party === 'friends') {
        return {
          variant: 'party_nightlife',
          reason: 'travelParty/friends+nightlife',
          extraFactHints: [
            'Getränke / Bier / After wenn belegt',
            'Öffnungszeiten Abend / Einlass wenn belegt',
          ],
        };
      }
    }
    if (party === 'solo') {
      return {
        variant: 'solo_adult',
        reason: 'travelParty=solo',
        extraFactHints: ['Solo-tauglich / Bar-Platz / Einzelkarte wenn belegt'],
      };
    }
  } catch {
    /* soft */
  }
  return { variant: 'default', reason: 'default', extraFactHints: [] };
}

export function personaPromptBlock(hint: PersonaHint): string {
  if (hint.variant === 'default') {
    return 'PERSONA: default — neutrale Zusatzfakten, kein Stereotyp.';
  }
  return [
    `PERSONA: ${hint.variant} (${hint.reason})`,
    'Zusatzfakten nur wenn belegt:',
    ...hint.extraFactHints.map((h) => `- ${h}`),
  ].join('\n');
}
