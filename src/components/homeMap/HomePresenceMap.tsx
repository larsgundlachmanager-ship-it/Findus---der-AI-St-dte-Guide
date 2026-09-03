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
import { useSensorStore } from '../../store/useSensorStore';
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
  HOME_MAP_FILTER_IDS,
  homeMapFilterIdsForPoi,
  type HomeMapFilterId,
} from '../../services/homeMap/homeMapPlaceFilter';
import { isAmenityIconEnabled } from '../../services/homeMap/homeMapAmenityIconPrefs';
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
  MAP_VIEWPORT_PACK_CITY_LIMIT,
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
  isTransitIconLod,
  type HomeMapPlaceIcon,
} from '../../services/homeMap/homeMapPlaceType';
import {
  bindMapPlacePreview,
  instantMapPlacePopup,
  MAP_DROP_PIN_ID,
  prefetchVisibleMapPlaces,
  prioritizeMapPlacePreview,
  skeletonMapPlacePopup,
} from '../../services/homeMap/mapPlacePreview';
import { MAP_BASEMAP_POI_ID } from '../../services/homeMap/basemapFeatureQuery';
import { noteUiTap } from '../../services/diagnostics/interactionDelay';
import {
  hydrateDisplayExtract,
  peekCityMapExtract,
  peekDisplayExtract,
  rememberDisplayExtract,
  flushDisplayExtractNow,
  scheduleIdleCityMapExtract,
  ensureCityMapExtract,
  prefetchCityMapExtract,
  deleteCityMapExtractFile,
  type CityMapExtract,
} from '../../services/homeMap/cityMapExtract';
import { useHomeOverlayStore } from '../../store/useHomeOverlayStore';
import { useHomeMapUiStore } from '../../store/useHomeMapUiStore';
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
  onMapGpsFog,
} from '../../services/homeMap/mapSceneController';
import { loadExtractForViewport, invalidateLocalMapIndex, warmLocalMapIndex } from '../../services/homeMap/mapExtractLoader';
import {
  HOME_MAP_FOOTPRINTS_AFTER_MS,
  HOME_MAP_PLACES_AFTER_EXTRACT_MS,
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
  flushLastMapGpsNow,
} from '../../services/location/lastKnownMapGps';
import {
  isSplashCurtainUp,
  noteSplashMapCoreReady,
  noteSplashMapFogReady,
  noteSplashMapInteractive,
  noteSplashMapPlacesReady,
} from '../../services/homeMap/splashReadyGate';
import {
  MAP_CITY_PARTIAL_DEADLINE_MS,
  MAP_CITY_RADIUS_M,
  MAP_NEAR_RADIUS_M,
  beginMapLoadPhases,
  isMapExtractFrozen,
  noteMapCityFinal,
  noteMapNearReady,
  noteMapPlacesReady,
  peekMapLoadPhases,
  releaseMapWorld,
  shouldSkipSameCityReclip,
} from '../../services/homeMap/mapLoadPhases';
import {
  hydrateHomeMapHudFollowPrefs,
  noteHomeMapHudFollowPrefs,
  peekHomeMapHudFollowPrefs,
} from '../../services/homeMap/homeMapHudFollowPrefs';
import {
  packRingNeedsTileSnap,
  resolvePlaceFillRing,
  type LatLngRing,
} from '../../services/homeMap/extractBuildingUnderPin';
import { getSmoothedSpeedMs } from '../../services/navigation/transportMode';
import {
  homeMapViewSpanM,
  capMapPlacesForView,
  placeCapForMapView,
  skipPlaceRingsForView,
  warmupSettleRingsM,
} from '../../services/homeMap/homeMapWarmupRings';
import { waitMapIdle } from '../../services/homeMap/mapIdleGate';
import {
  isMapUserGesturing,
  registerMapGestureProbe,
} from '../../services/homeMap/mapGestureLane';
import {
  noteMapDataPainted,
  resetMapDataCache,
} from '../../services/homeMap/mapDataCache';
import {
  isMapLayerDebugEnabled,
  isMapLayerDebugExtractLocked,
  mapLayerDebugAllows,
  resetMapLayerDebugStep,
} from '../../services/homeMap/mapLayerDebug';
import { isVectorBasemapEnabled } from '../../services/homeMap/mapTileConfig';
import { isMapExtractRoadsSane } from '../../services/homeMap/mapExtractSanity';
import { isCityPackDownloaded, isYorroMapContentAllowed } from '../../services/homeMap/mapPackGate';
import { promptCityPackDownloadIfNeeded, ensureBrowsePackAtViewport } from '../../services/homeMap/mapPackPrompt';
import { MapLayerDebugHud } from './MapLayerDebugHud';

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
  filterTags: HomeMapFilterId[];
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
  // Achsen-Boxen sind nie echte OSM-Umrisse → kein Fill (Tile-Snap übernimmt).
  if (isAxisAlignedBoxPolygon(poly)) return null;
  const tags = parseTagsJson(poi.tags_json);
  // map_point ist ein reiner GPS-Marker — nie als Fläche zeichnen.
  if (tags.includes('map_point')) return null;
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
  /** Gebäudeumrisse aus der Vector-Basemap (queryRenderedFeaturesAtPoint). */
  const tileFootprintsRef = useRef<Map<number, LatLngRing>>(new Map());
  /** POIs schon per Tile-Snap versucht (auch ohne Treffer) — kein Requery-Sturm. */
  const tileSnapTriedRef = useRef<Set<number>>(new Set());
  const tileSnapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runTileFootprintSnapRef = useRef<() => void>(() => undefined);
  const enrichRunningRef = useRef(false);
  const lastGpsTapAt = useRef(0);
  const lastCompassTapAt = useRef(0);
  const ignoreUserPanUntil = useRef(0);
  const lastFollowGps = useRef<{ lat: number; lng: number } | null>(null);
  const didCameraLock = useRef(false);
  /** Boot-jumpTo nur 1× — Remount/onReady darf nicht erneut auf GPS ziehen. */
  const didBootJumpRef = useRef(false);
  /** Extract-Boot nur 1× — MapView-Remount sonst ShapeSource-Sturm → Kamera-Snap. */
  const didExtractBootRef = useRef(false);
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
  /** Token für verzögertes Nav-Ranzoomen (Overview → Nah). */
  const pendingNavZoomTokenRef = useRef(0);
  const placesInjectGen = useRef(0);
  const popupHoldRef = useRef(false);
  const ignorePlaceTapUntil = useRef(0);
  const lastPlacesSig = useRef('');
  const placesBootCommittedRef = useRef(false);
  /** Mindestens einmal Orte mit Inhalt gezeichnet (Pack-Race nach Stadtwechsel). */
  const placesHadContentRef = useRef(false);
  /** Filter-Tap darf Places auch zwischen Splash und Final neu setzen. */
  const placesForceRef = useRef(false);
  /** Nach Final-Places: kein weiteres Places-Paint (außer Filter). */
  const placesFinalDoneRef = useRef(false);
  /** Cities-Layer Force (Boot / Final / Filter). */
  const citiesForceRef = useRef(false);
  /** User hat die Karte schon bewegt (Session) — Final wartet auf Idle, fällt nicht weg. */
  const mapUserExploredRef = useRef(false);
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
  /** Idle: Orte für Viewport-Pack(s) nachladen (Prisdorf↔Hamburg↔Lissabon). */
  const viewportPlacesRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastViewportPackAtRef = useRef<string | null>(null);
  const poisRef = useRef<Poi[]>([]);
  const injectPlacesOnlyRef = useRef<() => void>(() => undefined);
  const mapPlacesPaintSigRef = useRef('');
  const mapExtractPaintSigRef = useRef('');
  const mapExtractPaintLockedRef = useRef(false);
  const [mapExtractLocal, setMapExtract] = useState<CityMapExtract | null>(null);
  const mapExtractFromStore = useMapExtractStore((s) => s.extract);
  const [mapExtractPaint, setMapExtractPaint] = useState<CityMapExtract | null>(
    mapExtractFromStore ?? mapExtractLocal,
  );
  const mapExtractDeferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapExtract = mapExtractPaint ?? mapExtractFromStore ?? mapExtractLocal;

  useEffect(() => {
    const next = mapExtractFromStore ?? mapExtractLocal;
    if (mapExtractDeferTimer.current) {
      clearTimeout(mapExtractDeferTimer.current);
      mapExtractDeferTimer.current = null;
    }
    const commit = () => {
      if (isMapLayerDebugExtractLocked() && mapExtractPaintLockedRef.current) return;
      if (next) mapExtractPaintLockedRef.current = true;
      setMapExtractPaint(next);
    };
    if (!next) {
      commit();
      return;
    }
    const waitGestureClear = () => {
      if (isMapUserGesturing()) {
        mapExtractDeferTimer.current = setTimeout(waitGestureClear, 350);
        return;
      }
      commit();
    };
    if (isMapUserGesturing() || userMapGestureRef.current) {
      waitGestureClear();
      return () => {
        if (mapExtractDeferTimer.current) {
          clearTimeout(mapExtractDeferTimer.current);
        }
      };
    }
    commit();
  }, [mapExtractFromStore, mapExtractLocal]);
  const [mapPlaces, setMapPlaces] = useState<NativeMapPlace[]>([]);
  const [mapCities, setMapCities] = useState<NativeMapCity[]>([]);
  const [mapRoute, setMapRoute] = useState<NavRouteMapPayload | null>(null);
  const [dropPin, setDropPin] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const pois = useFinnusStore((s) => s.pois);
  poisRef.current = pois;
  const poisByIdRef = useRef(new Map<number, (typeof pois)[number]>());
  useEffect(() => {
    const m = new Map<number, (typeof pois)[number]>();
    for (const p of pois) m.set(p.id, p);
    poisByIdRef.current = m;
  }, [pois]);
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const mapFilters = useHomeMapUiStore((s) => s.filters);
  const amenityIcons = useHomeMapUiStore((s) => s.amenityIcons);
  const seekVisible = useHomeOverlayStore((s) => s.seekVisible);
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
    void hydrateHomeMapHudFollowPrefs();
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
  /** Nur hasPack — Yorro-Orte/Nav-Gate (Vector-Basemap). */
  const localPackIdsRef = useRef<string[]>([]);
  const packContentAllowedRef = useRef<boolean | null>(null);

  const storeProfile = useUserProfileStore((s) => s.profile);
  const profile = storeProfile ?? getCachedUserProfile();
  const cityId = (profile?.cityId ?? '').toLowerCase() || null;
  const bounds = resolveCityCoverageBoundsSync(cityId);

  const yorroContentAt = useCallback(
    (viewportLat?: number | null, viewportLng?: number | null) => {
      const known = listKnownCityCoverageBounds();
      return isYorroMapContentAllowed({
        cityId,
        localPackIds: localPackIdsRef.current,
        viewportLat,
        viewportLng,
        view: viewRef.current,
        coverageBounds: known,
        locateCity: (la, ln) => smallestCityIdContainingPoint(la, ln, known),
      });
    },
    [cityId],
  );

  const maybePromptPackAt = useCallback(
    (viewportLat: number, viewportLng: number, cityEnter = false) => {
      if (!isVectorBasemapEnabled()) return;
      void promptCityPackDownloadIfNeeded({
        viewportLat,
        viewportLng,
        cityId,
        localPackIds: localPackIdsRef.current,
        cityEnter,
      });
    },
    [cityId],
  );

  /** Swipe in Nachbarstadt → Pack still als Zubringer (GPS-Stadt bleibt). */
  const maybeEnsureBrowsePackAt = useCallback(
    (viewportLat: number, viewportLng: number) => {
      if (!isVectorBasemapEnabled()) return;
      const known = listKnownCityCoverageBounds();
      const gpsLat =
        gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat ?? null;
      const gpsLng =
        gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng ?? null;
      let stickyCityId: string | null = null;
      if (
        typeof gpsLat === 'number' &&
        typeof gpsLng === 'number' &&
        Number.isFinite(gpsLat) &&
        Number.isFinite(gpsLng)
      ) {
        stickyCityId =
          smallestCityIdContainingPoint(gpsLat, gpsLng, known)?.toLowerCase() ??
          null;
      }
      void ensureBrowsePackAtViewport({
        viewportLat,
        viewportLng,
        profileCityId: cityId,
        stickyCityId,
        localPackIds: localPackIdsRef.current,
      }).then(async (res) => {
        if (!res?.ready || !res.cityId) return;
        try {
          const rows = await listLocalCityDatasets();
          localPackIdsRef.current = rows
            .filter((row) => row.hasPack)
            .map((row) => row.id.toLowerCase());
          localOfflineCityIdsRef.current = rows
            .filter((row) => row.hasPack || row.hasMap)
            .map((row) => row.id.toLowerCase())
            .filter((id) => id && !isRegionPackCityId(id));
        } catch {
          /* soft */
        }
        if (!localPackIdsRef.current.includes(res.cityId)) {
          localPackIdsRef.current = [
            ...localPackIdsRef.current,
            res.cityId,
          ];
        }
        lastViewportPackAtRef.current = res.cityId;
        if (userMapGestureRef.current || isMapUserGesturing()) return;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
        citiesForceRef.current = true;
        injectCitiesRef.current();
        citiesForceRef.current = false;
      });
    },
    [cityId],
  );

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
      // Stadtwechsel: Tile-Snap-Umrisse gehören zur alten POI-Menge.
      tileFootprintsRef.current.clear();
      tileSnapTriedRef.current.clear();
      followRef.current = false;
      didCameraLock.current = true;
      headingFollowRef.current = false;
      locationFollowRef.current = false;
      lastGpsTapAt.current = 0;
      lastCompassTapAt.current = 0;
      setHeadingFollow(false);
      setLocationFollow(false);
      if (isMapLayerDebugEnabled()) resetMapLayerDebugStep();
      // Pack-Popup nur bei echtem Stadtwechsel (nicht Pan/Zoom/Blank-Tap).
      const lat = gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
      const lng = gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        maybePromptPackAt(lat, lng, true);
      }
    }
  }, [cityId, maybePromptPackAt]);

  useEffect(() => {
    return registerMapGestureProbe(() => userMapGestureRef.current);
  }, []);

  useEffect(() => {
    void applyCompassLockForCity(cityId);
  }, [cityId]);

  // Display-Extract: RAM/Disk warm — kein Push während Geste / 3-Release / nach Freeze.
  useEffect(() => {
    if (isVectorBasemapEnabled()) return;
    const id = (cityId || env.cityId() || '').toLowerCase();
    if (!id) return;
    if (isMapLayerDebugExtractLocked()) return;
    if (isMapUserGesturing()) return;
    const phases = peekMapLoadPhases();
    if (phases.paintRelease > 0 && phases.paintRelease < 3) return;
    if (isMapExtractFrozen(id)) return;
    const view = viewRef.current;
    const seed = seedMapCameraGps();
    const lat =
      (mapUserExploredRef.current && view
        ? (view.south + view.north) / 2
        : null) ??
      seed?.lat ??
      gpsLatRef.current ??
      (bounds != null ? (bounds.latMin + bounds.latMax) / 2 : null);
    const lng =
      (mapUserExploredRef.current && view
        ? (view.west + view.east) / 2
        : null) ??
      seed?.lng ??
      gpsLngRef.current ??
      (bounds != null ? (bounds.lngMin + bounds.lngMax) / 2 : null);
    const mem = peekDisplayExtract(id);
    if (mem?.extract) {
      if (!isMapExtractRoadsSane(mem.extract)) {
        useMapExtractStore.getState().clear();
        void deleteCityMapExtractFile(id).catch(() => undefined);
      } else {
        useMapExtractStore.getState().setExtract(id, mem.extract, {
          lat: mem.lat,
          lng: mem.lng,
        });
        extractCityIdRef.current = id;
        extractClipCenterRef.current = { lat: mem.lat, lng: mem.lng };
        return;
      }
    }
    void (async () => {
      const snap = (await hydrateDisplayExtract(id)) ?? peekDisplayExtract(id);
      if (!snap?.extract || !isMapExtractRoadsSane(snap.extract)) {
        if (lat != null && lng != null) {
          void loadExtractForViewport(lat, lng, {
            force: true,
            urgent: true,
            cityId: id,
          });
        } else {
          void prefetchCityMapExtract(id);
        }
        return;
      }
      useMapExtractStore.getState().setExtract(id, snap.extract, {
        lat: snap.lat,
        lng: snap.lng,
      });
      extractCityIdRef.current = id;
      extractClipCenterRef.current = { lat: snap.lat, lng: snap.lng };
      if (lat != null && lng != null) {
        const drift = metersBetween(lat, lng, snap.lat, snap.lng);
        if (
          drift > 1_400 &&
          !isMapExtractFrozen(id) &&
          !shouldSkipSameCityReclip(id) &&
          !mapUserExploredRef.current &&
          !isMapUserGesturing()
        ) {
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
      if (tileSnapTimer.current) {
        clearTimeout(tileSnapTimer.current);
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
      const shelterBldg = isMapShelterBuildingPoi(poi);
      // Stadt-Übersicht: Directory-Noise weglassen — aber Always-On-Icons behalten
      // (sonst fehlen Restaurant/Arzt nach Places-Freeze beim Reinzoomen).
      if (
        cityScale &&
        !story &&
        !shelterBldg &&
        !isModul1AutoTriggerMapPoi(poi, profile) &&
        !isKeepDotMapPoi(poi) &&
        !isStreetPointAmenity(poi) &&
        !isAlwaysOnMapAmenity(poi) &&
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
      const amenityDot = isStreetPointAmenity(poi) || shelterBldg;
      const rawIcon = placeMapIcon(poi) ?? undefined;
      const iconAllowed = isAmenityIconEnabled(amenityIcons, rawIcon);
      const keepTransitIcon = isTransitIconLod(
        rawIcon ? homeMapIconLod(rawIcon, poi) : null,
      );
      // Story-Halt: nie Bahnsteig-Fill → sonst Icon weg, nur lila Punkt.
      // Wartehäuschen: Punkt+Historic-Icon, kein Fill das das Icon frisst.
      const keepDotForced =
        keepTransitIcon ||
        shelterBldg ||
        (isKeepDotMapPoi(poi) && !story);
      const filterTags = homeMapFilterIdsForPoi(poi, {
        visited,
        planned: isPlanned,
        profile,
      });
      // Amenity-Bypass nur wenn Icon erlaubt — Orte steuert die Karte, nicht M1.
      const amenityBypass =
        iconAllowed && (amenityDot || isAlwaysOnMapAmenity(poi));
      if (!amenityBypass && filterTags.length === 0) {
        continue;
      }
      const packOrOsm = keepDotForced || skipRings
        ? null
        : ringFromPoi(poi, osmFootprintsRef.current.get(poi.id));
      // Live aus Store — nach Extract-Inject noch vor dem nächsten Render.
      const extractBuildings =
        useMapExtractStore.getState().extract?.buildings ??
        mapExtract?.buildings;
      // Vector-Basemap: extract leer → Tile-Snap-Umriss als Gebäude-Kandidat.
      const tileRing = tileFootprintsRef.current.get(poi.id);
      const buildingCandidates: LatLngRing[] | undefined = tileRing
        ? extractBuildings && extractBuildings.length
          ? [tileRing, ...extractBuildings]
          : [tileRing]
        : extractBuildings;
      // Fill = dasselbe Haus wie Extract-Umriss unter dem Pin (kein versetztes Pack-Viereck).
      const ring =
        keepDotForced || skipRings
          ? null
          : resolvePlaceFillRing(
              Number(poi.lat),
              Number(poi.lng),
              packOrOsm,
              buildingCandidates,
              { name: poi.name, category: poi.category },
            );
      const hasBuilding = !keepDotForced && !!(ring && ring.length >= 3);
      // Gebäudeumriss schlägt Icon-Punkt — Statusfarbe als Fläche.
      // Ausnahme ÖPNV: Bahn-Icon behalten (sonst nur Story-Punkt auf den Gleisen).
      const keepDot = !hasBuilding;
      const wegweiserTarget =
        pendingNavOffer?.source === 'wegweiser' &&
        pendingNavOffer.awaitConfirm === true &&
        pendingNavOffer.poiId === poi.id;
      const rawIconForMap =
        iconAllowed && !(hasBuilding && !keepTransitIcon) ? rawIcon : undefined;
      const icon = rawIconForMap;
      out.push({
        id: poi.id,
        name: poi.name,
        lat: Number(poi.lat),
        lng: Number(poi.lng),
        color: wegweiserTarget
          ? HOME_MAP_PLACE_COLORS.planned
          : colorForHomeMapPoi(poi, profile, visited, { planned: isPlanned }),
        radiusM: Math.max(18, Math.min(80, poi.radius_meters || 30)),
        // Transit: nie Ring — exclusiveHomeMapPlaces würde sonst Fill erzwingen und Icon löschen.
        ring: keepDot || keepTransitIcon ? null : slimRing(ring),
        spotKey: poi.spot_key,
        category: categoryLabelForPoi(poi),
        story: story ? 1 : 0,
        pointOnly: keepDot || keepTransitIcon,
        keepDot: keepDot || keepTransitIcon,
        // Nur echte Punkt-Amenities (Briefkasten/Halt/…) — Stories behalten Fill.
        // Transit-Stories: Icon-Punkt, kein Riesen-Bahnsteig-Fill.
        amenityDot:
          amenityDot ||
          keepTransitIcon ||
          (!!icon && !hasBuilding && !story),
        // Cap: ÖPNV/Briefkasten zuerst — nicht jedes Restaurant killt Stories.
        keepPin: amenityDot || keepTransitIcon,
        icon,
        iconLod: icon ? homeMapIconLod(icon, poi) : undefined,
        filterTags,
      });
    }
    return exclusiveHomeMapPlaces(out);
  }, [
    amenityIcons,
    bounds,
    cityId,
    mapExtract?.buildings,
    pendingNavOffer,
    pois,
    profile,
    visitedHistory,
  ]);

  const scheduleNeighborPackPlacesMerge = useCallback(
    (baseVisible: PlacePayload[], genAtStart: number) => {
      const viewForNeighbors = viewRef.current;
      if (!viewForNeighbors || !isVectorBasemapEnabled()) return;
      const known = listKnownCityCoverageBounds();
      const gpsLat =
        gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat ?? null;
      const gpsLng =
        gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng ?? null;
      let stickyCityId: string | null = null;
      if (
        typeof gpsLat === 'number' &&
        typeof gpsLng === 'number' &&
        Number.isFinite(gpsLat) &&
        Number.isFinite(gpsLng)
      ) {
        const at = smallestCityIdContainingPoint(gpsLat, gpsLng, known);
        if (at && isCityPackDownloaded(at, localPackIdsRef.current)) {
          stickyCityId = at.toLowerCase();
        }
      }
      if (
        !stickyCityId &&
        cityId &&
        isCityPackDownloaded(cityId, localPackIdsRef.current)
      ) {
        stickyCityId = cityId;
      }
      void loadNeighborPinsInViewport({
        view: viewForNeighbors,
        activeCityId: cityId,
        stickyCityId,
        maxCities: MAP_VIEWPORT_PACK_CITY_LIMIT,
      })
        .then((neighbors) => {
          if (!neighbors.length) return;
          if (genAtStart !== placesInjectGen.current) return;
          if (userMapGestureRef.current || isMapUserGesturing()) return;
          if (popupHoldRef.current) return;
          const overlayMap = new Map<
            number,
            { name: string; cityId: string; lat: number; lng: number }
          >();
          const extra: PlacePayload[] = [];
          for (const p of neighbors) {
            const oid = overlayPinId(p.cityId, p.id);
            overlayMap.set(oid, {
              name: p.name,
              cityId: p.cityId,
              lat: p.lat,
              lng: p.lng,
            });
            let icon: HomeMapPlaceIcon | undefined;
            let iconLod: ReturnType<typeof homeMapIconLod> | undefined;
            if (p.category) {
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
            extra.push({
              id: oid,
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              color: p.liked
                ? HOME_MAP_PLACE_COLORS.liked
                : p.story
                  ? HOME_MAP_PLACE_COLORS.neutral
                  : HOME_MAP_PLACE_COLORS.rest,
              radiusM: p.radiusM || 30,
              ring,
              category: p.category || p.cityId,
              story: p.story,
              pointOnly: !ring,
              keepDot: !ring,
              amenityDot: !ring && !p.story,
              icon,
              iconLod,
              filterTags: (['story'] as HomeMapFilterId[]),
            });
          }
          if (!extra.length) return;
          const merged = exclusiveHomeMapPlaces([...baseVisible, ...extra]);
          const mergeCap = placeCapForMapView(
            placeRadiusRef.current,
            homeMapViewSpanM(viewForNeighbors),
          );
          let next = merged;
          if (next.length > mergeCap) {
            const oLat =
              (viewForNeighbors.south + viewForNeighbors.north) / 2;
            const oLng =
              (viewForNeighbors.west + viewForNeighbors.east) / 2;
            next = capMapPlacesForView(next, mergeCap, (pl) =>
              metersBetween(pl.lat, pl.lng, oLat, oLng),
            );
          }
          const mergeSig = next
            .map(
              (p) => `${p.id}:${p.color}:${p.story || 0}:${p.keepDot ? 1 : 0}`,
            )
            .join('|');
          if (mergeSig === lastPlacesSig.current) return;
          lastPlacesSig.current = mergeSig;
          mapPlacesPaintSigRef.current = mergeSig;
          overlayPinsRef.current = overlayMap;
          setMapPlaces(next);
          prefetchVisibleMapPlaces(next.map((p) => p.id));
        })
        .catch(() => undefined);
    },
    [cityId],
  );

  const injectPlacesOnly = useCallback(() => {
    if (!readyRef.current) return;
    if (isVectorBasemapEnabled()) {
      const view = viewRef.current;
      const vLat =
        (view ? (view.south + view.north) / 2 : null) ??
        gpsLatRef.current ??
        null;
      const vLng =
        (view ? (view.west + view.east) / 2 : null) ??
        gpsLngRef.current ??
        null;
      if (!yorroContentAt(vLat, vLng)) {
        const navOn = useFinnusStore.getState().navActive;
        // Nav-Kamera darf kurz Pack-Zone verlassen — Orte nicht verwerfen.
        // Profil-Pack + schon Inhalt: nicht leer wischen (Gate-Race / Coverage).
        const profilePack =
          !!cityId &&
          isCityPackDownloaded(cityId, localPackIdsRef.current);
        if (
          !(navOn && placesHadContentRef.current) &&
          !(profilePack && placesHadContentRef.current)
        ) {
          setMapPlaces([]);
        }
        return;
      }
    }
    if (
      isMapLayerDebugEnabled() &&
      !mapLayerDebugAllows('places') &&
      !placesForceRef.current
    ) {
      return;
    }
    if (popupHoldRef.current) return;
    if (isMapUserGesturing()) return;
    // Während Pan/Drehen: kein Places-ShapeSource-Update (Kamera-Snap).
    if (userMapGestureRef.current) return;
    // Places: nur Boot/Final/Filter mit Force — sonst still (auch nach Final).
    if (placesBootCommittedRef.current && !placesForceRef.current) {
      return;
    }
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
    const chipFilters = useHomeMapUiStore.getState().filters;
    const allFiltersOn = HOME_MAP_FILTER_IDS.every((id) => chipFilters[id]);
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
              filterTags: ['story' as HomeMapFilterId],
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
      scheduleNeighborPackPlacesMerge(visible, placesInjectGen.current);
      return;
    }
    lastPlacesSig.current = sig;
    mapPlacesPaintSigRef.current = sig;
    const gen = ++placesInjectGen.current;
    overlayPinsRef.current.clear();
    placesBootCommittedRef.current = true;
    if (visible.length > 0) placesHadContentRef.current = true;
    if (peekMapLoadPhases().phase === 'final') {
      placesFinalDoneRef.current = true;
    }
    noteMapDataPainted(cityId, 'places');
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
    // Nachbar-Packs im Viewport (Multi-Stadt) — Merge nach Idle, nicht während Geste.
    scheduleNeighborPackPlacesMerge(visible, placesInjectGen.current);
  }, [
    buildPlacePayloads,
    cityId,
    pois,
    profile,
    scheduleNeighborPackPlacesMerge,
    yorroContentAt,
  ]);
  injectPlacesOnlyRef.current = injectPlacesOnly;

  // Orte-Chips: MapLibre Layer-Filter — kein GeoJSON-Rebuild (Kamera-Snap).
  // Amenity-Icons: nach Idle einmal — nie während Geste (ShapeSource-Snap).
  useEffect(() => {
    if (!readyRef.current || !placesBootCommittedRef.current) return;
    if (userMapGestureRef.current || isMapUserGesturing()) return;
    lastPlacesSig.current = '';
    placesForceRef.current = true;
    injectPlacesOnlyRef.current();
    placesForceRef.current = false;
  }, [amenityIcons]);

  const injectOfflineMapExtract = useCallback(
    async (
      force = false,
      center?: { lat: number; lng: number } | null,
      radiusM?: number,
      preferCityId?: string | null,
      urgent = false,
    ) => {
      if (isVectorBasemapEnabled()) return;
      if (!readyRef.current) return;
      const mayBypassGesture = urgent && !mapUserExploredRef.current;
      if (isMapUserGesturing() && !mayBypassGesture) return;
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
      // radiusM nur setzen wenn explizit (Boot = Near). Pan/Idle → Display-Wide.
      // preferCityId = Viewport-Overlap (Tornesch sichtbar) — unabhängig von Modul-1.
      return loadExtractForViewport(lat, lng, {
        force,
        urgent: (urgent || citySwitch) && !mapUserExploredRef.current,
        ...(radiusM != null ? { radiusM } : {}),
        ...(preferCityId ? { cityId: preferCityId } : {}),
      });
    },
    [cityId],
  );

  const applyMapLayerDebugStepEffects = useCallback(
    async (step: number) => {
      if (!isMapLayerDebugEnabled() || !readyRef.current) return;
      const activeId = (cityId || env.cityId() || '').toLowerCase() || null;
      const nearLat =
        gpsLatRef.current ??
        seedMapCameraGps()?.lat ??
        useFinnusStore.getState().lastGpsLat ??
        null;
      const nearLng =
        gpsLngRef.current ??
        seedMapCameraGps()?.lng ??
        useFinnusStore.getState().lastGpsLng ??
        null;

      if (step >= 1) {
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
        noteMapPlacesReady(activeId);
      }
      if (step >= 4) {
        try {
          const track = await loadWalkTrack();
          setWalkTrack(track);
          if (!isMapUserGesturing()) forceFogRecompute(track);
        } catch {
          /* soft */
        }
      }
      if (step >= 5) {
        citiesForceRef.current = true;
        injectCitiesRef.current();
        citiesForceRef.current = false;
      }
      if (step >= 6 && nearLat != null && nearLng != null) {
        await waitMapIdle({
          isGesturing: () => userMapGestureRef.current,
          quietMs: 800,
        });
        await injectOfflineMapExtract(
          true,
          { lat: nearLat, lng: nearLng },
          MAP_CITY_RADIUS_M,
          activeId,
          false,
        );
        noteMapCityFinal(activeId);
        noteMapDataPainted(activeId, 'final');
        placesFinalDoneRef.current = true;
      }
      if (step >= 7) {
        releaseMapWorld();
      }
    },
    [cityId, injectOfflineMapExtract],
  );

  // Orte-Sheet offen → nur Places neu (Extract nie — kein 4. Release).
  useEffect(() => {
    if (!seekVisible || !readyRef.current) return;
    if (!mapLayerDebugAllows('places')) return;
    lastPlacesSig.current = '';
    placesForceRef.current = true;
    injectPlacesOnlyRef.current();
    placesForceRef.current = false;
  }, [seekVisible, cityId]);

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
      if (isMapUserGesturing() && !opts?.urgent) return;
      const activeExtractId = useMapExtractStore.getState().cityId;
      const targetId = (opts?.cityId || '').toLowerCase();
      const citySwitch =
        !!targetId &&
        !!activeExtractId &&
        targetId !== activeExtractId.toLowerCase();
      // Freeze / settled: kein Nachladen — auch nicht force (nur echter Stadtwechsel).
      if (!citySwitch && isMapExtractFrozen(targetId || activeExtractId)) {
        return;
      }
      if (
        !citySwitch &&
        shouldSkipSameCityReclip(targetId || activeExtractId)
      ) {
        return;
      }
      const urgent = opts?.urgent === true || citySwitch;
      pendingExtractCenter.current = {
        lat,
        lng,
        cityId: opts?.cityId ?? null,
        force: citySwitch,
        urgent,
      };
      if (urgent) {
        void injectOfflineMapExtract(
          citySwitch,
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
      // Kill/Hintergrund: Kamera + Display-Snap sofort sichern — sonst Cold-Start ohne Cache.
      if (state === 'background' || state === 'inactive') {
        const view = viewRef.current;
        if (view) {
          const midLat = (view.south + view.north) / 2;
          const midLng = (view.west + view.east) / 2;
          if (Number.isFinite(midLat) && Number.isFinite(midLng)) {
            persistLastMapGpsSoon({
              lat: midLat,
              lng: midLng,
              zoom: seedMapCameraGps()?.zoom ?? undefined,
            });
          }
        }
        void flushLastMapGpsNow();
        void flushDisplayExtractNow();
        return;
      }
      if (state !== 'active') return;
      if (!readyRef.current) return;
      invalidateLocalMapIndex();
      const activeId =
        useMapExtractStore.getState().cityId ||
        (cityId || env.cityId() || '').toLowerCase() ||
        null;
      // Settled Stadt: kein Force-Reclip beim App-Zurück — nur Index warmhalten.
      if (isMapExtractFrozen(activeId) || shouldSkipSameCityReclip(activeId)) return;
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
  }, [cityId, injectOfflineMapExtract, queueViewportExtract]);

  const scheduleHeavyMapOverlays = useCallback(() => {
    // Nur Force (Boot/Final/Filter) — kein POI-Effekt-Churn.
    if (placesBootCommittedRef.current && !placesForceRef.current) {
      return;
    }
    if (isMapUserGesturing()) return;
    overlaysEnabledRef.current = true;
    if (heavyOverlayTimer.current) {
      clearTimeout(heavyOverlayTimer.current);
      heavyOverlayTimer.current = null;
    }
    const run = () => {
      if (userMapGestureRef.current) {
        heavyOverlayTimer.current = setTimeout(run, 400);
        return;
      }
      injectPlacesOnlyRef.current();
      // Vector-Basemap: nach dem Places-Paint Umrisse aus den Kacheln snappen.
      if (isVectorBasemapEnabled()) {
        if (tileSnapTimer.current) clearTimeout(tileSnapTimer.current);
        tileSnapTimer.current = setTimeout(() => {
          tileSnapTimer.current = null;
          runTileFootprintSnapRef.current();
        }, 700);
      }
    };
    // Orte sofort (Pin-Index / SQLite) — nicht hinter Idle-Queue verstecken.
    if (HOME_MAP_PLACES_AFTER_EXTRACT_MS <= 0) {
      run();
      return;
    }
    InteractionManager.runAfterInteractions(() => {
      if (heavyOverlayTimer.current) clearTimeout(heavyOverlayTimer.current);
      heavyOverlayTimer.current = setTimeout(run, HOME_MAP_PLACES_AFTER_EXTRACT_MS);
    });
  }, []);

  // POIs nachgeladen → Story-Orte erneut zeichnen (Race mit Map-Ready / Stadtwechsel).
  useEffect(() => {
    if (!readyRef.current || !pois.length) return;
    if (enrichRunningRef.current) return;
    if (userMapGestureRef.current || isMapUserGesturing()) return;
    const cityMismatch =
      !!cityId && placesInjectedForCity.current !== cityId;
    // Pack kam nach leerem Places-Boot → Force (sonst placesBootCommitted sperrt).
    // Vector: nur einmal nachziehen wenn noch leer — kein POI-Churn-Rebuild.
    const needForce =
      cityMismatch ||
      !placesBootCommittedRef.current ||
      !placesHadContentRef.current;
    if (!needForce) return;
    const tryPaint = () => {
      if (userMapGestureRef.current) {
        setTimeout(tryPaint, 350);
        return;
      }
      placesForceRef.current = true;
      lastPlacesSig.current = '';
      injectPlacesOnlyRef.current();
      placesForceRef.current = false;
    };
    tryPaint();
  }, [pois, cityId]);

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

  // Vector-Basemap: Pack-Boxen / fehlende Umrisse auf den gerenderten
  // Protomaps-Gebäudeumriss unter dem Pin snappen (queryBuildingRingAt).
  const runTileFootprintSnap = useCallback(async () => {
    if (!isVectorBasemapEnabled()) return;
    if (!readyRef.current) return;
    if (userMapGestureRef.current || isMapUserGesturing()) return;
    const handle = mapRef.current;
    if (!handle?.queryBuildingRingAt) return;
    const list = poisRef.current;
    if (!list.length) return;
    const view = viewRef.current;
    let changed = false;
    let budget = 24;
    for (const poi of list) {
      if (budget <= 0) break;
      const id = poi.id;
      if (tileSnapTriedRef.current.has(id)) continue;
      const lat = Number(poi.lat);
      const lng = Number(poi.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (
        view &&
        (lat < view.south ||
          lat > view.north ||
          lng < view.west ||
          lng > view.east)
      ) {
        continue;
      }
      // Nur wo der Pack-Ring keine echte OSM-Hülle liefert (Box / fehlt / zu grob).
      const packRing = ringFromPoi(poi, osmFootprintsRef.current.get(id));
      if (packRing && !packRingNeedsTileSnap(packRing)) continue;
      budget -= 1;
      tileSnapTriedRef.current.add(id);
      try {
        const ring = await handle.queryBuildingRingAt(lat, lng);
        if (ring && ring.length >= 3) {
          tileFootprintsRef.current.set(id, ring);
          changed = true;
        }
      } catch {
        /* Soft-Fail: kein Snap für diesen Ort */
      }
    }
    if (changed && readyRef.current && !isMapUserGesturing()) {
      placesForceRef.current = true;
      lastPlacesSig.current = '';
      injectPlacesOnlyRef.current();
      placesForceRef.current = false;
    }
  }, []);
  runTileFootprintSnapRef.current = () => {
    void runTileFootprintSnap();
  };

  const runWarmupRings = useCallback(() => {
    // Vector: Orte einmal beim Boot — keine Warmup-Ring-Re-Injects (Kamera-Snap).
    if (isVectorBasemapEnabled()) {
      if (!placesBootCommittedRef.current) scheduleHeavyMapOverlays();
      return;
    }
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
    if (
      isMapLayerDebugEnabled() &&
      !mapLayerDebugAllows('cities') &&
      !citiesForceRef.current
    ) {
      return;
    }
    if (isVectorBasemapEnabled()) {
      const packIds = new Set(localPackIdsRef.current);
      if (packIds.size === 0) {
        setMapCities([]);
        return;
      }
    }
    if (isMapUserGesturing() && !citiesForceRef.current) return;
    const activeId = (cityId ?? '').toLowerCase();
    if (isMapExtractFrozen(activeId) && !citiesForceRef.current) return;
    // Zwischen Splash und Final: kein Cities-ShapeSource-Update (Snap).
    if (
      !isVectorBasemapEnabled() &&
      isSplashCurtainUp() &&
      peekMapLoadPhases().phase !== 'final' &&
      !citiesForceRef.current
    ) {
      return;
    }
    const localIds = isVectorBasemapEnabled()
      ? localPackIdsRef.current
      : localOfflineCityIdsRef.current;
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
        onProgress: () => {
          if (isMapUserGesturing()) return;
          injectCitiesRef.current();
        },
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
      if (readyRef.current && mapLayerDebugAllows('cities')) injectCitiesRef.current();
    });
    if (!isMapLayerDebugEnabled()) {
      void loadWalkTrack().then(setWalkTrack);
    }
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    if (isMapExtractFrozen((cityId || '').toLowerCase())) return;
    injectCities();
  }, [cityId, injectCities]);

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
      const minDeg = following ? 0.6 : 1.2;
      const minMs = following ? 16 : 48;
      if (jump < minDeg && now - lastSentAt < minMs) return;
      lastSent = d;
      lastSentAt = now;
      headingRef.current = d;
      // Backup: Sensor-Store + Puck (Scene-Controller kann fehlen / gefiltert sein).
      useSensorStore.getState().reportHeading(d);
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

  const applyHudFollowPrefs = useCallback(
    (prefs: { locationFollow: boolean; headingFollow: boolean }) => {
      ignoreUserPanUntil.current = Date.now() + 900;
      if (prefs.locationFollow) {
        locationFollowRef.current = true;
        followRef.current = true;
        setLocationFollow(true);
        mapRef.current?.reattachFollow();
        const lat = gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
        const lng = gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
        if (lat != null && lng != null) {
          mapRef.current?.jumpTo(lat, lng, 16, true);
        }
      } else {
        locationFollowRef.current = false;
        followRef.current = false;
        setLocationFollow(false);
        mapRef.current?.releaseFollow();
      }
      if (prefs.headingFollow) {
        headingFollowRef.current = true;
        setHeadingFollow(true);
        mapRef.current?.setHeadingFollow(true);
      } else {
        headingFollowRef.current = false;
        setHeadingFollow(false);
        mapRef.current?.setHeadingFollow(false);
      }
    },
    [],
  );

  // Walk track → fog schon beim Öffnen, nicht erst wenn Navigation startet
  useEffect(() => {
    injectWalkFog(!fogExpandedRef.current);
  }, [injectWalkFog, walkTrack]);

  const injectNavRoute = useCallback(() => {
    if (!readyRef.current) return;
    if (isVectorBasemapEnabled()) {
      const view = viewRef.current;
      const vLat =
        (view ? (view.south + view.north) / 2 : null) ??
        gpsLatRef.current ??
        null;
      const vLng =
        (view ? (view.west + view.east) / 2 : null) ??
        gpsLngRef.current ??
        null;
      if (!yorroContentAt(vLat, vLng)) {
        if (lastRouteJson.current !== 'null') {
          lastRouteJson.current = 'null';
          setMapRoute(null);
        }
        return;
      }
    }
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
    headingFollowRef.current = false;
    setLocationFollow(false);
    setHeadingFollow(false);
    mapRef.current?.releaseFollow();
    mapRef.current?.setHeadingFollow(false);
    // Überblick: Gesten-Echos vom Fit kurz ignorieren — danach Pan bleibt frei.
    // Nach Overview kurz ranzoomen (ohne Follow-Lock), damit die Route lesbar wird.
    ignoreUserPanUntil.current = Date.now() + 900;
    const gpsLat =
      gpsLatRef.current ?? useFinnusStore.getState().lastGpsLat;
    const gpsLng =
      gpsLngRef.current ?? useFinnusStore.getState().lastGpsLng;
    const nextPin =
      payload?.pins?.[0] ??
      payload?.previewPin ??
      null;
    const pts: { lat: number; lng: number }[] = [];
    if (gpsLat != null && gpsLng != null) {
      pts.push({ lat: gpsLat, lng: gpsLng });
    }
    // Alle nummerierten Stops (1+2), nicht nur der nächste — sonst falscher Ausschnitt.
    for (const p of payload?.pins ?? []) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
        pts.push({ lat: p.lat, lng: p.lng });
      }
    }
    if (
      nextPin &&
      Number.isFinite(nextPin.lat) &&
      Number.isFinite(nextPin.lng)
    ) {
      pts.push({ lat: nextPin.lat, lng: nextPin.lng });
    }
    // Gesamte Polyline in den Überblick, nicht nur GPS+Pin.
    for (const p of payload?.current ?? []) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
        pts.push({ lat: p.lat, lng: p.lng });
      }
    }
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
      // User-Ausschnitt: etwas Luft um die Route, kein Street-Tight-Fit.
      const padLat = Math.max((north - south) * 0.55, 0.0022);
      const padLng = Math.max((east - west) * 0.55, 0.0028);
      south -= padLat;
      north += padLat;
      west -= padLng;
      east += padLng;
      mapRef.current?.fitBounds(south, west, north, east, true);
      // Nach Overview: Ranzoomen ohne Follow — Finger kann jederzeit panzen.
      const zoomLat = gpsLat;
      const zoomLng = gpsLng;
      if (zoomLat != null && zoomLng != null) {
        const token = Date.now();
        pendingNavZoomTokenRef.current = token;
        setTimeout(() => {
          if (pendingNavZoomTokenRef.current !== token) return;
          if (!useFinnusStore.getState().navActive) return;
          if (Date.now() < ignoreUserPanUntil.current) return;
          try {
            const { isMapUserGesturing } = require('../../services/homeMap/mapGestureLane') as {
              isMapUserGesturing?: () => boolean;
            };
            if (isMapUserGesturing?.()) return;
          } catch {
            /* soft */
          }
          mapRef.current?.jumpTo(zoomLat, zoomLng, 15.8, true);
        }, 2200);
      }
      return;
    }
    if (gpsLat != null && gpsLng != null) {
      // Ohne Ziel-Pin: leichter Überblick (~14.6), kein Street-Lock 16.
      mapRef.current?.jumpTo(gpsLat, gpsLng, 14.6, true);
    }
  }, [yorroContentAt]);

  const wasNavActive = useRef(false);
  useEffect(() => {
    if (navActive && !wasNavActive.current) {
      lastRouteJson.current = '';
      pendingNavFitRef.current = true;
    }
    if (!navActive && wasNavActive.current) {
      pendingNavZoomTokenRef.current = 0;
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
        if (readyRef.current && hereNow && !isMapExtractFrozen(hereNow)) {
          injectCitiesRef.current();
        }
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
      if (newlyGreen && here && !isMapExtractFrozen(here)) {
        injectCitiesRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 4_000);
    return () => clearInterval(t);
  }, [cityId]);

  // Stadtwechsel (Einstellungen): 3 Releases — Outline → Places → Final.
  // Nur cityId in Deps — sonst re-triggert jeder Callback-Identitätswechsel
  // (Fast Refresh / LOD-Edits) Extract+Places → Ruckeln und Kamera-Snap.
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
      placesBootCommittedRef.current = false;
      placesFinalDoneRef.current = false;
      placesHadContentRef.current = false;
      // Freie Erkundung nach Wechsel — sonst springt die Kamera zurück.
      mapUserExploredRef.current = true;
      lastPlacesSig.current = '';
      followRef.current = false;
      didCameraLock.current = true;
      locationFollowRef.current = false;
      headingFollowRef.current = false;
      setLocationFollow(false);
      setHeadingFollow(false);
      beginMapLoadPhases(cityId);
      resetMapDataCache(cityId);
      useMapExtractStore.getState().setLoading(cityId);
      const fitBounds = resolveFitBounds(cityId);
      const jumpLat = fitBounds
        ? (fitBounds.latMin + fitBounds.latMax) / 2
        : null;
      const jumpLng = fitBounds
        ? (fitBounds.lngMin + fitBounds.lngMax) / 2
        : null;
      if (fitBounds && jumpLat != null && jumpLng != null) {
        viewRef.current = viewBoxFromCoverageBounds(fitBounds);
        ignoreUserPanUntil.current = Date.now() + 220;
        mapRef.current?.releaseFollow();
        mapRef.current?.setHeadingFollow(false);
        mapRef.current?.jumpTo(jumpLat, jumpLng, 13.2, true);
      }
      if (isVectorBasemapEnabled()) {
        noteMapNearReady(cityId);
        noteMapCityFinal(cityId);
        noteMapDataPainted(cityId, 'final');
        placesFinalDoneRef.current = true;
        if (yorroContentAt(jumpLat, jumpLng)) {
          placesForceRef.current = true;
          lastPlacesSig.current = '';
          injectPlacesOnlyRef.current();
          placesForceRef.current = false;
          noteMapPlacesReady(cityId);
        } else {
          setMapPlaces([]);
        }
        citiesForceRef.current = true;
        injectCitiesRef.current();
        citiesForceRef.current = false;
        placesInjectedForCity.current = cityId;
        return;
      }
      void (async () => {
        const center =
          jumpLat != null && jumpLng != null
            ? { lat: jumpLat, lng: jumpLng }
            : null;
        const idle = () =>
          waitMapIdle({
            isGesturing: () => userMapGestureRef.current,
            quietMs: 800,
          });
        try {
          await prefetchCityMapExtract(cityId);
        } catch {
          /* soft */
        }
        mapRef.current?.releaseFollow();
        // R1 — Straßen / Wasser / Bahn (5 km, core).
        await injectOfflineMapExtract(
          true,
          center,
          MAP_NEAR_RADIUS_M,
          cityId,
          true,
        );
        noteMapNearReady(cityId);
        noteMapDataPainted(cityId, 'near');
        await idle();
        mapRef.current?.releaseFollow();
        // R2 — Orte + Icons (kein Extract).
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
        noteMapPlacesReady(cityId);
        await idle();
        // R3 — Rest (10 km full) — Freeze erst danach.
        await injectOfflineMapExtract(
          true,
          center,
          MAP_CITY_RADIUS_M,
          cityId,
          true,
        );
        noteMapCityFinal(cityId);
        noteMapDataPainted(cityId, 'final');
        placesFinalDoneRef.current = true;
        await waitMapIdle({
          isGesturing: () => userMapGestureRef.current,
          quietMs: 640,
        });
        mapRef.current?.releaseFollow();
        citiesForceRef.current = true;
        injectCitiesRef.current();
        citiesForceRef.current = false;
      })();
      placesInjectedForCity.current = cityId;
      return;
    }
    injectFastCityPins(cityId);
    void injectPlacesAndRoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- absichtlich nur cityId
  }, [cityId]);

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
    // Boot-GPS nur wenn User noch nicht weggewischt hat (onReady kann spät kommen).
    if (
      !didBootJumpRef.current &&
      bootLat != null &&
      bootLng != null &&
      !mapUserExploredRef.current
    ) {
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
    const activeMapId = (cityId || env.cityId() || '').toLowerCase();
    const bootExtract = useMapExtractStore.getState().extract;
    const bootCity = (useMapExtractStore.getState().cityId || '').toLowerCase();
    if (
      bootExtract &&
      activeMapId &&
      bootCity === activeMapId &&
      !isMapExtractRoadsSane(bootExtract)
    ) {
      useMapExtractStore.getState().clear();
      void deleteCityMapExtractFile(activeMapId).catch(() => undefined);
      if (bootLat != null && bootLng != null) {
        void loadExtractForViewport(bootLat, bootLng, {
          force: true,
          urgent: true,
          cityId: activeMapId,
        });
      }
    }
    // Nur aktive Stadt vorwärmen — keine serielle Prefetch-Kette aller Offline-Packs
    // (Viewport-First: Tornesch/Kiel erst wenn Viewport sie braucht).
    if (!isVectorBasemapEnabled() && activeMapId) {
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
        localPackIdsRef.current = rows
          .filter((row) => row.hasPack)
          .map((row) => row.id.toLowerCase());
        // Pack-_coverage für Offline-Städte (Tornesch etc.) — vor Fills, ohne Map-Download.
        await registerCoverageFromLocalPacks({
          cityIds: offlineIds.filter((id) =>
            rows.some((r) => r.id === id && r.hasPack),
          ),
        });
        invalidateLocalMapIndex();
        await warmLocalMapIndex();
        if (readyRef.current && mapLayerDebugAllows('cities')) injectCitiesRef.current();
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
        if (near && !isVectorBasemapEnabled()) {
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
    // Boot: 3 Releases wie Stadtwechsel — R1 unter Splash, R3 spätestens idle/60s.
    if (!didExtractBootRef.current) {
      didExtractBootRef.current = true;
      const activeId = (cityId || env.cityId() || '').toLowerCase() || null;
      beginMapLoadPhases(activeId);
      if (isVectorBasemapEnabled()) {
        noteMapNearReady(activeId);
        noteMapCityFinal(activeId);
        noteMapDataPainted(activeId, 'final');
        noteSplashMapPlacesReady();
        void (async () => {
          try {
            const rows = await listLocalCityDatasets();
            localOfflineCityIdsRef.current = rows
              .filter((row) => row.hasPack || row.hasMap)
              .map((row) => row.id.toLowerCase())
              .filter((id) => id && !isRegionPackCityId(id));
            localPackIdsRef.current = rows
              .filter((row) => row.hasPack)
              .map((row) => row.id.toLowerCase());
            await registerCoverageFromLocalPacks({
              cityIds: localPackIdsRef.current,
            }).catch(() => undefined);
            // Immer Force-Inject nach Pack-Liste — Gate-Race sonst leere Orte.
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            placesBootCommittedRef.current = false;
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
            if (yorroContentAt(bootLat, bootLng)) {
              noteMapPlacesReady(activeId);
            }
            citiesForceRef.current = true;
            injectCitiesRef.current();
            citiesForceRef.current = false;
          } catch {
            /* soft */
          }
        })();
      } else {
      const already = useMapExtractStore.getState().extract;
      const alreadyCity = (
        useMapExtractStore.getState().cityId || ''
      ).toLowerCase();
      const nearLat = bootLat ?? gpsLatRef.current;
      const nearLng = bootLng ?? gpsLngRef.current;
      void (async () => {
        const idle = () =>
          waitMapIdle({
            isGesturing: () => userMapGestureRef.current,
            quietMs: 800,
          });
        const cacheHit =
          !!already &&
          !!activeId &&
          alreadyCity === activeId.toLowerCase() &&
          isMapExtractRoadsSane(already);
        if (!cacheHit && nearLat != null && nearLng != null) {
          await injectOfflineMapExtract(
            true,
            { lat: nearLat, lng: nearLng },
            MAP_NEAR_RADIUS_M,
            activeId,
            true,
          );
        }
        noteMapNearReady(activeId);
        noteMapDataPainted(activeId, 'near');
        if (isMapLayerDebugEnabled()) return;
        await idle();
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
        noteMapPlacesReady(activeId);
        noteSplashMapPlacesReady();
        try {
          const track = await loadWalkTrack();
          setWalkTrack(track);
          if (!isMapUserGesturing()) {
            forceFogRecompute(track);
          }
        } catch {
          /* soft */
        }
        noteSplashMapFogReady();
        await idle();
        citiesForceRef.current = true;
        injectCitiesRef.current();
        citiesForceRef.current = false;
      })();

      if (!isMapLayerDebugEnabled()) {
      const cityLat = nearLat;
      const cityLng = nearLng;
      let cityDone = false;
      const applyCityFinal = async () => {
        if (cityDone) return;
        if (peekMapLoadPhases().phase === 'final') return;
        if (cityLat == null || cityLng == null) return;
        // Freie Erkundung: Final-Extract nicht mehr nachziehen —
        // ShapeSource-Sturm = Kamera zurück auf Boot-GPS (live verifiziert).
        if (mapUserExploredRef.current) {
          cityDone = true;
          if (activeId && !isMapExtractFrozen(activeId)) {
            noteMapCityFinal(activeId);
            noteMapDataPainted(activeId, 'final');
          }
          return;
        }
        if (userMapGestureRef.current) {
          setTimeout(() => {
            void applyCityFinal();
          }, 800);
          return;
        }
        if (mapUserExploredRef.current && isMapUserGesturing()) {
          setTimeout(() => {
            void applyCityFinal();
          }, 800);
          return;
        }
        cityDone = true;
        await waitMapIdle({ isGesturing: () => userMapGestureRef.current });
        await injectOfflineMapExtract(
          true,
          { lat: cityLat, lng: cityLng },
          MAP_CITY_RADIUS_M,
          activeId,
          true,
        );
        noteMapCityFinal(activeId);
        noteMapDataPainted(activeId, 'final');
        placesFinalDoneRef.current = true;
        await waitMapIdle({
          isGesturing: () => userMapGestureRef.current,
          quietMs: 640,
        });
        if (!userMapGestureRef.current) {
          citiesForceRef.current = true;
          injectCitiesRef.current();
          citiesForceRef.current = false;
        }
      };

      const finalDeadline = setTimeout(() => {
        void applyCityFinal();
      }, MAP_CITY_PARTIAL_DEADLINE_MS);

      setTimeout(() => {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          void (async () => {
            try {
              if (activeId) {
                await prefetchCityMapExtract(activeId).catch(() => undefined);
              }
              await applyCityFinal();
            } finally {
              clearTimeout(finalDeadline);
            }
          })();
        });
      }, 2_800);
      }
      }
    }
    injectNavRoute();
    // Kein Footprint-/Warmup-/Fog-Ladder nach Splash — das waren die Snap-Quellen.
  }, [
    cityId,
    injectNavRoute,
    injectOfflineMapExtract,
    refreshCatalogBoundaries,
  ]);

  const onNativeUserPan = useCallback(() => {
    // Echte User-Bewegung: immer sofort Unlock — ignoreUserPanUntil gilt nur
    // gegen programmierte Jump-Echoes (die noteUserGesture gar nicht feuern).
    mapUserExploredRef.current = true;
    userMapGestureRef.current = true;
    pendingRingDone.current?.();
    followRef.current = false;
    locationFollowRef.current = false;
    headingFollowRef.current = false;
    lastGpsTapAt.current = 0;
    lastCompassTapAt.current = 0;
    setLocationFollow(false);
    setHeadingFollow(false);
    // Prefs bewusst nicht speichern — Pan ist Session-Unlock.
    mapRef.current?.releaseFollow();
    mapRef.current?.setHeadingFollow(false);
  }, []);

  const gestureQuietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNativeMapGestureStart = useCallback(() => {
    userMapGestureRef.current = true;
    if (gestureQuietTimer.current) {
      clearTimeout(gestureQuietTimer.current);
      gestureQuietTimer.current = null;
    }
  }, []);

  const onNativeMapGestureEnd = useCallback(() => {
    // Finger hoch ≠ Idle — Fling/Trägheit ~2,8 s wie native Region-Handler.
    if (gestureQuietTimer.current) clearTimeout(gestureQuietTimer.current);
    gestureQuietTimer.current = setTimeout(() => {
      gestureQuietTimer.current = null;
      userMapGestureRef.current = false;
      // Nach Swipe: fehlenden Nachbar-Pack still holen + Orte mergen.
      const view = viewRef.current;
      if (view && isVectorBasemapEnabled()) {
        const midLat = (view.south + view.north) / 2;
        const midLng = (view.west + view.east) / 2;
        if (Number.isFinite(midLat) && Number.isFinite(midLng)) {
          maybeEnsureBrowsePackAt(midLat, midLng);
          placesForceRef.current = true;
          lastPlacesSig.current = '';
          injectPlacesOnlyRef.current();
          placesForceRef.current = false;
        }
      }
    }, 2_800);
    // Pan/Zoom: kein Extract-Nachladen — pending verwerfen.
    pendingExtractCenter.current = null;
    if (extractDeferTimer.current) {
      clearTimeout(extractDeferTimer.current);
      extractDeferTimer.current = null;
    }
    if (viewportInjectTimer.current) {
      clearTimeout(viewportInjectTimer.current);
      viewportInjectTimer.current = null;
    }
  }, [maybeEnsureBrowsePackAt]);

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
      if (!userMapGestureRef.current) {
        useHomeMapUiStore.getState().setMapBearing(v.bearing);
      }
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
        // Kartenbewegung: kein Extract-, Places- oder Cities-ShapeSource-Update.
        // Boot / Filter / Stadtwechsel / GPS-Lock laden weiter separat.
      }
      if (!bounds) {
        // Ohne Profil-Coverage trotzdem Pack-Orte pflegen (Vector).
        if (isVectorBasemapEnabled()) {
          const allowed = yorroContentAt(midLat, midLng);
          const prevAllowed = packContentAllowedRef.current;
          packContentAllowedRef.current = allowed;
          if (
            allowed &&
            (prevAllowed === false ||
              prevAllowed == null ||
              mapPlaces.length === 0) &&
            !userMapGestureRef.current
          ) {
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
            citiesForceRef.current = true;
            injectCitiesRef.current();
            citiesForceRef.current = false;
          }
        }
        return;
      }
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
      // LOD nur merken — kein injectCities / Boundary-Refresh beim Pan (Shape-Snap).
      const next = resolveHomeMapLodStable(
        lodRef.current,
        resolveHomeMapLod({
          zoom: v.zoom ?? 14,
          cityFullyVisible: fully,
        }),
      );
      lodRef.current = next;

      if (isVectorBasemapEnabled()) {
        const allowed = yorroContentAt(midLat, midLng);
        const prevAllowed = packContentAllowedRef.current;
        packContentAllowedRef.current = allowed;
        if (!allowed) {
          const navOn = useFinnusStore.getState().navActive;
          if (!(navOn && placesHadContentRef.current)) {
            if (mapPlaces.length > 0) setMapPlaces([]);
            if (mapCities.length > 0) setMapCities([]);
            placesBootCommittedRef.current = false;
            placesHadContentRef.current = false;
          }
          // Genau hier: Viewport in Nachbarstadt ohne Pack → still nachladen.
          maybeEnsureBrowsePackAt(midLat, midLng);
          return;
        }
        // Pack unter Kamera gewechselt (Prisdorf → Tornesch) → Idle-Refresh.
        const known = listKnownCityCoverageBounds();
        const packAt =
          smallestCityIdContainingPoint(midLat, midLng, known)?.toLowerCase() ??
          null;
        const packDownloaded =
          packAt != null &&
          isCityPackDownloaded(packAt, localPackIdsRef.current);
        // Nachbarstadt ohne Pack: still als Zubringer nachladen (GPS bleibt).
        if (
          packAt &&
          !packDownloaded &&
          packAt !== lastViewportPackAtRef.current
        ) {
          maybeEnsureBrowsePackAt(midLat, midLng);
        }
        const packChanged =
          packAt != null &&
          packAt !== lastViewportPackAtRef.current &&
          packDownloaded;
        if (packChanged) {
          lastViewportPackAtRef.current = packAt;
        }
        const needPlaces =
          mapPlaces.length === 0 ||
          prevAllowed === false ||
          prevAllowed == null ||
          packChanged;
        if (needPlaces && !userMapGestureRef.current && !placesForceRef.current) {
          if (viewportPlacesRefreshTimer.current) {
            clearTimeout(viewportPlacesRefreshTimer.current);
          }
          viewportPlacesRefreshTimer.current = setTimeout(() => {
            viewportPlacesRefreshTimer.current = null;
            if (userMapGestureRef.current || isMapUserGesturing()) return;
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
            citiesForceRef.current = true;
            injectCitiesRef.current();
            citiesForceRef.current = false;
          }, 420);
        }
      }
    },
    [
      bounds,
      cityId,
      mapCities.length,
      mapPlaces.length,
      maybeEnsureBrowsePackAt,
      yorroContentAt,
    ],
  );

  const onNativePlaceTap = useCallback(
    (place: {
      id: number;
      name: string;
      category: string;
      lat: number;
      lng: number;
    }) => {
      let placeId = Number(place.id);
      let placeName = place.name;
      let placeCategory = place.category;
      let placeLat = place.lat;
      let placeLng = place.lng;
      if (!Number.isFinite(placeId)) return;
      // Basemap-Label (Famila etc.): nächsten Pack-POI matchen, sonst ephemeres Popup.
      if (placeId === MAP_BASEMAP_POI_ID) {
        const nameKey = String(place.name || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
        let bestId = 0;
        let bestScore = 0;
        for (const [id, poi] of poisByIdRef.current) {
          if (id <= 0) continue;
          const dLat = (Number(poi.lat) - place.lat) * 111_320;
          const dLng =
            (Number(poi.lng) - place.lng) *
            111_320 *
            Math.cos((place.lat * Math.PI) / 180);
          const dist = Math.hypot(dLat, dLng);
          if (dist > 90) continue;
          const poiKey = String(poi.name || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
          let score = 0;
          if (nameKey && poiKey && (poiKey.includes(nameKey) || nameKey.includes(poiKey))) {
            score = 80 - dist * 0.2;
          } else if (nameKey && poiKey) {
            const tokens = nameKey.split(/\s+/).filter((t) => t.length >= 3);
            const hits = tokens.filter((t) => poiKey.includes(t)).length;
            if (hits) score = 40 + hits * 10 - dist * 0.3;
          } else if (dist < 35) {
            score = 25 - dist * 0.4;
          }
          if (score > bestScore) {
            bestScore = score;
            bestId = id;
          }
        }
        if (bestId > 0 && bestScore >= 30) {
          const matched = poisByIdRef.current.get(bestId);
          placeId = bestId;
          placeName = matched?.name || place.name;
          placeCategory = matched
            ? categoryLabelForPoi(matched)
            : place.category;
          placeLat = Number(matched?.lat ?? place.lat);
          placeLng = Number(matched?.lng ?? place.lng);
        }
      }
      if (Date.now() < ignorePlaceTapUntil.current) return;
      noteUiTap('mapPlace');
      if (viewportInjectTimer.current) {
        clearTimeout(viewportInjectTimer.current);
        viewportInjectTimer.current = null;
      }
      popupHoldRef.current = true;
      const overlay = overlayPinsRef.current.get(placeId);
      // Frame 1: Skeleton ohne Bullet-Parsing — Popup sofort sichtbar.
      useHomeMapUiStore.getState().setPlacePopup(
        skeletonMapPlacePopup({
          id: placeId,
          name: placeName || overlay?.name,
          category: placeCategory || overlay?.cityId || undefined,
          lat: placeLat,
          lng: placeLng,
        }),
      );
      // Frame 2+: Bullets / Prefetch hinter dem ersten Paint.
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => {
          const poi = poisByIdRef.current.get(placeId) ?? null;
          const full = instantMapPlacePopup({
            id: placeId,
            name: placeName || overlay?.name || poi?.name,
            category: placeCategory || overlay?.cityId || undefined,
            lat: placeLat,
            lng: placeLng,
            poi,
          });
          const cur = useHomeMapUiStore.getState().placePopup;
          if (!cur || cur.id !== placeId) return;
          useHomeMapUiStore.getState().setPlacePopup({
            ...full,
            lat: cur.lat,
            lng: cur.lng,
          });
          // Kein Google-Places-Enrich beim Tap — Popup bleibt Google-frei.
          if (!overlay && placeId > 0) {
            void prioritizeMapPlacePreview(placeId);
          }
        });
      });
    },
    [],
  );

  const onNativeDropPin = useCallback(
    (latN: number, lngN: number) => {
      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
      if (isVectorBasemapEnabled() && !yorroContentAt(latN, lngN)) {
        maybePromptPackAt(latN, lngN);
        return;
      }
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
    [mapExtract, mapPlaces, onNativePlaceTap, yorroContentAt, maybePromptPackAt],
  );

  const onNativeBlankTap = useCallback(() => {
    const view = viewRef.current;
    const vLat =
      (view ? (view.south + view.north) / 2 : null) ??
      gpsLatRef.current ??
      null;
    const vLng =
      (view ? (view.west + view.east) / 2 : null) ??
      gpsLngRef.current ??
      null;
    if (
      isVectorBasemapEnabled() &&
      typeof vLat === 'number' &&
      typeof vLng === 'number' &&
      !yorroContentAt(vLat, vLng)
    ) {
      maybePromptPackAt(vLat, vLng);
      return;
    }
    if (useHomeMapUiStore.getState().placePopup) {
      useHomeMapUiStore.getState().setPlacePopup(null);
    }
    setDropPin(null);
  }, [maybePromptPackAt, yorroContentAt]);

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
        // Pulse: nur zentrieren — Zoom lassen (kein Street-Snap 16).
        mapRef.current?.jumpTo(lat, lng, undefined, true);
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
    noteHomeMapHudFollowPrefs({ locationFollow: next.locked });
    if (next.action === 'unlock') {
      followRef.current = false;
      mapRef.current?.releaseFollow();
      return;
    }
    // Pulse = einmal zentrieren. Lock = Karte folgt GPS (Punkt bleibt Mitte).
    // Kein Auto-Norden — das macht nur der Kompass-Button.
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      mapRef.current?.reattachFollow();
    }
    snapGps(next.action === 'lock' ? 'lock' : 'pulse');
  }, [snapGps]);

  const onRecenterLock = useCallback(() => {
    locationFollowRef.current = true;
    lastGpsTapAt.current = Date.now();
    setLocationFollow(true);
    noteHomeMapHudFollowPrefs({ locationFollow: true });
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
    noteHomeMapHudFollowPrefs({ headingFollow: next.locked });
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      // 2. Tipp in 5 s: Karte dreht mit Blickrichtung.
      mapRef.current?.setHeadingFollow(true);
      return;
    }
    // 1. Tipp / Unlock: Norden oben.
    mapRef.current?.setHeadingFollow(false);
    useHomeMapUiStore.getState().setMapBearing(0);
    mapRef.current?.setNorthUp();
  }, []);

  const onNorthLongPress = useCallback(() => {
    headingFollowRef.current = false;
    lastCompassTapAt.current = Date.now();
    setHeadingFollow(false);
    noteHomeMapHudFollowPrefs({ headingFollow: false });
    mapRef.current?.setHeadingFollow(false);
    useHomeMapUiStore.getState().setMapBearing(0);
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.setNorthUp();
  }, []);

  const onCalibrateCompass = useCallback(() => {
    resetNativeMapCompass();
    void ensureHeadingWatch();
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
      // Kein Google-Places-Enrich beim Tap — Popup bleibt Google-frei.
    })();
  }, [buildPlacePayloads, tourPlaceDemo]);

  return (
    <View
      style={[
        styles.root,
        { top: Math.max(0, hudHeight - 8), bottom: bottomChrome },
      ]}
      pointerEvents="auto"
    >
      <NativeHomeMapView
        ref={mapRef}
        extract={isVectorBasemapEnabled() ? null : mapExtract}
        places={mapPlaces}
        cities={mapCities}
        placeFilters={mapFilters}
        amenityIcons={amenityIcons}
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
      <MapLayerDebugHud onStepChange={applyMapLayerDebugStepEffects} />
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
