/**
 * Wake-/Aufsteh-Intent — breite Erkennung (STT-robust), ohne Orts-Hardcodes.
 * SSOT für Voice, Planning, Fan-out und Say–Do-Recovery.
 */

/** Explizite Wecker-/Weck-Formulierungen (inkl. häufiger STT-Varianten). */
const STRONG_WAKE =
  /\b(?:weck(?:er|ah|a|e|en|st|t)?|geweckt\w*|aufweck\w*|alarm(?:e|uhr)?|auf\s*steh(?:en|n)?|aufsteh\w*|weckerschalten)\b/iu;

/** „stell/setz/mach … Wecker“ */
const SET_WAKE_PHRASE =
  /\b(?:stell(?:e|en)?|setz(?:e|en)?|mach(?:e|en)?)\s+(?:mir\s+)?(?:den\s+|einen\s+|nen\s+)?(?:wecker|alarm)\b/iu;

/** Erinnerung mit Uhrzeit die klar Aufstehen meint — nicht „anrufen um 10“. */
const REMIND_WAKE =
  /\berinner(?:e|n)?\s+mich\b.{0,48}\b(?:morgen\s+)?(?:früh|frueh|morgens)\b|\berinner(?:e|n)?\s+mich\b.{0,40}\b(?:auf\s*steh|aufsteh|wach|geweckt|weck)/iu;

/**
 * Intention ohne Wort „Wecker“:
 * „ich muss um 8 morgens aufstehen / wach sein / raus“
 */
/** Aufstehen — nicht „um X los“ (Abfahrt/Leave-by). */
const OBLIGATION_MORNING =
  /\b(?:muss|müsste|muesste|soll(?:te)?|will|möchte|moechte|brauch(?:e)?)\b.{0,64}\b(?:um\s+)?\d{1,2}(?::\d{2})?\s*(?:uhr)?\b.{0,48}\b(?:auf\s*steh|aufsteh|wach|raus|fertig)\b/iu;

const TIME_THEN_OBLIGATION =
  /\b(?:um\s+)?\d{1,2}(?::\d{2})?\s*(?:uhr)?\b.{0,32}\b(?:morgens|früh|frueh)\b.{0,40}\b(?:auf\s*steh|aufsteh|wach|raus|geweckt|weck)/iu;

/** „morgen früh um 8 raus“ / „früh um 7 fertig“ */
const MORNING_THEN_TIME_ACTION =
  /\b(?:morgen\s+)?(?:früh|frueh|morgens)\b.{0,40}\b(?:um\s+)?\d{1,2}(?::\d{2})?\s*(?:uhr)?\b.{0,32}\b(?:raus|auf\s*steh|aufsteh|wach|fertig|geweckt)/iu;

/** „wach sein/bin um 7“ / „um 7 wach sein“ */
const WAKE_BE =
  /\bwach\s*(?:bin|sein|werden|machen)\b/iu;

const WAKE_ME =
  /\b(?:weck(?:e|en|st|t)?|hol)\s+(?:mich|uns)\b/iu;

const HAS_CLOCK =
  /\b(?:um\s+)?\d{1,2}(?::\d{2})?\s*(?:uhr)?\b|\b\d{1,2}[:.]\d{2}\b/i;

/** „wann muss ich aufstehen“ ohne Zeit → trotzdem Wake-Flow (fragt nach / rechnet). */
const ASK_WHEN_WAKE =
  /\bwann\s+(?:muss|soll|kann)\s+ich\s+(?:auf\s*steh|aufsteh|wach)/iu;

export function hasClockHint(text: string): boolean {
  return HAS_CLOCK.test(text.replace(/\s+/g, ' ').trim());
}

/**
 * true = User will geweckt / erinnert / aufstehen — App muss handeln, nicht nur reden.
 */
export function isWakeAlarmIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;

  if (SET_WAKE_PHRASE.test(t)) return true;
  if (WAKE_ME.test(t)) return true;
  if (REMIND_WAKE.test(t)) return true;
  if (ASK_WHEN_WAKE.test(t)) return true;
  if (OBLIGATION_MORNING.test(t)) return true;
  if (TIME_THEN_OBLIGATION.test(t)) return true;
  if (MORNING_THEN_TIME_ACTION.test(t)) return true;
  if (WAKE_BE.test(t) && hasClockHint(t)) return true;

  if (STRONG_WAKE.test(t)) {
    // „aufstehen“ allein in Story-Kontext selten — mit Zeit oder klarer Wake-Nähe ok
    if (hasClockHint(t)) return true;
    if (
      /\b(?:wecker|alarm|geweckt|weck\s*mich|stell|setz|mach|erinner|morgen|früh|frueh|morgens)\b/iu.test(
        t,
      )
    ) {
      return true;
    }
    // „Ich will aufstehen“ / „Aufsteh-Wecker“
    if (/\b(?:wecker|alarm|aufsteh-?wecker)\b/iu.test(t)) return true;
    if (/\bauf\s*steh(?:en)?\b/iu.test(t) && /\b(?:ich|mir|mich)\b/iu.test(t)) {
      return true;
    }
  }

  // „geweckt werden um 8“ ohne STRONG word-boundary edge cases
  if (/\bgeweckt\b/iu.test(t) && hasClockHint(t)) return true;

  return false;
}
