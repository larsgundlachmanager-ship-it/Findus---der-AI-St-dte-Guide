/**
 * Vier Recherche-Zustände (SSOT) — Modul-2 Ortssuche unabhängig von der
 * ausgewählten Pack-Stadt (die gilt nur für Modul 1).
 *
 * 1) installed — Zielstadt-Pack liegt auf dem Gerät → Recherche OK
 * 2) ghost — kein Katalog-Pack → stille Live-Recherche + Inbox wächst;
 *    nie auswählbar/herunterladbar, bis Founder die Stadt scharf schaltet
 * 3) requires_download — Katalog-Pack existiert, fehlt lokal → erst Download,
 *    dann Recherche (Ressourcen sparen)
 * 4) exempt — Reiseplan (Flug/Leave-by), Reisebüro, gleiche Stadt, kein Ziel
 */

import {
  loadCityCatalog,
  isCityPackCachedOnDevice,
  type CityCatalogItem,
} from './cityCatalogService';
import { extractCityFromText } from '../module2/context/shortTermContext';
import {
  isPlausibleSoftCityName,
  looksLikeAmenityCityBlob,
} from './softCityName';

export type CityResearchLaneKind =
  | 'installed'
  | 'ghost'
  | 'requires_download'
  | 'exempt';

export type CityResearchLane = {
  kind: CityResearchLaneKind;
  cityId: string | null;
  cityName: string | null;
  /** Katalog-Treffer nur bei installed / requires_download */
  catalog?: CityCatalogItem | null;
  reason?:
    | 'reisebuero'
    | 'travel_plan'
    | 'same_city'
    | 'no_city'
    | 'outfit_weather'
    | 'amenity_blob';
};

function normalizeCityToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function matchCatalogCity(
  name: string,
  catalog: CityCatalogItem[],
): CityCatalogItem | null {
  const n = normalizeCityToken(name);
  if (!n || n.length < 3) return null;
  for (const c of catalog) {
    const id = normalizeCityToken(c.id);
    const nm = normalizeCityToken(c.name);
    if (id === n || nm === n) return c;
    if (n.length >= 5 && (id.includes(n) || nm.includes(n) || n.includes(nm))) {
      return c;
    }
  }
  return null;
}

/** Kanonische Pack-/Inbox-ID ohne soft_-Prefix (RN-frei). */
export function ghostCityIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return slug || 'unknown';
}

/**
 * Reiseplan zur Stadt (Flug, Abreise, „nach X“) — kein In-Stadt-POI-Zwang.
 * Frühstück/Hotel/Essen/Sehenswürdigkeit in X → false.
 */
export function isTravelPlanExemptQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  try {
    const { isFlightTripQuery } = require('./flights/flightTripIntent') as {
      isFlightTripQuery: (s: string) => boolean;
    };
    if (isFlightTripQuery(t)) return true;
  } catch {
    /* soft */
  }
  if (
    /\b(flug|fliegen|flieger|flughafen|boarding|abflug|ankunft\s+flug)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(wann|ab\s*wann).{0,48}\b(los|aufbrechen|abreisen|losfahren|losfliegen|hin)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  const venueAsk =
    /\b(frühstück|fruehstueck|essen|restaurant|café|cafe|bar|hotel|übernacht|uebernacht|übernachten|wo\s+kann|suche|spot|sehenswürdig|museum|kino|brunch|mittag|abendessen|dining)\b/iu.test(
      t,
    );
  if (
    !venueAsk &&
    /\b(nach|richtung)\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{2,}/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** In-Stadt-Suche: Orte/Venues in einer genannten Stadt. */
export function isInCityVenueResearchQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isTravelPlanExemptQuery(t)) return false;
  const city = extractCityFromText(t);
  if (!city) return false;
  return (
    /\b(frühstück|fruehstueck|essen|restaurant|café|cafe|bar|hotel|übernacht|uebernacht|wo\s+kann|beste|spot|sehenswürdig|museum|kino|brunch|mittag|abendessen|dining|übernachten|uebernachten|schlafen|kaffee)\b/iu.test(
      t,
    ) || /\bin\s+/iu.test(t)
  );
}

function isReisebueroActive(): boolean {
  try {
    const { isReisebueroOverlayOpen } = require('../reisebuero/store') as {
      isReisebueroOverlayOpen: () => boolean;
    };
    if (isReisebueroOverlayOpen()) return true;
  } catch {
    /* soft */
  }
  try {
    const { isReisebueroLiveActive } = require('../reisebuero/reisebueroLiveChat') as {
      isReisebueroLiveActive: () => boolean;
    };
    if (isReisebueroLiveActive()) return true;
  } catch {
    /* soft */
  }
  return false;
}

