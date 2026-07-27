import type { AttentionCue } from './navigationTypes';

/**
 * Detect spoken direction cues for spontaneous compass attention.
 * Prefer explicit phrases (not bare "links"/"rechts" in unrelated words).
 */
export function scanAttentionCue(text: string): AttentionCue {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  if (
    /\b(hinter dir|dreh dich (mal )?um|schau (mal )?zurück|im rücken)\b/u.test(
      t,
    )
  ) {
    return 'behind';
  }

  if (
    /\b(auf der linken seite|links von dir|nach links|zur linken|linker hand|links neben|schau (mal )?links)\b/u.test(
      t,
    )
  ) {
    return 'left';
  }

  if (
    /\b(auf der rechten seite|rechts von dir|nach rechts|zur rechten|rechter hand|rechts neben|schau (mal )?rechts)\b/u.test(
      t,
    )
  ) {
    return 'right';
  }

  return null;
}
