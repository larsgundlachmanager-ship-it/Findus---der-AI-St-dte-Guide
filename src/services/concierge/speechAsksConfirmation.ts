/**
 * Erkennt, ob Findus um Zustimmung bittet (→ „Ja“-Button).
 */

import { isPlaylistQuickAction } from '../playlistService';
import type { QuickAction } from '../../types/concierge';

export function speechAsksForConfirmation(speech: string): boolean {
  const t = speech.trim();
  if (!t) return false;
  const asks =
    /\b(soll\s+ich|darf\s+ich|möchtest\s+du|moechtest\s+du|willst\s+du|wollen\s+wir|sollen\s+wir|hast\s+du\s+bock|interessiert\s+(dich|es)|solln\s+wir)\b/iu.test(
      t,
    );
  const offers =
    /\b(heraussuch|raussuch|zeig(en)?|buch(en)?|reservier|vorbereiten|tisch|kompass|route|tour|unterkunft|hotel|mietwagen|uber|gepäck|gepaeck|option)\b/iu.test(
      t,
    );
  return asks && (offers || /\?/.test(t));
}

/**
 * Kein „Ja“-Button, wenn der Link schon fertig ist (Playlist etc.).
 */
export function shouldShowConfirmationButton(
  speech: string,
  actions: QuickAction[],
): boolean {
  if (!speechAsksForConfirmation(speech)) return false;
  // Just-Do-It: Permission-Lookup-Fragen nie als „Ja“-Chip
  if (
    /\bsoll\s+ich\b[^.?!]{0,80}\b(heraussuch|raussuch|nachschau|nachseh|telefon|nummer|party|locations?|orte)\b/iu.test(
      speech,
    )
  ) {
    return false;
  }
  // Just-Do-It: Ergebnis schon da → kein Ja-Button für „Soll ich suchen?“
  if (
    actions.some((a) => a.type === 'DIAL_PHONE' && a.payload.phoneNumber) &&
    /\b(telefon|nummer|anruf)\b/iu.test(speech)
  ) {
    return false;
  }
  if (
    actions.filter((a) => a.type === 'START_NAVIGATION').length >= 1 &&
    /\b(party|heraussuch|raussuch|locations?|orte|welchen\s+nehmen)\b/iu.test(speech)
  ) {
    return false;
  }
  const hasReadyPlaylist = actions.some(isPlaylistQuickAction);
  if (
    hasReadyPlaylist &&
    /\b(playlist|musik|spotify|feier)\b/iu.test(speech)
  ) {
    return false;
  }
  // Fertiger OPEN_URL + nur Frage nach Öffnen → Button überflüssig
  const hasOpenUrl = actions.some(
    (a) => a.type === 'OPEN_URL' && Boolean(a.payload.url?.trim()),
  );
  if (
    hasOpenUrl &&
    /\b(öffnen|oeffnen|zeig|playlist)\b/iu.test(speech) &&
    !/\b(kompass|navigation|route|führ|fuehr|reservier|buch)\b/iu.test(speech)
  ) {
    return false;
  }
  return true;
}
