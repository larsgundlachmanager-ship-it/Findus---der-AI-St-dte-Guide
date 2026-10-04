/**
 * Visuell verlässliche Outdoor-Landmarken für Turn-Cues.
 * Briefkasten/Bank/generischer Laden → zu schwach für Hosentaschen-Navi.
 */

export function isWeakVisualLandmark(label: string | null | undefined): boolean {
  const t = String(label || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!t || t.length < 3) return true;
  if (
    /\b(briefkasten|mailbox|post\s*box|mülleimer|muelleimer|bank\b|sitzbank|automat|kiosk|flyer|werbetafel|plakat)\b/iu.test(
      t,
    ) ||
    /broschüre|broschuere/iu.test(t)
  ) {
    return true;
  }
  if (/^laden\s*\(/iu.test(t)) return true;
  if (/^(baum|tree)\b/iu.test(t) && !/[„"]/.test(label || '')) return true;
  return false;
}

/** Straße/Allee/Gasse — besser als schwache Shop-Namen (auch Komposita). */
export function looksLikeStreetLandmark(label: string | null | undefined): boolean {
  return /(straße|strasse|str\.?|weg|allee|gasse|platz|ring|damm|chaussee|ufer)/iu.test(
    String(label || ''),
  );
}
