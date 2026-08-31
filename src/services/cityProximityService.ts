/**
 * Stadt-Fokus & Wechsel:
 * - Kaltstart (JS-Prozess neu): GPS-Stadt vs. Auswahl → Prompt nur bei anderer Stadt.
 * - Dataset-Wechsel im Lauf: wenn physisch in einer anderen Katalog-Stadt → Prompt (Pack).
 * - Soft-Stadt: GPS-Ort ohne Pack → Auswahl-Karte, Speech folgt dem Ort.
 * - Speech-Fokus: außerhalb ~20 km der Pack-Stadt keine Pack-Stories/Vorschläge mehr
 *   (intern), auch bevor der Datensatz gewechselt ist.
 */

import {
  loadCityCatalog,
  installCityPack,
  type CityCatalogItem,
} from './cityCatalogService';
import { getCachedUserProfile, saveUserProfile } from './userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import { speakCityWelcomeForCity } from './cityWelcomeService';
import {
  CITY_FOCUS_RADIUS_KM,
  haversineKm,
  isSoftCityId,
  resolveLocalityAt,
  setSoftWorkingCity,
  slugifySoftCityId,
  updatePackSpeechFocus,
  warmSoftWorkingCity,
} from './softWorkingCity';
import {
  CITY_SWITCH_PROMPT_COOLDOWN_MS,
  IN_CITY_KM,
  decideSessionOpenCitySwitch,
  isSameCity,
  pickSelectedCityKm,
  shouldHoldCitySwitchPrompt,
} from './cityProximityDecision';
import * as FileSystem from 'expo-file-system';

const SWITCH_GAP_KM = 5;
const CHECK_INTERVAL_MS = 5 * 60_000;
const MIN_MOVE_KM = 0.8;
/** Soft-/Katalog-Ort nur vorschlagen wenn näher als so. */
const DETECT_MAX_KM = 35;
/** Andere Stadt muss klar näher sein (nicht Prisdorf→Prisdorf). */
const MIN_CLOSER_GAP_KM = 3;
/** Soft-Pin am User (< 2 km) ohne Orts-Match → kein echtes Stadtzentrum. */
const GLUED_SOFT_MAX_KM = 2;
const PROMPT_MEM_PATH = `${FileSystem.documentDirectory}findus-city-switch-prompt.json`;

export type CitySwitchResult = {
  cityId: string;
  cityName: string;
  soft?: boolean;
};

export type CityProximityHandlers = {
  onCitySwitched: (result: CitySwitchResult) => void | Promise<void>;
};

export type CitySwitchPromptPayload = {
  nearest: CityCatalogItem;
  selected: CityCatalogItem;
  nearestKm: number;
  selectedKm: number;
  gapKm: number;
  /** Kein Pack — Soft-Stadt aus GPS */
  softTarget?: boolean;
  /** research = Datensatz für Plan/Recherche, nicht GPS-Nähe */
  reason?: 'gps' | 'research';
};

export type CitySwitchDecision = 'accept' | 'dismiss';

type CitySwitchPresenter = (
  payload: CitySwitchPromptPayload,
) => Promise<CitySwitchDecision>;

let handlers: CityProximityHandlers | null = null;
let presenter: CitySwitchPresenter | null = null;
let settledListener: (() => void) | null = null;
let abortHook: ((decision: CitySwitchDecision) => void) | null = null;
let catalogCache: CityCatalogItem[] | null = null;
let catalogFetchedAt = 0;
let lastCheckAt = 0;
let lastCheckLat: number | null = null;
let lastCheckLng: number | null = null;
let promptOpen = false;
/** Blocks overlapping GPS checks before presenter sets promptOpen. */
let checkInFlight = false;
/** True until the first conclusive GPS-Stadtcheck after JS-Start (nicht AppState-Resume). */
let sessionOpenPending = true;
const SESSION_OPEN_GPS_DELAY_MS = 6_000;
const sessionOpenReadyAtMs = Date.now() + SESSION_OPEN_GPS_DELAY_MS;
let coldStartWelcomeSpoken = false;
let lastDismissedCityId: string | null = null;
let lastDismissedAt = 0;
let lastPromptAt = 0;
let lastPromptCityId: string | null = null;
let promptMemHydrated = false;

