/**
 * Wann ein User-Turn den Datensatz wachsen lassen darf — ohne RN-Imports.
 */

import { isDeicticPoiQuestion } from '../intent/poiInfoVsNav';

const WHERE_AM_I_RE =
  /\b(wo\s+bin\s+ich|wo\s+stehe\s+ich|was\s+ist\s+(?:das|hier)|hier\s+(?:für\s+ein\s+ort|für\s+einen\s+ort)|was\s+ist\s+das\s+hier)\b/iu;

const NAMED_PLACE_HINT_RE =
  /\b(?:zum|zur|nach|zu)\s+[A-ZÄÖÜa-zäöüß]|\b(?:restaurant|café|cafe|museum|kirche)\s+\w/iu;

export function shouldGrowPackFromUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  if (WHERE_AM_I_RE.test(t) || isDeicticPoiQuestion(t)) return true;
  if (NAMED_PLACE_HINT_RE.test(t)) return true;
  return /\b(geschichte|erzähl|erzaehl|denkmal|kirche|museum|was\s+ist\s+hier)\b/iu.test(
    t,
  );
}
