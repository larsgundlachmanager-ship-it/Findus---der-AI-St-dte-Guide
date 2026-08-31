/**
 * Einmal abends/nachts: lokal gespeichertes Feedback automatisch hochladen.
 * Kein Dauer-Upload — nach 21:00 (Catch-up bis 09:00), plus 30-Min-Debounce
 * falls nach dem ersten Abend-Upload noch nachgespeichert wird.
 */

export const FEEDBACK_AUTO_HOUR = 21;
export const FEEDBACK_CATCHUP_UNTIL_HOUR = 9;
export const FEEDBACK_EVENING_DEBOUNCE_MS = 30 * 60_000;

export function feedbackAutoWindowStart(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(FEEDBACK_AUTO_HOUR, 0, 0, 0);
  if (now.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

export function isFeedbackEveningOrNight(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= FEEDBACK_AUTO_HOUR || hour < FEEDBACK_CATCHUP_UNTIL_HOUR;
}

/**
 * true → stiller Upload ist jetzt erlaubt (pending muss der Caller prüfen).
 */
export function shouldAutoUploadFeedback(
  lastUploadAtMs: number,
  now = new Date(),
): boolean {
  const windowStartMs = feedbackAutoWindowStart(now).getTime();
  if (lastUploadAtMs < windowStartMs) return true;
  if (!isFeedbackEveningOrNight(now)) return false;
  return now.getTime() - lastUploadAtMs >= FEEDBACK_EVENING_DEBOUNCE_MS;
}