const CATALOG_TTL_MS = 10 * 60_000;
const DISMISS_COOLDOWN_MS = CITY_SWITCH_PROMPT_COOLDOWN_MS;

async function hydratePromptMem(): Promise<void> {
  if (promptMemHydrated) return;
  promptMemHydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PROMPT_MEM_PATH);
    if (!info.exists) return;
    const raw = JSON.parse(
      await FileSystem.readAsStringAsync(PROMPT_MEM_PATH),
    ) as { lastPromptAt?: number; lastPromptCityId?: string | null };
    if (typeof raw.lastPromptAt === 'number' && raw.lastPromptAt > 0) {
      lastPromptAt = raw.lastPromptAt;
    }
    if (typeof raw.lastPromptCityId === 'string' && raw.lastPromptCityId) {
      lastPromptCityId = raw.lastPromptCityId;
    }
  } catch {
    /* erster Lauf */
  }
}

function rememberCitySwitchPrompt(cityId: string): void {
  lastPromptAt = Date.now();
  lastPromptCityId = cityId;
  void FileSystem.writeAsStringAsync(
    PROMPT_MEM_PATH,
    JSON.stringify({ lastPromptAt, lastPromptCityId }),
  ).catch(() => undefined);
}

/** Manueller Stadtwechsel (Settings/Recherche) — GPS-Prompt 1 h pausieren. */
export function noteManualCityFocus(cityId: string): void {
  rememberCitySwitchPrompt(cityId || 'manual');
  lastDismissedCityId = null;
  lastDismissedAt = 0;
}

export function registerCityProximityHandlers(h: CityProximityHandlers | null): void {
  handlers = h;
}

export function registerCitySwitchPresenter(
  p: CitySwitchPresenter | null,
): void {
  presenter = p;
}

/** UI schließt den Busy-State, wenn Wechsel/Dismiss durch ist. */
export function registerCitySwitchSettledListener(
  fn: (() => void) | null,
): void {
  settledListener = fn;
}

export function registerCitySwitchAbort(
  fn: ((decision: CitySwitchDecision) => void) | null,
): void {
  abortHook = fn;
}

/** Popup schließen (Voice/Chip hat schon entschieden). */
export function abortCitySwitchPrompt(
  decision: CitySwitchDecision = 'dismiss',
): void {
  try {
    abortHook?.(decision);
  } catch {
    /* soft */
  }
}

/**
 * Pack-Wechsel-Karte für Recherche (nicht GPS).
 * Soft (kein Pack): nie Popup — still akzeptieren (Caller setzt Arbeitsstadt).
 * Amenity-Müll („Mit Pool“): dismiss.
 * null = kein Presenter / anderes Prompt offen — Caller wartet nur auf Voice/Chips.
 */
export async function presentCityPackSwitchCard(input: {
  target: CityCatalogItem;
  activeId?: string | null;
  activeName: string;
  /** Unbekannte Zielstadt / kein Pack */
  softTarget?: boolean;
}): Promise<CitySwitchDecision | null> {
  const soft =
    Boolean(input.softTarget) || isSoftCityId(input.target.id);
  try {
    const { isPlausibleSoftCityName } = await import('./softCityName');
    if (!isPlausibleSoftCityName(input.target.name)) {
      return 'dismiss';
    }
  } catch {
    /* soft */
  }
  // Soft-Recherche: still im Hintergrund — kein Popup.
  if (soft) return 'accept';

  if (!presenter || promptOpen) return null;
  const selected = emptyCatalogItem({
    id: (input.activeId || 'active').trim() || 'active',
    name: input.activeName.trim() || 'deiner Stadt',
  });
  promptOpen = true;
  rememberCitySwitchPrompt(input.target.id);
  try {
    return await presenter({
      nearest: input.target,
      selected,
      nearestKm: 0,
      selectedKm: 0,
      gapKm: 0,
      reason: 'research',
      softTarget: false,
    });
  } finally {
    promptOpen = false;
    settledListener?.();
  }
}

