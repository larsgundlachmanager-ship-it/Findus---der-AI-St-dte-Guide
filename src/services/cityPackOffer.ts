/**
 * Wenn User eine andere Stadt meint und das Pack noch nicht lokal liegt:
 * Katalog-Pack → Download/Switch-Popup.
 * Unbekannte echte Stadt → Soft-Arbeitsstadt still im Hintergrund (kein Popup).
 * Amenity-Müll („Mit Pool“) → nie.
 */

import {
  loadCityCatalog,
  installCityPack,
  isCityPackCachedOnDevice,
  type CityCatalogItem,
} from './cityCatalogService';
import { getCachedUserProfile } from './userProfileService';
import { extractCityFromText } from '../module2/context/shortTermContext';
import { isSoftCityId, slugifySoftCityId } from './softWorkingCity';
import {
  destinationSwitchSpeech,
  type DestinationSwitchIntent,
} from './destinationCitySwitchSpeech';
import {
  isPlausibleSoftCityName,
  looksLikeAmenityCityBlob,
} from './softCityName';

export type { DestinationSwitchIntent };
export { destinationSwitchSpeech };
export { isPlausibleSoftCityName } from './softCityName';

export type CityPackOffer = {
  city: CityCatalogItem;
  alreadyActive: boolean;
  speechHint: string;
  /** Kein Katalog-Pack — Wechsel setzt nur die Arbeitsstadt. */
  soft?: boolean;
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

export function syntheticSoftCatalogCity(name: string): CityCatalogItem {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return {
    id: slugifySoftCityId(trimmed),
    name: trimmed,
    lat: undefined,
    lng: undefined,
    coverUrl: null,
    distanceKm: null,
    triggerCount: 0,
    zoneCount: 0,
    approachCount: 0,
    subCount: 0,
    factCount: 0,
    storyCount: 0,
    directoryCount: 0,
    triggers: [],
    gpsCount: 0,
    placeCount: 0,
  };
}

function isAlreadyActive(
  hit: CityCatalogItem,
  mentioned: string,
  activeId: string,
  activeName: string,
): boolean {
  return (
    hit.id.toLowerCase() === activeId ||
    normalizeCityToken(hit.name) === normalizeCityToken(activeName) ||
    normalizeCityToken(mentioned) === normalizeCityToken(activeName)
  );
}

/**
 * Wenn Utterance eine andere Stadt nennt:
 * Katalog-Pack → Offer (Popup nur bei echtem Pack-Download).
 * Unbekannt + plausibel → Soft-Stadt (still, kein Popup).
 */
export async function maybeCityPackOfferForText(
  text: string,
  opts?: { evenIfCached?: boolean; intent?: DestinationSwitchIntent },
): Promise<CityPackOffer | null> {
  try {
    const { looksLikeOutfitOrWeatherUtterance } = await import(
      '../module2/planning/planUtteranceGate'
    );
    if (looksLikeOutfitOrWeatherUtterance(text)) return null;
  } catch {
    /* soft */
  }
  try {
    const { isFlightTripQuery } = await import('../flights/flightTripIntent');
    if (isFlightTripQuery(text)) return null;
  } catch {
    /* soft */
  }
  try {
    const { isSupermarketOfferQuery } = await import(
      './research/supermarketProspectGates'
    );
    // Lokales Prospekt-Thema: kein Stadt-Pack-Switch (auch nicht via sticky Rewrite).
    if (isSupermarketOfferQuery(text)) return null;
  } catch {
    /* soft */
  }
  const mentioned = extractCityFromText(text);
  if (!mentioned) return null;
  if (looksLikeAmenityCityBlob(mentioned) || !isPlausibleSoftCityName(mentioned)) {
    return null;
  }

  const profile = getCachedUserProfile();
  const activeId = String(profile?.cityId || '')
    .trim()
    .toLowerCase();
  const activeName = String(profile?.cityName || '').trim();
  const firstName = String(profile?.firstName || '').trim() || null;
  let workingName = '';
  try {
    const { getWorkingCityName } = await import('./softWorkingCity');
    workingName = String(getWorkingCityName() || '').trim();
  } catch {
    workingName = '';
  }

  const catalog = await loadCityCatalog(null);
  const hit = matchCatalogCity(mentioned, catalog);
  const city = hit ?? syntheticSoftCatalogCity(mentioned);
  const soft = !hit || isSoftCityId(city.id);

  // Soft nur bei plausiblem Ortsnamen — nie „Mit Pool Und“
  if (soft && !isPlausibleSoftCityName(city.name)) return null;

  if (isAlreadyActive(city, mentioned, activeId, activeName)) return null;
  if (
    workingName &&
    normalizeCityToken(workingName) === normalizeCityToken(mentioned)
  ) {
    return null;
  }

  // Q&A kann gecachte Packs ohne Switch nutzen. Planung/Hotel braucht den aktiven Datensatz.
  if (!soft && !opts?.evenIfCached && (await isCityPackCachedOnDevice(city.id))) {
    return null;
  }

  return {
    city,
    alreadyActive: false,
    soft,
    // Soft: still — kein Switch-Satz in der Synthese
    speechHint: soft
      ? ''
      : destinationSwitchSpeech({
          cityName: city.name,
          activeName,
          firstName,
          intent: opts?.intent ?? 'research',
        }),
  };
}

export async function acceptCityPackOffer(
  cityId: string,
  cityName?: string,
): Promise<{ ok: boolean; cityName: string; soft?: boolean }> {
  const label = (cityName || '').trim();
  if (isSoftCityId(cityId)) {
    try {
      const { setSoftWorkingCity } = await import('./softWorkingCity');
      await setSoftWorkingCity({
        id: cityId,
        name: label || cityId.replace(/^soft_/i, ''),
        lat: null,
        lng: null,
        soft: true,
        source: 'manual',
      });
      const { notifyCityPackActivated } = await import('./cityProximityService');
      await notifyCityPackActivated({
        id: cityId,
        name: label || cityId,
        soft: true,
      });
    } catch {
      /* soft */
    }
    return {
      ok: true,
      cityName: label || cityId,
      soft: true,
    };
  }

  const result = await installCityPack(cityId, {
    checkRemote: true,
    reason: 'switch',
  });
  const resolvedName = result.cityName || label || cityId;
  try {
    const { notifyCityPackActivated, noteManualCityFocus } = await import(
      './cityProximityService'
    );
    noteManualCityFocus(cityId);
    await notifyCityPackActivated({ id: cityId, name: resolvedName });
  } catch {
    /* soft */
  }
  return {
    ok: true,
    cityName: resolvedName,
  };
}

let lastSwitchPrompt: {
  key: string;
  atMs: number;
  result: {
    cityName: string;
    cityId: string;
    accepted: boolean;
    soft: boolean;
    blocked?: boolean;
    lane?: string;
  };
} | null = null;

/**
 * Hotel/Recherche in fremder Stadt — Vier-Lane-Gesetz (cityResearchLane).
 *
 * - installed / ghost / travel_plan / reisebuero → cityHint, Home bleibt
 * - requires_download → Speech + Download-Karte; Pack auf Disk ohne Profil-Wechsel
 * - Soft/Geist: nie Popup, nie auswählbar machen (nur Such-Bias)
 * null = keine Zielstadt / Amenity-Müll / gleiche Stadt ohne Offer
 */
export async function promptDestinationCitySwitch(opts: {
  text: string;
  intent?: DestinationSwitchIntent;
  /** true = nur Such-Bias, nie Download-Karte (Reisebüro / Caller) */
  searchBiasOnly?: boolean;
}): Promise<{
  cityName: string;
  cityId: string;
  accepted: boolean;
  soft: boolean;
  /** requires_download abgelehnt → Caller stoppt Recherche */
  blocked?: boolean;
  lane?: string;
} | null> {
  const { resolveCityResearchLane } = await import('./cityResearchLane');
  const lane = await resolveCityResearchLane(opts.text);

  const key = `${lane.kind}:${lane.cityId || 'x'}:${opts.intent ?? 'research'}:${opts.searchBiasOnly ? 'bias' : 'gate'}`;
  if (
    lastSwitchPrompt &&
    lastSwitchPrompt.key === key &&
    Date.now() - lastSwitchPrompt.atMs < 20_000
  ) {
    return lastSwitchPrompt.result;
  }

  if (
    lane.kind === 'exempt' &&
    (lane.reason === 'no_city' ||
      lane.reason === 'amenity_blob' ||
      lane.reason === 'outfit_weather')
  ) {
    return null;
  }

  // Reiseplan / gleiche Stadt / installed: Bias, Home unverändert
  // searchBiasOnly überspringt KEINE Download-Pflicht (nur Caller-Hinweis)
  if (lane.kind === 'exempt' || lane.kind === 'installed') {
    if (!lane.cityName || !lane.cityId) return null;
    const result = {
      cityName: lane.cityName,
      cityId: lane.cityId,
      accepted: true,
      soft: lane.kind === 'exempt',
      lane: lane.kind,
    };
    lastSwitchPrompt = { key, atMs: Date.now(), result };
    return result;
  }

  // Geist: Recherche OK, still — nie Soft-Working / nie Popup
  if (lane.kind === 'ghost') {
    const result = {
      cityName: lane.cityName!,
      cityId: lane.cityId!,
      accepted: true,
      soft: true,
      lane: 'ghost',
    };
    lastSwitchPrompt = { key, atMs: Date.now(), result };
    return result;
  }

  // requires_download — einziges Mal: Download erzwingen
  const city = lane.catalog;
  if (!city || !lane.cityName || !lane.cityId) return null;

  try {
    const { clearCityPackOffer, noteCityPackOffer } = await import(
      '../module2/context/shortTermContext'
    );
    clearCityPackOffer();
    const profile = getCachedUserProfile();
    const speechHint = destinationSwitchSpeech({
      cityName: lane.cityName,
      activeName: String(profile?.cityName || '').trim() || null,
      firstName: String(profile?.firstName || '').trim() || null,
      intent: 'download',
    });
    noteCityPackOffer({
      cityId: lane.cityId,
      cityName: lane.cityName,
      speechHint,
    });
  } catch {
    /* soft */
  }

  const speechHint = destinationSwitchSpeech({
    cityName: lane.cityName,
    activeName: String(getCachedUserProfile()?.cityName || '').trim() || null,
    firstName: String(getCachedUserProfile()?.firstName || '').trim() || null,
    intent: 'download',
  });

  try {
    const { enqueueSpeech } = await import('../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'main',
      text: speechHint,
      turnId: `city_download_${lane.cityId}`,
    });
  } catch {
    /* soft */
  }

  let accepted = false;
  try {
    const { presentCityPackSwitchCard } = await import(
      './cityProximityService'
    );
    const profile = getCachedUserProfile();
    const decision = await presentCityPackSwitchCard({
      target: city,
      activeId: profile?.cityId,
      activeName: String(profile?.cityName || '').trim() || 'deiner Stadt',
      softTarget: false,
    });
    accepted = decision === 'accept';
  } catch {
    accepted = false;
  }

  if (accepted) {
    // Nur auf Disk — Selected-/Home-Stadt (Modul 1) bleibt
    try {
      const { ensureBrowseCityPackOnDevice } = await import(
        './cityCatalogService'
      );
      await ensureBrowseCityPackOnDevice(lane.cityId);
    } catch {
      /* soft — Fallback Full-Install ohne Profil-Zwang */
      try {
        await installCityPack(lane.cityId, {
          checkRemote: true,
          reason: 'install',
        });
      } catch {
        /* soft */
      }
    }
  }

  const result = {
    cityName: lane.cityName,
    cityId: lane.cityId,
    accepted,
    soft: false,
    blocked: !accepted,
    lane: 'requires_download',
  };
  lastSwitchPrompt = { key, atMs: Date.now(), result };
  return result;
}
