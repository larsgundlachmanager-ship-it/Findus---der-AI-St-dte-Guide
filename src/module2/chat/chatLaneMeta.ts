/**
 * Chat-Lane Meta-Tags nie in Speech/UI — auch ohne Zeilenumbruch.
 */

export function stripChatLaneMeta(text: string): string {
  return (text || '')
    .replace(/\bWANT_REMINDER:\s*(yes|no)\b/giu, ' ')
    .replace(/\bLOCAL_SHOW:\s*(?:none|[^\n]+)/giu, ' ')
    .replace(/\b(?:SPEECH|BULLET):\s*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
