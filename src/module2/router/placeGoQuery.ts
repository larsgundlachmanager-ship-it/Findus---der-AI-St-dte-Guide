/**
 * User will HINGEHEN / eine Sache ERLEDIGEN — kein Trivia-„wo ist X gebaut“.
 * Chat-Fast-Lane (2 Sätze) ist hier verboten: Distanz, Route, Live-Ort.
 */

import { formatDurationMinutesDe } from '../../services/navigation/travelEtaFormat';

const BEACH_RE =
  /\b(strand|strände|straende|beach|baden|badestelle|freibad|badesee|ins\s+wasser|ostsee|nordsee|priwall|kurstrand)\b/iu;

const GO_RE =
  /\b(hingehen|wohin|wo\s+kann\s+(?:ich|man)|kann\s+man\s+hin|zum\s+hingehen|hin\s+kann)\b/iu;

/** Orte, zu denen man geht oder die man braucht — nie 2-Satz-Chat. */
const PLACE_TYPE_RE =
  /\b(strand|park|aussicht|museum|kirche|café|cafe|kino|restaurant|bar|hotel|apotheke|toilette|klo|wc|ladestation|steckdose|atm|geldautomat|supermarkt|bäcker|baecker|bäckerei|drogerie|arzt|klinik|krankenhaus|hafen|markt|aussichtspunkt|sehenswürdigkeit|sehenswuerdigkeit|badestelle|freibad|tankstelle|parkplatz|parkhaus|parken|picknick|picnic|grillplatz|liegewiese)\b/iu;

const AMENITY_RE =
  /\b(toilette|klo|wc|pinkeln|geldautomat|atm|bargeld|ladestation|powerbank|steckdose|laden\s+(?:mein\s+)?handy|wlan|wifi|apotheke)\b/iu;

const DISTANCE_RE =
  /\b(wie\s+weit|entfernung|entfernt|fahrzeit|gehzeit|minuten\s+(?:hin|bis|fahrt|fu[sß])|wie\s+lange\s+(?:brauche|bin)\s+ich|wie\s+lange\s+(?:ist|dauert)\s+(?:der\s+weg|die\s+fahrt|es\s+(?:hin|zu)))\b/iu;

const HOURS_RE =
  /\b(öffnungszeit|oeffnungszeit|geöffnet|geoeffnet|wann\s+hat|hat\s+.+\s+auf|noch\s+offen|schon\s+zu|bis\s+wann|ab\s+wann|welche\s+zeiten|uhrzeiten?)\b/iu;

export function isBeachDestQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(hotel|übernacht|uebernacht|airbnb)\b/iu.test(t)) return false;
  return BEACH_RE.test(t);
}

export function isAmenityFrictionQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return AMENITY_RE.test(t);
}

export function isDistanceEtaQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return DISTANCE_RE.test(t);
}

export function isHoursQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return HOURS_RE.test(t);
}

/** Empfehlung mit Route/Distanz — nicht 2-Satz-Chat. */
export function isPlaceGoQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return false;
  if (isBeachDestQuery(t)) return true;
  if (GO_RE.test(t)) return true;
  if (isAmenityFrictionQuery(t)) return true;
  if (
    /\bwo\s+(ist|liegt|finde ich)\b/iu.test(t) &&
    t.length >= 10 &&
    !/\b(unterschied|passwort|problem|fehler|wifi|wlan|geboren|gebaut|bedeutet|gemalt)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\bgibt\s+es\b[\s\S]{0,80}\b(strand|park|aussicht|badestelle|see|baden|museum|café|cafe)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\bbeste[rn]?\s+(?:strand|park|aussicht|spot|platz|ort|museum|café|cafe|picknick)\b/iu.test(
      t,
    ) ||
    /\bden\s+besten\s+(?:strand|park|ort|platz|spot)\b/iu.test(t)
  ) {
    return true;
  }
  try {
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (looksLikePicnicQuery(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}

/**
 * Alles, was Live-Ort / Distanz / Zeiten braucht — Trivia-Fast-Lane verboten.
 * Hotel/Events werden zusätzlich von liveInventoryGate gefangen.
 */
export function shouldForbidQuickChat(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isPlaceGoQuery(t)) return true;
  if (isDistanceEtaQuery(t)) return true;
  if (isHoursQuery(t)) return true;
  if (/\b(party|events?|konzert|was\s+geht|heute\s+abend|feiern)\b/iu.test(t)) {
    return true;
  }
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    if (wantsTaxiRide(t)) return true;
  } catch {
    /* soft */
  }
  if (
    /\b(wie\s+teuer|was\s+kostet|eintritt|speisekarte|tickets?)\b/iu.test(t) &&
    PLACE_TYPE_RE.test(t)
  ) {
    return true;
  }
  return false;
}

/** Profil sagt Auto — sonst Distanz, keine Fake-Kurzfahrt. */
export function userDeclaredCar(): boolean {
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => {
        mobilityMode?: string | null;
        travelModes?: string[] | null;
        mobilityPrefs?: { car?: string | null } | null;
      } | null;
    };
    const p = getCachedUserProfile();
    if (!p) return false;
    if (p.mobilityMode === 'car') return true;
    const modes = p.travelModes ?? [];
    if (modes.some((m) => /^(auto|car)$/i.test(String(m)))) return true;
    const car = String(p.mobilityPrefs?.car ?? '').toLowerCase();
    return car === 'yes' || car === 'own' || car === 'have';
  } catch {
    return false;
  }
}

/** Distanz-Hinweis: erwartet Routenmeter (OSRM/Maps), nicht Luftlinie. */
export function travelHintFromMeters(
  distanceM: number,
  opts?: { declaredCar?: boolean },
): {
  minutes: number;
  mode: 'walk' | 'drive';
  distLabel: string;
  speech: string;
  /** Kurz für Stichpunkte: „ca. 3 Std“ statt „200 Min“. */
  etaLabel: string;
  walkMinutes: number;
  driveMinutes: number;
} {
  const m = Math.max(0, Math.round(distanceM));
  const distLabel =
    m >= 1000
      ? `${(m / 1000).toFixed(1).replace('.', ',')} km`
      : `${m} m`;
  const walkMinutes = Math.max(1, Math.round(m / 80));
  // ~25 km/h innerorts inkl. Ampeln — 3,8 km ≈ 9 Min, nie 700 m/Min (Fake-5-Min).
  const driveMinutes = Math.max(6, Math.round(m / 420));
  const declaredCar = opts?.declaredCar ?? userDeclaredCar();
  if (m < 1800) {
    const durSpeech = formatDurationMinutesDe(walkMinutes, 'speech');
    return {
      minutes: walkMinutes,
      mode: 'walk',
      distLabel,
      etaLabel: formatDurationMinutesDe(walkMinutes, 'short'),
      speech: `von hier ${durSpeech} zu Fuß (${distLabel})`,
      walkMinutes,
      driveMinutes,
    };
  }
  if (declaredCar) {
    const durSpeech = formatDurationMinutesDe(driveMinutes, 'speech');
    return {
      minutes: driveMinutes,
      mode: 'drive',
      distLabel,
      etaLabel: formatDurationMinutesDe(driveMinutes, 'short'),
      speech: `von hier ${durSpeech} Fahrt (${distLabel})`,
      walkMinutes,
      driveMinutes,
    };
  }
  return {
    minutes: driveMinutes,
    mode: 'drive',
    distLabel,
    etaLabel: distLabel,
    speech: `von hier ${distLabel}`,
    walkMinutes,
    driveMinutes,
  };
}

/** Ab dieser Distanz: nähere Alternative mitliefern. */
export const FAR_DEST_M = 8_000;