async function getCatalog(): Promise<CityCatalogItem[]> {
  const now = Date.now();
  if (catalogCache && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const catalog = await loadCityCatalog(null);
  catalogCache = catalog;
  catalogFetchedAt = now;
  return catalog;
}

function emptyCatalogItem(
  partial: Pick<CityCatalogItem, 'id' | 'name'> &
    Partial<Pick<CityCatalogItem, 'lat' | 'lng' | 'coverUrl' | 'distanceKm'>>,
): CityCatalogItem {
  return {
    id: partial.id,
    name: partial.name,
    lat: partial.lat,
    lng: partial.lng,
    coverUrl: partial.coverUrl ?? null,
    distanceKm: partial.distanceKm ?? null,
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

async function applyCitySwitch(
  city: CityCatalogItem,
  opts?: { soft?: boolean },
): Promise<void> {
  const soft = Boolean(opts?.soft || isSoftCityId(city.id));

  await setSoftWorkingCity({
    id: soft ? slugifySoftCityId(city.name) : city.id,
    name: city.name,
    lat: typeof city.lat === 'number' ? city.lat : null,
    lng: typeof city.lng === 'number' ? city.lng : null,
    soft,
    source: soft ? 'gps_soft' : 'catalog',
  });

  const result: CitySwitchResult = {
    cityId: soft ? slugifySoftCityId(city.name) : city.id,
    cityName: city.name,
    soft,
  };
  void Promise.resolve(handlers?.onCitySwitched(result)).catch(() => undefined);

  noteManualCityFocus(result.cityId);

  if (soft) return;

  void installCityPack(city.id, { checkRemote: true, reason: 'switch' }).catch((err) => {
    console.warn('[cityProximity] pack install failed, soft fallback:', err);
    void setSoftWorkingCity({
      id: slugifySoftCityId(city.name),
      name: city.name,
      lat: typeof city.lat === 'number' ? city.lat : null,
      lng: typeof city.lng === 'number' ? city.lng : null,
      soft: true,
      source: 'gps_soft',
    });
  });
  void speakCityWelcomeForCity(city, { preferSwitch: true }).catch(() => undefined);
  coldStartWelcomeSpoken = true;
}

/** Pack aktivieren ohne Welcome-Speech — Plan/Recherche läuft weiter. */
export async function notifyCityPackActivated(city: {
  id: string;
  name: string;
  lat?: number | null;
  lng?: number | null;
  soft?: boolean;
}): Promise<void> {
  noteManualCityFocus(city.id);
  const soft = Boolean(city.soft || isSoftCityId(city.id));
  await setSoftWorkingCity({
    id: city.id,
    name: city.name,
    lat: city.lat ?? null,
    lng: city.lng ?? null,
    soft,
    source: soft ? 'manual' : 'catalog',
  });
  const result: CitySwitchResult = {
    cityId: city.id,
    cityName: city.name,
    soft,
  };
  await Promise.resolve(handlers?.onCitySwitched(result)).catch(() => undefined);
}

function shouldThrottle(lat: number, lng: number): boolean {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) {
    if (lastCheckLat != null && lastCheckLng != null) {
      const moved = haversineKm(lastCheckLat, lastCheckLng, lat, lng);
      if (moved < MIN_MOVE_KM) return true;
    } else {
      return true;
    }
  }
  return false;
}

async function lockFocusToSelected(opts: {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  soft: boolean;
}): Promise<void> {
  await setSoftWorkingCity({
    id: opts.id,
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    soft: opts.soft,
    source: opts.soft ? 'gps_soft' : 'pack_focus',
  });
}

function speakColdStartWelcomeIfNeeded(city: {
  id: string;
  name: string;
}): void {
  if (coldStartWelcomeSpoken) return;
  coldStartWelcomeSpoken = true;
  void speakCityWelcomeForCity(city).catch(() => undefined);
}

export function bootstrapColdStartCityCheck(): void {
  setTimeout(() => {
    const s = useFinnusStore.getState();
    if (s.lastGpsLat != null && s.lastGpsLng != null) {
      void checkCityProximity(s.lastGpsLat, s.lastGpsLng);
    }
  }, SESSION_OPEN_GPS_DELAY_MS + 200);
}

/**
 * Prüft GPS gegen Fokus-Radius (20 km) und Katalog.
 * Innerhalb Fokus → Stadt bleibt. Außerhalb → Wechsel/ Soft-Stadt anbieten.
 */
export async function checkCityProximity(lat: number, lng: number): Promise<void> {
  if (promptOpen || checkInFlight) return;
  if (useFinnusStore.getState().isSimulationMode) return;
  if (sessionOpenPending && Date.now() < sessionOpenReadyAtMs) return;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return;

  await hydratePromptMem();
  const promptHeld = shouldHoldCitySwitchPrompt({ lastPromptAtMs: lastPromptAt });

  if (!sessionOpenPending && shouldThrottle(lat, lng)) return;
  lastCheckAt = Date.now();
  lastCheckLat = lat;
  lastCheckLng = lng;
  checkInFlight = true;

  try {
  await warmSoftWorkingCity();
  const catalog = await getCatalog();

  const withDistance = catalog.map((item) => {
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number') {
      return { ...item, distanceKm: null as number | null };
    }
    return {
      ...item,
      distanceKm: haversineKm(lat, lng, item.lat, item.lng),
    };
  });

  const sorted = [...withDistance].sort((a, b) => {
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    return da - db;
  });

  const selectedFromCatalog = (() => {
    if (profile.cityId) {
      const byId = withDistance.find((c) => c.id === profile.cityId);
      if (byId) return byId;
    }
    if (profile.cityName) {
      return withDistance.find((c) =>
        isSameCity(
          { id: c.id, name: c.name },
          { id: profile.cityId, name: profile.cityName },
        ),
      );
    }
    return undefined;
  })();

  const softState = await warmSoftWorkingCity();

  const selectedName =
    selectedFromCatalog?.name || profile.cityName || profile.cityId || 'Aktuell';
  const selectedId =
    selectedFromCatalog?.id || profile.cityId || slugifySoftCityId(selectedName);

  const nearestCatalog = sorted[0];
  const locality = await resolveLocalityAt(lat, lng);

  let softKm: number | null = null;
  let softIsGluedAwayFromLocality = false;
  if (
    softState &&
    softState.lat != null &&
    softState.lng != null &&
    isSameCity(
      { id: softState.id, name: softState.name },
      { id: profile.cityId, name: profile.cityName },
    )
  ) {
    softKm = haversineKm(lat, lng, softState.lat, softState.lng);
    const softMatchesLocality = Boolean(
      locality &&
        isSameCity(
          { id: softState.id, name: softState.name },
          { name: locality.name },
        ),
    );
    softIsGluedAwayFromLocality =
      softKm <= GLUED_SOFT_MAX_KM && !softMatchesLocality;
  }

  let fallbackKm: number | null = null;
  if (selectedFromCatalog?.distanceKm == null) {
    try {
      const { cityCoordsFromName } = await import(
        './navigation/fuzzyCityResolve'
      );
      const packHit = cityCoordsFromName(selectedName);
      if (packHit) {
        fallbackKm = haversineKm(lat, lng, packHit.lat, packHit.lng);
      }
    } catch {
      /* soft */
    }
    if (fallbackKm == null) {
      try {
        const { findAirportByCityHint } = await import('./flights/airportIata');
        const ap = findAirportByCityHint(selectedName);
        if (ap && Number.isFinite(ap.lat) && Number.isFinite(ap.lng)) {
          fallbackKm = haversineKm(lat, lng, ap.lat, ap.lng);
        }
      } catch {
        /* soft */
      }
    }
  }

  const selectedKm = pickSelectedCityKm({
    catalogKm: selectedFromCatalog?.distanceKm ?? null,
    softKm,
    softIsGluedAwayFromLocality,
    fallbackKm,
  });

  const lockSelected = async () => {
    updatePackSpeechFocus({
      userLat: lat,
      userLng: lng,
      packLat: selectedFromCatalog?.lat ?? softState?.lat ?? null,
      packLng: selectedFromCatalog?.lng ?? softState?.lng ?? null,
    });
    await lockFocusToSelected({
      id: selectedId,
      name: selectedName,
      lat: selectedFromCatalog?.lat ?? softState?.lat ?? null,
      lng: selectedFromCatalog?.lng ?? softState?.lng ?? null,
      soft: isSoftCityId(selectedId),
    });
  };

  let target: CityCatalogItem | null = null;
  let softTarget = false;
  let bypassPromptGuards = false;

  if (sessionOpenPending) {
    if (!presenter) {
      return;
    }
    const nearestKm = nearestCatalog?.distanceKm ?? null;
    const localityKm = locality
      ? haversineKm(lat, lng, locality.lat, locality.lng)
      : null;
    const openDecision = decideSessionOpenCitySwitch({
      selected: { id: selectedId, name: selectedName },
      selectedKm,
      nearest:
        nearestCatalog && nearestKm != null
          ? { id: nearestCatalog.id, name: nearestCatalog.name, km: nearestKm }
          : null,
      locality: locality
        ? { name: locality.name, km: localityKm ?? 0 }
        : null,
    });
    if (openDecision.action === 'skip_same') {
      sessionOpenPending = false;
      await lockSelected();
      void speakColdStartWelcomeIfNeeded({
        id: selectedId,
        name: selectedName,
      });
      return;
    }
    if (openDecision.action === 'prompt') {
      if (promptHeld) {
        sessionOpenPending = false;
        await lockSelected();
        void speakColdStartWelcomeIfNeeded({
          id: selectedId,
          name: selectedName,
        });
        return;
      }
      sessionOpenPending = false;
      bypassPromptGuards = true;
      if (openDecision.via === 'catalog' && nearestCatalog) {
        target = nearestCatalog;
        softTarget = false;
      } else if (locality) {
        const byName = withDistance.find((c) =>
          isSameCity({ id: c.id, name: c.name }, { name: locality.name }),
        );
        if (byName) {
          target = {
            ...byName,
            distanceKm: byName.distanceKm ?? localityKm,
          };
          softTarget = false;
        } else {
          target = emptyCatalogItem({
            id: slugifySoftCityId(locality.name),
            name: locality.name,
            lat: locality.lat,
            lng: locality.lng,
            distanceKm: localityKm,
          });
          softTarget = true;
          try {
            const { isPlausibleSoftCityName } = await import('./softCityName');
            if (!isPlausibleSoftCityName(locality.name)) {
              target = null;
              softTarget = false;
            }
          } catch {
            /* soft */
          }
        }
      }
    } else {
      sessionOpenPending = false;
    }
  }

  // Laufender Check: schon klar in der gewählten Stadt → kein Wechsel-Prompt
  if (!target && selectedKm != null && selectedKm <= IN_CITY_KM) {
    await lockSelected();
    return;
  }

  // Speech-Fokus: Pack-Stories nur im 20-km-Radius der Pack-Stadt
  updatePackSpeechFocus({
    userLat: lat,
    userLng: lng,
    packLat: selectedFromCatalog?.lat ?? softState?.lat ?? null,
    packLng: selectedFromCatalog?.lng ?? softState?.lng ?? null,
  });

  // Sofort Speech auf aktuellen Ort (auch vor Dataset-Accept)
  const packSpeechOk =
    selectedKm != null && selectedKm <= CITY_FOCUS_RADIUS_KM;
  if (!packSpeechOk && locality) {
    const samePack =
      profile.cityName &&
      locality.name.toLowerCase() === profile.cityName.toLowerCase();
    if (!samePack) {
      await setSoftWorkingCity({
        id: slugifySoftCityId(locality.name),
        name: locality.name,
        lat: locality.lat,
        lng: locality.lng,
        soft: true,
        source: 'gps_soft',
      });
      updatePackSpeechFocus({
        userLat: lat,
        userLng: lng,
        packLat: selectedFromCatalog?.lat ?? null,
        packLng: selectedFromCatalog?.lng ?? null,
      });
    }
  } else if (packSpeechOk) {
    await lockFocusToSelected({
      id: selectedId,
      name: selectedName,
      lat: selectedFromCatalog?.lat ?? null,
      lng: selectedFromCatalog?.lng ?? null,
      soft: isSoftCityId(selectedId),
    });
  }

  // ── Dataset-Wechsel wenn physisch in anderer Stadt ──────────────
  const profileCity = { id: profile.cityId, name: profile.cityName };
  if (!target) {
    if (
      nearestCatalog &&
      nearestCatalog.distanceKm != null &&
      nearestCatalog.distanceKm <= DETECT_MAX_KM &&
      !isSameCity(nearestCatalog, profileCity)
    ) {
      const inNewCity = nearestCatalog.distanceKm <= IN_CITY_KM;
      // Ohne bekannte Distanz zur aktuellen Stadt: KEIN Fake-Gap → sonst Spam
      const gap =
        selectedKm != null
          ? selectedKm - nearestCatalog.distanceKm
          : null;
      const clearlyCloser =
        gap != null && gap >= Math.max(SWITCH_GAP_KM, MIN_CLOSER_GAP_KM);
      const leftOldCity =
        selectedKm != null && selectedKm > CITY_FOCUS_RADIUS_KM && inNewCity;
      if (clearlyCloser || leftOldCity) {
        target = nearestCatalog;
        softTarget = false;
      }
    }

    // Soft / byName: same closer-gap as catalog — no spam without clearlyCloser/leftOldCity
    const softClearlyCloserOrLeft = (candidateKm: number | null): boolean => {
      if (selectedKm == null || candidateKm == null) return false;
      const gap = selectedKm - candidateKm;
      const clearlyCloser =
        gap >= Math.max(SWITCH_GAP_KM, MIN_CLOSER_GAP_KM);
      const leftOldCity =
        selectedKm > CITY_FOCUS_RADIUS_KM && candidateKm <= IN_CITY_KM;
      return clearlyCloser || leftOldCity;
    };

    // Kein sinnvoller Katalog-Treffer → Soft aus Reverse-Geocode (Wedel etc.)
    if (!target && locality) {
      const softId = slugifySoftCityId(locality.name);
      const sameAsProfile = isSameCity(
        { id: softId, name: locality.name },
        profileCity,
      );
      if (!sameAsProfile) {
        // Katalog-Match per Name?
        const byName = withDistance.find((c) =>
          isSameCity(
            { id: c.id, name: c.name },
            { id: softId, name: locality.name },
          ),
        );
        if (byName && !isSameCity(byName, profileCity)) {
          const candKm =
            byName.distanceKm ??
            haversineKm(lat, lng, locality.lat, locality.lng);
          if (softClearlyCloserOrLeft(candKm)) {
            target = {
              ...byName,
              distanceKm: candKm,
            };
            softTarget = false;
          }
        } else if (byName && isSameCity(byName, profileCity)) {
          // Soft-Geocode = Profil-Stadt → kein Prompt
          await lockFocusToSelected({
            id: byName.id,
            name: byName.name,
            lat: typeof byName.lat === 'number' ? byName.lat : locality.lat,
            lng: typeof byName.lng === 'number' ? byName.lng : locality.lng,
            soft: false,
          });
          return;
        } else {
          const softKm = haversineKm(lat, lng, locality.lat, locality.lng);
          if (softClearlyCloserOrLeft(softKm)) {
            let okSoft = true;
            try {
              const { isPlausibleSoftCityName } = await import('./softCityName');
              okSoft = isPlausibleSoftCityName(locality.name);
            } catch {
              okSoft = true;
            }
            if (okSoft) {
              target = emptyCatalogItem({
                id: softId,
                name: locality.name,
                lat: locality.lat,
                lng: locality.lng,
                distanceKm: softKm,
              });
              softTarget = true;
            }
          }
        }
      } else if (sameAsProfile) {
        // Schon diese Soft-Stadt — Arbeitsstadt syncen, kein Prompt
        await lockFocusToSelected({
          id: softId,
          name: locality.name,
          lat: locality.lat,
          lng: locality.lng,
          soft: true,
        });
        // Profil-Stadtname sync (ohne Prefs)
        if (profile.cityName !== locality.name || profile.cityId !== softId) {
          try {
            await saveUserProfile({
              ...profile,
              cityId: softId,
              cityName: locality.name,
            });
          } catch {
            /* soft */
          }
        }
        return;
      }
    }
  }

  // Nie dieselbe Stadt vorschlagen (Name/ID)
  if (
    target &&
    isSameCity(target, { id: selectedId, name: selectedName })
  ) {
    return;
  }

  // Ein Prompt, nächster erst nach 1 h — alle Städte, auch nach App-Neustart
  if (target && promptHeld) {
    return;
  }

  if (!target) {
    // Außerhalb Pack-Fokus: Speech-Stadt = GPS-Ort (ohne Prompt-Spam)
    if (!packSpeechOk && locality) {
      await setSoftWorkingCity({
        id: slugifySoftCityId(locality.name),
        name: locality.name,
        lat: locality.lat,
        lng: locality.lng,
        soft: true,
        source: 'gps_soft',
      });
    }
    return;
  }

  const targetIsSoft = softTarget || isSoftCityId(target.id);

  // Soft-GPS / Soft-Session: still Arbeitsstadt — nie „Stadt erkannt“-Popup.
  if (targetIsSoft) {
    try {
      const { isPlausibleSoftCityName } = await import('./softCityName');
      if (!isPlausibleSoftCityName(target.name)) {
        return;
      }
    } catch {
      /* soft */
    }
    // Innerhalb Pack-Fokus: Soft nicht erzwingen (Pack-Speech behalten)
    if (!bypassPromptGuards && packSpeechOk) {
      return;
    }
    rememberCitySwitchPrompt(target.id);
    await applyCitySwitch(target, { soft: true });
    return;
  }

  // Innerhalb Pack-Fokus und Target ist Soft-Ort → kein Prompt, Pack-Speech behalten
  // (Katalog-Pfad unten; Soft schon oben erledigt)

  if (
    !bypassPromptGuards &&
    lastDismissedCityId === target.id &&
    Date.now() - lastDismissedAt < DISMISS_COOLDOWN_MS
  ) {
    // Auch bei Dismiss: Research auf GPS-Ort, nicht alte Pack-Stadt
    if (locality) {
      try {
        const { isPlausibleSoftCityName } = await import('./softCityName');
        if (!isPlausibleSoftCityName(locality.name)) return;
      } catch {
        /* soft */
      }
      await setSoftWorkingCity({
        id: slugifySoftCityId(locality.name),
        name: locality.name,
        lat: locality.lat,
        lng: locality.lng,
        soft: true,
        source: 'gps_soft',
      });
    }
    return;
  }

  if (!presenter) {
    console.warn('[cityProximity] no UI presenter registered');
    // Ohne UI: Soft-Arbeitsstadt trotzdem setzen
    await setSoftWorkingCity({
      id: target.id,
      name: target.name,
      lat: typeof target.lat === 'number' ? target.lat : null,
      lng: typeof target.lng === 'number' ? target.lng : null,
      soft: false,
      source: 'catalog',
    });
    return;
  }

  const selectedItem =
    selectedFromCatalog ??
    emptyCatalogItem({
      id: selectedId,
      name: selectedName,
      distanceKm: selectedKm,
    });

  const nearestKm = target.distanceKm ?? 0;
  const selKm = selectedKm ?? nearestKm + CITY_FOCUS_RADIUS_KM;
  const gap = Math.max(0, selKm - nearestKm);

  promptOpen = true;
  rememberCitySwitchPrompt(target.id);
  try {
    // Nur echte Katalog-Packs → Wechsel-Karte (kein Soft)
    const decision = await presenter({
      nearest: target,
      selected: selectedItem,
      nearestKm,
      selectedKm: selKm,
      gapKm: gap,
      softTarget: false,
    });

    if (decision === 'accept') {
      promptOpen = false;
      void applyCitySwitch(target, { soft: false }).catch((err) => {
        console.warn('[cityProximity] switch failed:', err);
      });
    } else {
      lastDismissedCityId = target.id;
      lastDismissedAt = Date.now();
      rememberCitySwitchPrompt(target.id);
      speakColdStartWelcomeIfNeeded({
        id: selectedId,
        name: selectedName,
      });
      // Bleiben = gewählte Stadt behalten. GPS-Ort nicht still als Arbeitsstadt setzen.
    }
  } finally {
    promptOpen = false;
    settledListener?.();
  }
  } finally {
    checkInFlight = false;
  }
}
