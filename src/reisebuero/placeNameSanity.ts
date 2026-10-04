/**
 * Pseudo-Orte / STT-Deixis — nie als Start/Ziel für Bahn, Board oder Brief.
 * „davon“, „dahin“, Vornamen, … sind keine Städte.
 */

const NON_PLACE =
  /^(davon|dahin|darauf|dar[uü]ber|damit|dazu|daran|daraus|hier|da|dort|start|egal|irgendwo|woher|wohin|uns|euch|denen|dem|der|den|die|das|ein|eine|mal|jetzt|dann|also|halt|irgendwie|wei[sß]s?\s*nicht|keine\s*ahnung|machen|wissen|wollen|einfach|gerne|party|urlaub|hin)$/iu;

const FIRST_NAME =
  /^(kristof|christoph|christopher|andreas|michael|thomas|martin|christian|stefan|peter|lars|jan|tim|max|luca|nico|paul|david|daniel|klaus|hans|leon|finn|jonas)$/iu;

/** Kern ohne „Hbf“ / Bahnhof-Suffix. */
function placeCore(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/\s*(hbf|hauptbahnhof|bahnhof|station|hl\.?\s*n\.?)\s*$/iu, '')
    .trim();
}

/** Kein realer Reiseort — Brief/Bahn darf das nicht übernehmen. */
export function isJunkPlaceName(raw: string | null | undefined): boolean {
  const t = (raw || '').trim();
  if (!t || t.length < 2) return true;
  const core = placeCore(t);
  if (!core || core.length < 3) return true;
  if (NON_PLACE.test(core)) return true;
  if (FIRST_NAME.test(core)) return true;
  // reine Pronomen/Füllwörter mit Bindestrich
  if (/^(von|ab|aus|nach|zum|zur)-/i.test(core)) return true;
  return false;
}

/**
 * Echten Ortsnamen für Bahn/Bus/Deeplink — Junk → Fallback (Heimat/Hamburg).
 */
export function sanitizeTravelPlaceName(
  raw: string | null | undefined,
  fallback = 'Hamburg',
): string {
  const t = (raw || '').trim();
  if (!t || isJunkPlaceName(t)) {
    const fb = (fallback || 'Hamburg').trim();
    return isJunkPlaceName(fb) ? 'Hamburg' : fb;
  }
  return t;
}
