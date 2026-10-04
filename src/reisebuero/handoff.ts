/**
 * Wann Concierge an Yorro Reisebüro abgibt.
 * Solo-Hotel-jetzt / Solo-Flug Leave-by bleiben Modul 2 / Flight-Advisor.
 * Wochenende/Woche/Urlaub / Flug+Hotel / offenes Ziel → Reisebüro.
 */

import { findAirportMentionedInText } from '../services/flights/airportIata';
import { extractCityFromText } from '../module2/context/shortTermContext';

function norm(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function hasNamedDest(t: string): boolean {
  if (findAirportMentionedInText(t)) return true;
  const city = extractCityFromText(t);
  if (!city) return false;
  if (/^(ostsee|nordsee|niederlande|holland)$/iu.test(city)) return false;
  return true;
}

function isOpenDestCue(t: string): boolean {
  return /\b(weiß\s+nicht\s+wohin|weiss\s+nicht\s+wohin|keine\s+ahnung\s+(?:welche\s+stadt|wohin)|wo(?:hin)?\s+(?:könnten|koennten|können|koennen|soll(?:en)?)\s+wir|welche\s+stadt|irgendwohin|egal\s+wohin|wo\s+können\s+wir\s+hin)\b/iu.test(
    t,
  );
}

function isOpenWarmTrip(t: string): boolean {
  return (
    /\b(irgendwo.{0,40}warm|warm.{0,24}(?:hin|weg|urlaub)|nächste\s+woche.{0,48}(?:wegflieg|urlaub|wohin))\b/iu.test(
      t,
    ) && !hasNamedDest(t)
  );
}

function wantsFullPlan(t: string): boolean {
  return /\b(urlaubsplan|reise\s*planen|ganzen\s+urlaub|neuen\s+urlaub|(?:yorro|findus)\s+reiseb[uü]ro|reisebüro|reisebuero)\b/iu.test(
    t,
  );
}

/** Kreuzfahrt als volles Paket (Flug/Hotel/planen) → Reisebüro. */
export function isCruisePackageHandoff(text: string): boolean {
  const t = norm(text);
  if (!/\b(?:kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida)\b/iu.test(t)) {
    return false;
  }
  try {
    const { looksLikeCruiseInclusionAsk } = require('../module2/planning/cruiseInclusionsFaq') as {
      looksLikeCruiseInclusionAsk: (s: string) => boolean;
    };
    if (looksLikeCruiseInclusionAsk(t)) return false;
  } catch {
    /* soft */
  }
  if (wantsFullPlan(t)) return true;
  return /\b(flug|hotel|vornacht|komplett|paket|einschiff|anreise|planen)\b/iu.test(t);
}

/** Nur Schiff/Suche — Modul-2 Quick-Pitch, kein Briefing. */
export function isCruiseQuickPitch(text: string): boolean {
  const t = norm(text);
  // Inklusiv-FAQ läuft eigenen Chat-Pfad — nicht als Pitch stehlen
  try {
    const { looksLikeCruiseInclusionAsk } = require('../module2/planning/cruiseInclusionsFaq') as {
      looksLikeCruiseInclusionAsk: (s: string) => boolean;
    };
    if (looksLikeCruiseInclusionAsk(t)) return false;
  } catch {
    /* soft */
  }
  if (!/\b(?:kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida)\b/iu.test(t)) {
    return false;
  }
  if (isCruisePackageHandoff(t)) return false;
  return /\b(günstig|guenstig|oktober|suite|party|familie|pool|rutsche|sauna|spa|laufbahn|teens?|rentner|senior|kids|kinder|ab\s+\w+|in\s+\d+\s+tagen|welches\s+schiff|schiff\s+mit)\b/iu.test(
    t,
  ) || (/\bkreuzfahrt\b/iu.test(t) && t.length >= 20);
}

function isOpenCityTrip(t: string): boolean {
  const tripish = /\b(städtetrip|staedtetrip|kurzurlaub|kurztrip|wochenende\s+weg|wohin\s+reisen)\b/iu.test(
    t,
  );
  if (!tripish) return false;
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../module2/planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  } catch {
    /* soft */
  }
  if (hasNamedDest(t) && !isOpenDestCue(t)) return false;
  return true;
}

