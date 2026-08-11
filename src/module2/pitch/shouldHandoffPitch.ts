/**
 * Wann M2 den Auswahl-Pitch statt Agent-Dual-Option nutzen soll.
 */

import { shouldHandoffToTourModule } from '../tour/shouldHandoffTour';
import { shouldForceModul5Handoff } from '../planning/planHandoffGuard';
import { detectCityBestIntent, detectPitchKind } from './parentBrief';

/** Klare Auswahl-/Empfehlungsabsicht — kein STT-Müll, kein Proaktiv-Drift. */
const CHOICE_RE =
  /\b((?:was|wo)\s+(?:kann|soll|würdest|wuerdest|empfiehl)|empfehl(?:ung|st|en)?\s+(?:mir|doch|mal|ein)|zwei\s+option|alternativ(?:e|en)?|bester|beste[rn]?\s+\w+|restaurant|italiener|grieche|pizza|essen\s+gehen|hotel\s+(?:mit|in|nahe|für|fuer)|kino|biergarten|hunger|süßhunger|sueßhunger|brunch|sushi|burger|frühstück|fruehstueck|café|cafe\s+(?:in|nahe|empfehl)|snack|snacks|imbiss|döner|doener)\b/iu;

export function shouldHandoffToPitchModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (t.length < 10) return false;
  if (shouldForceModul5Handoff(t)) return false;
  if (shouldHandoffToTourModule(t)) return false;
  // Kein Pitch ohne erkennbare Frage/Wunsch (sonst Proaktiv / STT-Echo)
  if (
    !/[?]/.test(t) &&
    !/\b(bitte|kannst|könntest|koenntest|suche|such|zeig|empfehl|brauch|möcht|moecht|will|hätte|haette|gibt\s+es|wo\s)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (!CHOICE_RE.test(t) && !detectCityBestIntent(t)) return false;
  const kind = detectPitchKind(t);
  return (
    kind === 'food' ||
    kind === 'hotel' ||
    kind === 'cinema' ||
    kind === 'bar' ||
    kind === 'sight' ||
    detectCityBestIntent(t)
  );
}
