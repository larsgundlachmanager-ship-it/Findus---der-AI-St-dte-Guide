/**
 * Verhindert, dass Piper-Modell-/Stimmen-Namen als User-Vornamen gesprochen werden.
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
