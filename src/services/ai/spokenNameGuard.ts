/**
 * Verhindert, dass TTS-Modell-/Stimmen-Namen als User-Vornamen gesprochen werden.
 * Prompt-Priming mit „nicht Thorsten sagen“ führt bei kleinen Modellen oft zum Gegenteil.
 */

/** Interne Stimmen-/Modell-Tokens — nie als Anrede. */
const VOICE_MODEL_NAME_RE =
  /\b(thorsten|martin|eva|karl|kerstin|ramona|aishel|mls)\b/gi;

/**
 * Entfernt Stimmen-Namen aus gesprochenem Text.
 * Erlaubter User-Vorname bleibt stehen, wenn er übergeben wird.
 */
export function scrubInventedVoiceNames(
  text: string,
  allowedFirstName?: string | null,
): string {
  if (!text) return text;
  const allowed = allowedFirstName?.trim().toLowerCase() || null;

  let s = text.replace(VOICE_MODEL_NAME_RE, (match) => {
    if (allowed && match.toLowerCase() === allowed) return match;
    return '';
  });

  s = s
    .replace(/\b(hey|hi|hallo|moin)\s*,?\s*(?=[,.!?]|$)/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[,\s]+/, '')
    .trim();

  return s;
}

/**
 * Entfernt den User-Vornamen aus Speech, wenn die Modul-1-Quote ihn blockt.
 */
export function scrubBlockedUserFirstName(
  text: string,
  firstName?: string | null,
): string {
  const name = firstName?.trim();
  if (!text || !name || name.length < 2) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = text
    .replace(new RegExp(`\\b(hey|hi|hallo|moin)\\s+${esc}\\b[,:]?\\s*`, 'giu'), '$1, ')
    .replace(new RegExp(`\\b${esc}\\s*[,:]\\s*`, 'giu'), '')
    .replace(new RegExp(`\\b${esc}\\b`, 'giu'), '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[,\s]+/, '')
    .trim();
  return s;
}

/** Max. 1× Vorname pro Textstück (auch wenn Quote freigibt). */
export function limitUserFirstNameToOnce(
  text: string,
  firstName?: string | null,
): string {
  const name = firstName?.trim();
  if (!text || !name || name.length < 2) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${esc}\\b`, 'giu');
  let seen = false;
  return text
    .replace(re, (match) => {
      if (!seen) {
        seen = true;
        return match;
      }
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

export function textContainsUserFirstName(
  text: string,
  firstName?: string | null,
): boolean {
  const name = firstName?.trim();
  if (!text || !name || name.length < 2) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'iu').test(text);
}
