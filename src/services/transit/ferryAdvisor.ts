/**
 * Fähren & tideabhängige Verbindungen — getrennt vom Bahn-Transit.
 * Live-Verspätungsfeeds für Inselfähren gibt es meist nicht; wir nutzen
 * Tide-Daten (PEGELONLINE) + ehrliche statische Hinweise aus dem City-Pack.
 */

import { haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { getTideState } from '../geo/tideService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';
import type { GeminiConciergeResponse } from '../../types/concierge';
import {
  findNearestFerryPoi,
  shouldRouteToFerryAdvisor,
} from './transportContext';

const FERRY_QUERY =
  /\b(fähre|faehre|ferry|inselbahn|harlesiel|fähranleger|faehranleger|fährhafen|faehrhafen|watt\s*sprinter|insel\s*fähre|anleger|überfahrt|ueberfahrt)\b/iu;

const SCHEDULE_QUERY =
  /\b(wann\s+fährt|wann\s+faehrt|abfahrt|fahrplan|nächste\s+fähre|naechste\s+faehre|verspät|verspaet|pünktlich|puenktlich)\b/iu;

export type FerryAdvice = {
  ferryPoi: Poi;
  ferryName: string;
  walkMinutes: number;
  distanceM: number;
  tideStatus: 'low' | 'high' | 'unknown';
  tideLevelCm?: number;
  source: 'tide_live' | 'static';
  cityId: string;
};

export function isFerryQuery(text: string): boolean {
  const t = text.trim();
  if (FERRY_QUERY.test(t)) return true;
  return (
    SCHEDULE_QUERY.test(t) &&
    /\b(fähre|faehre|ferry|harlesiel|insel|anleger)\b/iu.test(t)
  );
}

/** Inkl. standortbasierter Erkennung für „Wann fährt die nächste?“. */
export async function isFerryQueryWithLocation(text: string): Promise<boolean> {
  if (isFerryQuery(text)) return true;
  return shouldRouteToFerryAdvisor(text);
}

function cityId(): string {
  return (
    getCachedUserProfile()?.cityId ||
    env.cityId?.() ||
    'prisdorf'
  )
    .toString()
    .trim()
    .toLowerCase();
}

async function findFerryPoi(): Promise<Poi | null> {
  return findNearestFerryPoi();
}

function walkMinutesForDistance(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / 80));
}

function tideSpeech(status: FerryAdvice['tideStatus'], levelCm?: number): string {
  if (status === 'low') {
    return 'Gerade ist Niedrigwasser — die Fähre fährt tideabhängig, bei Ebbe kann es länger dauern bis die nächste Abfahrt möglich ist.';
  }
  if (status === 'high') {
    const lvl = levelCm != null ? ` Pegel bei ${Math.round(levelCm)} Zentimetern.` : '';
    return `Das Wasser steht gerade höher${lvl} — gute Bedingungen für tideabhängige Abfahrten.`;
  }
  return 'Den aktuellen Pegel konnte ich gerade nicht abrufen.';
}

export async function buildFerryAdvice(text: string): Promise<FerryAdvice | null> {
  const routeFerry = await isFerryQueryWithLocation(text);
  if (!routeFerry) return null;

  const city = cityId();
  const ferry = await findFerryPoi();
  if (!ferry) return null;

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  let distanceM = 0;
  let walkMinutes = 5;
  if (lat != null && lng != null) {
    distanceM = Math.round(haversineMeters(lat, lng, ferry.lat, ferry.lng));
    walkMinutes = walkMinutesForDistance(distanceM);
  }

  const tide = await getTideState(city);
  const ferryName = ferry.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();

  return {
    ferryPoi: ferry,
    ferryName,
    walkMinutes,
    distanceM,
    tideStatus: tide.status,
    tideLevelCm: tide.levelCm,
    source: tide.status !== 'unknown' ? 'tide_live' : 'static',
    cityId: city,
  };
}

export function formatFerryReply(advice: FerryAdvice): string {
  const tideClause = tideSpeech(advice.tideStatus, advice.tideLevelCm);

  const locationClause =
    advice.distanceM > 0 && advice.distanceM < 180
      ? `Du stehst gerade am ${advice.ferryName} — `
      : advice.distanceM > 0
        ? `Von deinem Standort bis ${advice.ferryName} sind es etwa ${advice.walkMinutes} Minuten zu Fuß. `
        : '';

  if (advice.cityId === 'wangerooge') {
    return (
      `${locationClause}` +
      `Die Fähre zwischen Harlesiel und Wangerooge fährt tideabhängig — in der Hauptsaison etwa sechs Mal am Tag, aber ohne feste Uhrzeiten wie bei der Bahn. ` +
      `${tideClause} ` +
      `Live-Verspätungsdaten für die Inselfähre gibt es leider nicht — aktuelle Abfahrten findest du auf wangerooge.de oder am Schalter in Harlesiel.`
    );
  }

  return (
    `Für ${advice.ferryName} gibt es keinen klassischen Live-Fahrplan mit Verspätungsanzeige. ` +
    `${tideClause} ` +
    `Ich kann dir aber sagen, dass du von hier etwa ${advice.walkMinutes} Minuten brauchst.`
  );
}

export function ferryAdviceToConcierge(
  advice: FerryAdvice,
  speechText: string,
): GeminiConciergeResponse {
  const bullets: string[] = [];

  if (advice.cityId === 'wangerooge') {
    bullets.push('Harlesiel ↔ Wangerooge · tideabhängig');
    bullets.push('Hauptsaison: ca. 6 Abfahrten/Tag');
    if (advice.tideStatus === 'low') {
      bullets.push('Niedrigwasser — Abfahrt evtl. verzögert');
    } else if (advice.tideStatus === 'high') {
      bullets.push('Hochwasser — gute Abfahrtsbedingungen');
    }
    bullets.push('Kein Live-Verspätungsfeed verfügbar');
  } else {
    bullets.push(`${advice.ferryName}`);
    bullets.push('Kein Live-Fahrplan verfügbar');
    if (advice.walkMinutes > 1) {
      bullets.push(`Fußweg ca. ${advice.walkMinutes} Min`);
    }
  }

  return {
    speechText,
    cardTitle: 'Fähre & Anreise',
    visualBullets: bullets.slice(0, 3),
    quickActions: [],
  };
}

export async function prepareFerryFollowUp(text: string): Promise<{
  advice: FerryAdvice;
  reply: string;
} | null> {
  const advice = await buildFerryAdvice(text);
  if (!advice) return null;
  return { advice, reply: formatFerryReply(advice) };
}
