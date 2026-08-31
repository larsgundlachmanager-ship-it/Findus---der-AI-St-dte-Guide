/**
 * Einheitlicher Nav-Start: lokale POI-ID → Koordinaten → Geocode (Google/Nominatim).
 * Damit „Ja, navigieren“ und unbekannte Orte zuverlässig funktionieren.
 */

import { getAllPois, getPoiWithFacts, haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { geocodePlaceNameOsmFirst } from './googleMapsNav';
import { startNavigation, startNavigationToCoords } from './navigationService';
import { recordNavSearch } from './navSearchHistory';
import { checkClosingTimeGate } from './closingTimeGate';
import { getCachedGeocodeForNav } from './landmarkCache';
import {
  lookupCachedDestinationByName,
  upsertCachedDestination,
} from './offlineNavCache';
import { isDeviceOffline } from './networkState';
import { lookupOfflineAddress } from '../homeMap/searchCityIndex';
import {
  peekCityMapExtract,
  peekDisplayExtract,
} from '../homeMap/cityMapExtract';
import type { PendingNavOffer } from './navigationTypes';
import { suggestNearbyUnvisited } from '../research/poiDiscoveryResearch';
import {
  addOptimizedTourStop,
  clearMultiStopTour,
  hasActiveTourQueue,
  weaveSpontaneousStop,
} from './multiStopTour';
import {
  presentNavRetargetChoice,
  shouldOfferNavRetarget,
} from './navRetargetChoice';
import {
  looksLikeStreetAddress,
  expandStreetAddressGeocodeQueries,
  rememberStreetNavQuery,
  sanitizeNavDestQuery,
} from './streetAddressQuery';
import {
  labeledDestName,
  NAV_VERIFY_OTHER_CITY_M,
  verifyNavDestBeforeCommit,
} from './navDestVerify';

export {
  looksLikeStreetAddress,
  streetAddressGeocodeCandidates,
  expandStreetAddressGeocodeQueries,
  peekLastStreetNavQuery,
  rememberStreetNavQuery,
} from './streetAddressQuery';

let pendingNavCommitMode: { replaceRoute: boolean; addStop: boolean } = {
  replaceRoute: false,
  addStop: false,
};

/**
 * Einzelziel starten — bei laufender Tour: einweben statt Queue zu killen.
 * Gibt optional speechHint zurück (für UI/TTS).
 */
async function startNavOrWeaveIntoTour(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  offlineOnly?: boolean;
  /** Original-Userquery für Verify (ohne Geocode-Stadt-Label). */
  userQuery?: string;
  /** Pin / „Ja, dorthin“ — Verify überspringen */
  skipDestVerify?: boolean;
}): Promise<{
  ok: boolean;
  weaveSpeech?: string;
  message?: string;
  needsConfirm?: boolean;
}> {
  const verifyName = (opts.userQuery || opts.name).trim() || opts.name;
  if (!opts.skipDestVerify) {
    const check = verifyNavDestBeforeCommit({
      name: verifyName,
      lat: opts.lat,
      lng: opts.lng,
      mentionedCity: spokenCityHint('', opts.userQuery),
    });
    if (!check.ok) {
      if (check.kind === 'wrong_city') {
        return { ok: false };
      }
      if (check.kind === 'confirm') {
        return parkFarDestConfirmOffer({
          name: verifyName,
          lat: opts.lat,
          lng: opts.lng,
          poiId: opts.poiId,
          destCity: check.destCity,
          message: check.message,
        });
      }
      return { ok: false, message: check.message };
    }
  }

  // Bestätigte Fernstrecke: ÖPNV vor 60-km-Fußmarsch
  try {
    const st = useFinnusStore.getState();
    const uLat = st.lastGpsLat;
    const uLng = st.lastGpsLng;
    if (
      !st.isSimulationMode &&
      typeof uLat === 'number' &&
      typeof uLng === 'number' &&
      haversineMeters(uLat, uLng, opts.lat, opts.lng) > NAV_VERIFY_OTHER_CITY_M
    ) {
      const { startTransitHandsFree } = await import(
        './handsFreeNav/transitBridge'
      );
      const transit = await startTransitHandsFree({
        from: { lat: uLat, lng: uLng },
        to: { lat: opts.lat, lng: opts.lng },
        destName: opts.name,
      });
      if (transit.ok) {
        return { ok: true, weaveSpeech: transit.message };
      }
      return {
        ok: false,
        message:
          transit.message ||
          'ÖPNV ist gerade nicht planbar — ich lege keine Fußroute über die ganze Strecke.',
      };
    }
  } catch {
    /* soft — nur nah: Fuß-Fallback */
  }

  const replaceRoute = pendingNavCommitMode.replaceRoute;
  const addStop = pendingNavCommitMode.addStop;
  const liveNav =
    useFinnusStore.getState().navActive === true || hasActiveTourQueue();
  if (
    liveNav &&
    !replaceRoute &&
    !addStop &&
    shouldOfferNavRetarget({
      name: opts.name,
      lat: opts.lat,
      lng: opts.lng,
      poiId: opts.poiId,
    })
  ) {
    const { speech } = presentNavRetargetChoice(
      {
        destName: opts.name,
        destLat: opts.lat,
        destLng: opts.lng,
        targetPoiId: opts.poiId,
        offlineOnly: opts.offlineOnly,
        skipDestVerify: true,
        skipClosingGate: true,
      },
      { speak: false },
    );
    return { ok: false, needsConfirm: true, message: speech };
  }

  if (addStop) {
    const added = await addOptimizedTourStop(
      {
        poiId: opts.poiId ?? -1,
        name: opts.name,
        lat: opts.lat,
        lng: opts.lng,
        done: false,
        priority: 'high',
        remindMinBefore: null,
      },
      { startNow: true },
    );
    if (added) {
      return { ok: true, weaveSpeech: added.speechHint };
    }
  }

  if (replaceRoute) {
    clearMultiStopTour();
  }

  // Expliziter Pin-/Confirm-Start: Tour nicht einweben — frische Einzelroute
  if (!opts.skipDestVerify && !replaceRoute && hasActiveTourQueue()) {
    const woven = await weaveSpontaneousStop(
      {
        poiId: opts.poiId ?? -1,
        name: opts.name,
        lat: opts.lat,
        lng: opts.lng,
        done: false,
        priority: 'high',
        remindMinBefore: null,
      },
      { startNow: true },
    );
    if (woven) {
      return { ok: true, weaveSpeech: woven.speechHint };
    }
  }
  const ok = await startNavigationToCoords({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.poiId,
    offlineOnly: opts.offlineOnly,
    // Verify lief oben schon — kein stiller Doppel-Abbruch
    skipDestVerify: true,
  });
  if (!ok) {
    const again = verifyDestPlausible({
      name: opts.name,
      lat: opts.lat,
      lng: opts.lng,
    });
    return { ok: false, message: again?.message };
  }
  return { ok: true };
}