function isOpenDayTrip(t: string): boolean {
  if (/\b(tagestrip|tagesausflug)\b/iu.test(t) && !hasNamedDest(t)) return true;
  if (/\ban\s+die\s+ostsee\b/iu.test(t) && !hasNamedDest(t)) return true;
  return false;
}

function isFlightAndHotel(t: string): boolean {
  const fly = /\b(flug|fliegen|flieger)\b/iu.test(t);
  const stay = /\b(hotel|unterkunft|ferienhaus|wohnung|übernacht|uebernacht|mietwagen)\b/iu.test(
    t,
  );
  return fly && stay;
}

/** Flug + Aufenthalt/Hotel/Tage → Paket schlägt Solo-Flug (P5). */
function isStayDaysPackageTrip(t: string): boolean {
  if (!/\b(flug|fliegen|flieger)\b/iu.test(t)) return false;
  if (isFlightAndHotel(t)) return true;
  const hasStay = /\b(hotel|unterkunft|ferienhaus|apartment|all\s*inclusive|übernacht|uebernacht|zimmer)\b/iu.test(
    t,
  );
  const days =
    tripHorizon(t) ||
    /\bfür\s+(\d+|zwei|drei|vier|fünf|fuenf|sechs)\s+tage?\b/iu.test(t);
  if (hasStay && days) return true;
  if (days && hasNamedDest(t) && !/\bnur\s+(?:den\s+)?flug\b/iu.test(t)) return true;
  return false;
}

/** Messe/Kongress mit Reise-Rahmen → Reisebüro-Paket. */
function isTradeFairPackageTrip(t: string): boolean {
  if (!/\b(messe|konferenz|kongress|buchmesse|trade\s*fair)\b/iu.test(t)) return false;
  if (wantsFullPlan(t)) return true;
  return (
    tripHorizon(t) ||
    isFlightAndHotel(t) ||
    /\b(flug|hotel|unterkunft|tage|wochenende|urlaub)\b/iu.test(t)
  );
}

/** Solo „Hotel jetzt / hier“ — Pitch, kein Reisebüro. */
function isTonightHotelOnly(t: string): boolean {
  if (!/\b(hotel|übernacht|uebernacht|unterkunft|zimmer)\b/iu.test(t)) return false;
  if (/\b(flug|fliegen|wochenende|urlaub|kurztrip|mietwagen)\b/iu.test(t)) return false;
  if (/\b(jetzt|heute|hier|in\s+der\s+nähe|naehe)\b/iu.test(t)) return true;
  // Hotel + Stadt ohne Reise-Horizont → lokal Pitch
  if (hasNamedDest(t) && !tripHorizon(t) && !isOpenDestCue(t)) return true;
  return false;
}

