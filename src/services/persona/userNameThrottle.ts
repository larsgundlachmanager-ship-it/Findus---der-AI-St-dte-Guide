/**
 * User-Vorname sparsam — max. alle 30 Min, lieber seltener.
 * Bewusste Anrede (Trost / klarer Weckruf) ok; beiläufiges „Lars, siehst du…“ nie.
 */

export const USER_NAME_COOLDOWN_MS = 30 * 60_000;

let lastSaidAtMs = 0;

export function msSinceUserNameSaid(): number {
  if (lastSaidAtMs <= 0) return Number.POSITIVE_INFINITY;
  return Date.now() - lastSaidAtMs;
}

export function canSayUserName(nowMs = Date.now()): boolean {
  if (lastSaidAtMs <= 0) return true;
  return nowMs - lastSaidAtMs >= USER_NAME_COOLDOWN_MS;
}

export function markUserNameSaid(nowMs = Date.now()): void {
  lastSaidAtMs = nowMs;
}

/** Tests / Session-Reset. */
export function resetUserNameThrottle(): void {
  lastSaidAtMs = 0;
}

/**
 * Prompt-Regel für alle Lanes (Chat, Bridge, Modul 1, Concierge).
 */
export function formatUserNamePromptRule(firstName: string | null | undefined): string {
  const name = (firstName || '').trim();
  if (!name) {
    return 'Kein Vorname hinterlegt. Nur „du / dein / deine“. Niemals einen Vornamen erfinden.';
  }
  if (!canSayUserName()) {
    const minLeft = Math.max(
      1,
      Math.ceil((USER_NAME_COOLDOWN_MS - msSinceUserNameSaid()) / 60_000),
    );
    return (
      `VORNAME VERBOTEN (~${minLeft} Min Cooldown). Nur „du / dein / deine“ — ` +
      `nicht „${name}“ sagen. Nie beiläufig („${name}, siehst du das?“).`
    );
  }
  return [
    `User-Vorname: ${name}`,
    'Nur sagen, wenn du die Person BEWUSST ansprechen musst — Trost, klarer Weckruf, starke Emotion.',
    `Beispiel-Ton (Wortlaut frei): „Ey ${name}, hab dich nicht so — wird wieder gut.“`,
    `VERBOTEN: beiläufige Richtung/Smalltalk-Anrede („${name}, siehst du das?“, „Hey ${name}, schau mal“).`,
    'Maximal 1× in dieser Antwort. Nach Gebrauch gilt 30-Min-Pause. Lieber weglassen als zu oft.',
  ].join(' ');
}

/** Entfernt Vorname aus Speech wenn Cooldown aktiv. */
export function stripUserNameIfThrottled(
  text: string | null | undefined,
  firstName: string | null | undefined,
): string | null {
  if (!text) return text ?? null;
  const name = (firstName || '').trim();
  if (!name || name.length < 2) return text;
  if (canSayUserName()) return text;
  const re = new RegExp(
    `\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b[,!.\\s]*`,
    'giu',
  );
  const cleaned = text.replace(re, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || text;
}

/** Nach ausgesprochener Speech: Cooldown starten wenn Name vorkam. */
export function noteUserNameIfSpoken(
  speech: string | null | undefined,
  firstName: string | null | undefined,
): void {
  const name = (firstName || '').trim();
  if (!name || name.length < 2 || !speech) return;
  const re = new RegExp(
    `\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`,
    'iu',
  );
  if (re.test(speech)) markUserNameSaid();
}
