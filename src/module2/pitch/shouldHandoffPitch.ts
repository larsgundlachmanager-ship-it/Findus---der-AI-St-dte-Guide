/**
 * Wann M2 den Auswahl-Pitch statt Agent-Dual-Option nutzen soll.
 */

import { detectCityBestIntent, detectPitchKind } from './parentBrief';

const CHOICE_RE =
  /\b(empfehl|empfiehl|wo\s+(kann|soll)|was\s+ess|restaurant|italiener|grieche|pizza|essen\s+gehen|zwei\s+option|alternativ|bester|beste[rn]?|hotel\s+mit|kino|biergarten)\b/iu;

/** Explizite Tagesplanung → M5, nicht Pitch allein. */
const PLAN_DAY_RE =
  /\b(tagesplan|ganzen\s+tag|morgen\s+früh|timeline|plane\s+mir\s+den\s+tag|itinerar)\b/iu;

export function shouldHandoffToPitchModule(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (!t || PLAN_DAY_RE.test(t)) return false;
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
