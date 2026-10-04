/**
 * Phase 5a — Amenity-/Activity-Ort finden (Platz, Brunnen, Grill…).
 * Nicht Verleih/Kurs (SUP/Bouldern) — die bleiben Activity-Research.
 * Stadt-agnostisch, Just-Do-It → Pitch-Modul.
 *
 * Unbekannte Ortstypen („nächste X“) → openPlaceFind (kein Domänen-Hardcode).
 */

import {
  extractOpenPlaceType,
  isOpenPlaceFindQuery,
  isOpenExperienceQuery,
  openPlaceMustLabels,
  extractOpenThemeNeed,
} from './openPlaceFind';

const AMENITY_PLACE_RE =
  /\b(basketball(?:platz)?|tischtennis(?:platte)?|ping[\s-]?pong|trinkwasser(?:station|stelle)?|trinkbrunnen|trinken\s+wasser|grillplatz|grillstelle|bbq|barbecue|picknick(?:platz|ort)?|picnic|briefkasten|postkasten|mailbox|packstation|paketautomat|toilette|wc\b|apotheke|geldautomat|ladestation|parkplatz|freibad|strandbad|badestelle|baden\s+gehen|volleyball(?:platz)?|skate(?:park|anlage)?|liegewiese|sonnenplatz|sonnenbaden|kostenlos\s+sonnen|wechselstube|geldwechsel)\b/iu;

const FIND_INTENT_RE =
  /\b(wo|find(?:e|en)?|suche|such|gibt\s+es|kann\s+(?:ich|man|wir)|zeig|brauch|möcht|moecht|will|spiel(?:en)?|hin(?:gehen)?|beste[rn]?|nächste[rn]?|naechste[rn]?|kostenlos(?:e|er|es)?)\b/iu;

function isWhitelistAmenityPlaceFind(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 6) return false;
  if (
    /\b(verleih|ausleihen|mieten|kurs|schule|unterricht|bouldern|sup\b|stand[-\s]?up|surf(?:en|kurs)?|spikeball)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return AMENITY_PLACE_RE.test(t) && FIND_INTENT_RE.test(t);
}

/** Öffentlicher Ort / Amenity / Erlebnis-Open-Find → Pitch. */
export function isAmenityPlaceFindQuery(text: string): boolean {
  if (isWhitelistAmenityPlaceFind(text)) return true;
  if (isOpenExperienceQuery(text)) return true;
  return isOpenPlaceFindQuery(text);
}

/** Must-Labels: Whitelist kanonisch, sonst dynamischer Ortstyp/Thema aus der Frage. */
export function amenityPlaceMustLabels(text: string): string[] {
  const t = String(text || '').toLowerCase();
  const out: string[] = [];
  if (/basketball/.test(t)) out.push('basketballplatz');
  if (/tischtennis|ping[\s-]?pong/.test(t)) out.push('tischtennisplatte');
  if (/trinkwasser|trinkbrunnen|trinken\s+wasser/.test(t)) out.push('trinkwasser');
  if (/grillplatz|grillstelle|bbq|barbecue|grillen/.test(t)) out.push('grillplatz');
  if (/picknick|picnic/.test(t)) out.push('picknick');
  if (/liegewiese|sonnenplatz|sonnenbaden|kostenlos\s+sonnen|sonnen\b/.test(t))
    out.push('liegewiese');
  if (/briefkasten|postkasten|mailbox/.test(t)) out.push('briefkasten');
  if (/packstation|paketautomat/.test(t)) out.push('packstation');
  if (/toilette|\bwc\b/.test(t)) out.push('toilette');
  if (/apotheke/.test(t)) out.push('apotheke');
  if (/geldautomat|bankomat|atm\b/.test(t)) out.push('geldautomat');
  if (/ladestation|ladesäule|ladesaeule/.test(t)) out.push('ladestation');
  if (/parkplatz|parken/.test(t)) out.push('parkplatz');
  if (/freibad|strandbad|badestelle|baden\s+gehen/.test(t)) out.push('badestelle');
  if (/volleyball/.test(t)) out.push('volleyballplatz');
  if (/skate/.test(t)) out.push('skatepark');
  if (/wechselstube|geldwechsel|devise/.test(t)) out.push('wechselstube');
  if (out.length) return out.slice(0, 4);
  const theme = extractOpenThemeNeed(text);
  if (theme) return [theme];
  return openPlaceMustLabels(text);
}

export {
  extractOpenPlaceType,
  isOpenPlaceFindQuery,
  openPlaceMustLabels,
  extractOpenThemeNeed,
  isOpenExperienceQuery,
};
