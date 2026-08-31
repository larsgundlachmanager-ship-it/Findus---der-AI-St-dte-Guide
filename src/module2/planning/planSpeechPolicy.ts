/**
 * Modul 5 Speech-Policy: Wer spricht, wenn Planung aktiv ist?
 *
 * - Zusammen auf Plan → Planungsmodul spricht; Modul 2 bleibt still.
 * - Modul 2 darf nur bei wirklich wichtigem Off-Topic zu Ende reden
 *   (Notfall/Survival, Pack-Story, kritisches GPS).
 * - Wetter-/Outfit im Plan-Kontext: M5 (andere Planung), nicht M2-Chat.
 *
 * Handoff-SSOT bleibt `planHandoffGuard.ts` — hier nur Speech-Ownership.
 */

import { isPlanningModuleActive } from './planSessionState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import {
  looksLikeModul5PlanUtterance,
  looksLikeOutfitOrWeatherUtterance,
} from './planUtteranceGate';
import { looksLikePlanEditUtterance } from './planEditDetect';

/** Planungssession oder Kalender sichtbar = „wir sind auf Plan“. */
export function isPlanSpeechContextActive(): boolean {
  try {
    if (isPlanningModuleActive()) return true;
    return usePlanCalendarUiStore.getState().calendarVisible;
  } catch {
    return false;
  }
}

/**
 * Wichtiges Off-Topic: Modul 2 soll fertig sprechen dürfen,
 * auch wenn parallel die Timeline aufgeht.
 */
export function looksLikeImportantModul2Finish(userText: string): boolean {
  const t = (userText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;

  if (
    /\b(notfall|hilfe|rettung|polizei|feuerwehr|unfall|akku|laden|powerbank|überlebt|ueberlebt)\b/iu.test(
      t,
    )
  ) {
    return true;
  }

  if (
    /\b(gps|ortung)\b/iu.test(t) &&
    /\b(weg|hängt|haengt|tot|kaputt|fehlt|funktioniert\s+nicht)\b/iu.test(t)
  ) {
    return true;
  }

  if (
    /\b(mehr\s+(dazu|historie)|erzähl|erzaehl|geschichte|historie)\b/iu.test(
      t,
    ) &&
    !/\b(plan|änder|aender|verschieb|termin|kalender|und\s+dann)\b/iu.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * true = bei aktiver Planung soll Modul 2 diesen Turn nicht labern
 * (Plan spricht / übernimmt). Ausnahme: wichtiges Off-Topic.
 */
export function shouldSilenceModul2ForPlan(userText: string): boolean {
  const t = (userText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!isPlanSpeechContextActive()) return false;
  if (looksLikeImportantModul2Finish(t)) return false;
  if (looksLikePlanEditUtterance(t) || looksLikeModul5PlanUtterance(t)) {
    return true;
  }
  // Wetter/Outfit: M2/Wetter-Agent darf sprechen (Plan nutzt Info danach)
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  try {
    if (isPlanningModuleActive()) return true;
  } catch {
    /* soft */
  }
  return false;
}