export type NavTargetInput = {
  poiId?: string | number | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Rohe User-Äußerung — Verify darf Geocode-Stadt nicht als genannt zählen. */
  userQuery?: string | null;
};

export type NavStartResult = {
  ok: boolean;
  /** Fernziel gefunden — User soll erst bestätigen. */
  needsConfirm?: boolean;
  /** lokaler POI oder -1 bei reinen Koordinaten */
  poiId: number | null;
  name: string;
  via: 'poi' | 'coords' | 'geocode' | 'none';
  message?: string;
};

/** Pending-Offer mit Stadt im Namen, ohne Nav zu committen. */
export function parkFarDestConfirmOffer(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number | null;
  destCity?: string | null;
  message: string;
}): {
  ok: false;
  needsConfirm: true;
  message: string;
  labeledName: string;
  destCity: string | null;
} {
  const labeled = labeledDestName(opts.name, opts.destCity ?? null);
  try {
    useFinnusStore.getState().setPendingNavOffer({
      poiId: opts.poiId != null && opts.poiId >= 0 ? opts.poiId : -1,
      name: labeled,
      lat: opts.lat,
      lng: opts.lng,
      awaitConfirm: true,
    });
  } catch {
    /* soft */
  }
  return {
    ok: false,
    needsConfirm: true,
    message: opts.message,
    labeledName: labeled,
    destCity: opts.destCity ?? null,
  };
}

export function parkAmbiguousPlaceChoice(
  place: string,
  options: Array<{ city: string; lat: number; lng: number; label: string }>,
): NavStartResult {
  const { buildPlaceCityChoiceSpeech } = require('./placeCityDisambiguate') as {
    buildPlaceCityChoiceSpeech: (
      p: string,
      o: Array<{ city: string; lat: number; lng: number; label: string }>,
    ) => string;
  };
  const speech = buildPlaceCityChoiceSpeech(place, options);
  try {
    useFinnusStore.getState().setPendingNavOffer(null);
    useFinnusStore.getState().setActiveConciergeCard({
      id: `nav-city-${Date.now()}`,
      createdAtMs: Date.now(),
      cardTitle: 'Welcher Ort?',
      speechText: speech,
      visualBullets: options.map((o) => o.city).slice(0, 4),
      quickActions: options.slice(0, 4).map((o) => ({
        type: 'START_NAVIGATION' as const,
        label: o.city,
        payload: {
          destName: `${place}, ${o.city}`,
          destLat: o.lat,
          destLng: o.lng,
          skipDestVerify: true,
          skipClosingGate: true,
        },
      })),
    });
  } catch {
    /* soft */
  }
  return {
    ok: false,
    needsConfirm: true,
    poiId: null,
    name: place,
    via: 'none',
    message: speech,
  };
}

/**
 * Wenn das Ziel in einer anderen Stadt / weit weg liegt und der User
 * die Stadt nicht genannt hat: Offer parken + Nachfrage-Text.
 */
export function maybeParkFarDestConfirm(opts: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number | null;
}): { message: string; labeledName: string; destCity: string | null } | null {
  const check = verifyNavDestBeforeCommit({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
  });
  if (check.ok || check.kind !== 'confirm') return null;
  const parked = parkFarDestConfirmOffer({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    poiId: opts.poiId,
    destCity: check.destCity,
    message: check.message,
  });
  return {
    message: parked.message,
    labeledName: parked.labeledName,
    destCity: parked.destCity,
  };
}

function fromWeave(
  woven: {
    ok: boolean;
    weaveSpeech?: string;
    message?: string;
    needsConfirm?: boolean;
  },
  name: string,
  via: NavStartResult['via'],
  poiId: number | null,
): NavStartResult | null {
  if (woven.ok) {
    return {
      ok: true,
      poiId,
      name,
      via,
      message: woven.weaveSpeech,
    };
  }
  if (woven.needsConfirm) {
    return {
      ok: false,
      needsConfirm: true,
      poiId,
      name,
      via: 'none',
      message: woven.message,
    };
  }
  if (woven.message) {
    return {
      ok: false,
      poiId,
      name,
      via: 'none',
      message: woven.message,
    };
  }
  return null;
}

