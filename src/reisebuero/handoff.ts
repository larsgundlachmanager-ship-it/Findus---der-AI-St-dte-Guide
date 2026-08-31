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
  if (!/\b(flug|fliegen|flieger)\b/iu.test(t)) return false;
  if (/\b(hotel|unterkunft|ferienhaus|wochenende|urlaub|kurztrip|mietwagen)\b/iu.test(t)) {
    return false;
  }
  if (tripHorizon(t) && hasNamedDest(t)) return false;
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

/** Genanntes Wochenende/Woche/Urlaub nach X → immer Reisebüro. */
function isNamedTripCollect(t: string): boolean {
  if (!tripHorizon(t)) return false;
  if (!/\b(nach|in)\s+[A-Za-zÄÖÜäöüß]{3,}/u.test(t) && !hasNamedDest(t)) return false;
  if (/\b(jetzt|heute\s+abend|hier\s+in\s+der\s+nähe)\b/iu.test(t)) return false;
  return true;
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
  if (isSoloFlightJob(t)) return false;
  if (wantsFullPlan(t)) return true;
  if (isOpenDestCue(t)) return true;
  if (isOpenWarmTrip(t)) return true;
  if (isOpenCityTrip(t)) return true;
  if (isOpenDayTrip(t)) return true;
  if (isFlightAndHotel(t)) return true;
  if (isNamedTripCollect(t)) return true;
  return false;
}
