/**
 * Stimmen-Zuordnung aus Persönlichkeits-Matrix (Golden Combos + freie Kat. 1/2).
 *
 * Kernrollen-Defaults (verbindlich):
 * Classic → Sebastian · Opi → Alexander · Kumpel → Varson ·
 * Aristokrat → Jaqcline · Nerd → Lukas · Kind → Rena
 */

import type { UserGender, VoiceId } from '../../types/userProfile';
import type {
  CoreRoleId,
  GoldenCombo,
  VibeToneId,
} from '../../constants/personalityMatrix';
import { GOLDEN_COMBOS, matchGoldenCombo } from '../../constants/personalityMatrix';

const ROLE_VOICES: Record<
  CoreRoleId,
  { male: VoiceId; female: VoiceId }
> = {
  classic_guide: { male: 'sebastian', female: 'sebastian' },
  heartfelt_oldie: { male: 'alexander', female: 'alexander' },
  buddy: { male: 'varson', female: 'varson' },
  aristocrat: { male: 'jaqcline', female: 'jaqcline' },
  nerd: { male: 'lukas', female: 'lukas' },
  innocent_child: { male: 'rena', female: 'rena' },
};

/** Primärstimme je Kernrolle (für Empfohlen-oben). */
export function primaryVoiceForCoreRole(
  role: CoreRoleId | null | undefined,
): VoiceId {
  const base = ROLE_VOICES[role ?? 'classic_guide'] ?? ROLE_VOICES.classic_guide;
  return base.male;
}

function pickGenderVoice(
  male: VoiceId,
  female: VoiceId,
  gender?: UserGender | null,
): VoiceId {
  if (gender === 'female') return female;
  return male;
}

export function resolveVoiceForPersonality(input: {
  coreRole?: CoreRoleId | null;
  vibeTone?: VibeToneId | null;
  knowledgeStyle?: string | null;
  spleens?: string[];
  gender?: UserGender | null;
  /** Wenn Golden Combo matched → deren Stimmen */
  preferComboVoice?: boolean;
}): VoiceId {
  const role = input.coreRole ?? 'classic_guide';

  // Kernrollen-Stimme hat Vorrang vor Combo-/Vibe-Overrides
  if (input.coreRole) {
    return primaryVoiceForCoreRole(input.coreRole);
  }

  if (input.preferComboVoice !== false) {
    const combo = matchGoldenCombo({
      coreRole: role,
      vibeTone: input.vibeTone ?? 'balanced',
      knowledgeStyle: input.knowledgeStyle as never,
      spleens: input.spleens as never,
    });
    if (combo) {
      return pickGenderVoice(
        combo.voiceMale,
        combo.voiceFemale,
        input.gender,
      );
    }
  }

  const base = ROLE_VOICES[role] ?? ROLE_VOICES.classic_guide;
  return pickGenderVoice(base.male, base.female, input.gender);
}

export function voiceForGoldenCombo(
  combo: GoldenCombo,
  gender?: UserGender | null,
): VoiceId {
  if (combo.coreRole) return primaryVoiceForCoreRole(combo.coreRole);
  return pickGenderVoice(combo.voiceMale, combo.voiceFemale, gender);
}

/** Stimmen, die zu einer Golden Combo passen (♂ + ♀, dedupliziert). */
export function voicesMatchingGoldenCombo(combo: GoldenCombo): VoiceId[] {
  const primary = primaryVoiceForCoreRole(combo.coreRole);
  return Array.from(new Set([primary, combo.voiceMale, combo.voiceFemale]));
}

/** Stimmen passend zur aktuellen Matrix (Combo oder Rollen-Map). */
export function voicesMatchingPersonality(input: {
  coreRole?: CoreRoleId | null;
  vibeTone?: VibeToneId | null;
  knowledgeStyle?: string | null;
  spleens?: string[];
}): VoiceId[] {
  if (input.coreRole) {
    return [primaryVoiceForCoreRole(input.coreRole)];
  }
  const combo = matchGoldenCombo({
    coreRole: input.coreRole,
    vibeTone: input.vibeTone,
    knowledgeStyle: input.knowledgeStyle as never,
    spleens: input.spleens as never,
  });
  if (combo) return voicesMatchingGoldenCombo(combo);
  const role = input.coreRole ?? 'classic_guide';
  const base = ROLE_VOICES[role] ?? ROLE_VOICES.classic_guide;
  return Array.from(new Set([base.male, base.female]));
}

export function applyGoldenComboToProfile(combo: GoldenCombo): {
  coreRole: CoreRoleId;
  vibeTone: VibeToneId;
  knowledgeStyle: string;
  spleens: string[];
  voiceId: VoiceId;
} {
  return {
    coreRole: combo.coreRole,
    vibeTone: combo.vibeTone,
    knowledgeStyle: combo.knowledgeStyle,
    spleens: [...combo.spleens],
    voiceId: primaryVoiceForCoreRole(combo.coreRole),
  };
}

export { GOLDEN_COMBOS };