function keepNavResult(r: NavStartResult | null): r is NavStartResult {
  return r != null && (r.ok === true || r.needsConfirm === true);
}

export function spokenCityHint(_name: string, userQuery?: string): string | null {
  try {
    const { spokenCityFromQuery } = require('./fuzzyCityResolve') as {
      spokenCityFromQuery: (q: string) => string | null;
    };
    return spokenCityFromQuery(userQuery || '');
  } catch {
    return null;
  }
}

function geocodeOptsForQuery(query: string): {
  biasLat?: number;
  biasLng?: number;
  cityHint?: string | null;
} {
  const gps = biasFromStore();
  try {
    const { geocodeBiasForSpokenCity } = require('./fuzzyCityResolve') as {
      geocodeBiasForSpokenCity: (q: string) => {
        cityHint: string;
        biasLat?: number;
        biasLng?: number;
      } | null;
    };
    const spoken = geocodeBiasForSpokenCity(query);
    if (spoken) return spoken;
  } catch {
    /* GPS-Fallback */
  }
  return gps;
}

function cleanName(name: string | null | undefined): string {
  const n = (name ?? '')
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/^📍\s*/u, '')
    .replace(/^Route:\s*/iu, '')
    .trim();
  return sanitizeNavDestQuery(n) || n;
}

const VAGUE_AREA_RE =
  /\b(zentrum|ortskern|stadtmitte|stadtzentrum|ortszentrum|innenstadt|city\s*center|town\s*center|downtown|mitte\s+der\s+stadt)\b/iu;

/**
 * „Wangerooge“, „Pinneberg Zentrum“, „Ortskern“ — kein konkretes Erlebnisziel.
 */
export function isVagueAreaDestination(name: string | null | undefined): boolean {
  const n = cleanName(name).toLowerCase();
  if (!n || n.length < 2) return true;
  if (VAGUE_AREA_RE.test(n)) return true;
  const profile = getCachedUserProfile();
  const city = (profile?.cityName ?? profile?.cityId ?? '')
    .toLowerCase()
    .trim();
  if (!city) return false;
  if (n === city) return true;
  if (n === `${city} zentrum` || n === `zentrum ${city}`) return true;
  if (n.startsWith(`${city} `) && VAGUE_AREA_RE.test(n.slice(city.length))) {
    return true;
  }
  return false;
}

/**
 * Nächstes konkretes Pack-Highlight statt Stadtmitte / Ortskern.
 */
export async function resolveConcreteSightTarget(): Promise<{
  poiId: number;
  name: string;
  lat: number;
  lng: number;
} | null> {
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  const nearby = await suggestNearbyUnvisited(lat, lng, 1);
  if (nearby[0]) {
    const poi = await getPoiWithFacts(nearby[0].poiId);
    if (poi) {
      return {
        poiId: poi.id,
        name: cleanName(poi.name) || nearby[0].name,
        lat: poi.lat,
        lng: poi.lng,
      };
    }
  }

  // Fallback: nächster area/legacy-POI (kein Transit/Hotel)
  try {
    const pois = await getAllPois();
    const visited = new Set(store.visitedHistory.map((v) => v.poiId));
    let best: { poiId: number; name: string; lat: number; lng: number; d: number } | null =
      null;
    for (const p of pois) {
      const kind = p.kind ?? 'legacy';
      if (kind !== 'area' && kind !== 'legacy') continue;
      const cat = (p.category ?? '').toLowerCase();
      if (/hotel|bahnhof|haltestelle|parkplatz|ferry|fähre|faehre/.test(cat)) {
        continue;
      }
      if (/hotel|bahnhof|haltestelle/.test(p.name.toLowerCase())) continue;
      if (visited.has(p.id)) continue;
      const d = Math.hypot(p.lat - lat, p.lng - lng);
      if (!best || d < best.d) {
        best = {
          poiId: p.id,
          name: cleanName(p.name) || p.name,
          lat: p.lat,
          lng: p.lng,
          d,
        };
      }
    }
    if (best) {
      return {
        poiId: best.poiId,
        name: best.name,
        lat: best.lat,
        lng: best.lng,
      };
    }
  } catch {
    /* soft */
  }
  return null;
}

