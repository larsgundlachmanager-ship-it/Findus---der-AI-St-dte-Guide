/**
 * Verify-before-commit — hart vor jedem Nav-Start.
 * Falsche Stadt / Home-Bias darf nicht als Route committet werden.
 * Stadt-agnostisch: GPS-Stadt vs. Ziel-Stadt aus Pack-Index, keine Orts-Hardcodes.
 *
 * Unbenanntes Fernziel: nicht silent blocken — finden + nachfragen
 * („Meinst du {Ort} in {Stadt}?“).
 */

import {
  citiesShareCore,
  cityCoordsFromName,
  loadNearbyCitiesFromIndex,
  nearestCityName,
} from './fuzzyCityResolve';

/** Ohne genannte Zielstadt: weiter weg als Umland → nachfragen. */
export const NAV_VERIFY_FAR_M = 40_000;
/** Andere nächste Stadt + nicht im Namen/Utterance → nachfragen. */
export const NAV_VERIFY_OTHER_CITY_M = 18_000;

export type NavDestVerifyInput = {
  name: string;
  lat: number;
  lng: number;
  userLat?: number | null;
  userLng?: number | null;
  /** User hat eine Stadt genannt (Utterance / dest-Name). */
  mentionedCity?: string | null;
  simulation?: boolean;
};

export type NavDestVerifyResult =
  | { ok: true }
  | {
      ok: false;
      kind: 'confirm';
      message: string;
      destCity: string | null;
      userCity: string | null;
      distM: number;
    }
  | {
      ok: false;
      kind: 'wrong_city';
      message: string;
      destCity: string | null;
      mentionedCity: string;
      userCity: string | null;
      distM: number;
    };

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameMentionsCity(blob: string, city: string): boolean {
  const b = norm(blob);
  const c = norm(city);
  if (!b || !c || c.length < 3) return false;
  return b.includes(c);
}

/** Anzeigename inkl. Stadt — damit „Ja“ Verify passiert. */
export function labeledDestName(place: string, destCity: string | null): string {
  const p = String(place || '')
    .replace(/\s+/g, ' ')
    .trim() || 'Ziel';
  if (!destCity || nameMentionsCity(p, destCity)) return p;
  return `${p}, ${destCity}`;
}

