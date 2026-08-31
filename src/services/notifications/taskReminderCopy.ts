/**
 * Zeit-Aufgaben vs. Leave-by — Struktur, kein Skript.
 * „Um 14 Uhr anrufen“ ist kein Aufbruch zur Bahn.
 */

const LEAVE_BY_RE =
  /\b(?:bahn|zug|bus|s-?bahn|u-?bahn|tram|straßenbahn|strassenbahn|öpnv|oepnv|abfahrt|anschluss|haltestelle|bahnhof|hbf|flug|flieger|flughafen|gate|boarding|los\s*geh|los\s*muss|aufbruch|leave[-\s]?by)\b/iu;

const TASK_VERB_RE =
  /\b(?:anruf(?:en)?|call|tabletten?|medikament(?:e)?|pillen?|pack(?:en)?|mail(?:en)?|nachricht|todo|einkauf|mitnehm|abhol|kündig|kuendig|bezahlt?|überweis|ueberweis)\b/iu;

export function looksLikeLeaveByReminder(text: string): boolean {
  return LEAVE_BY_RE.test((text || '').replace(/\s+/g, ' '));
}

export function looksLikeTaskReminder(text: string): boolean {
  return TASK_VERB_RE.test((text || '').replace(/\s+/g, ' '));
}

/** Ob eine Uhrzeit-Erinnerung als Aufgabe (nicht Leave-by) geplant werden soll. */
export function shouldUseTaskReminderPush(opts: {
  userText?: string | null;
  destName?: string | null;
  hasCoords?: boolean;
}): boolean {
  if (opts.hasCoords) return false;
  const blob = `${opts.userText ?? ''} ${opts.destName ?? ''}`.replace(
    /\s+/g,
    ' ',
  );
  if (looksLikeLeaveByReminder(blob)) return false;
  if (looksLikeTaskReminder(blob)) return true;
  // Uhr ohne Ort und ohne Reisewort → Aufgabe (Anruf, To-do, „denk dran“)
  if (!opts.destName?.trim()) return true;
  return false;
}

/**
 * Auftrag aus dem User-Satz ziehen — Wrapper („erinner mich um 14 Uhr“) weg.
 */
export function extractTaskReminderPhrase(
  userText: string,
  fallback?: string | null,
): string {
  let t = (userText || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:hey\s+)?(?:yorro|findus|yoro)[,.]?\s*/iu, '');
  t = t.replace(
    /\b(?:bitte\s+)?(?:erinner(?:e|n|ung)?\s+mich|denk\s+dran|sag\s+(?:mir\s+)?bescheid|stell(?:e)?\s+(?:mir\s+)?(?:eine\s+)?erinnerung|ich\s+(?:möchte|moechte|will|hätte|haette)\s+(?:gerne\s+)?dass\s+du\s+mich(?:\s+gerne)?\s+(?:dran\s+)?erinnerst)\b/giu,
    ' ',
  );
  t = t.replace(
    /\b(?:ich\s+möchte|ich\s+moechte|gerne|bitte|dass\s+du\s+mich)\b/giu,
    ' ',
  );
  t = t.replace(/\b(?:um\s+)?\d{1,2}(?:[:.]\d{2})?\s*uhr\b/giu, ' ');
  t = t.replace(/\b(?:um\s+)?\d{1,2}[:.]\d{2}\b/g, ' ');
  t = t.replace(/\bin\s+\d+\s*(?:min(?:uten)?|stunden?|std)\b/giu, ' ');
  t = t.replace(/\b(?:heute|morgen|übermorgen|uebermorgen)\b/giu, ' ');
  t = t.replace(/\b(?:dran|noch\s+mal|nochmal)\b/giu, ' ');
  t = t.replace(/^[,\s.:;–—-]+|[,\s.:;–—-]+$/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length >= 3) return t.slice(0, 180);
  const fb = (fallback || '').replace(/\s+/g, ' ').trim();
  if (fb.length >= 2) return fb.slice(0, 180);
  return 'Erinnerung';
}

export function formatReminderClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

/** Gesprochener Satz nach Tap — Auftrag + Uhr, kein Leave-by. */
export function buildTaskReminderSpeech(opts: {
  task: string;
  fireAtMs: number;
}): string {
  const task = opts.task.replace(/\s+/g, ' ').trim() || 'Erinnerung';
  const clock = formatReminderClock(opts.fireAtMs);
  if (/[.!?]$/.test(task)) return `${clock} — ${task}`;
  return `${clock} — ${task}.`;
}