/** Fuzzy-Match gegen lokale POIs (ohne actionHandler-Zyklus). */
async function matchLocalPoiId(
  target: string | number | undefined | null,
): Promise<number | null> {
  if (target == null) return null;
  if (typeof target === 'number' && Number.isFinite(target) && target >= 0) {
    const poi = await getPoiWithFacts(target);
    return poi ? target : null;
  }
  const s = String(target).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    const poi = await getPoiWithFacts(id);
    return poi ? id : null;
  }

  // Straße+Hausnummer nie fuzzy auf Establishment/POI mappen
  if (looksLikeStreetAddress(s)) return null;

  const poisRaw = await getAllPois();
  let pois = poisRaw;
  try {
    const gpsLat = useFinnusStore.getState().lastGpsLat;
    const gpsLng = useFinnusStore.getState().lastGpsLng;
    if (
      typeof gpsLat === 'number' &&
      typeof gpsLng === 'number' &&
      Number.isFinite(gpsLat) &&
      Number.isFinite(gpsLng)
    ) {
      const nearby = poisRaw.filter(
        (p) => haversineMeters(gpsLat, gpsLng, p.lat, p.lng) <= 35_000,
      );
      if (nearby.length > 0) pois = nearby;
    }
  } catch {
    /* soft */
  }
  const lower = s.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const bySpot = pois.find((p) => (p.spot_key ?? '').toLowerCase() === lower);
  if (bySpot) return bySpot.id;
  const byName = pois.find((p) => {
    const n = p.name.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (n === lower) return true;
    if (lower.length >= 6 && n.includes(lower)) return true;
    if (n.length >= 8 && lower.includes(n)) return true;
    return false;
  });
  if (byName) return byName.id;

  const tokens = lower
    .replace(/[()[\].,]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    // „Tennisclub“ → tennis + club (Pack: Tennis-Club)
    .flatMap((t) => {
      if (t.length >= 8 && /club$/.test(t)) {
        return [t, t.replace(/club$/, ''), 'club'].filter((x) => x.length >= 4);
      }
      if (t.length >= 8 && /halle$/.test(t)) {
        return [t, t.replace(/halle$/, ''), 'halle'].filter((x) => x.length >= 4);
      }
      return [t];
    });
  let bestId: number | null = null;
  let bestScore = 0;
  for (const poi of pois) {
    const blob = `${poi.name} ${poi.spot_key ?? ''} ${poi.category ?? ''}`
      .toLowerCase()
      .replace(/[-_]+/g, ' ');
    let score = 0;
    for (const tok of tokens) {
      if (blob.includes(tok)) score += 12;
    }
    // Stadt allein reicht nie — sonst falscher Prisdorf-POI
    if (
      tokens.length >= 2 &&
      score === 12 &&
      /^(prisdorf|priesdorf|wangerooge|laboe|pinneberg)$/i.test(
        tokens.find((t) => blob.includes(t)) ?? '',
      )
    ) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = poi.id;
    }
  }
  return bestId != null && bestScore >= 24 ? bestId : null;
}

/** Nur IDs, die wirklich in der SQLite-DB existieren. */
export async function resolveExistingPoiId(
  target: string | number | undefined | null,
): Promise<number | null> {
  return matchLocalPoiId(target);
}

function liveCityHintFromGps(): string | null {
  try {
    const store = useFinnusStore.getState();
    const { nearestCityName, loadNearbyCitiesFromIndex } = require('./fuzzyCityResolve') as {
      nearestCityName: (
        lat: number | null,
        lng: number | null,
        cities: Array<{ name: string; lat: number; lng: number }>,
      ) => string | null;
      loadNearbyCitiesFromIndex: () => Array<{
        name: string;
        lat: number;
        lng: number;
      }>;
    };
    return nearestCityName(
      store.lastGpsLat,
      store.lastGpsLng,
      loadNearbyCitiesFromIndex(),
    );
  } catch {
    return null;
  }
}

function biasFromStore(): {
  biasLat?: number;
  biasLng?: number;
  cityHint?: string | null;
} {
  const store = useFinnusStore.getState();
  const live = liveCityHintFromGps();
  return {
    biasLat: store.lastGpsLat ?? undefined,
    biasLng: store.lastGpsLng ?? undefined,
    // GPS-Stadt, nie Home-Profil (sonst Lübeck-Ziele → Prisdorf)
    cityHint: live,
  };
}

/**
 * Verify-before-commit: Ziel vs. Live-GPS (SSOT: navDestVerify).
 */
function verifyDestPlausible(opts: {
  name: string;
  lat: number;
  lng: number;
}): NavStartResult | null {
  const check = verifyNavDestBeforeCommit(opts);
  if (check.ok) return null;
  return {
    ok: false,
    needsConfirm: check.kind === 'confirm',
    poiId: null,
    name: opts.name,
    via: 'none',
    message: check.message,
  };
}

async function resolveStoredPlaceByName(
  name: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const cached = await lookupCachedDestinationByName(name);
  if (cached) {
    return { lat: cached.lat, lng: cached.lng, label: cached.name };
  }
  const geo = await getCachedGeocodeForNav(name);
  if (geo) return geo;
  const cityHint = liveCityHintFromGps();
  try {
    const { composeGeocodeQuery } = require('./fuzzyCityResolve') as {
      composeGeocodeQuery: (query: string, hint?: string | null) => string;
    };
    const composed = composeGeocodeQuery(name, cityHint);
    if (composed !== name) {
      return getCachedGeocodeForNav(composed);
    }
  } catch {
    if (cityHint && !name.toLowerCase().includes(cityHint.toLowerCase())) {
      return getCachedGeocodeForNav(`${name}, ${cityHint}`);
    }
  }
  return null;
}

function rememberDestination(input: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number | null;
  source: 'db_poi' | 'geocode' | 'nav' | 'offer' | 'search' | 'discovery' | 'route';
  searchQuery?: string | null;
}): void {
  void upsertCachedDestination({
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    poiId: input.poiId ?? null,
    source: input.source,
    searchQuery: input.searchQuery ?? input.name,
  }).catch(() => undefined);
}

/**
 * Startet Navigation so robust wie möglich.
 * Masterbook: ETA vs. ClosingTime — warn before start when doors would be closed.
 */
export async function resolveAndStartNavigation(
  input: NavTargetInput,
  opts?: {
    skipClosingGate?: boolean;
    offlineOnly?: boolean;
    skipDestVerify?: boolean;
    replaceRoute?: boolean;
    addStop?: boolean;
  },
): Promise<NavStartResult> {
  pendingNavCommitMode = {
    replaceRoute: opts?.replaceRoute === true,
    addStop: opts?.addStop === true,
  };
  try {
    return await resolveAndStartNavigationInner(input, opts);
  } finally {
    pendingNavCommitMode = { replaceRoute: false, addStop: false };
  }
}