function activeCityNames(): { id: string; name: string } {
  try {
    const { getCachedUserProfile } = require('./userProfileService') as {
      getCachedUserProfile: () => {
        cityId?: string | null;
        cityName?: string | null;
      } | null;
    };
    const p = getCachedUserProfile();
    return {
      id: String(p?.cityId || '')
        .trim()
        .toLowerCase(),
      name: String(p?.cityName || '').trim(),
    };
  } catch {
    return { id: '', name: '' };
  }
}

function isSoftCityIdLocal(id: string | null | undefined): boolean {
  return Boolean(id && /^soft_/i.test(id));
}

/**
 * Löst den Recherche-Lane für eine Utterance auf.
 */
export async function resolveCityResearchLane(
  text: string,
  opts?: { forceCityName?: string | null },
): Promise<CityResearchLane> {
  if (isReisebueroActive()) {
    return {
      kind: 'exempt',
      cityId: null,
      cityName: null,
      reason: 'reisebuero',
    };
  }

  try {
    const { looksLikeOutfitOrWeatherUtterance } = await import(
      '../module2/planning/planUtteranceGate'
    );
    if (looksLikeOutfitOrWeatherUtterance(text)) {
      return {
        kind: 'exempt',
        cityId: null,
        cityName: null,
        reason: 'outfit_weather',
      };
    }
  } catch {
    /* soft */
  }

  if (isTravelPlanExemptQuery(text)) {
    const mentioned = opts?.forceCityName || extractCityFromText(text);
    return {
      kind: 'exempt',
      cityId: mentioned ? ghostCityIdFromName(mentioned) : null,
      cityName: mentioned ?? null,
      reason: 'travel_plan',
    };
  }

  const mentioned = (opts?.forceCityName || extractCityFromText(text) || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!mentioned) {
    return {
      kind: 'exempt',
      cityId: null,
      cityName: null,
      reason: 'no_city',
    };
  }
  if (
    looksLikeAmenityCityBlob(mentioned) ||
    !isPlausibleSoftCityName(mentioned)
  ) {
    return {
      kind: 'exempt',
      cityId: null,
      cityName: null,
      reason: 'amenity_blob',
    };
  }

  const active = activeCityNames();
  if (
    (active.id &&
      normalizeCityToken(active.id) === normalizeCityToken(mentioned)) ||
    (active.name &&
      normalizeCityToken(active.name) === normalizeCityToken(mentioned))
  ) {
    return {
      kind: 'installed',
      cityId: active.id || ghostCityIdFromName(mentioned),
      cityName: active.name || mentioned,
      reason: 'same_city',
    };
  }

  let workingName = '';
  try {
    const { getWorkingCityName } = await import('./softWorkingCity');
    workingName = String(getWorkingCityName() || '').trim();
  } catch {
    workingName = '';
  }
  if (
    workingName &&
    normalizeCityToken(workingName) === normalizeCityToken(mentioned)
  ) {
    const catalog = await loadCityCatalog(null);
    const hit = matchCatalogCity(mentioned, catalog);
    if (hit && (await isCityPackCachedOnDevice(hit.id))) {
      return {
        kind: 'installed',
        cityId: hit.id,
        cityName: hit.name,
        catalog: hit,
      };
    }
    if (hit) {
      return {
        kind: 'requires_download',
        cityId: hit.id,
        cityName: hit.name,
        catalog: hit,
      };
    }
    return {
      kind: 'ghost',
      cityId: ghostCityIdFromName(mentioned),
      cityName: mentioned,
    };
  }

  const catalog = await loadCityCatalog(null);
  const hit = matchCatalogCity(mentioned, catalog);
  if (hit && !isSoftCityIdLocal(hit.id)) {
    if (await isCityPackCachedOnDevice(hit.id)) {
      return {
        kind: 'installed',
        cityId: hit.id,
        cityName: hit.name,
        catalog: hit,
      };
    }
    if (isInCityVenueResearchQuery(text) || Boolean(mentioned)) {
      return {
        kind: 'requires_download',
        cityId: hit.id,
        cityName: hit.name,
        catalog: hit,
      };
    }
  }

  return {
    kind: 'ghost',
    cityId: ghostCityIdFromName(mentioned),
    cityName: mentioned,
  };
}
