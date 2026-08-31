/**
 * Permanente Homescreen Presence-Karte (MapLibre Native).
 * Offline: Stadt-Extract (*.map.json) als ShapeSources — keine WebView, keine HTTP-Kacheln.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, InteractionManager, StyleSheet, View } from 'react-native';
import type { Poi } from '../../db/types';
import { parsePolygonJson, isAxisAlignedBoxPolygon } from '../../services/geo/polygon';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import { colors } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import { useGpsStore } from '../../store/useGpsStore';
import {
  selectNavRouteLoading,
  useFinnusStore,
} from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../../services/userProfileService';
import { useUserProfileStore } from '../../store/useUserProfileStore';
import {
  computeCityExploreProgress,
} from '../../services/discovery/cityExploreProgress';
import {
  getWalkTrackSnapshot,
  loadWalkTrack,
  type WalkTrackPoint,
} from '../../services/discovery/walkTrackService';
import {
  resolveCityCoverageBoundsSync,
  hasRealCityBoundaryPolygon,
  pointInCityBounds,
  smallestCityIdContainingPoint,
  ensureHomeMapCityBoundaries,
  selectHomeMapCities,
  listKnownCityCoverageBounds,
  seedCatalogCityAnchors,
  isRegionPackCityId,
  estimateBoundsFromCenter,
  viewBoxFromCoverageBounds,
  ringForCityOverview,
} from '../../services/discovery/cityCoverageBounds';
import { getCurrentCoords, ensureHeadingWatch } from '../../services/locationService';
import {
  loadCityCatalog,
  peekCityIndexCache,
  listLocalCityDatasets,
  registerCoverageFromLocalPacks,
} from '../../services/cityCatalogService';
import { env } from '../../config/env';
import {
  applyCompassLockForCity,
  getMapDisplayHeadingDegSticky,
  needsCompassCalibration,
  restoreCompassLockForActiveCity,
  subscribeMapHeading,
} from '../../services/navigation/liveDeviceHeading';
import {
  resetNativeMapCompass,
} from '../../services/navigation/nativeMapCompass';
import { nextHudLockTap } from '../../services/homeMap/homeMapCompass';
import { shortestAngleDelta } from '../../services/navigation/bearing';
import {
  collectOpenPlanStops,
  plannedPoiIdSet,
} from '../../services/navigation/stampMapPlanMatch';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import {
  countsAsMapVisitedGreen,
  isCityExploreMapPoi,
  isPackStoryMapPoi,
  isModul1AutoTriggerMapPoi,
} from '../../services/navigation/stampMapModul1';
import {
  colorForHomeMapPoi,
  isHomePresenceMapPoi,
  isTouristDirectoryMapPoi,
} from '../../services/homeMap/homeMapPlaceTone';
import { shouldShowCarMobilityAmenityOnMap } from '../../services/homeMap/homeMapMobilityAmenity';
import { HOME_MAP_PLACE_COLORS } from '../../services/homeMap/homeMapStyle';
import {
  enabledHomeMapFilterSet,
  HOME_MAP_FILTER_IDS,
  poiPassesHomeMapFilter,
} from '../../services/homeMap/homeMapPlaceFilter';
import { useHomeMapUiStore } from '../../store/useHomeMapUiStore';
import {
  cityFullyVisibleInBounds,
  resolveHomeMapLod,
  resolveHomeMapLodStable,
  type HomeMapLodMode,
} from '../../services/homeMap/homeMapLod';
import { buildNavRouteMapPayload, navRoutePayloadSig } from '../../services/navigation/navRouteMapPayload';
import { useMapRouteStore } from '../../store/useMapRouteStore';
import {
  loadMapPinIndex,
  loadNeighborPinsInViewport,
  overlayPinId,
  peekMapPinIndex,
  type MapPin,
} from '../../services/homeMap/mapPinIndex';
import {
  collectTimelineCityPlanStops,
  cityIdsForPlanStop,
  resolveHomeMapCityTone,
} from '../../services/homeMap/homeMapCityTone';
import { colorsForHomeMapCityTone } from '../../services/homeMap/homeMapStyle';
import { enrichHomeMapFootprints } from '../../services/homeMap/enrichHomeMapFootprints';
import type { OsmFootprintRing } from '../../services/navigation/osmBuildingFootprint';
import { categoryLabelForPoi } from '../../services/homeMap/homeMapPlaceBullets';
import { exclusiveHomeMapPlaces } from '../../services/homeMap/exclusiveHomeMapPlaces';
import {
  isAlwaysOnMapAmenity,
  isKeepDotMapPoi,
  isMapShelterBuildingPoi,
  isNatureLandscapeNotPin,
  isStreetPointAmenity,
  placeMapIcon,
  homeMapIconLod,
  type HomeMapPlaceIcon,
} from '../../services/homeMap/homeMapPlaceType';
import {
  bindMapPlacePreview,
  enrichMapPlaceMapsIfListed,
  instantMapPlacePopup,
  MAP_DROP_PIN_ID,
  prefetchVisibleMapPlaces,
  prioritizeMapPlacePreview,
} from '../../services/homeMap/mapPlacePreview';
import { noteUiTap } from '../../services/diagnostics/interactionDelay';
import {
  hydrateDisplayExtract,
  peekCityMapExtract,
  peekDisplayExtract,
  rememberDisplayExtract,
  scheduleIdleCityMapExtract,
  ensureCityMapExtract,
  prefetchCityMapExtract,
  DISPLAY_BOOT_RADIUS_M,
  type CityMapExtract,
} from '../../services/homeMap/cityMapExtract';
import { useHomeOverlayStore } from '../../store/useHomeOverlayStore';
import { usePlanCalendarUiStore } from '../../module2/timeline/planCalendarUiStore';
import { useReisebueroStore } from '../../reisebuero/store';
import {
  hydrateCityDwellTracker,
  isCityMapGreen,
  isPlaceMapGreenByDwell,
  listCityMapGreenIds,
  noteCityDwellDelta,
  notePlaceDwellDelta,
} from '../../services/homeMap/cityDwellTracker';
import { isCityExplorePlaceSeen } from '../../services/discovery/cityExploreVisitMatch';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import {
  startMapSceneController,
  stopMapSceneController,
  onMapViewport,
  onMapGpsFog,
} from '../../services/homeMap/mapSceneController';
import { loadExtractForViewport, RECLIP_M, invalidateLocalMapIndex, peekLocalMapIds, resolveViewportCityIdForView, warmLocalMapIndex } from '../../services/homeMap/mapExtractLoader';
import {
  HOME_MAP_FOOTPRINTS_AFTER_MS,
  HOME_MAP_PLACES_AFTER_EXTRACT_MS,
  HOME_MAP_PLACES_REINJECT_MIN_M,
  HOME_MAP_PLACES_REINJECT_ZOOM,
  HOME_MAP_WARMUP_RINGS_AFTER_MS,
} from '../../services/homeMap/homeMapBootSchedule';
import {
  markHomeMapBoot,
  markHomeMapBootStart,
} from '../../services/homeMap/homeMapBootMetrics';
import { forceFogRecompute } from '../../services/homeMap/fogTrackEngine';
import {
  NativeHomeMapView,
  type NativeHomeMapHandle,
  type NativeMapCity,
  type NativeMapPlace,
} from './NativeHomeMapView';
import type { NavRouteMapPayload } from '../../services/navigation/navRouteMapPayload';
import { snapMapLongPress } from '../../services/homeMap/snapMapDrop';
import { CompassCalibrateModal } from './CompassCalibrateModal';
import { HomeMapExploreChip } from './HomeMapExploreChip';
import {
  seedMapCameraGps,
  persistLastMapGpsSoon,
} from '../../services/location/lastKnownMapGps';
import { noteSplashMapInteractive } from '../../services/homeMap/splashReadyGate';
import { getSmoothedSpeedMs } from '../../services/navigation/transportMode';
import {
  homeMapViewSpanM,
  capMapPlacesForView,
  placeCapForMapView,
  skipPlaceRingsForView,
  warmupSettleRingsM,
} from '../../services/homeMap/homeMapWarmupRings';

type Props = {
  hudHeight: number;
  bottomChrome: number;
  /** Concierge spricht → Karte abdunkeln, ohne Store in der Karte. */
  chromeDim?: boolean;
  /** Overlay offen → keine Place-Injects / Track-Polls (JS-Thread für Buttons frei). */
  paused?: boolean;
  /** Erklärung: Ort-Popup + Karte hinzoomen (Navigation / Webseite zeigen). */
  tourPlaceDemo?: boolean;
};

type PlacePayload = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  color: string;
  radiusM: number;
  ring: Array<[number, number]> | null;
  spotKey?: string | null;
  category: string;
  /** Kein OSM-Gebäude → nur Punkt */
  pointOnly?: boolean;
  /** 1 = Modul-1/Story — Labels + Kreis-Fallback */
  story?: number;
  /** Briefkasten/Halt: Punkt bleibt beim Street-Zoom sichtbar */
  keepDot?: boolean;
  /** OSM-Amenity: Bahnhof, Parkplatz, Briefkasten, … */
  icon?: HomeMapPlaceIcon;
  /** Immer Punkt, auch wenn später ein Ring nachkommt */
  amenityDot?: boolean;
  /** Cap darf diesen Pin nicht zugunsten ferner Stories droppen */
  keepPin?: boolean;
};

function ringFromPoi(
  poi: Poi,
  osmOverride?: OsmFootprintRing | null,
): Array<[number, number]> | null {
  if (osmOverride && osmOverride.length >= 3) {
    return osmOverride.map(([lat, lng]) => [lat, lng] as [number, number]);
  }
  const poly = parsePolygonJson(poi.polygon_json);
  if (!poly || poly.length < 3) return null;
  const lats = poly.map((p) => p.latitude);
  const lngs = poly.map((p) => p.longitude);
  const dLat = Math.max(...lats) - Math.min(...lats);
  const dLng = Math.max(...lngs) - Math.min(...lngs);
  const approxM = Math.hypot(dLat * 111_320, dLng * 111_320 * 0.6);
  if (approxM > 350 && poly.length <= 6) return null;
  const spanLatM = dLat * 111_320;
  const spanLngM = dLng * 111_320 * 0.6;
  const shortM = Math.min(spanLatM, spanLngM);
  const longM = Math.max(spanLatM, spanLngM);
  // Bahnsteige / Gleis-Hüllen: lang und schmal — nie als Orts-Fill.
  if (longM > 80 && shortM > 0 && longM / shortM >= 4) return null;
  // Nur Stadt-/Pack-Kästen verwerfen — rechteckige Häuser bleiben Fill.
  if (isAxisAlignedBoxPolygon(poly) && approxM > 90) return null;
  const tags = parseTagsJson(poi.tags_json);
  if (tags.includes('map_point') && isAxisAlignedBoxPolygon(poly)) return null;
  return poly.map((p) => [p.latitude, p.longitude] as [number, number]);
}