async function resolveAndStartNavigationInner(
  input: NavTargetInput,
  opts?: {
    skipClosingGate?: boolean;
    offlineOnly?: boolean;
    skipDestVerify?: boolean;
  },
): Promise<NavStartResult> {
  let nameHint = cleanName(input.name);
  try {
    const { expandBareHauptbahnhofQuery } = require('./expandBareHauptbahnhof') as {
      expandBareHauptbahnhofQuery: (
        n: string,
        o?: { lat?: number | null; lng?: number | null; cityHint?: string | null },
      ) => string;
    };
    const gps = biasFromStore();
    const profile = getCachedUserProfile();
    const expanded = expandBareHauptbahnhofQuery(nameHint, {
      lat: gps.biasLat ?? null,
      lng: gps.biasLng ?? null,
      cityHint: profile?.cityName ?? profile?.cityId ?? null,
    });
    if (expanded !== nameHint) {
      nameHint = cleanName(expanded);
    }
  } catch {
    /* soft */
  }
  const rawQuery = String(input.userQuery || nameHint).trim();
  const addressMode = looksLikeStreetAddress(nameHint);
  // Explizite POI-ID behalten; bei Straße+Nr. keinen Name→POI-Pfad erzwingen
  let existingId = addressMode
    ? typeof input.poiId === 'number' &&
      Number.isFinite(input.poiId) &&
      input.poiId >= 0
      ? input.poiId
      : null
    : await resolveExistingPoiId(input.poiId ?? undefined);

  // „Was sehen“ / Stadtname / Ortskern → immer ein konkretes Pack-Ziel
  if (isVagueAreaDestination(nameHint) && existingId == null) {
    const concrete = await resolveConcreteSightTarget();
    if (concrete) {
      return resolveAndStartNavigationInner(
        {
          poiId: concrete.poiId,
          name: concrete.name,
          lat: concrete.lat,
          lng: concrete.lng,
        },
        opts,
      );
    }
  }

  const runGate = async (args: {
    name: string;
    lat: number;
    lng: number;
    poiId?: number | null;
    facts?: Array<{ fact_text: string }> | null;
  }): Promise<NavStartResult | null> => {
    if (opts?.skipClosingGate) return null;
    const gate = await checkClosingTimeGate({
      destName: args.name,
      destLat: args.lat,
      destLng: args.lng,
      poiId: args.poiId,
      facts: args.facts,
      placeHint: args.name,
    });
    if (gate.allow) return null;
    return {
      ok: false,
      poiId: args.poiId ?? null,
      name: args.name,
      via: 'none',
      message: gate.warningSpeech ?? 'Das Ziel schließt bald — ETA ist zu lang.',
    };
  };

  const hasCoords =
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);

  // Gleicher Name, mehrere Städte → fragen, bevor Koordinaten (Lübeck) starten.
  if (!opts?.skipDestVerify && !looksLikeStreetAddress(nameHint)) {
    const spoken = spokenCityHint('', rawQuery);
    if (!spoken) {
      try {
        const { geocodeNamedPlaceHits } = await import('./googleMapsNav');
        const { analyzePlaceCityHits } = await import('./placeCityDisambiguate');
        const core = nameHint.split(',')[0]?.trim() || nameHint;
        const hits = await geocodeNamedPlaceHits(core);
        const analysis = analyzePlaceCityHits(rawQuery || nameHint, hits);
        if (analysis.kind === 'choice') {
          return parkAmbiguousPlaceChoice(analysis.place, analysis.options);
        }
      } catch {
        /* einzelne Geocode weiter */
      }
    }
  }

  // Koordinaten schlagen POI-ID — sonst stale Offer/Parkplatz-Drift (Lidl → DRK)
  if (hasCoords) {
    const label = nameHint || 'Ziel';
    const blocked = await runGate({
      name: label,
      lat: input.lat!,
      lng: input.lng!,
      poiId: existingId && existingId >= 0 ? existingId : null,
    });
    if (blocked) return blocked;
    const woven = await startNavOrWeaveIntoTour({
      name: label,
      lat: input.lat!,
      lng: input.lng!,
      poiId: existingId && existingId >= 0 ? existingId : -1,
      offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
    });
    const stopped = fromWeave(
      woven,
      label,
      'coords',
      existingId && existingId >= 0 ? existingId : -1,
    );
    if (stopped) {
      if (stopped.ok) {
        void recordNavSearch(label);
        rememberDestination({
          name: label,
          lat: input.lat!,
          lng: input.lng!,
          poiId: existingId && existingId >= 0 ? existingId : -1,
          source: 'geocode',
          searchQuery: nameHint || label,
        });
      }
      return stopped;
    }
  }

  if (addressMode && !hasCoords) {
    const cityId = (getCachedUserProfile()?.cityId || '').toLowerCase();
    const nums =
      peekCityMapExtract(cityId)?.housenumbers ??
      peekDisplayExtract(cityId)?.extract?.housenumbers ??
      [];
    const st = useFinnusStore.getState();
    const origin =
      typeof st.lastGpsLat === 'number' &&
      typeof st.lastGpsLng === 'number' &&
      Number.isFinite(st.lastGpsLat) &&
      Number.isFinite(st.lastGpsLng)
        ? { lat: st.lastGpsLat, lng: st.lastGpsLng }
        : null;
    const hit = lookupOfflineAddress(nameHint, nums, origin);
    if (hit) {
      rememberStreetNavQuery(nameHint);
      return resolveAndStartNavigationInner(
        {
          name: hit.name,
          lat: hit.lat,
          lng: hit.lng,
          userQuery: rawQuery,
        },
        opts,
      );
    }
  }

  if (existingId != null) {
    const poi = await getPoiWithFacts(existingId);
    if (poi) {
      const blocked = await runGate({
        name: cleanName(poi.name) || nameHint || 'Ziel',
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        facts: poi.facts?.map((f) => ({ fact_text: f.fact_text })),
      });
      if (blocked) return blocked;
    }
    const poiName = cleanName(poi?.name) || nameHint || 'Ziel';
    if (
      poi &&
      (hasActiveTourQueue() || useFinnusStore.getState().navActive)
    ) {
      const woven = await startNavOrWeaveIntoTour({
        name: poiName,
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
      });
      const stopped = fromWeave(woven, poiName, 'poi', existingId);
      if (stopped) {
        if (stopped.ok) {
          void recordNavSearch(poiName);
          rememberDestination({
            name: poiName,
            lat: poi.lat,
            lng: poi.lng,
            poiId: poi.id,
            source: 'db_poi',
            searchQuery: nameHint || poiName,
          });
        }
        return stopped;
      }
    }
    const ok = await startNavigation(existingId, { offlineOnly: opts?.offlineOnly });
    if (ok) {
      void recordNavSearch(poiName);
      if (poi) {
        rememberDestination({
          name: poiName,
          lat: poi.lat,
          lng: poi.lng,
          poiId: poi.id,
          source: 'db_poi',
          searchQuery: nameHint || poiName,
        });
      }
      return {
        ok: true,
        poiId: existingId,
        name: cleanName(poi?.name) || nameHint || 'Ziel',
        via: 'poi',
      };
    }
    // POI da, aber Nav fail → trotzdem Koordinaten versuchen
    if (poi) {
      const ok2 = await startNavOrWeaveIntoTour({
        name: cleanName(poi.name),
        lat: poi.lat,
        lng: poi.lng,
        poiId: poi.id,
        offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
      });
      const stopped2 = fromWeave(ok2, cleanName(poi.name), 'coords', poi.id);
      if (stopped2) {
        if (stopped2.ok) {
          void recordNavSearch(cleanName(poi.name));
          rememberDestination({
            name: cleanName(poi.name),
            lat: poi.lat,
            lng: poi.lng,
            poiId: poi.id,
            source: 'db_poi',
          });
        }
        return stopped2;
      }
    }
  }

  if (nameHint.length >= 2) {
    const offline = opts?.offlineOnly || (await isDeviceOffline());
    if (offline) {
      const stored = await resolveStoredPlaceByName(nameHint);
      if (stored) {
        const destName = stored.label || nameHint;
        const ok = await startNavOrWeaveIntoTour({
          name: destName,
          lat: stored.lat,
          lng: stored.lng,
          poiId: -1,
          offlineOnly: true,
          userQuery: rawQuery,
        });
        const stopped = fromWeave(ok, destName, 'geocode', -1);
        if (stopped) {
          if (stopped.ok) {
            void recordNavSearch(destName);
            rememberDestination({
              name: destName,
              lat: stored.lat,
              lng: stored.lng,
              source: 'search',
              searchQuery: nameHint,
            });
          }
          return stopped;
        }
      }
      return {
        ok: false,
        poiId: null,
        name: nameHint,
        via: 'none',
        message:
          'Diesen Ort habe ich offline noch nicht gespeichert. Einmal online suchen, dann kann ich dich später auch ohne Internet dorthin führen.',
      };
    }

    // Online: Straße+Hausnummer → Geocode (street_address), nie Places-Establishment
    if (addressMode) {
      rememberStreetNavQuery(nameHint);
      const bias = geocodeOptsForQuery(nameHint);
      const candidates = expandStreetAddressGeocodeQueries(nameHint, {
        profileCity: bias.cityHint,
        biasLat: bias.biasLat,
        biasLng: bias.biasLng,
      });
      for (const cand of candidates) {
        const geo = await geocodePlaceNameOsmFirst(cand, {
          ...geocodeOptsForQuery(cand),
          preferStreetAddress: true,
        });
        if (!geo) continue;
        const destName = geo.label || cand;
        const blocked = await runGate({
          name: destName,
          lat: geo.lat,
          lng: geo.lng,
          poiId: -1,
        });
        if (blocked) return blocked;
        const ok = await startNavOrWeaveIntoTour({
          name: destName,
          lat: geo.lat,
          lng: geo.lng,
          poiId: -1,
          offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
        });
        const stopped = fromWeave(ok, destName, 'geocode', -1);
        if (!keepNavResult(stopped)) continue;
        if (stopped.ok) {
          void recordNavSearch(destName);
          rememberDestination({
            name: destName,
            lat: geo.lat,
            lng: geo.lng,
            source: 'search',
            searchQuery: nameHint,
          });
          if (__DEV__) {
            console.log('[nav] street-address geocode', cand, '→', destName);
          }
        }
        return stopped;
      }
      return {
        ok: false,
        poiId: null,
        name: nameHint,
        via: 'none',
        message:
          'Diese Adresse konnte ich gerade nicht auflösen. Sag Straße und Hausnummer nochmal klar — oder tippe sie kurz.',
      };
    }

    // Pack zuerst — aktuelle Stadt, dann andere gecachte Packs, dann Geocode
    try {
      const { resolvePlacePackOsmGoogle } = await import('./packPlaceResolve');
      const biasPack = geocodeOptsForQuery(nameHint);
      const packHit = await resolvePlacePackOsmGoogle({
        query: nameHint,
        cityHint: biasPack.cityHint,
        biasLat: biasPack.biasLat,
        biasLng: biasPack.biasLng,
      });
      if (
        packHit &&
        Number.isFinite(packHit.lat) &&
        Number.isFinite(packHit.lng)
      ) {
        const destName = packHit.label || nameHint;
        const blocked = await runGate({
          name: destName,
          lat: packHit.lat,
          lng: packHit.lng,
          poiId: -1,
        });
        if (blocked) return blocked;
        const ok = await startNavOrWeaveIntoTour({
          name: destName,
          lat: packHit.lat,
          lng: packHit.lng,
          poiId: -1,
          offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
        });
        const stopped = fromWeave(ok, destName, 'geocode', -1);
        if (keepNavResult(stopped)) {
          if (stopped.ok) {
            void recordNavSearch(destName);
            rememberDestination({
              name: destName,
              lat: packHit.lat,
              lng: packHit.lng,
              source: 'search',
              searchQuery: nameHint,
            });
          }
          return stopped;
        }
      }
    } catch {
      /* Pack optional — weiter Geocode */
    }

    // Online: immer Google Places (+ Main Entrance wenn möglich)
    const { resolveDestinationWithEntrance } = await import(
      './resolveEntranceCoords'
    );
    const bias = geocodeOptsForQuery(nameHint);
    const entrance = await resolveDestinationWithEntrance({
      name: nameHint,
      biasLat: bias?.biasLat,
      biasLng: bias?.biasLng,
    });
    if (entrance.via !== 'none' && entrance.lat && entrance.lng) {
      const destName = entrance.name || nameHint;
      const blocked = await runGate({
        name: destName,
        lat: entrance.lat,
        lng: entrance.lng,
        poiId: -1,
      });
      if (blocked) return blocked;
      const ok = await startNavOrWeaveIntoTour({
        name: destName,
        lat: entrance.lat,
        lng: entrance.lng,
        poiId: -1,
        offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
      });
      const stopped = fromWeave(ok, destName, 'geocode', -1);
      if (stopped) {
        if (stopped.ok) {
          void recordNavSearch(destName);
          rememberDestination({
            name: destName,
            lat: entrance.lat,
            lng: entrance.lng,
            source: 'search',
            searchQuery: nameHint,
          });
          if (__DEV__) {
            console.log(
              '[nav] entrance resolve',
              entrance.via,
              entrance.usedEntrance ? 'main_entrance' : 'place',
            );
          }
        }
        return stopped;
      }
    }

    if (!addressMode) {
      try {
        const { geocodeNamedPlaceHits } = await import('./googleMapsNav');
        const {
          analyzePlaceCityHits,
        } = await import('./placeCityDisambiguate');
        const hits = await geocodeNamedPlaceHits(nameHint);
        const analysis = analyzePlaceCityHits(rawQuery || nameHint, hits);
        if (analysis.kind === 'choice') {
          return parkAmbiguousPlaceChoice(analysis.place, analysis.options);
        }
        if (analysis.kind === 'one') {
          const pick = analysis.pick;
          const destName = pick.label || nameHint;
          const blocked = await runGate({
            name: destName,
            lat: pick.lat,
            lng: pick.lng,
            poiId: -1,
          });
          if (blocked) return blocked;
          const ok = await startNavOrWeaveIntoTour({
            name: destName,
            lat: pick.lat,
            lng: pick.lng,
            poiId: -1,
            offlineOnly: opts?.offlineOnly,
            skipDestVerify: opts?.skipDestVerify,
            userQuery: rawQuery,
          });
          const stopped = fromWeave(ok, destName, 'geocode', -1);
          if (keepNavResult(stopped)) {
            if (stopped.ok) {
              void recordNavSearch(destName);
              rememberDestination({
                name: destName,
                lat: pick.lat,
                lng: pick.lng,
                source: 'geocode',
                searchQuery: nameHint,
              });
            }
            return stopped;
          }
        }
      } catch {
        /* weiter einzelne Geocode */
      }
    }

    const geo = await geocodePlaceNameOsmFirst(nameHint, geocodeOptsForQuery(nameHint));
    if (geo) {
      const destName = geo.label || nameHint;
      const blocked = await runGate({
        name: destName,
        lat: geo.lat,
        lng: geo.lng,
        poiId: -1,
      });
      if (blocked) return blocked;
      const ok = await startNavOrWeaveIntoTour({
        name: destName,
        lat: geo.lat,
        lng: geo.lng,
        poiId: -1,
        offlineOnly: opts?.offlineOnly,
      skipDestVerify: opts?.skipDestVerify,
          userQuery: rawQuery,
      });
      const stopped = fromWeave(ok, destName, 'geocode', -1);
      if (stopped) {
        if (stopped.ok) {
          void recordNavSearch(destName);
          rememberDestination({
            name: destName,
            lat: geo.lat,
            lng: geo.lng,
            source: 'geocode',
            searchQuery: nameHint,
          });
          if (!hasActiveTourQueue()) {
            useFinnusStore.getState().setPendingNavOffer({
              poiId: -1,
              name: geo.label || nameHint,
              lat: geo.lat,
              lng: geo.lng,
            });
          }
        }
        return stopped;
      }
    }
  }

  return {
    ok: false,
    poiId: null,
    name: nameHint || 'Ziel',
    via: 'none',
    message:
      'Dazu finde ich gerade keinen Ort für die Navigation. Sag den Namen nochmal oder prüfe, ob Google Maps in den Keys aktiv ist.',
  };
}