function stripCitySuffix(place: string, city: string | null): string {
  const p = String(place || '').replace(/\s+/g, ' ').trim();
  if (!city || !p) return p;
  const c = city.trim();
  if (!c) return p;
  const re = new RegExp(
    `[,\\s]+${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'i',
  );
  return p.replace(re, '').trim() || p;
}

/**
 * Kurze Nachfrage — Wortlaut ist Fallback, keine Skript-Lehre.
 * Stadt-/Ortsnamen kommen aus GPS/Pack-Index, nicht aus Hardcodes.
 */
export function buildFarDestConfirmSpeech(opts: {
  place: string;
  destCity: string | null;
  userCity: string | null;
  distM: number;
}): string {
  const place = stripCitySuffix(opts.place, opts.destCity) || 'diesen Ort';
  if (opts.userCity && opts.destCity) {
    return `In ${opts.userCity} finde ich „${place}“ nicht. Meinst du ${place} in ${opts.destCity}?`;
  }
  if (opts.destCity) {
    return `Meinst du ${place} in ${opts.destCity}?`;
  }
  const km = Math.max(1, Math.round(opts.distM / 1000));
  return `„${place}“ liegt etwa ${km} Kilometer von hier. Soll ich dich dorthin bringen?`;
}

/**
 * Kernprüfung ohne Store — für Tests und Commit-Gate.
 * Stadt zählt nur, wenn User sie genannt hat (Utterance / Zielname), nicht aus Geocode-Label.
 */
export function verifyNavDestAgainstGps(
  input: NavDestVerifyInput & { userLat: number; userLng: number },
): NavDestVerifyResult {
  if (input.simulation === true) return { ok: true };

  const uLat = input.userLat;
  const uLng = input.userLng;
  if (
    !Number.isFinite(uLat) ||
    !Number.isFinite(uLng) ||
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng)
  ) {
    return { ok: true };
  }

  const distM = haversineMeters(uLat, uLng, input.lat, input.lng);
  if (!Number.isFinite(distM) || distM <= 0) return { ok: true };

  const cities = loadNearbyCitiesFromIndex();
  const userCity = nearestCityName(uLat, uLng, cities);
  const destCity = nearestCityName(input.lat, input.lng, cities);
  const mentioned = (input.mentionedCity ?? '').trim();
  const wantCity = mentioned;
  const blob = `${input.name} ${mentioned}`;
  const destCityNamed = destCity ? nameMentionsCity(blob, destCity) : false;

  if (wantCity) {
    const wantCoords = cityCoordsFromName(wantCity);
    if (wantCoords) {
      const toWant = haversineMeters(
        input.lat,
        input.lng,
        wantCoords.lat,
        wantCoords.lng,
      );
      if (toWant > NAV_VERIFY_FAR_M) {
        return {
          ok: false,
          kind: 'wrong_city',
          destCity,
          mentionedCity: wantCity,
          userCity,
          distM,
          message:
            destCity && !citiesShareCore(wantCity, destCity)
              ? `Das liegt in ${destCity}, nicht in ${wantCity}.`
              : `Das liegt nicht in ${wantCity}.`,
        };
      }
    } else if (destCity && !citiesShareCore(wantCity, destCity)) {
      return {
        ok: false,
        kind: 'wrong_city',
        destCity,
        mentionedCity: wantCity,
        userCity,
        distM,
        message: `Das liegt in ${destCity}, nicht in ${wantCity}.`,
      };
    }
  }

  if (distM <= NAV_VERIFY_OTHER_CITY_M) return { ok: true };

  const needsConfirm =
    (Boolean(destCity) &&
      Boolean(userCity) &&
      norm(destCity!) !== norm(userCity!) &&
      distM > NAV_VERIFY_OTHER_CITY_M &&
      !destCityNamed) ||
    (distM > NAV_VERIFY_FAR_M && !destCityNamed);

  if (needsConfirm) {
    return {
      ok: false,
      kind: 'confirm',
      destCity,
      userCity,
      distM,
      message: buildFarDestConfirmSpeech({
        place: input.name.trim() || 'diesen Ort',
        destCity,
        userCity,
        distM,
      }),
    };
  }

  return { ok: true };
}

/**
 * Ziel gegen Live-GPS prüfen. `ok: false` + `kind: 'confirm'` → nachfragen, nicht starten.
 */
export function verifyNavDestBeforeCommit(
  input: NavDestVerifyInput,
): NavDestVerifyResult {
  if (input.simulation === true) return { ok: true };
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          isSimulationMode?: boolean;
          lastGpsLat: number | null;
          lastGpsLng: number | null;
        };
      };
    };
    if (useFinnusStore.getState().isSimulationMode) return { ok: true };
  } catch {
    /* soft */
  }

  let uLat = input.userLat;
  let uLng = input.userLng;
  if (uLat == null || uLng == null) {
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: {
          getState: () => { lastGpsLat: number | null; lastGpsLng: number | null };
        };
      };
      const st = useFinnusStore.getState();
      uLat = st.lastGpsLat;
      uLng = st.lastGpsLng;
    } catch {
      /* soft */
    }
  }
  if (
    uLat == null ||
    uLng == null ||
    !Number.isFinite(uLat) ||
    !Number.isFinite(uLng)
  ) {
    return { ok: true };
  }

  const mentioned = (input.mentionedCity ?? '').trim();
  return verifyNavDestAgainstGps({
    ...input,
    userLat: uLat,
    userLng: uLng,
    mentionedCity: mentioned || input.mentionedCity,
  });
}