/** Solo-Flug ohne Aufenthalts-/Wochenend-Rahmen → Flight-Advisor. */
function isSoloFlightJob(t: string): boolean {
  try {
    const { isSoloFlightAbSearch } = require('../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(t)) return true;
  } catch {
    /* soft */
  }
  if (!/\b(flug|fliegen|flieger)\b/iu.test(t)) return false;
  if (/\b(hotel|unterkunft|ferienhaus|wochenende|urlaub|kurztrip|mietwagen)\b/iu.test(t)) {
    return false;
  }
  // Aufenthaltshorizont → Reisebüro, nicht Solo-Ticket
  if (tripHorizon(t)) return false;
  // Datumsfenster allein + Ziel → Solo wenn Flug-Verb und kein Full-Plan
  if (hasNamedDest(t) && !isOpenDestCue(t) && !wantsFullPlan(t)) return true;
  return false;
}

function tripHorizon(t: string): boolean {
  return (
    /\b(wochenende|kurztrip|städtetrip|staedtetrip|urlaub|ferien|urlaubsplan|eine\s+woche)\b/iu.test(
      t,
    ) ||
    /\b(\d+|zwei|drei|vier|fünf|fuenf)\s+tage?\b/iu.test(t) ||
    /\bin\s+(zwei|drei|\d+)\s+wochen?\b/iu.test(t) ||
    /\bnächste[rn]?\s+(woche|wochenende|monat)\b/iu.test(t)
  );
}

/** Genanntes Wochenende/Woche/Urlaub nach X → immer Reisebüro (außer Solo-Flug). */
function isNamedTripCollect(t: string): boolean {
  if (isSoloFlightJob(t)) return false;
  if (!tripHorizon(t)) return false;
  if (!/\b(nach|in)\s+[A-Za-zÄÖÜäöüß]{3,}/u.test(t) && !hasNamedDest(t)) return false;
  if (/\b(jetzt|heute\s+abend|hier\s+in\s+der\s+nähe)\b/iu.test(t)) return false;
  return true;
}

function isGapFillHandoff(t: string): boolean {
  // „hab Flug, brauch Hotel“ / „Unterkunft schon, muss noch hin“ / Mietwagen-only
  const haveFlight =
    /\b(flug|flüge|fluege|flieger|flugticket).{0,48}(schon|bereits|hab|habe|haben|gebucht)\b/iu.test(t) ||
    /\b(schon|bereits).{0,24}(flug|flüge|flieger).{0,24}(gebucht|hab)\b/iu.test(t);
  const needStay =
    /\b(noch|brauch|suche|fehlt|muss).{0,28}(hotel|unterkunft)\b/iu.test(t) ||
    /\b(hotel|unterkunft).{0,20}(noch|fehlt|brauchen)\b/iu.test(t) ||
    /\bnur\s+(?:noch\s+)?(?:ein\s+)?hotel\b/iu.test(t);
  const haveStay =
    /\b(hotel|unterkunft|apartment).{0,48}(schon|bereits|hab|habe|haben|gebucht)\b/iu.test(t) ||
    /\b(schon|bereits).{0,24}(hotel|unterkunft).{0,24}(gebucht|hab)\b/iu.test(t);
  const needFlight =
    /\b(noch|brauch|suche|fehlt|muss).{0,28}(flug|flüge|fluege|flieger)\b/iu.test(t) ||
    /\b(flug|flüge).{0,20}(noch|fehlt|brauchen)\b/iu.test(t) ||
    /\bnur\s+(?:noch\s+)?(?:den\s+)?flug\b/iu.test(t);
  const needCar =
    /\b(noch|brauch|suche|fehlt).{0,28}(mietwagen|leihwagen)\b/iu.test(t) ||
    /\bmietwagen.{0,16}(noch|fehlt|brauchen)\b/iu.test(t);
  if (haveFlight && needStay) return true;
  if (haveStay && needFlight) return true;
  if ((haveFlight || haveStay) && needCar) return true;
  if (haveStay && /\b(muss\s+noch\s+hin|noch\s+hin|anreise|flug|bahn)\b/iu.test(t)) return true;
  return false;
}

export function isFindusReisebueroHandoff(text: string): boolean {
  const t = norm(text);
  if (t.length < 12) return false;
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../module2/planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  } catch {
    /* soft */
  }
  if (isTonightHotelOnly(t)) return false;
  if (isTradeFairPackageTrip(t)) return true;
  if (isStayDaysPackageTrip(t)) return true;
  if (isSoloFlightJob(t)) return false;
  if (isGapFillHandoff(t)) return true;
  if (isCruisePackageHandoff(t)) return true;
  if (isCruiseQuickPitch(t)) return false;
  if (wantsFullPlan(t)) return true;
  if (isOpenDestCue(t)) return true;
  if (isOpenWarmTrip(t)) return true;
  if (isOpenCityTrip(t)) return true;
  if (isOpenDayTrip(t)) return true;
  if (isFlightAndHotel(t)) return true;
  if (isNamedTripCollect(t)) return true;
  return false;
}