export async function startNavigationFromOffer(
  offer: PendingNavOffer,
): Promise<NavStartResult> {
  try {
    const st = useFinnusStore.getState();
    if (st.pendingNavOffer?.awaitConfirm) {
      st.setPendingNavOffer({
        poiId: offer.poiId,
        name: offer.name,
        lat: offer.lat,
        lng: offer.lng,
        awaitConfirm: false,
      });
    }
  } catch {
    /* soft */
  }
  return resolveAndStartNavigation(
    {
      poiId: offer.poiId >= 0 ? offer.poiId : undefined,
      name: offer.name,
      lat: offer.lat,
      lng: offer.lng,
    },
    { skipDestVerify: true, skipClosingGate: true },
  );
}

/**
 * Validiert/repariert START_NAVIGATION-Actions und setzt pendingNavOffer.
 * Unbekannte Orte → Geocode + Koordinaten im Payload.
 */
export async function normalizeNavActionsAndOffer(opts: {
  actions: Array<{
    type: string;
    label: string;
    payload: {
      targetPoiId?: string | number;
      destLat?: number;
      destLng?: number;
      destName?: string;
    };
  }>;
  fallbackOffer?: PendingNavOffer | null;
}): Promise<{
  actions: typeof opts.actions;
  offer: PendingNavOffer | null;
}> {
  const out = [];
  let offer: PendingNavOffer | null = opts.fallbackOffer ?? null;

  for (const a of opts.actions) {
    if (a.type !== 'START_NAVIGATION') {
      out.push(a);
      continue;
    }

    const labelName = cleanName(
      a.payload.destName || a.label.replace(/^📍\s*/u, ''),
    );
    let existingId = await resolveExistingPoiId(a.payload.targetPoiId);

    // Ortskern / Stadtname → konkretes Highlight
    if (isVagueAreaDestination(labelName) && existingId == null) {
      const concrete = await resolveConcreteSightTarget();
      if (concrete) {
        out.push({
          ...a,
          label: `📍 Route: ${concrete.name}`,
          payload: {
            ...a.payload,
            targetPoiId: concrete.poiId,
            destName: concrete.name,
            destLat: concrete.lat,
            destLng: concrete.lng,
          },
        });
        offer = {
          poiId: concrete.poiId,
          name: concrete.name,
          lat: concrete.lat,
          lng: concrete.lng,
        };
        continue;
      }
    }

    if (existingId != null) {
      const poi = await getPoiWithFacts(existingId);
      const name = cleanName(poi?.name) || labelName || 'Ziel';
      const fixed = {
        ...a,
        label: `📍 Route: ${name}`,
        payload: {
          ...a.payload,
          targetPoiId: existingId,
          destName: name,
          destLat: poi?.lat,
          destLng: poi?.lng,
        },
      };
      out.push(fixed);
      // Action is SSOT — always prefer resolved START_NAVIGATION over discovery fallback
      offer = {
        poiId: existingId,
        name,
        lat: poi?.lat,
        lng: poi?.lng,
      };
      continue;
    }

    // Ungültige ID → Koordinaten oder Geocode
    let lat = a.payload.destLat;
    let lng = a.payload.destLng;
    let name = labelName;

    if (
      (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) &&
      name.length >= 2
    ) {
      const geo = await geocodePlaceNameOsmFirst(name, geocodeOptsForQuery(name));
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        name = geo.label || name;
      }
    }

    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    ) {
      const fixed = {
        ...a,
        label: `📍 Route: ${name || 'Ziel'}`,
        payload: {
          ...a.payload,
          targetPoiId: -1,
          destName: name || 'Ziel',
          destLat: lat,
          destLng: lng,
        },
      };
      out.push(fixed);
      offer = { poiId: -1, name: name || 'Ziel', lat, lng };
      continue;
    }

    // Lokal per Name suchen (nie bei Straße+Hausnummer)
    if (name.length >= 2 && !looksLikeStreetAddress(name)) {
      const pois = await getAllPois();
      const lower = name.toLowerCase();
      const hit = pois.find((p) =>
        p.name.toLowerCase().includes(lower.slice(0, 24)),
      );
      if (hit) {
        out.push({
          ...a,
          label: `📍 Route: ${cleanName(hit.name)}`,
          payload: {
            targetPoiId: hit.id,
            destName: cleanName(hit.name),
            destLat: hit.lat,
            destLng: hit.lng,
          },
        });
        offer = {
          poiId: hit.id,
          name: cleanName(hit.name),
          lat: hit.lat,
          lng: hit.lng,
        };
        continue;
      }
    }

    // Action droppen wenn nichts auflösbar — sonst „kein Ort“
    console.warn('[nav] Dropping unresolved START_NAVIGATION', a.label);
  }

  // Fallback-Offer aus Kontext, wenn Gemini nichts Brauchbares hatte
  if (!offer && opts.fallbackOffer) {
    offer = opts.fallbackOffer;
    const exists = out.some((a) => a.type === 'START_NAVIGATION');
    if (!exists) {
      out.unshift({
        type: 'START_NAVIGATION',
        label: `📍 Route: ${opts.fallbackOffer.name}`,
        payload: {
          targetPoiId: opts.fallbackOffer.poiId,
          destName: opts.fallbackOffer.name,
          destLat: opts.fallbackOffer.lat,
          destLng: opts.fallbackOffer.lng,
        },
      });
    }
  }

  if (offer) {
    if (
      typeof offer.lat === 'number' &&
      typeof offer.lng === 'number' &&
      Number.isFinite(offer.lat) &&
      Number.isFinite(offer.lng)
    ) {
      rememberDestination({
        name: offer.name,
        lat: offer.lat,
        lng: offer.lng,
        poiId: offer.poiId >= 0 ? offer.poiId : null,
        source: 'offer',
        searchQuery: offer.name,
      });
    }
    useFinnusStore.getState().setPendingNavOffer(offer);
  }

  return { actions: out, offer };
}
