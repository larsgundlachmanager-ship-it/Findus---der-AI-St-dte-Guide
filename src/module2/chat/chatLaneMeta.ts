/**
 * Chat-Lane Meta-Tags nie in Speech/UI — auch ohne Zeilenumbruch.
 */

export function stripChatLaneMeta(text: string): string {
  return (text || '')
    .replace(/\bWANT_REMINDER:\s*(yes|no)\b/giu, ' ')
    .replace(/\bLOCAL_SHOW:\s*(?:none|[^\n]+)/giu, ' ')
    .replace(/\b(?:SPEECH|BULLET):\s*/giu, ' ')
    .replace(/\bPACK-DATENSATZ\b[^.!?]*/giu, ' ')
    .replace(/\bSICHTBARKEIT\b[^.!?]*/giu, ' ')
    .replace(/\bTOPIC-LOCK\b[^.!?]*/giu, ' ')
    .replace(/\b(?:FLOW|FAKTEN)(?:\s+\w+)?:\s*[^.!?]*/giu, ' ')
    .replace(/\bNutze diese Fakten\b[^.!?]*/giu, ' ')
    .replace(/\bBeantworte(?:\s+die)?\b[^.!?]*/giu, ' ')
    .replace(/\bKEINE Formulierungen\b[^.!?]*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
