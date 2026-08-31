/**
 * Smalltalk-Companion: User will emotionalen Beistand / Persönlichkeit aufbauen.
 * Fast-Lane only — keine Research, keine Gastro/Nav-Jobs.
 * Sticky bis Wake zu Concierge oder klarer Travel-Intent.
 */

const HOLD_MS = 12 * 60_000;

let activeUntilMs = 0;
let lastReason: string | null = null;
/** Kurze In-Session-Persönlichkeits-Notizen (nur RAM). */
const personaNotes: string[] = [];

const COMPANION_RE =
  /\b(brauch(?:e)?\s+(?:mal\s+)?(?:deinen?\s+)?rat|rat\s+brauch|hilfst\s+du\s+mir|kannst\s+du\s+mir\s+helfen|geht\s+mir\s+(?:nicht\s+)?gut|bin\s+(?:traurig|gestresst|überfordert|ueberfordert|einsam|wütend|wuetend|ängstlich|aengstlich)|hab\s+(?:ein\s+)?problem|red(?:e)?\s+(?:mal\s+)?mit\s+mir|hör\s+(?:mir\s+)?zu|hoer\s+(?:mir\s+)?zu|smalltalk|plaudern|unterhalten|wie\s+geht(?:'s|s| es)\s+(?:dir|euch)|fühl\s+mich|fuehl\s+mich|sei\s+(?:mal\s+)?für\s+mich\s+da|fuer\s+mich\s+da)\b/iu;

const TRAVEL_ABORT_RE =
  /\b(restaurant|pizza|eis|café|cafe|route|navig|führ\s+mich|fuehr\s+mich|museum|hotel|strand|sonnenuntergang|speisekarte|öffnungszeit|oeffnungszeit|wie\s+weit|bring\s+mich|taxi|uber)\b/iu;

export function isSmalltalkCompanionActive(): boolean {
  return Date.now() < activeUntilMs;
}

export function getSmalltalkCompanionReason(): string | null {
  return isSmalltalkCompanionActive() ? lastReason : null;
}

export function markSmalltalkCompanion(reason = 'companion'): void {
  activeUntilMs = Date.now() + HOLD_MS;
  lastReason = reason;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[smalltalk-companion] ON', reason);
  }
}

export function bumpSmalltalkCompanion(reason?: string): void {
  if (!isSmalltalkCompanionActive()) {
    markSmalltalkCompanion(reason ?? 'companion');
    return;
  }
  activeUntilMs = Date.now() + HOLD_MS;
  if (reason) lastReason = reason;
}

export function clearSmalltalkCompanion(reason = 'travel'): void {
  if (!isSmalltalkCompanionActive() && activeUntilMs === 0) return;
  activeUntilMs = 0;
  lastReason = null;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[smalltalk-companion] OFF', reason);
  }
}

export function looksLikeSmalltalkCompanion(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  if (TRAVEL_ABORT_RE.test(t) && !COMPANION_RE.test(t)) return false;
  return COMPANION_RE.test(t);
}

/** Travel-Intent beendet Companion → normale Concierge-Lane. */
export function shouldAbortCompanionForTravel(text: string): boolean {
  return TRAVEL_ABORT_RE.test((text || '').trim());
}

export function rememberCompanionPersonaNote(note: string): void {
  const n = note.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (n.length < 8) return;
  if (personaNotes.some((x) => x === n)) return;
  personaNotes.unshift(n);
  if (personaNotes.length > 8) personaNotes.length = 8;
}

export function getCompanionPersonaNotes(): string[] {
  return [...personaNotes];
}

export function resetSmalltalkCompanion(): void {
  activeUntilMs = 0;
  lastReason = null;
  personaNotes.length = 0;
}