function slimRing(
  ring: Array<[number, number]> | null,
): Array<[number, number]> | null {
  if (!ring || ring.length < 3) return null;
  if (ring.length <= 28) return ring;
  const step = Math.max(1, Math.ceil(ring.length / 24));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const head = out[0];
  if (!head) return ring.slice(0, 28);
  if (last && (last[0] !== head[0] || last[1] !== head[1])) out.push(last);
  return out;
}

function viewBoxAroundGps(lat: number, lng: number) {
  return {
    south: lat - 0.012,
    north: lat + 0.012,
    west: lng - 0.018,
    east: lng + 0.018,
  };
}

function resolveFitBounds(cityId: string | null) {
  if (!cityId) return null;
  const known = resolveCityCoverageBoundsSync(cityId);
  if (known) return known;
  const hit = (peekCityIndexCache() ?? []).find(
    (c) => c.id.trim().toLowerCase() === cityId,
  );
  if (
    hit &&
    typeof hit.lat === 'number' &&
    Number.isFinite(hit.lat) &&
    typeof hit.lng === 'number' &&
    Number.isFinite(hit.lng)
  ) {
    return estimateBoundsFromCenter({
      cityId,
      name: hit.name,
      lat: hit.lat,
      lng: hit.lng,
      halfSpanDeg: 0.09,
    });
  }
  return null;
}

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng =
    (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

export const HomePresenceMap = React.memo(function HomePresenceMap({
  hudHeight,
  bottomChrome,
  chromeDim = false,
  paused = false,
  tourPlaceDemo = false,
}: Props) {
  const mapRef = useRef<NativeHomeMapHandle>(null);
  const readyRef = useRef(false);
  const followRef = useRef(false);
  const lodRef = useRef<HomeMapLodMode>('detail');
  const placesInjectedForCity = useRef<string | null>(null);
  const lastDwellAt = useRef(Date.now());
  const lastHereCityRef = useRef<string | null>(null);
  const osmFootprintsRef = useRef<Map<number, OsmFootprintRing>>(new Map());
  const enrichRunningRef = useRef(false);
  const lastGpsTapAt = useRef(0);
  const lastCompassTapAt = useRef(0);
  const ignoreUserPanUntil = useRef(0);
  const lastFollowGps = useRef<{ lat: number; lng: number } | null>(null);
  const didCameraLock = useRef(false);
  /** Boot-jumpTo nur 1× — Remount/onReady darf nicht erneut auf GPS ziehen. */
  const didBootJumpRef = useRef(false);
  const prevCityIdRef = useRef<string | null>(null);
  const viewRef = useRef<{
    south: number;
    west: number;
    north: number;
    east: number;
  } | null>(null);
  const overlayPinsRef = useRef(
    new Map<
      number,
      { name: string; cityId: string; lat: number; lng: number }
    >(),
  );
  const lastRouteJson = useRef('');
  const pendingNavFitRef = useRef(false);
  const placesInjectGen = useRef(0);
  const popupHoldRef = useRef(false);
  const ignorePlaceTapUntil = useRef(0);
  const lastPlacesSig = useRef('');
  const placesBootCommittedRef = useRef(false);
  const overlaysEnabledRef = useRef(false);
  const extractCityIdRef = useRef<string | null>(null);
  const extractClipCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const extractInjectGen = useRef(0);
  const heavyOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const placeRadiusRef = useRef(500);
  const warmupRingGen = useRef(0);
  const pendingRingDone = useRef<(() => void) | null>(null);
  const pendingFootprintM = useRef<number | null>(null);
  const viewportInjectTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const poisRef = useRef<Poi[]>([]);
  const injectPlacesOnlyRef = useRef<() => void>(() => undefined);
  const [mapExtractLocal, setMapExtract] = useState<CityMapExtract | null>(null);
  const mapExtractFromStore = useMapExtractStore((s) => s.extract);
  const mapExtract = mapExtractFromStore ?? mapExtractLocal;
  const [mapPlaces, setMapPlaces] = useState<NativeMapPlace[]>([]);
  const [mapCities, setMapCities] = useState<NativeMapCity[]>([]);
  const [mapRoute, setMapRoute] = useState<NavRouteMapPayload | null>(null);
  const [dropPin, setDropPin] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const pois = useFinnusStore((s) => s.pois);
  poisRef.current = pois;
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const mapFilters = useHomeMapUiStore((s) => s.filters);
  const navActive = useFinnusStore((s) => s.navActive);
  const navRouteLoading = useFinnusStore(selectNavRouteLoading);
  const navRouteRev = useFinnusStore((s) => s.navRouteRev);
  const multiStopTour = useFinnusStore((s) => s.multiStopTour);
  const pendingNavOffer = useFinnusStore((s) => s.pendingNavOffer);
  const gps0 = useGpsStore.getState();
  const gpsLatRef = useRef(gps0.lat);
  const gpsLngRef = useRef(gps0.lng);
  const navActiveRef = useRef(navActive);
  navActiveRef.current = navActive;
  const pausedRef = useRef(Boolean(paused));
  pausedRef.current = Boolean(paused);

  const headingRef = useRef<number | null>(getMapDisplayHeadingDegSticky());
  const headingFollowRef = useRef(false);
  const locationFollowRef = useRef(false);
  const [headingFollow, setHeadingFollow] = useState(false);
  const [locationFollow, setLocationFollow] = useState(false);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [walkTrack, setWalkTrack] = useState<WalkTrackPoint[]>([]);
  const walkTrackRef = useRef<WalkTrackPoint[]>([]);
  walkTrackRef.current = walkTrack;
  const tourPopupRef = useRef(false);
  const lastViewportWorkKey = useRef('');
  const userMapGestureRef = useRef(false);
  const extractDeferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingExtractCenter = useRef<{
    lat: number;
    lng: number;
    cityId?: string | null;
    force?: boolean;
    urgent?: boolean;
  } | null>(null);
  const placesInjectCenterRef = useRef<{ lat: number; lng: number; zoom: number } | null>(
    null,
  );

  useEffect(() => {
    markHomeMapBootStart();
    startMapSceneController();
    return () => stopMapSceneController();
  }, []);

  useEffect(() => {
    const syncPause = () => {
      /* native: Overlays frieren die Karte nicht */
    };
    syncPause();
    const unsub = [
      useHomeOverlayStore.subscribe(syncPause),
      usePlanCalendarUiStore.subscribe(syncPause),
      useHomeMapUiStore.subscribe((s, p) => {
        if (s.placePopup !== p.placePopup) syncPause();
      }),
      useReisebueroStore.subscribe(syncPause),
    ];
    return () => {
      for (const u of unsub) u();
    };
  }, []);

  useEffect(() => {
    const applyPopup = (open: boolean) => {
      const wasOpen = popupHoldRef.current;
      popupHoldRef.current = open;
      if (wasOpen && !open) {
        ignorePlaceTapUntil.current = Date.now() + 180;
      }
    };
    applyPopup(useHomeMapUiStore.getState().placePopup != null);
    return useHomeMapUiStore.subscribe((s) => {
      applyPopup(s.placePopup != null);
      if (!s.placePopup) {
        setDropPin(null);
      }
    });
  }, []);
  const [exploreLine, setExploreLine] = useState('0 % erkundet');
  /** Plan-Änderung → Stadtflächen (blau) neu färben */
  const [planTick, setPlanTick] = useState(0);
  const catalogCitiesRef = useRef<
    Array<{ id: string; name?: string; lat?: number | null; lng?: number | null }>
  >(peekCityIndexCache() ?? []);
  /** Lokal heruntergeladene Packs/Karten — immer auf der Rubbelkarte (auch offline). */
  const localOfflineCityIdsRef = useRef<string[]>([]);

  const storeProfile = useUserProfileStore((s) => s.profile);
  const profile = storeProfile ?? getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').toLowerCase() || null;
  const bounds = resolveCityCoverageBoundsSync(cityId);

  useEffect(() => {
    readyRef.current = false;
    overlaysEnabledRef.current = false;
    placeRadiusRef.current = 500;
    warmupRingGen.current += 1;
    placesInjectedForCity.current = null;
    lastPlacesSig.current = '';
    didCameraLock.current = false;
    headingFollowRef.current = false;
    locationFollowRef.current = false;
    extractCityIdRef.current = null;
    extractClipCenterRef.current = null;
    lastGpsTapAt.current = 0;
    lastCompassTapAt.current = 0;
    setHeadingFollow(false);
    setLocationFollow(false);
  }, []);

  useEffect(() => {
    lastPlacesSig.current = '';
    const prev = prevCityIdRef.current;
    prevCityIdRef.current = cityId;
    extractCityIdRef.current = null;
    extractClipCenterRef.current = null;
    extractInjectGen.current += 1;
    if (prev && cityId && prev !== cityId) {
      followRef.current = false;
      didCameraLock.current = true;
      headingFollowRef.current = false;
      locationFollowRef.current = false;
      lastGpsTapAt.current = 0;
      lastCompassTapAt.current = 0;
      setHeadingFollow(false);
      setLocationFollow(false);
    }
  }, [cityId]);

  useEffect(() => {
    void applyCompassLockForCity(cityId);
  }, [cityId]);

  // Display-Extract schon vor Map-Ready aus RAM/Disk — Straßen/Gebäude nicht erst nach Splash.
  useEffect(() => {
    const id = (cityId || env.cityId() || '').toLowerCase();
    if (!id) return;
    const seed = seedMapCameraGps();
    const lat =
      seed?.lat ??
      gpsLatRef.current ??
      (bounds != null ? (bounds.latMin + bounds.latMax) / 2 : null);
    const lng =
      seed?.lng ??
      gpsLngRef.current ??
      (bounds != null ? (bounds.lngMin + bounds.lngMax) / 2 : null);
    const mem = peekDisplayExtract(id);
    if (mem?.extract) {
      useMapExtractStore.getState().setExtract(id, mem.extract, {
        lat: mem.lat,
        lng: mem.lng,
      });
      extractCityIdRef.current = id;
      extractClipCenterRef.current = { lat: mem.lat, lng: mem.lng };
      return;
    }
    void (async () => {
      const snap = (await hydrateDisplayExtract(id)) ?? peekDisplayExtract(id);
      if (!snap?.extract) return;
      useMapExtractStore.getState().setExtract(id, snap.extract, {
        lat: snap.lat,
        lng: snap.lng,
      });
      extractCityIdRef.current = id;
      extractClipCenterRef.current = { lat: snap.lat, lng: snap.lng };
      if (lat != null && lng != null) {
        const drift = metersBetween(lat, lng, snap.lat, snap.lng);
        if (drift > 1_400) {
          void loadExtractForViewport(lat, lng);
        }
      }
    })();
  }, [bounds, cityId]);

  useEffect(() => {
    bindMapPlacePreview({
      getPoi: (id) => useFinnusStore.getState().pois.find((p) => p.id === id),
      getCityName: () => getCachedUserProfile()?.cityName ?? cityId ?? '',
      onUpdated: (place) => {
        const cur = useHomeMapUiStore.getState().placePopup;
        if (cur && cur.id === place.id) {
          useHomeMapUiStore.getState().setPlacePopup({ ...cur, ...place });
        }
      },
    });
  }, [cityId]);

  useEffect(() => {
    return () => {
      if (viewportInjectTimer.current) {
        clearTimeout(viewportInjectTimer.current);
      }
      if (heavyOverlayTimer.current) {
        clearTimeout(heavyOverlayTimer.current);
      }
    };
  }, []);

  const seedCam = seedMapCameraGps();
  const initialLat =
    seedCam?.lat ??
    (bounds != null ? (bounds.latMin + bounds.latMax) / 2 : 53.6769);
  const initialLng =
    seedCam?.lng ??
    (bounds != null ? (bounds.lngMin + bounds.lngMax) / 2 : 9.7633);
  const initialZoom = seedCam?.zoom ?? (seedCam ? 16 : 13);

  const buildPlacePayloads = useCallback((): PlacePayload[] => {
    const planned = plannedPoiIdSet(pois, collectOpenPlanStops());
    const enabled = enabledHomeMapFilterSet(mapFilters);
    const view = viewRef.current;
    const span = view ? homeMapViewSpanM(view) : 0;
    const skipRings = skipPlaceRingsForView(span);
    const cityScale = span >= 12_000;
    const out: PlacePayload[] = [];
    for (const poi of pois) {
      if (!isHomePresenceMapPoi(poi, profile)) continue;
      if (!shouldShowCarMobilityAmenityOnMap(poi, profile)) continue;
      if (isNatureLandscapeNotPin(poi)) continue;
      const story =
        isPackStoryMapPoi(poi) ||
        isCityExploreMapPoi(poi) ||
        isMapShelterBuildingPoi(poi);
      if (
        cityScale &&
        !story &&
        !isModul1AutoTriggerMapPoi(poi, profile) &&
        !isKeepDotMapPoi(poi) &&
        isTouristDirectoryMapPoi(poi)
      ) {
        continue;
      }
      const historyHit = isCityExplorePlaceSeen(poi, visitedHistory, {
        cityId,
        bounds,
      });
      const dwellGreen = isPlaceMapGreenByDwell(
        cityId,
        poi.spot_key || String(poi.id),
      );
      const visited =
        historyHit ||
        dwellGreen ||
        visitedHistory.some((v) =>
          countsAsMapVisitedGreen({
            keyFacts: v.keyFacts,
            poi,
            profile,
          }) &&
          (v.poiId === poi.id ||
            (v.name &&
              poi.name &&
              v.name.toLowerCase() === poi.name.toLowerCase())),
        );
      const isPlanned = planned.has(poi.id);
      const amenityDot = isStreetPointAmenity(poi);
      const keepDotForced = isKeepDotMapPoi(poi) && !story;
      if (
        !amenityDot &&
        !isAlwaysOnMapAmenity(poi) &&
        !poiPassesHomeMapFilter(poi, {
          visited,
          planned: isPlanned,
          profile,
          enabled,
        })
      ) {
        continue;
      }
      const ring = keepDotForced || skipRings
        ? null
        : ringFromPoi(poi, osmFootprintsRef.current.get(poi.id));
      const hasBuilding = !keepDotForced && !!(ring && ring.length >= 3);
      // Gebäudeumriss schlägt Icon-Punkt — Statusfarbe als Fläche.
      const keepDot = !hasBuilding;
      const wegweiserTarget =
        pendingNavOffer?.source === 'wegweiser' &&
        pendingNavOffer.awaitConfirm === true &&
        pendingNavOffer.poiId === poi.id;
      const icon = hasBuilding ? undefined : placeMapIcon(poi) ?? undefined;
      out.push({
        id: poi.id,
        name: poi.name,
        lat: Number(poi.lat),
        lng: Number(poi.lng),
        color: wegweiserTarget
          ? HOME_MAP_PLACE_COLORS.planned
          : colorForHomeMapPoi(poi, profile, visited, {
              planned: isPlanned,
              typeFilters: enabled,
            }),
        radiusM: Math.max(18, Math.min(80, poi.radius_meters || 30)),
        ring: keepDot ? null : slimRing(ring),
        spotKey: poi.spot_key,
        category: categoryLabelForPoi(poi),
        story: story ? 1 : 0,
        pointOnly: keepDot,
        keepDot,
        // Nur echte Punkt-Amenities (Briefkasten/Halt/…) — Stories behalten Fill.
        amenityDot: amenityDot || (!!icon && !hasBuilding && !story),
        // Cap: ÖPNV/Briefkasten zuerst — nicht jedes Restaurant killt Stories.
        keepPin: amenityDot,
        icon,
        iconLod: icon ? homeMapIconLod(icon, poi) : undefined,
      });
    }
    return exclusiveHomeMapPlaces(out);
  }, [bounds, cityId, mapFilters, pendingNavOffer, pois, profile, visitedHistory]);

  const injectPlacesOnly = useCallback(() => {
    if (!readyRef.current) return;
    if (popupHoldRef.current) return;
    const places = buildPlacePayloads().filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (!viewRef.current) {
      const la = gpsLatRef.current;
      const ln = gpsLngRef.current;
      if (la != null && ln != null) {
        viewRef.current = {
          south: la - 0.018,
          north: la + 0.018,
          west: ln - 0.028,
          east: ln + 0.028,
        };
      }
    }
    const allFiltersOn = HOME_MAP_FILTER_IDS.every((id) => mapFilters[id]);
    const fallback =
      places.length > 0 || !allFiltersOn
        ? places
        : pois
            .filter((p) => {
              const k = p.kind ?? 'legacy';
              if (k === 'approach' || k === 'sub') return false;
              return Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
            })
            .map((p) => ({
              id: p.id,
              name: p.name,
              lat: Number(p.lat),
              lng: Number(p.lng),
              color: colorForHomeMapPoi(p, profile, false),
              radiusM: 30,
              ring: null,
              spotKey: p.spot_key,
              category: categoryLabelForPoi(p),
              story: 1,
              pointOnly: true,
              keepDot: true,
            }));
    const storyN = fallback.filter((p) => p.story === 1).length;
    const view = viewRef.current;
    const radiusM = placeRadiusRef.current;
    const span = view ? homeMapViewSpanM(view) : 0;
    const skipRings = skipPlaceRingsForView(span);
    const cap = placeCapForMapView(radiusM, span);
    const originLat =
      view
        ? (view.south + view.north) / 2
        : gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
    const originLng =
      view
        ? (view.west + view.east) / 2
        : gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
    let visible = fallback;
    if (view) {
      const padLat = Math.max(0.006, (view.north - view.south) * 0.35);
      const padLng = Math.max(0.009, (view.east - view.west) * 0.35);
      visible = fallback.filter((p) => {
        const inView =
          p.lat >= view.south - padLat &&
          p.lat <= view.north + padLat &&
          p.lng >= view.west - padLng &&
          p.lng <= view.east + padLng;
        if (inView) return true;
        if (skipRings) return false;
        // Außerhalb: nur nah am Viewport-Zentrum (nicht GPS — sonst Heide ohne Orte).
        if (originLat == null || originLng == null) return false;
        return metersBetween(p.lat, p.lng, originLat, originLng) <= radiusM;
      });
      if (visible.length > cap) {
        visible = capMapPlacesForView(visible, cap, (p) =>
          originLat != null && originLng != null
            ? metersBetween(p.lat, p.lng, originLat, originLng)
            : 0,
        );
      }
    }
    const sig = visible
      .map((p) => `${p.id}:${p.color}:${p.story || 0}:${p.keepDot ? 1 : 0}`)
      .join('|');
    if (sig === lastPlacesSig.current) {
      if (visible.length > 0) markHomeMapBoot('places');
      prefetchVisibleMapPlaces(visible.map((p) => p.id));
      return;
    }
    lastPlacesSig.current = sig;
    const gen = ++placesInjectGen.current;
    overlayPinsRef.current.clear();
    placesBootCommittedRef.current = true;
    setMapPlaces(visible);
    if (visible.length > 0) markHomeMapBoot('places');
    if (
      !placesInjectCenterRef.current &&
      viewRef.current &&
      Number.isFinite(viewRef.current.south)
    ) {
      const midLat = (viewRef.current.south + viewRef.current.north) / 2;
      const midLng = (viewRef.current.west + viewRef.current.east) / 2;
      placesInjectCenterRef.current = { lat: midLat, lng: midLng, zoom: 16 };
    }
    prefetchVisibleMapPlaces(visible.map((p) => p.id));
    if (view && cityId && !skipRings) {
      const snap = view;
      void loadNeighborPinsInViewport({
        view: snap,
        activeCityId: cityId,
        bufferFactor: 0.35,
      }).then((extra) => {
        if (gen !== placesInjectGen.current || popupHoldRef.current) return;
        if (extra.length === 0) return;
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          if (gen !== placesInjectGen.current || popupHoldRef.current) return;
          const merged = [...visible];
          for (const p of extra) {
            const dup = visible.some(
              (v) => metersBetween(v.lat, v.lng, p.lat, p.lng) < 45,
            );
            if (dup) continue;
            const oid = overlayPinId(p.cityId, p.id);
            overlayPinsRef.current.set(oid, {
              name: p.name,
              cityId: p.cityId,
              lat: p.lat,
              lng: p.lng,
            });
            const ring = p.ring && p.ring.length >= 3 ? slimRing(p.ring) : null;
            merged.push({
              id: oid,
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              color: '#6E8B7A',
              radiusM: p.radiusM,
              ring,
              spotKey: `${p.cityId}:${p.id}`,
              category: p.category || '',
              story: p.story,
              pointOnly: !ring,
              keepDot: !ring,
            });
          }
          if (merged.length > cap) {
            const capped = capMapPlacesForView(merged, cap, (p) =>
              originLat != null && originLng != null
                ? metersBetween(p.lat, p.lng, originLat, originLng)
                : 0,
            );
            setMapPlaces(capped);
            return;
          }
          setMapPlaces(merged);
        });
      });
    }
  }, [buildPlacePayloads, cityId, mapFilters, pois, profile]);
  injectPlacesOnlyRef.current = injectPlacesOnly;

  const injectOfflineMapExtract = useCallback(
    async (
      force = false,
      center?: { lat: number; lng: number } | null,
      radiusM?: number,
      preferCityId?: string | null,
      urgent = false,
    ) => {
      if (!readyRef.current) return;
      const gpsId = (cityId || env.cityId() || '').toLowerCase();
      const gpsBounds = resolveCityCoverageBoundsSync(gpsId);
      const lat =
        center?.lat ??
        gpsLatRef.current ??
        useFinnusStore.getState().lastGpsLat ??
        extractClipCenterRef.current?.lat ??
        (gpsBounds
          ? (gpsBounds.latMin + gpsBounds.latMax) / 2
          : null);
      const lng =
        center?.lng ??
        gpsLngRef.current ??
        useFinnusStore.getState().lastGpsLng ??
        extractClipCenterRef.current?.lng ??
        (gpsBounds
          ? (gpsBounds.lngMin + gpsBounds.lngMax) / 2
          : null);
      if (lat == null || lng == null) return;
      const activeExtractId = useMapExtractStore.getState().cityId;
      const targetId = (preferCityId || '').toLowerCase();
      const citySwitch =
        !!targetId &&
        !!activeExtractId &&
        targetId !== activeExtractId.toLowerCase();
      // radiusM nur setzen wenn explizit (Boot = eng). Pan/Idle → Display-Wide.
      // preferCityId = Viewport-Overlap (Tornesch sichtbar) — unabhängig von Modul-1.
      void loadExtractForViewport(lat, lng, {
        force,
        urgent: urgent || citySwitch,
        ...(radiusM != null ? { radiusM } : {}),
        ...(preferCityId ? { cityId: preferCityId } : {}),
      });
    },
    [cityId],
  );

  const flushDeferredExtract = useCallback(() => {
    const pending = pendingExtractCenter.current;
    pendingExtractCenter.current = null;
    if (extractDeferTimer.current) {
      clearTimeout(extractDeferTimer.current);
      extractDeferTimer.current = null;
    }
    if (!pending || !readyRef.current) return;
    void injectOfflineMapExtract(
      pending.force === true,
      { lat: pending.lat, lng: pending.lng },
      undefined,
      pending.cityId,
      pending.urgent === true,
    );
  }, [injectOfflineMapExtract]);

  const EXTRACT_IDLE_MS = 350;

  const scheduleIdleExtractLoad = useCallback(() => {
    if (extractDeferTimer.current) clearTimeout(extractDeferTimer.current);
    extractDeferTimer.current = setTimeout(() => {
      extractDeferTimer.current = null;
      if (userMapGestureRef.current) {
        scheduleIdleExtractLoad();
        return;
      }
      flushDeferredExtract();
    }, EXTRACT_IDLE_MS);
  }, [flushDeferredExtract]);

  const queueViewportExtract = useCallback(
    (
      lat: number,
      lng: number,
      opts?: { cityId?: string | null; force?: boolean; urgent?: boolean },
    ) => {
      const activeExtractId = useMapExtractStore.getState().cityId;
      const targetId = (opts?.cityId || '').toLowerCase();
      const citySwitch =
        !!targetId &&
        !!activeExtractId &&
        targetId !== activeExtractId.toLowerCase();
      const urgent = opts?.urgent === true || opts?.force === true || citySwitch;
      pendingExtractCenter.current = {
        lat,
        lng,
        cityId: opts?.cityId ?? null,
        force: opts?.force === true,
        urgent,
      };
      if (urgent) {
        void injectOfflineMapExtract(
          opts?.force === true || citySwitch,
          { lat, lng },
          undefined,
          opts?.cityId ?? null,
          true,
        );
        pendingExtractCenter.current = null;
        return;
      }
      if (userMapGestureRef.current) return;
      scheduleIdleExtractLoad();
    },
    [injectOfflineMapExtract, scheduleIdleExtractLoad],
  );

  // Modul-1-Stadtwechsel: Karte bleibt viewport-basiert — nur Map-Datei vorholen.
  useEffect(() => {
    if (!cityId) return;
    invalidateLocalMapIndex();
    void prefetchCityMapExtract(cityId);
  }, [cityId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!readyRef.current) return;
      invalidateLocalMapIndex();
      const view = viewRef.current;
      if (view) {
        const midLat = (view.south + view.north) / 2;
        const midLng = (view.west + view.east) / 2;
        queueViewportExtract(midLat, midLng, { force: true });
        return;
      }
      void injectOfflineMapExtract(true);
    });
    return () => sub.remove();
  }, [injectOfflineMapExtract, queueViewportExtract]);

  const scheduleHeavyMapOverlays = useCallback(() => {
    overlaysEnabledRef.current = true;
    if (heavyOverlayTimer.current) {
      clearTimeout(heavyOverlayTimer.current);
      heavyOverlayTimer.current = null;
    }
    // Orte sofort (Pin-Index / SQLite) — nicht hinter Idle-Queue verstecken.
    if (HOME_MAP_PLACES_AFTER_EXTRACT_MS <= 0) {
      injectPlacesOnlyRef.current();
      return;
    }
    InteractionManager.runAfterInteractions(() => {
      if (heavyOverlayTimer.current) clearTimeout(heavyOverlayTimer.current);
      heavyOverlayTimer.current = setTimeout(() => {
        heavyOverlayTimer.current = null;
        injectPlacesOnlyRef.current();
      }, HOME_MAP_PLACES_AFTER_EXTRACT_MS);
    });
  }, []);

  // POIs nachgeladen → Story-Orte erneut zeichnen (Race mit Map-Ready).
  // Während Footprint-Enrich: Skip — Enrich injectet selbst (kein Doppel-Churn).
  useEffect(() => {
    if (!readyRef.current || !pois.length) return;
    if (enrichRunningRef.current) return;
    scheduleHeavyMapOverlays();
  }, [pois, scheduleHeavyMapOverlays]);

  // Nach Clean-Install / leerer DB: Stadt-Pack nachladen, sonst bleibt die Karte leer
  useEffect(() => {
    if (pois.length > 0) return;
    const id = cityId || env.cityId() || 'prisdorf';
    let cancelled = false;
    void (async () => {
      try {
        const { syncPOIsFromSupabase } = await import(
          '../../services/syncService'
        );
        const result = await syncPOIsFromSupabase(id);
        if (cancelled) return;
        if (result.synced && result.poiCount > 0) {
          const { getAllPois } = await import('../../db/database');
          const next = await getAllPois();
          if (!cancelled && next.length > 0) {
            useFinnusStore.getState().setPois(next);
          }
        }
      } catch {
        /* offline / sync optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cityId, pois.length]);

  const runFootprintEnrich = useCallback(async (maxM = 500) => {
    if (!pois.length) return;
    if (enrichRunningRef.current) {
      pendingFootprintM.current = Math.max(
        pendingFootprintM.current ?? 0,
        maxM,
      );
      return;
    }
    enrichRunningRef.current = true;
    try {
      const view = viewRef.current;
      const lat = view
        ? (view.south + view.north) / 2
        : gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat ?? undefined;
      const lng = view
        ? (view.west + view.east) / 2
        : gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng ?? undefined;
      const missing = pois.filter((p) => !osmFootprintsRef.current.has(p.id));
      const fetched = await enrichHomeMapFootprints(missing, profile, {
        nearLat: lat,
        nearLng: lng,
        maxM,
      });
      if (fetched.size === 0) return;
      for (const [id, ring] of fetched) {
        osmFootprintsRef.current.set(id, ring);
      }
      if (readyRef.current) scheduleHeavyMapOverlays();
    } catch {
      /* Overpass optional */
    } finally {
      enrichRunningRef.current = false;
      const pending = pendingFootprintM.current;
      if (pending != null && pending > maxM) {
        pendingFootprintM.current = null;
        void runFootprintEnrich(pending);
      } else {
        pendingFootprintM.current = null;
      }
    }
  }, [injectPlacesOnly, pois, profile]);

  const runWarmupRings = useCallback(() => {
    const gen = ++warmupRingGen.current;
    const gpsLat =
      gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
    const gpsLng =
      gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
    const cityBounds = resolveFitBounds(cityId);
    const gpsHere =
      gpsLat != null &&
      gpsLng != null &&
      cityBounds != null &&
      pointInCityBounds(gpsLat, gpsLng, cityBounds);
    const lat = gpsHere
      ? gpsLat
      : cityBounds
        ? (cityBounds.latMin + cityBounds.latMax) / 2
        : gpsLat;
    const lng = gpsHere
      ? gpsLng
      : cityBounds
        ? (cityBounds.lngMin + cityBounds.lngMax) / 2
        : gpsLng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      placeRadiusRef.current = 500;
      scheduleHeavyMapOverlays();
      return;
    }
    // Settled: nur 500 m — kein Expand auf 2/10 km (Dauer-Nachladen).
    const rings = warmupSettleRingsM();
    const step = async (i: number) => {
      if (gen !== warmupRingGen.current) return;
      const r = rings[i];
      if (r == null) return;
      placeRadiusRef.current = r;
      if (i === rings.length - 1) {
        // Kein Signature-Clear mid-boot — vermeidet zweites Places-Flicker.
        if (!placesBootCommittedRef.current) {
          lastPlacesSig.current = '';
        }
        injectPlacesOnlyRef.current();
      }
      if (i === 0 && gpsHere) void runFootprintEnrich(r);
      await new Promise((res) => setTimeout(res, i === 0 ? 280 : 550));
      await step(i + 1);
    };
    void step(0);
  }, [cityId, runFootprintEnrich, scheduleHeavyMapOverlays]);

  const injectFastCityPins = useCallback(
    (id: string | null) => {
      if (!id || !readyRef.current) return;
      overlaysEnabledRef.current = true;
      // Nach erstem Reveal: kein zweites Fast-Paint (Dots→Icons-Flicker).
      if (placesBootCommittedRef.current) {
        injectPlacesOnlyRef.current();
        return;
      }
      const paint = (pins: MapPin[] | null | undefined) => {
        if (!pins?.length) return;
        if (placesBootCommittedRef.current) return;
        const view = viewRef.current;
        const span = view ? homeMapViewSpanM(view) : 12_000;
        const cap = placeCapForMapView(500, span);
        let list = pins.filter((p) => p.story === 1);
        if (list.length < 16) list = pins.slice();
        if (view) {
          const padLat = Math.max(0.004, (view.north - view.south) * 0.2);
          const padLng = Math.max(0.006, (view.east - view.west) * 0.2);
          list = list.filter(
            (p) =>
              p.lat >= view.south - padLat &&
              p.lat <= view.north + padLat &&
              p.lng >= view.west - padLng &&
              p.lng <= view.east + padLng,
          );
        }
        list.sort((a, b) => (b.story || 0) - (a.story || 0));
        list = list.slice(0, cap);
        if (!list.length) return;
        const profileNow = profile;
        const visitedNow = visitedHistory;
        const cityNow = cityId;
        const payload = list.map((p) => {
          const poi = poisRef.current.find((x) => x.id === p.id) ?? null;
          let color = p.liked
            ? HOME_MAP_PLACE_COLORS.liked
            : p.story
              ? HOME_MAP_PLACE_COLORS.neutral
              : HOME_MAP_PLACE_COLORS.rest;
          let icon: HomeMapPlaceIcon | undefined;
          let iconLod: ReturnType<typeof homeMapIconLod> | undefined;
          if (poi) {
            const historyHit = isCityExplorePlaceSeen(poi, visitedNow, {
              cityId: cityNow,
              bounds,
            });
            const dwellGreen = isPlaceMapGreenByDwell(
              cityNow,
              poi.spot_key || String(poi.id),
            );
            const visited =
              historyHit ||
              dwellGreen ||
              visitedNow.some(
                (v) =>
                  countsAsMapVisitedGreen({
                    keyFacts: v.keyFacts,
                    poi,
                    profile: profileNow,
                  }) &&
                  (v.poiId === poi.id ||
                    (v.name &&
                      poi.name &&
                      v.name.toLowerCase() === poi.name.toLowerCase())),
              );
            color = colorForHomeMapPoi(poi, profileNow, visited);
            const ic = placeMapIcon(poi);
            if (ic) {
              icon = ic;
              iconLod = homeMapIconLod(ic, poi);
            }
          } else if (p.category) {
            // Pin-Index ohne volles POI: Icon aus Kategorie, kein Dot-only-Zwischenbild.
            const fake = {
              id: p.id,
              name: p.name,
              category: p.category,
              kind: 'legacy' as const,
            };
            const ic = placeMapIcon(fake as never);
            if (ic) {
              icon = ic;
              iconLod = homeMapIconLod(ic, fake as never);
            }
          }
          const ring =
            p.ring && p.ring.length >= 3 ? slimRing(p.ring) : null;
          const hasBuilding = !!(ring && ring.length >= 3);
          return {
            id: p.id,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            color,
            radiusM: p.radiusM,
            ring: hasBuilding ? ring : null,
            spotKey: `${p.cityId}:${p.id}`,
            category: p.category || '',
            story: p.story,
            pointOnly: !hasBuilding,
            keepDot: !hasBuilding && !icon,
            amenityDot: !!(icon && !hasBuilding),
            keepPin: !hasBuilding,
            icon,
            iconLod,
          };
        });
        lastPlacesSig.current = payload
          .map((p) => `${p.id}:${p.color}:${p.story || 0}:${p.icon || ''}`)
          .join('|');
        placesBootCommittedRef.current = true;
        setMapPlaces(payload);
        markHomeMapBoot('places');
      };
      const memPins = peekMapPinIndex(id);
      paint(memPins);
      void loadMapPinIndex(id).then((pins) => {
        if (!pins.length) return;
        if (placesBootCommittedRef.current) {
          injectPlacesOnlyRef.current();
          return;
        }
        paint(pins);
      });
    },
    [bounds, cityId, profile, visitedHistory],
  );

  const injectPlacesAndRoads = useCallback(async () => {
    if (!readyRef.current) return;
    injectFastCityPins(cityId);
    const id = (cityId ?? '').toLowerCase();
    const haveCityPois =
      !!id &&
      pois.some((p) => {
        const k = (p.spot_key || '').toLowerCase();
        return k.startsWith(`${id}_`) || k.startsWith(`${id}:`);
      });
    if (haveCityPois) scheduleHeavyMapOverlays();
    placesInjectedForCity.current = cityId;
  }, [cityId, injectFastCityPins, scheduleHeavyMapOverlays, pois]);

  const fitActiveCityOverview = useCallback(() => {
    // Kein Kamerafit — freie Erkundung bleibt. Nur Viewport-Ref für Pins/LOD.
    if (!readyRef.current || !cityId) return false;
    const fitBounds = resolveFitBounds(cityId);
    if (!fitBounds) return false;
    viewRef.current = viewBoxFromCoverageBounds(fitBounds);
    return true;
  }, [cityId]);
  const fitActiveCityOverviewRef = useRef(fitActiveCityOverview);
  fitActiveCityOverviewRef.current = fitActiveCityOverview;

  const injectCities = useCallback(() => {
    if (!readyRef.current) return;
    const activeId = (cityId ?? '').toLowerCase();
    const localIds = localOfflineCityIdsRef.current;
    const catalogIds = [
      ...new Set([
        ...catalogCitiesRef.current
          .map((c) => c.id.trim().toLowerCase())
          .filter((id) => id && !isRegionPackCityId(id)),
        ...localIds,
      ]),
    ];
    const known = listKnownCityCoverageBounds().filter(
      (b) => catalogIds.length === 0 || catalogIds.includes(b.cityId),
    );
    const locate = (lat: number, lng: number) =>
      smallestCityIdContainingPoint(lat, lng, known);
    const gpsLatNow =
      gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat ?? null;
    const gpsLngNow =
      gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng ?? null;
    const hereNowId =
      typeof gpsLatNow === 'number' &&
      typeof gpsLngNow === 'number' &&
      Number.isFinite(gpsLatNow) &&
      Number.isFinite(gpsLngNow)
        ? locate(gpsLatNow, gpsLngNow)
        : null;
    const plannedCityIds = new Set<string>();
    const planPois = pois.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      name: p.name,
    }));
    for (const s of collectTimelineCityPlanStops()) {
      for (const id of cityIdsForPlanStop(s, {
        cities: known.map((b) => ({ cityId: b.cityId, name: b.name })),
        locate,
        pois: planPois,
      })) {
        plannedCityIds.add(id);
      }
    }
    const alwaysIncludeIds = [
      ...new Set(
        [
          ...listCityMapGreenIds(),
          ...plannedCityIds,
          ...localIds,
          ...(hereNowId ? [hereNowId] : []),
        ].map((id) => id.toLowerCase()),
      ),
    ];
    const selected = selectHomeMapCities({
      activeCityId: activeId,
      catalogIds,
      alwaysIncludeIds,
    });
    const cities: Array<{
      id: string;
      name: string;
      ring: Array<[number, number]>;
      fill: string;
      stroke: string;
      fillOpacity: number;
      dashed: boolean;
    }> = [];
    for (const b of selected) {
      if (!hasRealCityBoundaryPolygon(b.polygon) || !b.polygon) continue;
      const ring = b.polygon as Array<[number, number]>;
      const tone = resolveHomeMapCityTone({
        hereNow: hereNowId === b.cityId,
        dwellGreen: isCityMapGreen(b.cityId),
        firmPlan: plannedCityIds.has(b.cityId),
      });
      const { fill, stroke, fillOpacity, dashed } =
        colorsForHomeMapCityTone(tone);
      cities.push({
        id: b.cityId,
        name: b.name || b.cityId,
        ring,
        fill,
        stroke,
        fillOpacity,
        dashed,
      });
    }
    setMapCities(cities);
  }, [cityId, planTick, pois]);
  const injectCitiesRef = useRef(injectCities);
  injectCitiesRef.current = injectCities;

  const refreshCatalogBoundaries = useCallback(
    (maxFetch = 16) => {
      const catalog = catalogCitiesRef.current;
      if (catalog.length) seedCatalogCityAnchors(catalog);
      void ensureHomeMapCityBoundaries({
        activeCityId: cityId,
        lat: gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat,
        lng: gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng,
        maxFetch,
        catalogCities: catalog,
        onProgress: () => injectCitiesRef.current(),
      }).then(() => injectCitiesRef.current());
    },
    [cityId],
  );
  const refreshCatalogBoundariesRef = useRef(refreshCatalogBoundaries);
  refreshCatalogBoundariesRef.current = refreshCatalogBoundaries;

  useEffect(() => {
    const cached = peekCityIndexCache();
    if (cached?.length) {
      catalogCitiesRef.current = cached;
      seedCatalogCityAnchors(cached);
    }
    void loadCityCatalog(null, { bustCache: false }).then((items) => {
      catalogCitiesRef.current = items;
      seedCatalogCityAnchors(items);
      if (readyRef.current) {
        setTimeout(() => {
          injectCitiesRef.current();
          refreshCatalogBoundariesRef.current(12);
        }, 1800);
      }
    });
  }, []);

  const refreshExploreLine = useCallback(() => {
    const lat = gpsLatRef.current;
    const lng = gpsLngRef.current;
    const track = getWalkTrackSnapshot();
    walkTrackRef.current = track;
    const prog = computeCityExploreProgress({
      pois,
      visitedHistory,
      walkTrack: track,
      userLoc:
        lat != null && lng != null ? { lat, lng } : null,
      cityId,
    });
    setExploreLine(prog.line);
  }, [cityId, pois, visitedHistory]);

  useEffect(() => {
    void hydrateCityDwellTracker().then(() => {
      if (readyRef.current) injectCitiesRef.current();
    });
    void loadWalkTrack().then(setWalkTrack);
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    injectCities();
  }, [injectCities]);

  useEffect(() => {
    void ensureHeadingWatch();
    let lastSent: number | null = null;
    let lastSentAt = 0;
    const syncCal = () => {
      const cal = needsCompassCalibration();
      setNeedsCalibration((prev) => (prev === cal ? prev : cal));
    };
    const calTick = setInterval(syncCal, 2000);
    let headingFlush = 0;
    let pendingDeg: number | null = null;
    const flushHeading = () => {
      headingFlush = 0;
      const d = pendingDeg;
      pendingDeg = null;
      if (d == null || !readyRef.current) return;
      const now = Date.now();
      const jump =
        lastSent == null ? 999 : Math.abs(shortestAngleDelta(lastSent, d));
      const following =
        headingFollowRef.current || locationFollowRef.current;
      const minDeg = following ? 1.4 : 6;
      const minMs = following ? 70 : 280;
      if (jump < minDeg && now - lastSentAt < minMs) return;
      if (lastSent == null || jump >= minDeg || now - lastSentAt >= minMs) {
        lastSent = d;
        lastSentAt = now;
      }
    };
    const unsub = subscribeMapHeading((d) => {
      headingRef.current = d;
      syncCal();
      if (!readyRef.current) return;
      pendingDeg = d;
      if (headingFlush) return;
      headingFlush = requestAnimationFrame(flushHeading);
    });
    return () => {
      unsub();
      clearInterval(calTick);
      if (headingFlush) cancelAnimationFrame(headingFlush);
    };
  }, []);


  useEffect(() => {
    return useFuturePlanStore.subscribe(() => {
      setPlanTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    refreshExploreLine();
  }, [refreshExploreLine]);

  const lastExploreAt = useRef(0);
  const applyLiveGps = useCallback(
    (lat: number, lng: number) => {
      gpsLatRef.current = lat;
      gpsLngRef.current = lng;
      if (!readyRef.current) return;
      lastFollowGps.current = { lat, lng };
      // Fog/Track ohne React-Re-Render der Map — Snapshot + Fog-Store.
      const track = getWalkTrackSnapshot();
      walkTrackRef.current = track;
      onMapGpsFog(lat, lng, track);
      const now = Date.now();
      if (now - lastExploreAt.current > 8_000) {
        lastExploreAt.current = now;
        refreshExploreLine();
      }
    },
    [refreshExploreLine],
  );

  useEffect(() => {
    const push = (lat: number | null, lng: number | null) => {
      if (lat == null || lng == null) return;
      applyLiveGps(lat, lng);
    };
    push(gpsLatRef.current, gpsLngRef.current);
    return useGpsStore.subscribe((s, prev) => {
      if (s.lat == null || s.lng == null) return;
      if (s.lat === prev.lat && s.lng === prev.lng) return;
      push(s.lat, s.lng);
    });
  }, [applyLiveGps]);

  const injectWalkFog = useCallback((_nearOnly = false) => {
    /* Fog kommt aus walkTrack-Prop in NativeHomeMapView */
  }, []);

  const fogExpandedRef = useRef(false);

  // Walk track → fog schon beim Öffnen, nicht erst wenn Navigation startet
  useEffect(() => {
    injectWalkFog(!fogExpandedRef.current);
  }, [injectWalkFog, walkTrack]);

  const injectNavRoute = useCallback(() => {
    if (!readyRef.current) return;
    const liveActive = useFinnusStore.getState().navActive;
    const tourOpen = (useFinnusStore.getState().multiStopTour?.stops ?? []).some(
      (s) => !s.done,
    );
    if (!liveActive && !tourOpen) {
      const offer = useFinnusStore.getState().pendingNavOffer;
      const previewStore = useMapRouteStore.getState().route;
      const hasWegweiserPreview =
        offer?.source === 'wegweiser' &&
        offer.awaitConfirm === true &&
        (offer.previewRoute?.length ?? 0) >= 2;
      if (hasWegweiserPreview) {
        const street =
          (offer.previewRoute?.length ?? 0) >= 3 ? offer.previewRoute! : [];
        const payload =
          previewStore?.preview && (previewStore.current?.length ?? 0) >= 3
            ? previewStore
            : {
                current: street,
                ahead: [],
                pins: [
                  {
                    lat: offer.lat!,
                    lng: offer.lng!,
                    n: 1,
                    name: offer.name,
                  },
                ],
                arrows: [],
                preview: street.length < 3,
                previewPin: { lat: offer.lat!, lng: offer.lng! },
              };
        const json = navRoutePayloadSig(payload);
        if (json !== lastRouteJson.current) {
          lastRouteJson.current = json;
          setMapRoute(payload);
        }
        return;
      }
      if (lastRouteJson.current !== 'null') {
        lastRouteJson.current = 'null';
        setMapRoute(null);
      }
      return;
    }
    let payload = null as ReturnType<typeof buildNavRouteMapPayload>;
    try {
      payload = buildNavRouteMapPayload();
    } catch {
      return;
    }
    if (payload?.fitWide) {
      followRef.current = false;
    }
    const json = navRoutePayloadSig(
      payload ?? { current: [], ahead: [], pins: [], arrows: [] },
    );
    if (json === lastRouteJson.current) return;
    lastRouteJson.current = json;
    setMapRoute(payload ?? { current: [], ahead: [], pins: [], arrows: [] });
    useMapRouteStore.getState().setRoute(
      payload ?? { current: [], ahead: [], pins: [], arrows: [] },
    );
    if (!pendingNavFitRef.current) return;
    pendingNavFitRef.current = false;
    followRef.current = false;
    locationFollowRef.current = false;
    setLocationFollow(false);
    ignoreUserPanUntil.current = Date.now() + 900;
    if (payload?.fitWide) {
      const pts = [
        ...(payload.current ?? []),
        ...(payload.ahead ?? []).flat(),
        ...(payload.pins ?? []),
      ];
      if (pts.length >= 2) {
        let south = 90;
        let north = -90;
        let west = 180;
        let east = -180;
        for (const p of pts) {
          if (p.lat < south) south = p.lat;
          if (p.lat > north) north = p.lat;
          if (p.lng < west) west = p.lng;
          if (p.lng > east) east = p.lng;
        }
        // Vertrag: kurz ganze Route, dann zur aktuellen Position, dann frei.
        mapRef.current?.fitBounds(south, west, north, east, true);
        const gpsLat =
          gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
        const gpsLng =
          gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
        setTimeout(() => {
          if (gpsLat != null && gpsLng != null) {
            mapRef.current?.jumpTo(gpsLat, gpsLng, undefined, true);
          }
          mapRef.current?.releaseFollow();
          locationFollowRef.current = false;
          setLocationFollow(false);
        }, 1_600);
        return;
      }
    }
    const lat = gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
    const lng = gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
    if (lat != null && lng != null) {
      mapRef.current?.jumpTo(lat, lng, undefined, true);
      mapRef.current?.releaseFollow();
    }
  }, [navActive, navRouteRev, multiStopTour]);

  const wasNavActive = useRef(false);
  useEffect(() => {
    if (navActive && !wasNavActive.current) {
      lastRouteJson.current = '';
      pendingNavFitRef.current = true;
    }
    wasNavActive.current = navActive;
    injectNavRoute();
  }, [injectNavRoute, navActive, navRouteLoading, navRouteRev, multiStopTour]);

  useEffect(() => {
    injectNavRoute();
    if (readyRef.current) injectPlacesOnly();
  }, [injectNavRoute, injectPlacesOnly, pendingNavOffer]);

  // GPS-Gemeinde + Dwell — nicht am GPS-Render-Takt, sonst hängt die UI
  useEffect(() => {
    const tick = () => {
      const gpsLat = gpsLatRef.current;
      const gpsLng = gpsLngRef.current;
      if (gpsLat == null || gpsLng == null) {
        if (lastHereCityRef.current != null) {
          lastHereCityRef.current = null;
          if (readyRef.current) injectCitiesRef.current();
        }
        return;
      }
      const hereNow = smallestCityIdContainingPoint(
        gpsLat,
        gpsLng,
        listKnownCityCoverageBounds(),
      );
      if (hereNow !== lastHereCityRef.current) {
        lastHereCityRef.current = hereNow;
        if (readyRef.current) injectCitiesRef.current();
      }
      if (pausedRef.current) return;
      const now = Date.now();
      const delta = now - lastDwellAt.current;
      lastDwellAt.current = now;
      if (delta < 500 || delta > 60_000) return;
      const here = hereNow || cityId;
      if (!here) return;
      const newlyGreen = noteCityDwellDelta(here, delta);
      let best: Poi | null = null;
      let bestD = 80;
      for (const p of poisRef.current) {
        if (!isCityExploreMapPoi(p)) continue;
        const dLat = (p.lat - gpsLat) * 111_320;
        const dLng =
          (p.lng - gpsLng) * 111_320 * Math.cos((gpsLat * Math.PI) / 180);
        const d = Math.hypot(dLat, dLng);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        notePlaceDwellDelta(here, best.spot_key || String(best.id), delta);
      }
      if (newlyGreen) injectCitiesRef.current();
    };
    tick();
    const t = setInterval(tick, 4_000);
    return () => clearInterval(t);
  }, [cityId]);

  // Stadtwechsel (Einstellungen): Karte zur Stadt + Offline-Extract laden.
  // Freie Erkundung danach bleibt — kein Dauer-Follow.
  useEffect(() => {
    if (!readyRef.current || !cityId) return;
    const prevInjected = placesInjectedForCity.current;
    if (prevInjected === cityId) {
      scheduleHeavyMapOverlays();
      return;
    }
    osmFootprintsRef.current = new Map();
    const switched = prevInjected != null && prevInjected !== cityId;
    if (switched) {
      followRef.current = false;
      didCameraLock.current = true;
      locationFollowRef.current = false;
      headingFollowRef.current = false;
      setLocationFollow(false);
      setHeadingFollow(false);
      const fitBounds = resolveFitBounds(cityId);
      if (fitBounds) {
        const lat = (fitBounds.latMin + fitBounds.latMax) / 2;
        const lng = (fitBounds.lngMin + fitBounds.lngMax) / 2;
        viewRef.current = viewBoxFromCoverageBounds(fitBounds);
        ignoreUserPanUntil.current = Date.now() + 900;
        mapRef.current?.releaseFollow();
        mapRef.current?.jumpTo(lat, lng, 13.2, true);
        void injectOfflineMapExtract(true, { lat, lng }, undefined, cityId, true);
        void prefetchCityMapExtract(cityId).catch(() => undefined);
      } else {
        void injectOfflineMapExtract(true, null, undefined, cityId, true);
        void prefetchCityMapExtract(cityId).catch(() => undefined);
      }
    }
    injectFastCityPins(cityId);
    void injectPlacesAndRoads();
    setTimeout(() => injectCitiesRef.current(), 400);
    void runWarmupRings();
  }, [
    cityId,
    fitActiveCityOverview,
    injectOfflineMapExtract,
    injectPlacesAndRoads,
    scheduleHeavyMapOverlays,
    injectFastCityPins,
    runWarmupRings,
  ]);

  const onNativeReady = useCallback(() => {
    readyRef.current = true;
    noteSplashMapInteractive();
    const seed = seedMapCameraGps();
    const liveLat = gpsLatRef.current;
    const liveLng = gpsLngRef.current;
    const bootLat =
      liveLat ?? seed?.lat ?? useFinnusStore.getState().lastGpsLat ?? null;
    const bootLng =
      liveLng ?? seed?.lng ?? useFinnusStore.getState().lastGpsLng ?? null;
    const bootZoom =
      typeof seed?.zoom === 'number' && seed.zoom >= 10 && seed.zoom <= 18
        ? seed.zoom
        : 16;
    // Nur EINMAL pro Session auf GPS — Map-Remount darf nicht zurückreißen.
    if (!didBootJumpRef.current && bootLat != null && bootLng != null) {
      didBootJumpRef.current = true;
      followRef.current = false;
      viewRef.current = viewBoxAroundGps(bootLat, bootLng);
      placeRadiusRef.current = 500;
      mapRef.current?.jumpTo(bootLat, bootLng, bootZoom, true);
      lastFollowGps.current = { lat: bootLat, lng: bootLng };
      didCameraLock.current = true;
    }
    // Immer detach — auch ohne GPS. Sonst bleibt die Kamera „offen“ für Host-Jumps.
    mapRef.current?.releaseFollow();
    locationFollowRef.current = false;
    headingFollowRef.current = false;
    setLocationFollow(false);
    setHeadingFollow(false);
    invalidateLocalMapIndex();
    void warmLocalMapIndex();
    // Nur aktive Stadt vorwärmen — keine serielle Prefetch-Kette aller Offline-Packs
    // (Viewport-First: Tornesch/Kiel erst wenn Viewport sie braucht).
    const activeMapId = (cityId || env.cityId() || '').toLowerCase();
    if (activeMapId) {
      void prefetchCityMapExtract(activeMapId).catch(() => undefined);
    }
    void (async () => {
      try {
        const rows = await listLocalCityDatasets();
        const offlineIds = rows
          .filter((row) => row.hasPack || row.hasMap)
          .map((row) => row.id.toLowerCase())
          .filter((id) => id && !isRegionPackCityId(id));
        localOfflineCityIdsRef.current = offlineIds;
        // Pack-_coverage für Offline-Städte (Tornesch etc.) — vor Fills, ohne Map-Download.
        await registerCoverageFromLocalPacks({
          cityIds: offlineIds.filter((id) =>
            rows.some((r) => r.id === id && r.hasPack),
          ),
        });
        invalidateLocalMapIndex();
        await warmLocalMapIndex();
        if (readyRef.current) injectCitiesRef.current();
        // Optional: genau EIN Nah-Nachbar idle vorwärmen — nie die ganze Offline-Liste.
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        const { resolveCityCoverageBoundsSync } = require('../../services/discovery/cityCoverageBounds') as {
          resolveCityCoverageBoundsSync: (
            id: string,
          ) => { latMin: number; latMax: number; lngMin: number; lngMax: number } | null;
        };
        const originLat = bootLat ?? gpsLatRef.current;
        const originLng = bootLng ?? gpsLngRef.current;
        let near: string | null = null;
        let nearDist = Number.POSITIVE_INFINITY;
        if (
          typeof originLat === 'number' &&
          typeof originLng === 'number' &&
          Number.isFinite(originLat) &&
          Number.isFinite(originLng)
        ) {
          for (const id of offlineIds) {
            if (!id || id === activeMapId) continue;
            const b = resolveCityCoverageBoundsSync(id);
            if (!b) continue;
            const cLat = (b.latMin + b.latMax) / 2;
            const cLng = (b.lngMin + b.lngMax) / 2;
            const d =
              Math.abs(cLat - originLat) + Math.abs(cLng - originLng);
            if (d < nearDist) {
              nearDist = d;
              near = id;
            }
          }
        }
        if (near) {
          setTimeout(() => {
            runMapIdleWhenFree(() => {
              void prefetchCityMapExtract(near!).catch(() => undefined);
            });
          }, 4_000);
        }
      } catch {
        /* soft */
      }
    })();
    // 1) Extract zuerst (Disk-Snapshot / RAM) — Places bewusst verzögert.
    const already = useMapExtractStore.getState().extract;
    void injectOfflineMapExtract(
      !already,
      {
        lat: bootLat ?? gpsLatRef.current,
        lng: bootLng ?? gpsLngRef.current,
      },
      DISPLAY_BOOT_RADIUS_M,
    );
    scheduleHeavyMapOverlays();
    injectNavRoute();
    // Footprints / Ringe / Fog später — mapIdle (Settings blockiert Paint nicht).
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          if (bootLat != null && bootLng != null) {
            void runFootprintEnrich(500);
          }
        });
      }, HOME_MAP_FOOTPRINTS_AFTER_MS);
      setTimeout(() => {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          runWarmupRings();
        });
      }, HOME_MAP_WARMUP_RINGS_AFTER_MS);
      setTimeout(() => {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          injectCitiesRef.current();
          refreshCatalogBoundaries(12);
        });
      }, 180);
      void loadWalkTrack().then((track) => {
        setWalkTrack(track);
        setTimeout(() => {
          forceFogRecompute(track);
          injectWalkFog(true);
        }, 2_200);
        setTimeout(() => {
          fogExpandedRef.current = true;
          injectWalkFog(false);
        }, 5_000);
      });
    });
  }, [
    injectNavRoute,
    injectOfflineMapExtract,
    injectWalkFog,
    queueViewportExtract,
    refreshCatalogBoundaries,
    runWarmupRings,
    runFootprintEnrich,
    scheduleHeavyMapOverlays,
  ]);

  const onNativeUserPan = useCallback(() => {
    if (Date.now() < ignoreUserPanUntil.current) return;
    pendingRingDone.current?.();
    followRef.current = false;
    locationFollowRef.current = false;
    headingFollowRef.current = false;
    lastGpsTapAt.current = 0;
    lastCompassTapAt.current = 0;
    setLocationFollow(false);
    setHeadingFollow(false);
  }, []);

  const onNativeMapGestureStart = useCallback(() => {
    userMapGestureRef.current = true;
  }, []);

  const onNativeMapGestureEnd = useCallback(() => {
    userMapGestureRef.current = false;
    if (pendingExtractCenter.current) {
      scheduleIdleExtractLoad();
    }
  }, [scheduleIdleExtractLoad]);

  const onNativeMapBearing = useCallback((bearing: number) => {
    useHomeMapUiStore.getState().setMapBearing(bearing);
  }, []);

  const onNativeViewport = useCallback(
    (v: {
      south: number;
      west: number;
      north: number;
      east: number;
      zoom: number;
      bearing: number;
    }) => {
      useHomeMapUiStore.getState().setMapBearing(v.bearing);
      const midLat = (v.south + v.north) / 2;
      const midLng = (v.west + v.east) / 2;
      const workKey = `${Math.round(midLat * 2500)}:${Math.round(midLng * 2500)}:${Math.round(v.zoom * 10)}`;
      if (workKey === lastViewportWorkKey.current) return;
      lastViewportWorkKey.current = workKey;
      if (Number.isFinite(midLat) && Number.isFinite(midLng)) {
        persistLastMapGpsSoon({
          lat: midLat,
          lng: midLng,
          zoom: v.zoom,
        });
        viewRef.current = {
          south: v.south,
          west: v.west,
          north: v.north,
          east: v.east,
        };
        const zoom = v.zoom ?? 16;
        const clip = useMapExtractStore.getState().clipCenter;
        const activeExtractCity = useMapExtractStore.getState().cityId;
        const localIds = peekLocalMapIds();
        const preferCity =
          localIds.size > 0
            ? resolveViewportCityIdForView(
                {
                  south: v.south,
                  west: v.west,
                  north: v.north,
                  east: v.east,
                },
                localIds,
              )
            : null;
        const cityChanged =
          !!preferCity &&
          preferCity !== (activeExtractCity ?? '').toLowerCase();
        const extractMoved =
          !clip ||
          metersBetween(midLat, midLng, clip.lat, clip.lng) >= RECLIP_M;
        // Stadtwechsel ODER Clip-Drift → Extract der sichtbaren lokalen Stadt.
        // Modul-1-Datensatz steuert das nicht.
        if (zoom >= 7.2 && (extractMoved || cityChanged)) {
          if (preferCity) {
            void prefetchCityMapExtract(preferCity);
          }
          queueViewportExtract(midLat, midLng, {
            cityId: preferCity,
            force: cityChanged,
            urgent: cityChanged,
          });
        }
        onMapViewport(midLat, midLng, zoom);

        const prevPlaces = placesInjectCenterRef.current;
        const placesMoved =
          !prevPlaces ||
          metersBetween(midLat, midLng, prevPlaces.lat, prevPlaces.lng) >=
            HOME_MAP_PLACES_REINJECT_MIN_M ||
          Math.abs(zoom - prevPlaces.zoom) >= HOME_MAP_PLACES_REINJECT_ZOOM;
        if (!popupHoldRef.current && placesMoved) {
          if (viewportInjectTimer.current) {
            clearTimeout(viewportInjectTimer.current);
          }
          viewportInjectTimer.current = setTimeout(() => {
            viewportInjectTimer.current = null;
            placesInjectCenterRef.current = {
              lat: midLat,
              lng: midLng,
              zoom,
            };
            injectPlacesOnlyRef.current();
          }, 800);
        }
      }
      if (!bounds) return;
      const fully = cityFullyVisibleInBounds({
        viewSouth: v.south,
        viewWest: v.west,
        viewNorth: v.north,
        viewEast: v.east,
        cityLatMin: bounds.latMin,
        cityLngMin: bounds.lngMin,
        cityLatMax: bounds.latMax,
        cityLngMax: bounds.lngMax,
      });
      const next = resolveHomeMapLodStable(
        lodRef.current,
        resolveHomeMapLod({
          zoom: v.zoom ?? 14,
          cityFullyVisible: fully,
        }),
      );
      if (next !== lodRef.current) {
        lodRef.current = next;
        injectCitiesRef.current();
        if (next === 'city' || next === 'region') {
          refreshCatalogBoundaries(next === 'region' ? 24 : 12);
        }
      }
    },
    [bounds, queueViewportExtract, refreshCatalogBoundaries],
  );

  const onNativePlaceTap = useCallback(
    (place: {
      id: number;
      name: string;
      category: string;
      lat: number;
      lng: number;
    }) => {
      const placeId = Number(place.id);
      if (!Number.isFinite(placeId)) return;
      if (Date.now() < ignorePlaceTapUntil.current) return;
      noteUiTap('mapPlace');
      if (viewportInjectTimer.current) {
        clearTimeout(viewportInjectTimer.current);
        viewportInjectTimer.current = null;
      }
      popupHoldRef.current = true;
      const overlay = overlayPinsRef.current.get(placeId);
      const poi = poisRef.current.find((p) => p.id === placeId) ?? null;
      useHomeMapUiStore.getState().setPlacePopup(
        instantMapPlacePopup({
          id: placeId,
          name: place.name || overlay?.name || poi?.name,
          category: place.category || overlay?.cityId || undefined,
          lat: place.lat,
          lng: place.lng,
          poi,
        }),
      );
      requestAnimationFrame(() => {
        const preview = useHomeMapUiStore.getState().placePopup;
        if (preview) void enrichMapPlaceMapsIfListed(preview);
        if (!overlay && placeId > 0) {
          void prioritizeMapPlacePreview(placeId);
        }
      });
    },
    [pois.length],
  );

  const onNativeDropPin = useCallback(
    (latN: number, lngN: number) => {
      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
      noteUiTap('mapDropPin');
      const snap = snapMapLongPress({
        lat: latN,
        lng: lngN,
        places: mapPlaces.map((p) => ({
          id: p.id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          category: p.category,
        })),
        houses: (mapExtract?.housenumbers ?? []).map((h) => ({
          lat: h.lat,
          lng: h.lng,
          n: h.n,
          s: h.s,
        })),
      });
      if (snap.kind === 'place') {
        setDropPin(null);
        onNativePlaceTap({
          id: snap.place.id,
          name: snap.place.name,
          category: snap.place.category || '',
          lat: snap.place.lat,
          lng: snap.place.lng,
        });
        return;
      }
      popupHoldRef.current = true;
      const lat = snap.kind === 'address' ? snap.lat : latN;
      const lng = snap.kind === 'address' ? snap.lng : lngN;
      const name =
        snap.kind === 'address' ? snap.name : 'Punkt auf der Karte';
      const category = snap.kind === 'address' ? 'Adresse' : 'Ort';
      setDropPin({ lat, lng });
      useHomeMapUiStore.getState().setPlacePopup(
        instantMapPlacePopup({
          id: MAP_DROP_PIN_ID,
          name,
          category,
          lat,
          lng,
        }),
      );
    },
    [mapExtract, mapPlaces, onNativePlaceTap],
  );

  const onNativeBlankTap = useCallback(() => {
    if (useHomeMapUiStore.getState().placePopup) {
      useHomeMapUiStore.getState().setPlacePopup(null);
    }
    setDropPin(null);
  }, []);

  const snapGps = useCallback(
    (mode: 'pulse' | 'lock') => {
      const apply = (lat: number, lng: number) => {
        lastFollowGps.current = { lat, lng };
        didCameraLock.current = true;
        // Pulse: einmal GPS, detached bleiben — kein reattachFollow.
        if (mode === 'lock') {
          mapRef.current?.reattachFollow();
          followRef.current = true;
          locationFollowRef.current = true;
          setLocationFollow(true);
          mapRef.current?.jumpTo(lat, lng, 16, true);
          return;
        }
        followRef.current = false;
        locationFollowRef.current = false;
        setLocationFollow(false);
        mapRef.current?.jumpTo(lat, lng, 16, true);
        mapRef.current?.releaseFollow();
      };
      const lat = gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
      const lng = gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
      if (lat != null && lng != null) {
        apply(lat, lng);
      } else {
        const fit = cityId ? resolveFitBounds(cityId) : null;
        if (fit) {
          apply((fit.latMin + fit.latMax) / 2, (fit.lngMin + fit.lngMax) / 2);
        }
      }
      void getCurrentCoords({
        timeoutMs: 900,
        accuracy: 'balanced',
        preferFresh: true,
      })
        .then((fresh) => {
          if (!fresh) return;
          if (userMapGestureRef.current) return;
          // Pulse: kein zweiter Nachzug (sonst reißt freie Erkundung zurück).
          if (mode === 'pulse') return;
          if (mode === 'lock' && !locationFollowRef.current) return;
          apply(fresh.lat, fresh.lng);
        })
        .catch(() => undefined);
    },
    [cityId],
  );

  const onRecenter = useCallback(() => {
    const next = nextHudLockTap(
      {
        locked: locationFollowRef.current,
        lastTapAt: lastGpsTapAt.current,
      },
      Date.now(),
    );
    lastGpsTapAt.current = next.lastTapAt;
    locationFollowRef.current = next.locked;
    setLocationFollow(next.locked);
    if (next.action === 'unlock') {
      followRef.current = false;
      mapRef.current?.releaseFollow();
      return;
    }
    // Fix-Modus: Norden oben, solange kein Blickrichtungs-Follow.
    if (next.action === 'lock' && !headingFollowRef.current) {
      mapRef.current?.setNorthUp();
      useHomeMapUiStore.getState().setMapBearing(0);
    }
    if (next.action === 'pulse' && !headingFollowRef.current) {
      mapRef.current?.setNorthUp();
      useHomeMapUiStore.getState().setMapBearing(0);
    }
    ignoreUserPanUntil.current = Date.now() + 700;
    // Lock: Follow anlocken. Pulse: nur einmal springen, kein reattach-Fenster.
    if (next.action === 'lock') {
      mapRef.current?.reattachFollow();
    }
    snapGps(next.action === 'lock' ? 'lock' : 'pulse');
  }, [snapGps]);

  const onRecenterLock = useCallback(() => {
    locationFollowRef.current = true;
    lastGpsTapAt.current = Date.now();
    setLocationFollow(true);
    if (!headingFollowRef.current) {
      mapRef.current?.setNorthUp();
      useHomeMapUiStore.getState().setMapBearing(0);
    }
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.reattachFollow();
    snapGps('lock');
  }, [snapGps]);

  const onNorthUp = useCallback(() => {
    const next = nextHudLockTap(
      {
        locked: headingFollowRef.current,
        lastTapAt: lastCompassTapAt.current,
      },
      Date.now(),
    );
    lastCompassTapAt.current = next.lastTapAt;
    headingFollowRef.current = next.locked;
    setHeadingFollow(next.locked);
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      mapRef.current?.setHeadingFollow(true);
      return;
    }
    mapRef.current?.setHeadingFollow(false);
    // Nur auf Kompass-Tipp → Norden. Manuelles Drehen snappt nicht zurück.
    useHomeMapUiStore.getState().setMapBearing(0);
    mapRef.current?.setNorthUp();
  }, []);

  const onNorthLongPress = useCallback(() => {
    headingFollowRef.current = false;
    lastCompassTapAt.current = Date.now();
    setHeadingFollow(false);
    mapRef.current?.setHeadingFollow(false);
    useHomeMapUiStore.getState().setMapBearing(0);
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.setNorthUp();
  }, []);

  const onCalibrateCompass = useCallback(() => {
    resetNativeMapCompass();
    setCalibrateOpen(true);
  }, []);

  useEffect(() => {
    if (!tourPlaceDemo) {
      if (tourPopupRef.current) {
        tourPopupRef.current = false;
        popupHoldRef.current = false;
        useHomeMapUiStore.getState().setPlacePopup(null);
      }
      return;
    }
    void (async () => {
      const places = buildPlacePayloads().filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
      );
      const pick =
        places.find((p) => p.story) ||
        places[0] ||
        null;
      if (!pick) return;
      tourPopupRef.current = true;
      popupHoldRef.current = true;
      // Kein Kamerasprung — Vertrag: nur Recenter-Button oder Nav-Route.
      mapRef.current?.releaseFollow();
      const poi = poisRef.current.find((p) => p.id === pick.id) ?? null;
      useHomeMapUiStore.getState().setPlacePopup(
        instantMapPlacePopup({
          id: pick.id,
          name: pick.name,
          category: pick.category,
          lat: pick.lat,
          lng: pick.lng,
          poi,
        }),
      );
      if (pick.id > 0) void prioritizeMapPlacePreview(pick.id);
      const preview = useHomeMapUiStore.getState().placePopup;
      if (preview) void enrichMapPlaceMapsIfListed(preview);
    })();
  }, [buildPlacePayloads, tourPlaceDemo]);

  return (
    <View
      style={[
        styles.root,
        { top: Math.max(0, hudHeight - 8), bottom: bottomChrome },
      ]}
      pointerEvents="box-none"
    >
      <NativeHomeMapView
        ref={mapRef}
        extract={mapExtract}
        places={mapPlaces}
        cities={mapCities}
        route={mapRoute}
        walkTrack={walkTrack}
        dropPin={dropPin}
        locationFollow={locationFollow}
        headingFollow={headingFollow}
        chromeDim={chromeDim}
        initialLat={initialLat}
        initialLng={initialLng}
        initialZoom={initialZoom}
        onReady={onNativeReady}
        onUserPan={onNativeUserPan}
        onGestureStart={onNativeMapGestureStart}
        onGestureEnd={onNativeMapGestureEnd}
        onBearing={onNativeMapBearing}
        onViewport={onNativeViewport}
        onPlaceTap={onNativePlaceTap}
        onDropPin={onNativeDropPin}
        onBlankTap={onNativeBlankTap}
      />
      <View style={styles.topFade} pointerEvents="none" />
      <HomeMapExploreChip
        line={exploreLine}
        top={12}
        onRecenter={onRecenter}
        onRecenterLock={onRecenterLock}
        onNorthUp={onNorthUp}
        onNorthLongPress={onNorthLongPress}
        onCalibrate={onCalibrateCompass}
        locationFollow={locationFollow}
        headingFollow={headingFollow}
        needsCalibration={needsCalibration}
        calibrating={calibrateOpen}
      />
      <CompassCalibrateModal
        visible={calibrateOpen}
        cityId={cityId}
        onClose={() => {
          setCalibrateOpen(false);
          restoreCompassLockForActiveCity();
          setNeedsCalibration(needsCompassCalibration());
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: UI_LAYER.avatar - 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 28,
    backgroundColor: 'transparent',
  },
});
