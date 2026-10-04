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
import { parsePolygonJson, isAxisAlignedBoxPolygon, isNearRectanglePolygon, pointInPolygon } from '../../services/geo/polygon';
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
import { colorsForHomeMapCityTone } from '../../services/homeMap/homeMapStyle';
import {
  collectTimelineCityPlanStops,
  cityIdsForPlanStop,
  resolveHomeMapCityTone,
} from '../../services/homeMap/homeMapCityTone';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
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
import {
  GPS_RECENTER_STREET_ZOOM,
  gpsZoomIsCloseEnough,
  nextCompassTap,
  nextGpsRecenterTap,
} from '../../services/homeMap/homeMapCompass';
import { shortestAngleDelta } from '../../services/navigation/bearing';
import {
  collectOpenPlanStops,
  plannedPoiIdSet,
} from '../../services/navigation/stampMapPlanMatch';
import {
  countsAsMapVisitedGreen,
  isCityExploreMapPoi,
  isPackStoryMapPoi,
  isMapIdleStoryFillPoi,
  isMapOpenAreaNoFillPoi,
  isMapEverydayBuildingFocusPoi,
  isModul1AutoTriggerMapPoi,
  shouldPaintPlaceBuildingFill,
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
import { getActiveNavDestination } from '../../services/navigation/navigationService';
import { useMapRouteStore } from '../../store/useMapRouteStore';
import {
  loadMapPinIndex,
  loadNeighborPinsInViewport,
  MAP_VIEWPORT_PACK_CITY_LIMIT,
  overlayPinId,
  peekMapPinIndex,
  warmNearbyPinIndexes,
  type MapPin,
} from '../../services/homeMap/mapPinIndex';
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
  shouldSuppressYorroMapIcon,
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
  HOME_MAP_PLACES_GESTURE_QUIET_MS,
  HOME_MAP_LIGHT_PINS_AFTER_SPLASH_MS,
  HOME_MAP_PLACES_PAINT_AFTER_SPLASH_MS,
  HOME_MAP_FOG_AFTER_SPLASH_MS,
  HOME_MAP_NEIGHBOR_WARM_AFTER_SPLASH_MS,
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
import { snapMapLongPress, resolveMapDropName } from '../../services/homeMap/snapMapDrop';
import { CompassCalibrateModal } from './CompassCalibrateModal';
import { HomeMapExploreChip } from './HomeMapExploreChip';
import {
  seedMapCameraGps,
  persistLastMapGpsSoon,
  flushLastMapGpsNow,
} from '../../services/location/lastKnownMapGps';
import {
  isSplashCurtainUp,
  noteSplashGpsLive,
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
import { isSoftCityId } from '../../services/softWorkingCity';
import {
  promptCityPackDownloadIfNeeded,
  ensureBrowsePacksOverlappingViewport,
} from '../../services/homeMap/mapPackPrompt';
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
  // Achsen-Boxen / grobe Rauten sind nie echte Gebäudeumrisse → kein Fill (Tile-Snap übernimmt).
  if (isAxisAlignedBoxPolygon(poly) || isNearRectanglePolygon(poly)) return null;
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

/** Heavy ShapeSource/extract work must yield to Lane B + Interactive Window. */
function placesPaintMustYield(): boolean {
  try {
    const {
      chromeHoldsLoad,
      isInMapPolishTouchGrace,
    } = require('../../services/boot/interactiveBootGate') as {
      chromeHoldsLoad: () => boolean;
      isInMapPolishTouchGrace: () => boolean;
    };
    // Mic / Overlay / Zurück-Puls / Voice — plus Polish-Grace nach Splash.
    return chromeHoldsLoad() || isInMapPolishTouchGrace();
  } catch {
    const s = useFinnusStore.getState();
    return Boolean(
      s.isListening ||
        s.isGenerating ||
        s.isPlayingAudio ||
        s.isAudiblySpeaking,
    );
  }
}

/** @deprecated name kept for call sites — same as placesPaintMustYield voice part. */
function voiceLaneOwnsJs(): boolean {
  return placesPaintMustYield();
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
  /**
   * Session-Fill-Cache: einmal aufgelöster Gebäude-Ring bleibt bis Stadtwechsel.
   * Pan/Zoom/Extract-Reclip darf Story-Fills nicht „wegladen“.
   */
  const placeFillRingCacheRef = useRef<Map<number, LatLngRing>>(new Map());
  /** Session: einmal gemalte Orte/Icons bleiben bis Stadtwechsel (kein Pan-Reload). */
  const sessionPaintedPlaceIdsRef = useRef<Set<number>>(new Set());
  /**
   * true = Protomaps hat dort schon ein Label. false = keins → eigenes Icon.
   * Unbekannt: kein eigenes Icon (Basis bleibt, kein Doppel).
   */
  const basemapLabelAtRef = useRef<Map<number, boolean>>(new Map());
  const basemapLabelTriedRef = useRef<Set<number>>(new Set());
  /** POIs schon per Tile-Snap versucht (auch ohne Treffer) — kein Requery-Sturm. */
  const tileSnapTriedRef = useRef<Set<number>>(new Set());
  const tileSnapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runTileFootprintSnapRef = useRef<() => void>(() => undefined);
  const enrichRunningRef = useRef(false);
  const lastGpsTapAt = useRef(0);
  const gpsTapStageRef = useRef<'centered' | 'zoomed' | undefined>(undefined);
  const lastCompassTapAt = useRef(0);
  const currentMapZoomRef = useRef<number | null>(null);
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
  /** Letzter Places-Paint: POI-Anzahl — Nachzug wenn Sync mehr liefert. */
  const placesPaintedPoiCountRef = useRef(0);
  /** Erster Paint: nur Punkte/Icons, keine Gebäude-Ring-Resolve (Boot-Freeze). */
  const placesFastDotsRef = useRef(false);
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
  const voiceDeferredFootprintRef = useRef(false);
  const viewportInjectTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Idle: Orte für Viewport-Pack(s) nachladen (Prisdorf↔Hamburg↔Lissabon). */
  const viewportPlacesRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastViewportPackAtRef = useRef<string | null>(null);
  /** Welche heruntergeladenen Packs zuletzt im Viewport überlappten (Paint-Trigger). */
  const lastOverlappingPackSigRef = useRef<string>('');
  /** Paint während Geste übersprungen → nach Idle nachholen. */
  const placesPaintPendingRef = useRef(false);
  /** Deduped retry when a voice turn interrupted a place rebuild. */
  const voiceDeferredPlacesRef = useRef(false);
  /** Nachbar-Merge während Geste verworfen → Retry. */
  const neighborMergeRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const poisRef = useRef<Poi[]>([]);
  const injectPlacesOnlyRef = useRef<() => void>(() => undefined);
  const injectFastCityPinsRef = useRef<(id: string | null) => void>(() => undefined);
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
      if (isMapUserGesturing() || voiceLaneOwnsJs()) {
        mapExtractDeferTimer.current = setTimeout(waitGestureClear, 350);
        return;
      }
      commit();
    };
    if (
      isMapUserGesturing() ||
      userMapGestureRef.current ||
      voiceLaneOwnsJs()
    ) {
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
  const mapPlacesRef = useRef(mapPlaces);
  const browseEnsureDeferredRef = useRef(false);
  mapPlacesRef.current = mapPlaces;
  const [mapCities, setMapCities] = useState<NativeMapCity[]>([]);
  const [planTick, setPlanTick] = useState(0);
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
  /** Fokus-Blau: Popup offen → Gebäudeumriss auch für Directory. */
  const popupFocusId = useHomeMapUiStore((s) => s.placePopup?.id ?? null);
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
        ignorePlaceTapUntil.current = Date.now() + 80;
      }
    };
    applyPopup(useHomeMapUiStore.getState().placePopup != null);
    return useHomeMapUiStore.subscribe((s, p) => {
      applyPopup(s.placePopup != null);
      if (!s.placePopup) {
        setDropPin(null);
      }
      // Fokus-Blau: Popup auf/zu → Places neu (Directory-Ring nur bei Fokus).
      if (s.placePopup?.id !== p.placePopup?.id && readyRef.current) {
        lastPlacesSig.current = '';
        placesForceRef.current = true;
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    });
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    lastPlacesSig.current = '';
    placesForceRef.current = true;
    injectPlacesOnlyRef.current();
    placesForceRef.current = false;
  }, [popupFocusId, multiStopTour, navActive]);
  const [exploreLine, setExploreLine] = useState('0 % erkundet');
  /** Plan-Änderung → Stadtflächen (blau) neu färben */
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

  /** Heruntergeladene Packs, die den aktuellen View treffen (ohne Active). */
  const overlappingDownloadedPackIds = useCallback(
    (pad: {
      south: number;
      north: number;
      west: number;
      east: number;
    }): string[] => {
      const profileLc = (cityId || '').toLowerCase();
      const known = listKnownCityCoverageBounds();
      return known
        .filter((b) => {
          const id = (b.cityId || '').toLowerCase();
          if (!id || id === profileLc) return false;
          if (!isCityPackDownloaded(id, localPackIdsRef.current)) return false;
          return (
            b.latMin <= pad.north &&
            b.latMax >= pad.south &&
            b.lngMin <= pad.east &&
            b.lngMax >= pad.west
          );
        })
        .map((b) => b.cityId.toLowerCase())
        .sort();
    },
    [cityId],
  );

  const forcePaintPlacesNow = useCallback(() => {
    if (userMapGestureRef.current || isMapUserGesturing()) {
      placesPaintPendingRef.current = true;
      return;
    }
    try {
      const { isInMapPolishTouchGrace } = require('../../services/boot/interactiveBootGate') as {
        isInMapPolishTouchGrace: () => boolean;
      };
      if (isInMapPolishTouchGrace()) {
        placesPaintPendingRef.current = true;
        return;
      }
    } catch {
      /* soft */
    }
    placesPaintPendingRef.current = false;
    placesForceRef.current = true;
    lastPlacesSig.current = '';
    injectPlacesOnlyRef.current();
    placesForceRef.current = false;
    const view = viewRef.current;
    if (view) {
      const midLat = (view.south + view.north) / 2;
      const midLng = (view.west + view.east) / 2;
      const mid = smallestCityIdContainingPoint(
        midLat,
        midLng,
        listKnownCityCoverageBounds(),
      )?.toLowerCase();
      const profileLc = (cityId || '').toLowerCase();
      if (mid && mid !== profileLc) {
        injectFastCityPinsRef.current(mid);
      }
    }
    citiesForceRef.current = true;
    injectCitiesRef.current();
    citiesForceRef.current = false;
  }, [cityId]);

  /**
   * Sichtbare Städte im Kamera-Ausschnitt → Browse-Packs still holen
   * (Tornesch/Pinneberg auch wenn Zentrum noch Prisdorf ist).
   * Schon heruntergeladene Packs: trotzdem Orte/Icons paint/mergen.
   * Sticky-GPS-Stadt ohne Pack: trotzdem nachladen (Profil ≠ GPS).
   */
  const maybeEnsureBrowsePackAt = useCallback(
    (viewportLat: number, viewportLng: number) => {
      if (!isVectorBasemapEnabled()) return;
      // Live-Nav: kein Browse-Pack-Spam (uetersen/appen 400 → Lag).
      if (useFinnusStore.getState().navActive) return;
      try {
        const {
          isInSplashInteractiveWindow,
          isInMapLightPinsGrace,
          isInMapPolishTouchGrace,
          runMapIdleWhenFree,
          runMapLightPinsWhenFree,
          runMapPolishWhenFree,
        } = require('../../services/boot/interactiveBootGate') as {
          isInSplashInteractiveWindow: () => boolean;
          isInMapLightPinsGrace: () => boolean;
          isInMapPolishTouchGrace: () => boolean;
          runMapIdleWhenFree: (fn: () => void) => void;
          runMapLightPinsWhenFree: (fn: () => void) => void;
          runMapPolishWhenFree: (fn: () => void) => void;
        };
        // Erste ~1 s: gar nichts. Danach RAM-Pins ok; volle Orte/Pack erst nach Polish-Grace.
        if (isInMapLightPinsGrace()) {
          if (!browseEnsureDeferredRef.current) {
            browseEnsureDeferredRef.current = true;
            runMapLightPinsWhenFree(() => {
              browseEnsureDeferredRef.current = false;
              maybeEnsureBrowsePackAt(viewportLat, viewportLng);
            });
          }
          return;
        }
        if (isInMapPolishTouchGrace()) {
          // Leicht: nur warmen Pin-Index painten — kein ensure/Download.
          const midPeek =
            smallestCityIdContainingPoint(
              viewportLat,
              viewportLng,
              listKnownCityCoverageBounds(),
            )?.toLowerCase() ?? null;
          const profilePeek = (cityId || '').toLowerCase();
          if (midPeek && midPeek !== profilePeek) {
            try {
              const { peekMapPinIndex } = require('../../services/homeMap/mapPinIndex') as {
                peekMapPinIndex: (id: string) => unknown[] | null;
              };
              if ((peekMapPinIndex(midPeek)?.length ?? 0) > 0) {
                injectFastCityPinsRef.current(midPeek);
              }
            } catch {
              /* soft */
            }
          }
          if (!browseEnsureDeferredRef.current) {
            browseEnsureDeferredRef.current = true;
            runMapPolishWhenFree(() => {
              browseEnsureDeferredRef.current = false;
              maybeEnsureBrowsePackAt(viewportLat, viewportLng);
            });
          }
          return;
        }
        if (isInSplashInteractiveWindow()) {
          // Leicht: nur warmen Pin-Index painten — kein ensure/Download.
          const midPeek =
            smallestCityIdContainingPoint(
              viewportLat,
              viewportLng,
              listKnownCityCoverageBounds(),
            )?.toLowerCase() ?? null;
          const profilePeek = (cityId || '').toLowerCase();
          if (midPeek && midPeek !== profilePeek) {
            try {
              const { peekMapPinIndex } = require('../../services/homeMap/mapPinIndex') as {
                peekMapPinIndex: (id: string) => unknown[] | null;
              };
              if ((peekMapPinIndex(midPeek)?.length ?? 0) > 0) {
                injectFastCityPinsRef.current(midPeek);
              }
            } catch {
              /* soft */
            }
          }
          if (!browseEnsureDeferredRef.current) {
            browseEnsureDeferredRef.current = true;
            runMapIdleWhenFree(() => {
              browseEnsureDeferredRef.current = false;
              maybeEnsureBrowsePackAt(viewportLat, viewportLng);
            });
          }
          return;
        }
      } catch {
        /* soft */
      }
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
      const view =
        viewRef.current ??
        ({
          south: viewportLat - 0.018,
          north: viewportLat + 0.018,
          west: viewportLng - 0.028,
          east: viewportLng + 0.028,
        } as const);
      const dLat = Math.max(0.004, (view.north - view.south) * 0.2);
      const dLng = Math.max(0.006, (view.east - view.west) * 0.2);
      const pad = {
        south: view.south - dLat,
        north: view.north + dLat,
        west: view.west - dLng,
        east: view.east + dLng,
      };
      const profileLc = (cityId || '').toLowerCase();
      const midCity =
        smallestCityIdContainingPoint(
          viewportLat,
          viewportLng,
          known,
        )?.toLowerCase() ?? null;

      // Viewport-Stadt ≠ Profil (Pinneberg): nach Interactive-Window Pins holen.
      if (midCity && midCity !== profileLc) {
        void (async () => {
          try {
            const { ensureBrowseCityPackOnDevice } = await import(
              '../../services/cityCatalogService'
            );
            const { peekMapPinIndex, loadMapPinIndex } = await import(
              '../../services/homeMap/mapPinIndex'
            );
            // Pin-Index warm? Sonst aus Disk bauen / ggf. Download.
            let ready =
              (peekMapPinIndex(midCity)?.length ?? 0) > 0 ||
              (await loadMapPinIndex(midCity)).length > 0;
            if (!ready) {
              ready = await ensureBrowseCityPackOnDevice(midCity);
            }
            if (!ready) return;
            let changed = false;
            if (!isCityPackDownloaded(midCity, localPackIdsRef.current)) {
              localPackIdsRef.current = [
                ...localPackIdsRef.current,
                midCity,
              ];
              changed = true;
            }
            await registerCoverageFromLocalPacks({
              cityIds: [midCity],
              yieldEvery: 1,
            }).catch(() => undefined);
            lastViewportPackAtRef.current = midCity;
            placesPaintPendingRef.current = false;
            injectFastCityPinsRef.current(midCity);
            // injectFastCityPins triggert Neighbor-Merge nach Pin-Load.
            if (changed) {
              /* localPackIds updated — Gate darf Yorro-Content erlauben */
            }
          } catch {
            /* soft */
          }
        })();
      }

      const alreadyReady = overlappingDownloadedPackIds(pad);
      // Sticky/Zentrum ohne Pack zählen als Download-Bedarf (nicht skippen).
      const needsDownload = known.some((b) => {
        const id = (b.cityId || '').toLowerCase();
        if (!id || id === profileLc) return false;
        if (isCityPackDownloaded(id, localPackIdsRef.current)) return false;
        return (
          b.latMin <= pad.north &&
          b.latMax >= pad.south &&
          b.lngMin <= pad.east &&
          b.lngMax >= pad.west
        );
      });
      // Zentrum in anderer Stadt mit Pack auf Disk → painten wenn neu oder pending.
      const midReady =
        !!midCity &&
        midCity !== profileLc &&
        isCityPackDownloaded(midCity, localPackIdsRef.current);
      const midNeedsPaint =
        midReady &&
        (lastViewportPackAtRef.current !== midCity ||
          placesPaintPendingRef.current);

      // Pack schon auf Disk: sofort Pins mergen — nicht nur neu laden.
      // Sig erst nach erfolgreichem Paint-Versuch setzen (sonst Geste blockiert Retry).
      const readySig = alreadyReady.join('|');
      const paintNeeded =
        (alreadyReady.length > 0 &&
          readySig !== lastOverlappingPackSigRef.current) ||
        midNeedsPaint;
      if (paintNeeded) {
        if (midCity) lastViewportPackAtRef.current = midCity;
        else if (alreadyReady[0]) {
          lastViewportPackAtRef.current = alreadyReady[0];
        }
        forcePaintPlacesNow();
        if (!placesPaintPendingRef.current) {
          lastOverlappingPackSigRef.current = readySig;
        }
      }

      if (!needsDownload) return;

      const beforeIds = new Set(localPackIdsRef.current);
      void ensureBrowsePacksOverlappingViewport({
        view,
        profileCityId: cityId,
        stickyCityId,
        localPackIds: localPackIdsRef.current,
      }).then(async (rows) => {
        const newly = rows.filter(
          (r) => r.ready && (r.newlyFetched || !beforeIds.has(r.cityId)),
        );
        // Sticky/Zentrum war schon ready → trotzdem painten wenn neu im View.
        if (!newly.length && !paintNeeded) return;
        try {
          const disk = await listLocalCityDatasets();
          localPackIdsRef.current = disk
            .filter((row) => row.hasPack)
            .map((row) => row.id.toLowerCase());
          localOfflineCityIdsRef.current = disk
            .filter((row) => row.hasPack || row.hasMap)
            .map((row) => row.id.toLowerCase())
            .filter((id) => id && !isRegionPackCityId(id));
        } catch {
          /* soft */
        }
        for (const res of newly.length ? newly : rows.filter((r) => r.ready)) {
          if (!localPackIdsRef.current.includes(res.cityId)) {
            localPackIdsRef.current = [
              ...localPackIdsRef.current,
              res.cityId,
            ];
          }
        }
        const nextMid =
          smallestCityIdContainingPoint(
            viewportLat,
            viewportLng,
            known,
          )?.toLowerCase() ??
          newly[0]?.cityId ??
          midCity;
        if (nextMid) lastViewportPackAtRef.current = nextMid;
        forcePaintPlacesNow();
        if (!placesPaintPendingRef.current) {
          lastOverlappingPackSigRef.current = overlappingDownloadedPackIds(
            pad,
          ).join('|');
        }
      });
    },
    [cityId, forcePaintPlacesNow, overlappingDownloadedPackIds],
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
      placeFillRingCacheRef.current.clear();
      sessionPaintedPlaceIdsRef.current.clear();
      basemapLabelAtRef.current.clear();
      basemapLabelTriedRef.current.clear();
      followRef.current = false;
      didCameraLock.current = true;
      headingFollowRef.current = false;
      locationFollowRef.current = false;
      lastGpsTapAt.current = 0;
      lastCompassTapAt.current = 0;
      setHeadingFollow(false);
      setLocationFollow(false);
      try {
        const { evictCityMapExtract } = require('../../services/homeMap/cityMapExtract') as {
          evictCityMapExtract: (id: string) => void;
        };
        evictCityMapExtract(prev);
      } catch {
        /* soft */
      }
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
    // Fast-Dots: nur Directory/Amenities ohne Ring — Story-Gebäude immer mit Fläche.
    const skipAmenityRings =
      placesFastDotsRef.current || skipPlaceRingsForView(span);
    const cityScale = span >= 12_000;
    // Nav/Tour-Ziel für Fokus-Blau (Directory nur dann mit Fläche).
    // Wichtig: pendingNavOffer wird beim Nav-Start genullt — Live-Ziel aus
    // getActiveNavDestination(), sonst bleibt das Ziel story-rot statt blau.
    const tourFocusId =
      multiStopTour?.stops?.find((s) => !s.done && s.poiId >= 0)?.poiId ?? null;
    const activeNavDest = navActive ? getActiveNavDestination() : null;
    const activeNavPoiId =
      activeNavDest && activeNavDest.poiId >= 0 ? activeNavDest.poiId : null;
    const navFocusId =
      pendingNavOffer?.poiId != null && pendingNavOffer.poiId >= 0
        ? pendingNavOffer.poiId
        : activeNavPoiId != null
          ? activeNavPoiId
          : tourFocusId;
    const activeNavName = (activeNavDest?.name || pendingNavOffer?.name || '')
      .trim()
      .toLowerCase();
    const out: PlacePayload[] = [];
    for (const poi of pois) {
      if (!isHomePresenceMapPoi(poi, profile)) continue;
      if (!shouldShowCarMobilityAmenityOnMap(poi, profile)) continue;
      if (isNatureLandscapeNotPin(poi)) continue;
      const story =
        isPackStoryMapPoi(poi) ||
        isCityExploreMapPoi(poi) ||
        isMapShelterBuildingPoi(poi);
      /** Story-Kandidat (Persistenz/Filter) — Fill nur via Status-Gate unten. */
      const idleStoryFill = isMapIdleStoryFillPoi(poi);
      /** Spielplatz/Gewerbe/Feldmark: nie Pack-Polygon. */
      const openAreaNoFill = isMapOpenAreaNoFillPoi(poi);
      /** Alltag-Shop: bei Nav höchstens echtes Gebäude — nie Pack-Zone. */
      const everydayFocus = isMapEverydayBuildingFocusPoi(poi);
      const shelterBldg = isMapShelterBuildingPoi(poi);
      const modul1Auto = isModul1AutoTriggerMapPoi(poi, profile);
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
      const isPopupFocus =
        popupFocusId != null &&
        popupFocusId > 0 &&
        popupFocusId === poi.id;
      const nameMatchesNav =
        !!activeNavName &&
        !!poi.name &&
        poi.name.trim().toLowerCase() === activeNavName;
      const nearActiveNav =
        !!activeNavDest &&
        Number.isFinite(Number(poi.lat)) &&
        Number.isFinite(Number(poi.lng)) &&
        metersBetween(
          Number(poi.lat),
          Number(poi.lng),
          activeNavDest.lat,
          activeNavDest.lng,
        ) <= 45;
      const isNavFocus =
        (navFocusId != null &&
          navFocusId === poi.id &&
          (navActive || !!pendingNavOffer)) ||
        (navActive && (nameMatchesNav || nearActiveNav));
      /** Idle: kein Massen-Fill. Fokus-Blau nur Nav/Plan (nicht Popup allein). */
      const isFocus = isPlanned || isPopupFocus || isNavFocus;
      const navOrPlanFocus = isPlanned || isNavFocus;
      // Shelter ist Gebäude (kann Fill) — nicht Street-Punkt.
      const streetPointAmenity =
        isStreetPointAmenity(poi) && !shelterBldg;
      const amenityDot = streetPointAmenity;
      const rawIconRaw = placeMapIcon(poi) ?? undefined;
      // WC/Wasser/ATM/… immer unser Icon. Shop/Restaurant nur ohne Basemap-Label.
      const rawIcon = (() => {
        if (!rawIconRaw) return undefined;
        if (!shouldSuppressYorroMapIcon(poi, rawIconRaw)) return rawIconRaw;
        return basemapLabelAtRef.current.get(poi.id) === false
          ? rawIconRaw
          : undefined;
      })();
      const iconAllowed = isAmenityIconEnabled(amenityIcons, rawIcon);
      const keepTransitIcon = isTransitIconLod(
        rawIcon ? homeMapIconLod(rawIcon, poi) : null,
      );
      // Directory / Fuel / Hard-Amenity: nie Gebäude-Fill (Basemap/Icon).
      const directoryNoFill =
        (isTouristDirectoryMapPoi(poi) || everydayFocus) &&
        !idleStoryFill &&
        !modul1Auto &&
        !shelterBldg;
      // Transit-Halt: nie Bahnsteig-Fill. Shelter: Fill nur Status-Gate + Ring.
      const keepDotForced =
        keepTransitIcon ||
        openAreaNoFill ||
        streetPointAmenity ||
        (isKeepDotMapPoi(poi) &&
          !shelterBldg &&
          !idleStoryFill &&
          !modul1Auto);
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
      // Display-Vertrag: Fill nur visited | Nav/Plan | M1-Auto — nie Idle-Rot-Masse.
      // Shelter: dasselbe Status-Gate (nicht mehr keepDotForced blockiert).
      const wantFill =
        !keepDotForced &&
        shouldPaintPlaceBuildingFill({
          visited,
          navOrPlanFocus,
          modul1Auto,
          openArea: openAreaNoFill,
          streetPointAmenity,
          directoryNoStory: directoryNoFill,
        }) &&
        !(skipAmenityRings && !modul1Auto && !visited && !navOrPlanFocus);
      // Ohne Status-Fill: Directory/Alltag nicht als Hit über Basemap legen —
      // Protomaps-Icon bleibt sichtbar + klickbar. Eigenes Icon nur Fallback.
      if (
        !wantFill &&
        !iconAllowed &&
        !amenityBypass &&
        !navOrPlanFocus &&
        !isPopupFocus &&
        !keepTransitIcon &&
        (directoryNoFill || everydayFocus || isTouristDirectoryMapPoi(poi))
      ) {
        continue;
      }
      const packOrOsm = wantFill
        ? ringFromPoi(poi, osmFootprintsRef.current.get(poi.id))
        : null;
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
      // Directory/Alltag: nie Pack-Zone — nur Extract/Tile unter dem Pin.
      const packForFill =
        directoryNoFill || (everydayFocus && !idleStoryFill && !modul1Auto)
          ? null
          : packOrOsm;
      // Fill = dasselbe Haus wie Extract-Umriss unter dem Pin (kein versetztes Pack-Viereck).
      let ring = wantFill
        ? resolvePlaceFillRing(
            Number(poi.lat),
            Number(poi.lng),
            packForFill,
            buildingCandidates,
            { name: poi.name, category: poi.category },
          )
        : null;
      // Shelter: Fill nur wenn Pin im Ring (sonst Icon — kein versetzter Kasten).
      if (
        ring &&
        ring.length >= 3 &&
        shelterBldg &&
        !pointInPolygon(
          Number(poi.lat),
          Number(poi.lng),
          ring.map(([la, ln]) => ({ latitude: la, longitude: ln })),
        )
      ) {
        ring = null;
      }
      // Session-Cache: einmal gut → bleibt (Pan/Zoom/Reclip darf nicht löschen).
      if (ring && ring.length >= 3) {
        placeFillRingCacheRef.current.set(poi.id, ring);
      } else if (wantFill) {
        const cached = placeFillRingCacheRef.current.get(poi.id);
        if (cached && cached.length >= 3) {
          if (
            !shelterBldg ||
            pointInPolygon(
              Number(poi.lat),
              Number(poi.lng),
              cached.map(([la, ln]) => ({ latitude: la, longitude: ln })),
            )
          ) {
            ring = cached;
          }
        }
      }
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
      const statusColor = colorForHomeMapPoi(poi, profile, visited, {
        planned: isPlanned,
      });
      out.push({
        id: poi.id,
        name: poi.name,
        lat: Number(poi.lat),
        lng: Number(poi.lng),
        color: wegweiserTarget
          ? '#E6B422'
          : isFocus
            ? HOME_MAP_PLACE_COLORS.planned
            : statusColor,
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
        keepPin: amenityDot || keepTransitIcon || isFocus,
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
    multiStopTour,
    navActive,
    pendingNavOffer,
    pois,
    popupFocusId,
    profile,
    visitedHistory,
  ]);

  const scheduleNeighborPackPlacesMerge = useCallback(
    (baseVisible: PlacePayload[], genAtStart: number, retry = 0) => {
      const viewForNeighbors = viewRef.current;
      if (!viewForNeighbors || !isVectorBasemapEnabled()) return;
      // Mic / Thinking: Orte-Nachladen sofort deferren — JS-Thread für Mic frei.
      if (placesPaintMustYield()) {
        placesPaintPendingRef.current = true;
        if (retry >= 6) return;
        if (neighborMergeRetryTimer.current) {
          clearTimeout(neighborMergeRetryTimer.current);
        }
        neighborMergeRetryTimer.current = setTimeout(() => {
          neighborMergeRetryTimer.current = null;
          try {
            const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
              runMapPolishWhenFree: (fn: () => void) => void;
            };
            runMapPolishWhenFree(() => {
              scheduleNeighborPackPlacesMerge(
                baseVisible,
                placesInjectGen.current,
                retry + 1,
              );
            });
          } catch {
            scheduleNeighborPackPlacesMerge(
              baseVisible,
              placesInjectGen.current,
              retry + 1,
            );
          }
        }, 320);
        return;
      }
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
          if (voiceLaneOwnsJs()) {
            if (retry >= 4) return;
            if (neighborMergeRetryTimer.current) {
              clearTimeout(neighborMergeRetryTimer.current);
            }
            neighborMergeRetryTimer.current = setTimeout(() => {
              neighborMergeRetryTimer.current = null;
              scheduleNeighborPackPlacesMerge(
                baseVisible,
                placesInjectGen.current,
                retry + 1,
              );
            }, 480);
            return;
          }
          if (userMapGestureRef.current || isMapUserGesturing()) {
            // Geste noch aktiv → nach Idle nochmal mergen (sonst leere Karte).
            if (retry >= 4) return;
            if (neighborMergeRetryTimer.current) {
              clearTimeout(neighborMergeRetryTimer.current);
            }
            neighborMergeRetryTimer.current = setTimeout(() => {
              neighborMergeRetryTimer.current = null;
              scheduleNeighborPackPlacesMerge(
                baseVisible,
                placesInjectGen.current,
                retry + 1,
              );
            }, 480);
            return;
          }
          if (popupHoldRef.current) return;
          const overlayMap = new Map<
            number,
            { name: string; cityId: string; lat: number; lng: number }
          >();
          const extra: PlacePayload[] = [];
          for (const p of neighbors) {
            // Fill nur M1-Schätzung (liked) — Rest = Basemap-Icon (klickbar).
            const wantFill =
              p.liked === 1 && !!(p.ring && p.ring.length >= 3);
            if (!wantFill) continue;
            const oid = overlayPinId(p.cityId, p.id);
            overlayMap.set(oid, {
              name: p.name,
              cityId: p.cityId,
              lat: p.lat,
              lng: p.lng,
            });
            const ring = slimRing(p.ring!);
            extra.push({
              id: oid,
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              color: HOME_MAP_PLACE_COLORS.liked,
              radiusM: p.radiusM || 30,
              ring,
              category: p.category || p.cityId,
              story: p.story,
              pointOnly: false,
              keepDot: false,
              amenityDot: false,
              icon: undefined,
              iconLod: undefined,
              filterTags: (['trigger'] as HomeMapFilterId[]),
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
          placesHadContentRef.current = true;
          setMapPlaces(next);
          prefetchVisibleMapPlaces(next.map((p) => p.id));
        })
        .catch(() => undefined);
    },
    [cityId],
  );

  const injectPlacesOnly = useCallback(() => {
    if (!readyRef.current) return;
    // Mic/Timeline/Settings zuerst — Orte nie sync während Interactive Window / Voice.
    if (placesPaintMustYield()) {
      placesPaintPendingRef.current = true;
      if (!voiceDeferredPlacesRef.current) {
        voiceDeferredPlacesRef.current = true;
        try {
          const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
            runMapPolishWhenFree: (fn: () => void) => void;
          };
          runMapPolishWhenFree(() => {
            voiceDeferredPlacesRef.current = false;
            if (!placesPaintPendingRef.current) return;
            placesPaintPendingRef.current = false;
            injectPlacesOnlyRef.current();
          });
        } catch {
          voiceDeferredPlacesRef.current = false;
        }
      }
      return;
    }
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
        // Pack-Liste noch unbekannt → nichts wischen (sonst 30–60 s leere Karte).
        if (!localPackIdsRef.current.length) return;
        const navOn = useFinnusStore.getState().navActive;
        // Packs auf Disk (z. B. danzig) immer mergen — soft_gdynia ist kein
        // Profil-Pack und darf Orte beim Pan nach Danzig nicht wischen.
        const profilePack =
          !!cityId &&
          !isSoftCityId(cityId) &&
          isCityPackDownloaded(cityId, localPackIdsRef.current);
        const hasDownloadedPacks = localPackIdsRef.current.length > 0;
        if (hasDownloadedPacks || (navOn && placesHadContentRef.current) || (profilePack && placesHadContentRef.current)) {
          scheduleNeighborPackPlacesMerge(
            [],
            placesInjectGen.current,
          );
        } else {
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
      const stickyFillIds = placeFillRingCacheRef.current;
      const sessionIds = sessionPaintedPlaceIdsRef.current;
      visible = fallback.filter((p) => {
        const inView =
          p.lat >= view.south - padLat &&
          p.lat <= view.north + padLat &&
          p.lng >= view.west - padLng &&
          p.lng <= view.east + padLng;
        if (inView) return true;
        // Session: einmal gemalt (Icon oder Fläche) → bleibt, bis Stadtwechsel.
        if (sessionIds.has(p.id)) return true;
        if (p.ring && p.ring.length >= 3 && stickyFillIds.has(p.id)) return true;
        if (p.keepPin) return true;
        if (skipRings) return false;
        if (originLat == null || originLng == null) return false;
        return metersBetween(p.lat, p.lng, originLat, originLng) <= radiusM;
      });
      // Neu sichtbare merken — Cap darf Session-Orte nicht wieder werfen.
      for (const p of visible) sessionIds.add(p.id);
      if (visible.length > cap) {
        const pinned = visible.filter(
          (p) => p.keepPin || sessionIds.has(p.id) || (p.ring && p.ring.length >= 3),
        );
        const rest = visible.filter(
          (p) => !(p.keepPin || sessionIds.has(p.id) || (p.ring && p.ring.length >= 3)),
        );
        const room = Math.max(0, Math.max(cap, 520) - pinned.length);
        rest.sort((a, b) =>
          originLat != null && originLng != null
            ? metersBetween(a.lat, a.lng, originLat, originLng) -
              metersBetween(b.lat, b.lng, originLat, originLng)
            : 0,
        );
        visible = [...pinned, ...rest.slice(0, room)];
      }
    }
    const sig = visible
      .map((p) => `${p.id}:${p.color}:${p.story || 0}:${p.keepDot ? 1 : 0}`)
      .join('|');
    if (sig === lastPlacesSig.current) {
      if (visible.length > 0) {
        markHomeMapBoot('places');
        noteSplashMapPlacesReady();
      }
      prefetchVisibleMapPlaces(visible.map((p) => p.id));
      scheduleNeighborPackPlacesMerge(visible, placesInjectGen.current);
      return;
    }
    lastPlacesSig.current = sig;
    mapPlacesPaintSigRef.current = sig;
    const gen = ++placesInjectGen.current;
    overlayPinsRef.current.clear();
    placesBootCommittedRef.current = true;
    placesPaintedPoiCountRef.current = pois.length;
    if (visible.length > 0) placesHadContentRef.current = true;
    if (peekMapLoadPhases().phase === 'final') {
      placesFinalDoneRef.current = true;
    }
    noteMapDataPainted(cityId, 'places');
    setMapPlaces(visible);
    if (visible.length > 0) {
      markHomeMapBoot('places');
      noteSplashMapPlacesReady();
    }
    if (viewRef.current && Number.isFinite(viewRef.current.south)) {
      const midLat = (viewRef.current.south + viewRef.current.north) / 2;
      const midLng = (viewRef.current.west + viewRef.current.east) / 2;
      const prevZ = placesInjectCenterRef.current?.zoom ?? 16;
      placesInjectCenterRef.current = {
        lat: midLat,
        lng: midLng,
        zoom: prevZ,
      };
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
      const navState = useFinnusStore.getState();
      // Legacy clip/GeoJSON conversion is map-polish work. Never compete with
      // nav geocode/route commit, GPS follow or the first turn cue.
      if (
        navState.navActive ||
        navState.navRouteLoading ||
        voiceLaneOwnsJs()
      ) return;
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
          if (!isMapUserGesturing() && !mapUserExploredRef.current) {
            forceFogRecompute(track);
          } else {
            setTimeout(() => {
              if (!isMapUserGesturing()) forceFogRecompute(track);
            }, 800);
          }
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
      const navState = useFinnusStore.getState();
      if (navState.navActive || navState.navRouteLoading) return;
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

  useEffect(() => {
    if (!navActive && !navRouteLoading) return;
    pendingExtractCenter.current = null;
    extractInjectGen.current += 1;
    if (extractDeferTimer.current) {
      clearTimeout(extractDeferTimer.current);
      extractDeferTimer.current = null;
    }
  }, [navActive, navRouteLoading]);

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
        // RAM: Pin-Indexes / Fog-Polygone / Extract-Duplikate — Disk bleibt.
        try {
          const { trimHomeMapMemory } = require('../../services/homeMap/trimHomeMapMemory') as {
            trimHomeMapMemory: (opts?: {
              keepCityIds?: Array<string | null | undefined>;
              reason?: string;
            }) => void;
          };
          const sticky =
            (cityId || env.cityId() || '').toLowerCase() || null;
          const mid = viewRef.current
            ? (() => {
                const v = viewRef.current!;
                return smallestCityIdContainingPoint(
                  (v.south + v.north) / 2,
                  (v.west + v.east) / 2,
                  listKnownCityCoverageBounds(),
                );
              })()
            : null;
          trimHomeMapMemory({
            keepCityIds: [sticky, mid],
            reason: 'app_background',
          });
        } catch {
          /* soft */
        }
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
      // Immer über Polish-Lane — nie sync gegen Mic/Chrome nach Splash.
      try {
        const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapPolishWhenFree: (fn: () => void) => void;
        };
        runMapPolishWhenFree(() => {
          if (userMapGestureRef.current || placesPaintMustYield()) {
            placesPaintPendingRef.current = true;
            heavyOverlayTimer.current = setTimeout(run, 400);
            return;
          }
          injectPlacesOnlyRef.current();
          if (isVectorBasemapEnabled()) {
            if (tileSnapTimer.current) clearTimeout(tileSnapTimer.current);
            tileSnapTimer.current = setTimeout(() => {
              tileSnapTimer.current = null;
              runTileFootprintSnapRef.current();
            }, 700);
          }
        });
        return;
      } catch {
        /* soft — Fallback unten */
      }
      injectPlacesOnlyRef.current();
      if (isVectorBasemapEnabled()) {
        if (tileSnapTimer.current) clearTimeout(tileSnapTimer.current);
        tileSnapTimer.current = setTimeout(() => {
          tileSnapTimer.current = null;
          runTileFootprintSnapRef.current();
        }, 700);
      }
    };
    // Auch bei AFTER_EXTRACT=0: ein Tick Luft, dann Polish-Lane (Chrome zuerst).
    heavyOverlayTimer.current = setTimeout(run, Math.max(80, HOME_MAP_PLACES_AFTER_EXTRACT_MS));
  }, []);

  // POIs nachgeladen → Story-Orte erneut zeichnen (Race mit Map-Ready / Stadtwechsel).
  useEffect(() => {
    if (!readyRef.current || !pois.length) return;
    if (enrichRunningRef.current) return;
    if (userMapGestureRef.current || isMapUserGesturing()) return;
    const cityMismatch =
      !!cityId && placesInjectedForCity.current !== cityId;
    // Pack kam nach leerem Places-Boot → Force (sonst placesBootCommitted sperrt).
    // Auch: Sync liefert mehr POIs als der erste (zu frühe) Paint — sonst nur Bahnhof.
    const poisGrew =
      pois.length > placesPaintedPoiCountRef.current + 2;
    const needForce =
      cityMismatch ||
      !placesBootCommittedRef.current ||
      !placesHadContentRef.current ||
      poisGrew;
    if (!needForce) return;
    const tryPaint = () => {
      if (userMapGestureRef.current) {
        setTimeout(tryPaint, 350);
        return;
      }
      if (placesPaintMustYield()) {
        try {
          const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
            runMapPolishWhenFree: (fn: () => void) => void;
          };
          runMapPolishWhenFree(() => {
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
          });
        } catch {
          setTimeout(tryPaint, 400);
        }
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
    if (voiceLaneOwnsJs()) {
      pendingFootprintM.current = Math.max(
        pendingFootprintM.current ?? 0,
        maxM,
      );
      if (voiceDeferredFootprintRef.current) return;
      voiceDeferredFootprintRef.current = true;
      try {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          voiceDeferredFootprintRef.current = false;
          const pending = pendingFootprintM.current ?? maxM;
          pendingFootprintM.current = null;
          void runFootprintEnrich(pending);
        });
      } catch {
        voiceDeferredFootprintRef.current = false;
        /* keep pending; a later idle trigger retries */
      }
      return;
    }
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

  // Vector-Basemap: sichtbaren Protomaps-Gebäudeumriss unter dem Pin holen.
  // Nur mapIdle — nie Mic/Polish (JS-Thread / Pan-Vorfahrt).
  const runTileFootprintSnap = useCallback(async () => {
    if (!isVectorBasemapEnabled()) return;
    if (!readyRef.current) return;
    if (userMapGestureRef.current || isMapUserGesturing()) return;
    // Bus/Zug-Tempo: Idle-Footprints deferren — Puck/Follow behalten JS-Vorfahrt.
    try {
      const speed = getSmoothedSpeedMs();
      if (typeof speed === 'number' && speed >= 8.3) {
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        runMapIdleWhenFree(() => {
          void runTileFootprintSnap();
        });
        return;
      }
    } catch {
      /* soft */
    }
    try {
      const {
        isMicActive,
        isInMapPolishTouchGrace,
        isLaneFree,
        runMapIdleWhenFree,
      } = require('../../services/boot/interactiveBootGate') as {
        isMicActive: () => boolean;
        isInMapPolishTouchGrace: () => boolean;
        isLaneFree: (lane: string) => boolean;
        runMapIdleWhenFree: (fn: () => void) => void;
      };
      if (
        isMicActive() ||
        isInMapPolishTouchGrace() ||
        !isLaneFree('mapIdle')
      ) {
        runMapIdleWhenFree(() => {
          void runTileFootprintSnap();
        });
        return;
      }
    } catch {
      /* soft — ohne Gate trotzdem versuchen */
    }
    const handle = mapRef.current;
    if (!handle?.queryBuildingRingAt) return;
    const list = poisRef.current;
    if (!list.length) return;
    const view = viewRef.current;
    let changed = false;
    let budget = 48;
    for (const poi of list) {
      if (budget <= 0) break;
      const id = poi.id;
      if (tileSnapTriedRef.current.has(id)) continue;
      if (tileFootprintsRef.current.has(id)) {
        tileSnapTriedRef.current.add(id);
        continue;
      }
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
      // Punkt-Amenities brauchen keinen Gebäude-Fill.
      if (isStreetPointAmenity(poi) || isKeepDotMapPoi(poi)) {
        tileSnapTriedRef.current.add(id);
        continue;
      }
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
    // Eigenes Icon nur wo Protomaps kein POI-Symbol hat.
    if (handle.queryBasemapLabelAt) {
      let iconBudget = 36;
      for (const poi of list) {
        if (iconBudget <= 0) break;
        const id = poi.id;
        if (basemapLabelTriedRef.current.has(id)) continue;
        if (!placeMapIcon(poi)) {
          basemapLabelTriedRef.current.add(id);
          continue;
        }
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
        iconBudget -= 1;
        basemapLabelTriedRef.current.add(id);
        try {
          const hit = await handle.queryBasemapLabelAt(lat, lng);
          if (hit == null) {
            basemapLabelTriedRef.current.delete(id);
            continue;
          }
          basemapLabelAtRef.current.set(id, hit);
          if (hit === false) changed = true;
        } catch {
          basemapLabelTriedRef.current.delete(id);
        }
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
    try {
      const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
        runMapIdleWhenFree: (fn: () => void) => void;
      };
      runMapIdleWhenFree(() => {
        void runTileFootprintSnap();
      });
    } catch {
      void runTileFootprintSnap();
    }
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
      const idLc = id.trim().toLowerCase();
      const profileLc = (cityId || '').trim().toLowerCase();
      const isNeighbor = !!profileLc && idLc !== profileLc;
      // Profil nach Boot: SQLite-Inject. Nachbarstadt: Pin-Index trotzdem (sonst nur Basemap-Icons).
      if (placesBootCommittedRef.current && !isNeighbor) {
        injectPlacesOnlyRef.current();
        return;
      }
      const paint = (pins: MapPin[] | null | undefined) => {
        if (!pins?.length) return;
        if (placesBootCommittedRef.current && !isNeighbor) return;
        if (userMapGestureRef.current || isMapUserGesturing()) {
          placesPaintPendingRef.current = true;
          return;
        }
        const view = viewRef.current;
        const span = view ? homeMapViewSpanM(view) : 12_000;
        const cap = placeCapForMapView(500, span);
        // Fast: nur M1-Fill-Kandidaten — kein Massen-Directory mit OSM-Ringen.
        let list = pins.filter((p) => p.liked === 1);
        if (!list.length && !isNeighbor) {
          list = pins.filter((p) => p.story === 1).slice(0, 24);
        }
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
        list.sort((a, b) => (b.liked || 0) - (a.liked || 0));
        list = list.slice(0, cap);
        if (!list.length) return;
        const profileNow = profile;
        const visitedNow = visitedHistory;
        const cityNow = cityId;
        const payload = list.map((p) => {
          const pinCity = (p.cityId || idLc).toLowerCase();
          const mapId = isNeighbor ? overlayPinId(pinCity, p.id) : p.id;
          const poi =
            !isNeighbor
              ? poisRef.current.find((x) => x.id === p.id) ?? null
              : null;
          let color = HOME_MAP_PLACE_COLORS.liked;
          let visited = false;
          if (poi) {
            const historyHit = isCityExplorePlaceSeen(poi, visitedNow, {
              cityId: cityNow,
              bounds,
            });
            const dwellGreen = isPlaceMapGreenByDwell(
              cityNow,
              poi.spot_key || String(poi.id),
            );
            visited =
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
            color = colorForHomeMapPoi(poi, profileNow, visited, {
              planned: false,
            });
          }
          // Fill = visited | M1-liked — nie jedes Story-Gebäude.
          const wantFill =
            (visited || p.liked === 1) &&
            !!(p.ring && p.ring.length >= 3);
          const ring = wantFill ? slimRing(p.ring!) : null;
          const hasBuilding = !!(ring && ring.length >= 3);
          return {
            id: mapId,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            color,
            radiusM: p.radiusM,
            ring: hasBuilding ? ring : null,
            spotKey: `${pinCity}:${p.id}`,
            category: p.category || '',
            story: p.story,
            pointOnly: !hasBuilding,
            keepDot: !hasBuilding,
            amenityDot: false,
            keepPin: hasBuilding,
            icon: undefined,
            iconLod: undefined,
            filterTags: (['trigger'] as HomeMapFilterId[]),
          };
        });
        // Nachbar: in bestehende Orte mergen (nicht Profil-Pins wegwischen).
        let nextPlaces = payload;
        if (isNeighbor) {
          const prev = mapPlacesRef.current ?? [];
          const keep = prev.filter((pl) => {
            const sk = String(pl.spotKey || '');
            return !sk.startsWith(`${idLc}:`) && !overlayPinsRef.current.has(pl.id);
          });
          nextPlaces = exclusiveHomeMapPlaces([...keep, ...payload]);
        }
        lastPlacesSig.current = nextPlaces
          .map((p) => `${p.id}:${p.color}:${p.story || 0}:${p.icon || ''}`)
          .join('|');
        placesBootCommittedRef.current = true;
        placesHadContentRef.current = true;
        setMapPlaces(nextPlaces);
        markHomeMapBoot('places');
        noteSplashMapPlacesReady();
        // Nachbar: Overlay-Refs für Tap → Stadt.
        if (isNeighbor) {
          for (const p of list) {
            const pinCity = (p.cityId || idLc).toLowerCase();
            overlayPinsRef.current.set(overlayPinId(pinCity, p.id), {
              name: p.name,
              cityId: pinCity,
              lat: p.lat,
              lng: p.lng,
            });
          }
        }
      };
      const memPins = peekMapPinIndex(idLc);
      paint(memPins);
      void loadMapPinIndex(idLc).then((pins) => {
        if (!pins.length) return;
        if (placesBootCommittedRef.current && !isNeighbor) {
          injectPlacesOnlyRef.current();
          return;
        }
        paint(pins);
        if (isNeighbor) {
          // Volle Merge inkl. Story/Directory nachziehen.
          scheduleNeighborPackPlacesMerge(
            [],
            placesInjectGen.current,
          );
        }
      });
    },
    [bounds, cityId, profile, scheduleNeighborPackPlacesMerge, visitedHistory],
  );
  injectFastCityPinsRef.current = injectFastCityPins;

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
    // Pack-Stadtflächen: rot (Katalog) / grün (besucht) / blau (geplant) + weiße Kontur.
    if (isMapUserGesturing() && !citiesForceRef.current) return;
    const activeId = (cityId ?? '').toLowerCase();
    if (isMapExtractFrozen(activeId) && !citiesForceRef.current) return;
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
        ring: b.polygon as Array<[number, number]>,
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
    // Kein setWalkTrack hier — Remount/Fog-Churn friert den ersten Pan.
    // Fog nur über Store (forceFogRecompute / schedule), Track in Ref.
    if (!isMapLayerDebugEnabled()) {
      void loadWalkTrack().then((track) => {
        walkTrackRef.current = track;
      });
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
    // Kalibrier-Badge nur periodisch — nie aus dem Kompass-Emit-Pfad.
    // Sonst: noteFacing → emit → setNeedsCalibration → Max update depth.
    const syncCal = () => {
      try {
        const { isOverlayBusy } = require('../../services/boot/interactiveBootGate') as {
          isOverlayBusy: () => boolean;
        };
        if (isOverlayBusy()) return;
      } catch {
        /* soft */
      }
      const cal = needsCompassCalibration();
      setNeedsCalibration((prev) => (prev === cal ? prev : cal));
    };
    syncCal();
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
      try {
        const { homeMapShouldPause } = require('../../services/ui/homeMapPause') as {
          homeMapShouldPause: () => boolean;
        };
        if (!homeMapShouldPause()) {
          const track = getWalkTrackSnapshot();
          walkTrackRef.current = track;
          onMapGpsFog(lat, lng, track);
        }
      } catch {
        const track = getWalkTrackSnapshot();
        walkTrackRef.current = track;
        onMapGpsFog(lat, lng, track);
      }
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

  // Follow-State → Soft-Pause / Fog / Heading-Throttle SSOT.
  useEffect(() => {
    try {
      const { noteHomeMapFollowState } = require('../../services/ui/homeMapPause') as {
        noteHomeMapFollowState: (o: {
          locationFollow?: boolean;
          headingFollow?: boolean;
        }) => void;
      };
      noteHomeMapFollowState({
        locationFollow,
        headingFollow,
      });
    } catch {
      /* soft */
    }
  }, [locationFollow, headingFollow]);

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
        // Location-Follow und Heading-Follow sind getrennt wählbar.
        if (prefs.headingFollow === true) {
          headingFollowRef.current = true;
          setHeadingFollow(true);
          mapRef.current?.setHeadingFollow(true);
        } else if (prefs.headingFollow === false) {
          // Recenter-Lock darf einen aktiven Kompass nicht anfassen —
          // nur explizit false vom Kompass-Button schaltet ab (siehe onNorthUp).
        }
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
      if (prefs.headingFollow && !prefs.locationFollow) {
        headingFollowRef.current = true;
        setHeadingFollow(true);
        mapRef.current?.setHeadingFollow(true);
      } else if (!prefs.headingFollow && !prefs.locationFollow) {
        headingFollowRef.current = false;
        setHeadingFollow(false);
        mapRef.current?.setHeadingFollow(false);
      }
    },
    [],
  );

  // Cold start: Karte immer frei. Gespeicherte HUD-Locks nicht auto-reaktivieren
  // (sonst GPS mittig + Follow, obwohl User panzen will). Prefs nur nach Tap.
  useEffect(() => {
    void hydrateHomeMapHudFollowPrefs().then(() => {
      noteHomeMapHudFollowPrefs({ locationFollow: false, headingFollow: false });
    });
  }, []);

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
    // Live-Nav/Tour: Route nie wegen Pack-Gate wischen (Pan/Edge → sonst
    // ShapeSource-Churn, UI-Freeze, „Route weg“, Puck wirkt falsch).
    if (isVectorBasemapEnabled() && !liveActive && !tourOpen) {
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
    if (!liveActive && !tourOpen) {
      const offer = useFinnusStore.getState().pendingNavOffer;
      const previewStore = useMapRouteStore.getState().route;
      const loading = useFinnusStore.getState().navRouteLoading === true;
      const hasWegweiserPreview =
        offer?.source === 'wegweiser' &&
        offer.awaitConfirm === true &&
        (offer.previewRoute?.length ?? 0) >= 2;
      // Bridge-Instant: Dest-Pin (+ grobe Linie) schon während TTS / Geocode→Commit.
      const hasInstantBridgePreview =
        loading &&
        offer != null &&
        typeof offer.lat === 'number' &&
        typeof offer.lng === 'number' &&
        (offer.source === 'concierge' || offer.source === 'other');
      if (hasWegweiserPreview || hasInstantBridgePreview) {
        const street =
          (offer!.previewRoute?.length ?? 0) >= 2
            ? offer!.previewRoute!
            : [];
        const payload =
          previewStore?.preview === true &&
          (previewStore.current?.length ?? 0) >= 2
            ? { ...previewStore, preview: true }
            : {
                current: street,
                ahead: [],
                pins: [
                  {
                    lat: offer!.lat!,
                    lng: offer!.lng!,
                    n: 1,
                    name: offer!.name,
                  },
                ],
                arrows: [],
                preview: true,
                previewPin: { lat: offer!.lat!, lng: offer!.lng! },
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
    // Live-Nav: leere Geometrie nie über eine gute Linie malen (Enrich-Gap /
    // Leg-Handoff → sonst „Route weg“ obwohl navActive).
    const mappedLen = payload?.current?.length ?? 0;
    if (liveActive && mappedLen < 2 && lastRouteJson.current !== 'null') {
      return;
    }
    const json = navRoutePayloadSig(
      payload ?? { current: [], ahead: [], pins: [], arrows: [] },
    );
    if (json === lastRouteJson.current) return;
    lastRouteJson.current = json;
    // Live-Nav: nie gestrichelte Preview, wenn echte Polyline/Turn da ist.
    const livePayload =
      payload &&
      (payload.current.length >= 3 || (payload.turnBands?.length ?? 0) > 0)
        ? { ...payload, preview: false }
        : payload;
    setMapRoute(livePayload ?? { current: [], ahead: [], pins: [], arrows: [] });
    useMapRouteStore.getState().setRoute(
      livePayload ?? { current: [], ahead: [], pins: [], arrows: [] },
    );
    if (!pendingNavFitRef.current) return;
    pendingNavFitRef.current = false;
    // A user-selected GPS lock wins over the one-shot route overview. The old
    // start path explicitly detached follow here, so the puck appeared frozen.
    if (locationFollowRef.current && followRef.current) return;
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
      // Mindestspanne: kurze Nav-Routen mit Überblick-Padding, kein Street-Tight.
      // Kein delayed jumpTo auf Zoom 16 / Follow-Snap — Overview bleibt, Finger frei.
      const padLat = Math.max((north - south) * 0.55, 0.0022);
      const padLng = Math.max((east - west) * 0.55, 0.0028);
      south -= padLat;
      north += padLat;
      west -= padLng;
      east += padLng;
      mapRef.current?.fitBounds(south, west, north, east, true);
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
      pendingNavFitRef.current =
        !locationFollowRef.current || !followRef.current;
      setDropPin(null);
    }
    if (!navActive && wasNavActive.current) {
      pendingNavZoomTokenRef.current = 0;
    }
    wasNavActive.current = navActive;
    injectNavRoute();
  }, [injectNavRoute, navActive, navRouteRev, multiStopTour]);

  useEffect(() => {
    injectNavRoute();
    if (readyRef.current) injectPlacesOnly();
  }, [injectNavRoute, injectPlacesOnly, pendingNavOffer, navRouteLoading]);

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
      placesPaintedPoiCountRef.current = 0;
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
    // Splash: GPS-Punkt aus Live oder Last-Known — nicht erst auf frischen Fix warten.
    if (bootLat != null && bootLng != null) {
      noteSplashGpsLive();
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
        // Pack-_coverage: echte Packs zuerst — soft_gdynia hat kein Pack.
        const rawActive = (activeMapId || '').toLowerCase();
        const coverActive =
          rawActive && !isSoftCityId(rawActive)
            ? rawActive
            : localPackIdsRef.current[0] || '';
        const coverIds = coverActive
          ? [
              coverActive,
              ...localPackIdsRef.current.filter((id) => id !== coverActive),
            ]
          : localPackIdsRef.current;
        await registerCoverageFromLocalPacks({
          cityIds: coverIds.slice(0, 1),
          yieldEvery: 1,
        });
        invalidateLocalMapIndex();
        await warmLocalMapIndex();
        if (readyRef.current && mapLayerDebugAllows('cities')) injectCitiesRef.current();
        // Optional: genau EIN Nah-Nachbar idle vorwärmen — nie die ganze Offline-Liste.
        const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapIdleWhenFree: (fn: () => void) => void;
        };
        const restCover = coverIds.slice(1);
        if (restCover.length) {
          runMapIdleWhenFree(() => {
            void (async () => {
              const chunk = 8;
              for (let i = 0; i < restCover.length; i += chunk) {
                await registerCoverageFromLocalPacks({
                  cityIds: restCover.slice(i, i + chunk),
                  yieldEvery: 1,
                  allowFullPackParse: true,
                }).catch(() => undefined);
                await new Promise<void>((r) => setTimeout(r, 40));
              }
            })();
          });
        }
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
        void (async () => {
          const { runMapIdleWhenFree } = require('../../services/boot/interactiveBootGate') as {
            runMapIdleWhenFree: (fn: () => void) => void;
          };
          try {
            // Pack-Liste ZUERST — sonst Gate wipcht Orte / blockiert Mic+Pan.
            const rows = await listLocalCityDatasets();
            localOfflineCityIdsRef.current = rows
              .filter((row) => row.hasPack || row.hasMap)
              .map((row) => row.id.toLowerCase())
              .filter((id) => id && !isRegionPackCityId(id));
            localPackIdsRef.current = rows
              .filter((row) => row.hasPack)
              .map((row) => row.id.toLowerCase());
            const bootCoverageIds = activeId
              ? [activeId, ...localPackIdsRef.current.filter((id) => id !== activeId)]
              : localPackIdsRef.current;
            await registerCoverageFromLocalPacks({
              cityIds: bootCoverageIds.slice(0, 1),
              yieldEvery: 1,
            }).catch(() => undefined);
            // First-Look: Fog-Signal → Splash heben.
            // Leiter erst ab Splash-Interactive (nicht unter dem Vorhang),
            // Light-Pins ~1 s, volle Orte ~2 s → Pan zuerst.
            noteSplashMapFogReady();
            const warmLat = bootLat;
            const warmLng = bootLng;
            const warmActive = activeId;
            const {
              runMapLightPinsWhenFree,
              runMapPolishWhenFree,
              runMapIdleWhenFree: runIdle,
              peekInteractiveBootGate,
            } = require('../../services/boot/interactiveBootGate') as {
              runMapLightPinsWhenFree: (fn: () => void) => void;
              runMapPolishWhenFree: (fn: () => void) => void;
              runMapIdleWhenFree: (fn: () => void) => void;
              peekInteractiveBootGate: () => { splashInteractiveAt: number };
            };
            const yieldThen = (fn: () => void) => {
              setTimeout(() => {
                if (!readyRef.current) return;
                if (userMapGestureRef.current || isMapUserGesturing()) {
                  placesPaintPendingRef.current = true;
                  return;
                }
                fn();
              }, 0);
            };
            const armPostSplashLadder = () => {
              setTimeout(() => {
                runMapLightPinsWhenFree(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:lightPins');
                    if (warmActive) injectFastCityPinsRef.current(warmActive);
                  });
                });
              }, HOME_MAP_LIGHT_PINS_AFTER_SPLASH_MS);
              setTimeout(() => {
                runMapPolishWhenFree(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:placesPaint');
                    placesFastDotsRef.current = true;
                    placesForceRef.current = true;
                    lastPlacesSig.current = '';
                    placesBootCommittedRef.current = false;
                    injectPlacesOnlyRef.current();
                    placesForceRef.current = false;
                    if (yorroContentAt(warmLat, warmLng)) {
                      noteMapPlacesReady(warmActive);
                    }
                    // Städte-Polygone erst später — sonst 1–2 Min Ruckeln nach Boot.
                  });
                });
              }, HOME_MAP_PLACES_PAINT_AFTER_SPLASH_MS);
              setTimeout(() => {
                runIdle(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:fog');
                    void loadWalkTrack()
                      .then((track) => {
                        walkTrackRef.current = track;
                        if (!isMapUserGesturing()) forceFogRecompute(track);
                      })
                      .catch(() => undefined);
                    if (!isMapUserGesturing() && mapLayerDebugAllows('cities')) {
                      citiesForceRef.current = true;
                      injectCitiesRef.current();
                      citiesForceRef.current = false;
                    }
                  });
                });
              }, HOME_MAP_FOG_AFTER_SPLASH_MS);
              setTimeout(() => {
                runIdle(() => {
                  yieldThen(() => {
                    if (__DEV__) console.log('[homeMapBoot] ladder:neighborWarm');
                    void warmNearbyPinIndexes({
                      activeCityId: warmActive,
                      stickyCityId: warmActive,
                      lat: warmLat,
                      lng: warmLng,
                    }).catch(() => undefined);
                    if (!readyRef.current) return;
                    placesFastDotsRef.current = false;
                    if (userMapGestureRef.current || isMapUserGesturing()) {
                      placesPaintPendingRef.current = true;
                    } else {
                      placesForceRef.current = true;
                      lastPlacesSig.current = '';
                      injectPlacesOnlyRef.current();
                      placesForceRef.current = false;
                    }
                    if (tileSnapTimer.current) clearTimeout(tileSnapTimer.current);
                    tileSnapTimer.current = setTimeout(() => {
                      tileSnapTimer.current = null;
                      // Snap nur über Ref → mapIdle (nie Polish).
                      if (!isMapUserGesturing()) runTileFootprintSnapRef.current();
                    }, 220);
                  });
                });
              }, HOME_MAP_NEIGHBOR_WARM_AFTER_SPLASH_MS);
            };
            if (peekInteractiveBootGate().splashInteractiveAt) {
              armPostSplashLadder();
            } else {
              const poll = setInterval(() => {
                if (!peekInteractiveBootGate().splashInteractiveAt) return;
                clearInterval(poll);
                armPostSplashLadder();
              }, 40);
              setTimeout(() => clearInterval(poll), 20_000);
            }
            // Restliche Coverage idle — chunked, mit Yield.
            const restIds = bootCoverageIds.slice(1);
            if (restIds.length) {
              runMapIdleWhenFree(() => {
                void (async () => {
                  const chunk = 8;
                  for (let i = 0; i < restIds.length; i += chunk) {
                    await registerCoverageFromLocalPacks({
                      cityIds: restIds.slice(i, i + chunk),
                      yieldEvery: 1,
                      allowFullPackParse: true,
                    }).catch(() => undefined);
                    await new Promise<void>((r) => setTimeout(r, 40));
                  }
                  if (
                    readyRef.current &&
                    mapLayerDebugAllows('cities') &&
                    !mapUserExploredRef.current &&
                    !isMapUserGesturing()
                  ) {
                    citiesForceRef.current = true;
                    injectCitiesRef.current();
                    citiesForceRef.current = false;
                  }
                })();
              });
            }
          } catch {
            noteSplashMapFogReady();
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
          // Kein setWalkTrack → NativeHomeMap Remount/Snap. Fog nur Store.
          if (!isMapUserGesturing() && !mapUserExploredRef.current) {
            forceFogRecompute(track);
          } else {
            setTimeout(() => {
              if (!isMapUserGesturing()) forceFogRecompute(track);
            }, 800);
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

  const gestureQuietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureWatchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onNativeUserPan = useCallback(() => {
    // Echte User-Bewegung: immer sofort Unlock — ignoreUserPanUntil gilt nur
    // gegen programmierte Jump-Echoes (die noteUserGesture gar nicht feuern).
    mapUserExploredRef.current = true;
    userMapGestureRef.current = true;
    // Watchdog auch bei Pan-only (ohne sauberes GestureEnd).
    if (gestureWatchdogTimer.current) clearTimeout(gestureWatchdogTimer.current);
    gestureWatchdogTimer.current = setTimeout(() => {
      gestureWatchdogTimer.current = null;
      if (!userMapGestureRef.current) return;
      userMapGestureRef.current = false;
      if (placesPaintPendingRef.current) {
        placesPaintPendingRef.current = false;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    }, 2_800);
    pendingRingDone.current?.();
    followRef.current = false;
    locationFollowRef.current = false;
    headingFollowRef.current = false;
    lastGpsTapAt.current = 0;
    gpsTapStageRef.current = undefined;
    lastCompassTapAt.current = 0;
    setLocationFollow(false);
    setHeadingFollow(false);
    // Prefs speichern: Fixierung raus, freie Ansicht bleibt.
    noteHomeMapHudFollowPrefs({ locationFollow: false, headingFollow: false });
    mapRef.current?.releaseFollow();
    mapRef.current?.setHeadingFollow(false);
  }, []);

  const onNativeUserRotate = useCallback(() => {
    headingFollowRef.current = false;
    lastCompassTapAt.current = 0;
    setHeadingFollow(false);
    // Rotation ist nur ein Session-Unlock; Standort-Follow bleibt erhalten.
    mapRef.current?.setHeadingFollow(false);
  }, []);

  const onNativeMapGestureStart = useCallback(() => {
    userMapGestureRef.current = true;
    // Sofort: Fog/Heavy nicht gegen Finger kämpfen.
    mapUserExploredRef.current = true;
    if (gestureQuietTimer.current) {
      clearTimeout(gestureQuietTimer.current);
      gestureQuietTimer.current = null;
    }
    // Failsafe: klemmendes Gesture-Flag (Region-Change ohne Finger-up) → Orte nie.
    if (gestureWatchdogTimer.current) clearTimeout(gestureWatchdogTimer.current);
    gestureWatchdogTimer.current = setTimeout(() => {
      gestureWatchdogTimer.current = null;
      if (!userMapGestureRef.current) return;
      userMapGestureRef.current = false;
      if (placesPaintPendingRef.current) {
        placesPaintPendingRef.current = false;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    }, 2_800);
  }, []);

  const onNativeMapGestureEnd = useCallback(() => {
    // Finger hoch ≠ Idle — kurze Quiet für Orte (Fling), nicht Sekunden warten.
    if (gestureWatchdogTimer.current) {
      clearTimeout(gestureWatchdogTimer.current);
      gestureWatchdogTimer.current = null;
    }
    if (gestureQuietTimer.current) clearTimeout(gestureQuietTimer.current);
    gestureQuietTimer.current = setTimeout(() => {
      gestureQuietTimer.current = null;
      userMapGestureRef.current = false;
      // Nach Zoom/Pan: sichtbare Städte aus Disk mergen + Orte (2-Phasen).
      const view = viewRef.current;
      if (view && isVectorBasemapEnabled()) {
        const midLat = (view.south + view.north) / 2;
        const midLng = (view.west + view.east) / 2;
        if (Number.isFinite(midLat) && Number.isFinite(midLng)) {
          maybeEnsureBrowsePackAt(midLat, midLng);
          // Phase 1: Stories behalten Gebäudefläche; Directory nur Punkte.
          placesFastDotsRef.current = true;
          placesForceRef.current = true;
          lastPlacesSig.current = '';
          injectPlacesOnlyRef.current();
          placesForceRef.current = false;
          placesPaintPendingRef.current = false;
          // Phase 2: alle Ringe + Tile-Snap — auch nach Erkunden.
          setTimeout(() => {
            if (userMapGestureRef.current || isMapUserGesturing()) {
              placesPaintPendingRef.current = true;
              return;
            }
            placesFastDotsRef.current = false;
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
            // Footprint-Snap nur mapIdle (Ref gated) — nicht sync im Gesture-Quiet.
            runTileFootprintSnapRef.current();
          }, 320);
        }
      } else if (placesPaintPendingRef.current) {
        placesPaintPendingRef.current = false;
        placesForceRef.current = true;
        lastPlacesSig.current = '';
        injectPlacesOnlyRef.current();
        placesForceRef.current = false;
      }
    }, HOME_MAP_PLACES_GESTURE_QUIET_MS);
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
      currentMapZoomRef.current = Number.isFinite(v.zoom) ? v.zoom : currentMapZoomRef.current;
      // Auch während Drehen/Pan — sonst bleibt die Kompass-Nadel oben tot.
      if (Number.isFinite(v.bearing)) {
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
        // Idle: Places neu wenn weit genug gepannt/gezoomt (Konstanten waren tot).
        if (
          !userMapGestureRef.current &&
          !isMapUserGesturing() &&
          isVectorBasemapEnabled()
        ) {
          const prev = placesInjectCenterRef.current;
          const movedM =
            prev != null
              ? metersBetween(prev.lat, prev.lng, midLat, midLng)
              : HOME_MAP_PLACES_REINJECT_MIN_M + 1;
          const zoomDelta =
            prev != null ? Math.abs(v.zoom - prev.zoom) : HOME_MAP_PLACES_REINJECT_ZOOM + 1;
          if (
            movedM >= HOME_MAP_PLACES_REINJECT_MIN_M ||
            zoomDelta >= HOME_MAP_PLACES_REINJECT_ZOOM
          ) {
            placesInjectCenterRef.current = {
              lat: midLat,
              lng: midLng,
              zoom: v.zoom,
            };
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
          }
        }
        // Kartenbewegung: kein Extract-/Cities-ShapeSource-Update mid-gesture.
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
        // Immer: sichtbare Nachbarstädte (Tornesch/Pinneberg) als Browse nachziehen.
        maybeEnsureBrowsePackAt(midLat, midLng);
        if (!allowed) {
          const navOn = useFinnusStore.getState().navActive;
          // Nie Orte clearen nur weil Pack-Liste stale (Pinneberg sonst 60s tot).
          void navOn;
          const { isInMapPolishTouchGrace, runMapLightPinsWhenFree, runMapIdleWhenFree } =
            require('../../services/boot/interactiveBootGate') as {
              isInMapPolishTouchGrace: () => boolean;
              runMapLightPinsWhenFree: (fn: () => void) => void;
              runMapIdleWhenFree: (fn: () => void) => void;
            };
          const midPack =
            smallestCityIdContainingPoint(
              midLat,
              midLng,
              listKnownCityCoverageBounds(),
            )?.toLowerCase() ?? null;
          if (isInMapPolishTouchGrace()) {
            placesPaintPendingRef.current = true;
            runMapLightPinsWhenFree(() => {
              if (midPack) injectFastCityPinsRef.current(midPack);
            });
          } else {
            if (midPack) {
              injectFastCityPinsRef.current(midPack);
            }
            runMapIdleWhenFree(() => {
              scheduleNeighborPackPlacesMerge([], placesInjectGen.current);
            });
          }
          // Weit raus: Stadtflächen (erkundet/Katalog) nachziehen — nicht nur wenn leer.
          if (!userMapGestureRef.current && !isMapUserGesturing()) {
            refreshCatalogBoundariesRef.current(48);
            citiesForceRef.current = true;
            injectCitiesRef.current();
            citiesForceRef.current = false;
          }
          return;
        }
        // Pack unter Kamera gewechselt (Prisdorf → Tornesch) → Idle-Refresh.
        // Auch: neue heruntergeladene Stadt nur am Rand sichtbar (Zentrum noch alt).
        const known = listKnownCityCoverageBounds();
        const packAt =
          smallestCityIdContainingPoint(midLat, midLng, known)?.toLowerCase() ??
          null;
        const packDownloaded =
          packAt != null &&
          isCityPackDownloaded(packAt, localPackIdsRef.current);
        const packChanged =
          packAt != null &&
          packAt !== lastViewportPackAtRef.current &&
          packDownloaded;
        if (packChanged) {
          lastViewportPackAtRef.current = packAt;
        }
        const viewPad = {
          south: v.south,
          north: v.north,
          west: v.west,
          east: v.east,
        };
        const overlapSig = overlappingDownloadedPackIds(viewPad).join('|');
        const overlapChanged =
          overlapSig.length > 0 &&
          overlapSig !== lastOverlappingPackSigRef.current;
        // Sig erst nach Idle-Paint setzen — sonst Geste blockiert Retry.
        const needPlaces =
          mapPlaces.length === 0 ||
          prevAllowed === false ||
          prevAllowed == null ||
          packChanged ||
          overlapChanged ||
          placesPaintPendingRef.current;
        if (needPlaces && !userMapGestureRef.current && !placesForceRef.current) {
          if (viewportPlacesRefreshTimer.current) {
            clearTimeout(viewportPlacesRefreshTimer.current);
          }
          viewportPlacesRefreshTimer.current = setTimeout(() => {
            viewportPlacesRefreshTimer.current = null;
            if (userMapGestureRef.current || isMapUserGesturing()) {
              placesPaintPendingRef.current = true;
              return;
            }
            placesForceRef.current = true;
            lastPlacesSig.current = '';
            injectPlacesOnlyRef.current();
            placesForceRef.current = false;
            placesPaintPendingRef.current = false;
            if (overlapChanged) {
              lastOverlappingPackSigRef.current = overlapSig;
            }
            citiesForceRef.current = true;
            injectCitiesRef.current();
            citiesForceRef.current = false;
          }, 420);
        } else if (needPlaces) {
          placesPaintPendingRef.current = true;
        }
      }
    },
    [
      bounds,
      cityId,
      mapCities.length,
      mapPlaces.length,
      maybeEnsureBrowsePackAt,
      overlappingDownloadedPackIds,
      scheduleNeighborPackPlacesMerge,
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
      if (Date.now() < ignorePlaceTapUntil.current) return;
      noteUiTap('mapPlace');
      if (viewportInjectTimer.current) {
        clearTimeout(viewportInjectTimer.current);
        viewportInjectTimer.current = null;
      }
      popupHoldRef.current = true;

      const showSkeleton = (
        id: number,
        name: string,
        category: string | undefined,
        lat: number,
        lng: number,
      ) => {
        useHomeMapUiStore.getState().setPlacePopup(
          skeletonMapPlacePopup({
            id,
            name,
            category,
            lat,
            lng,
          }),
        );
      };

      const enrichPopup = (
        id: number,
        name: string,
        category: string | undefined,
        lat: number,
        lng: number,
      ) => {
        const overlay = overlayPinsRef.current.get(id);
        const poi = poisByIdRef.current.get(id) ?? null;
        const full = instantMapPlacePopup({
          id,
          name: name || overlay?.name || poi?.name,
          category: category || overlay?.cityId || undefined,
          lat,
          lng,
          poi,
        });
        const cur = useHomeMapUiStore.getState().placePopup;
        if (!cur || cur.id !== id) return;
        useHomeMapUiStore.getState().setPlacePopup({
          ...full,
          lat: cur.lat,
          lng: cur.lng,
        });
        if (!overlay && id > 0) {
          void prioritizeMapPlacePreview(id);
        }
      };

      // Frame 1: Skeleton sofort — nie hinter Basemap-Match oder InteractionManager.
      const overlay = overlayPinsRef.current.get(placeId);
      showSkeleton(
        placeId,
        placeName || overlay?.name || place.name,
        placeCategory || overlay?.cityId || undefined,
        placeLat,
        placeLng,
      );

      const finishAfterMatch = () => {
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
            if (
              nameKey &&
              poiKey &&
              (poiKey.includes(nameKey) || nameKey.includes(poiKey))
            ) {
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
            const cur = useHomeMapUiStore.getState().placePopup;
            if (cur && cur.id === MAP_BASEMAP_POI_ID) {
              showSkeleton(
                placeId,
                placeName,
                placeCategory,
                placeLat,
                placeLng,
              );
            }
          }
        }
        enrichPopup(
          placeId,
          placeName,
          placeCategory,
          placeLat,
          placeLng,
        );
      };

      // Enrich + Match nach dem ersten Paint — nie InteractionManager
      // (MapLibre hält „interactions“ oft fest → Buttons/Dismiss tot).
      let enriched = false;
      const runEnrichOnce = () => {
        if (enriched) return;
        enriched = true;
        finishAfterMatch();
      };
      requestAnimationFrame(() => {
        queueMicrotask(runEnrichOnce);
      });
      setTimeout(runEnrichOnce, 48);
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
      // Gebäude-Tap: echten Namen nachziehen (Edeka …), nicht „Punkt auf der Karte“.
      if (snap.kind === 'point') {
        const dropLat = lat;
        const dropLng = lng;
        void resolveMapDropName(dropLat, dropLng).then((resolved) => {
          if (!resolved) return;
          const ui = useHomeMapUiStore.getState();
          const cur = ui.placePopup;
          if (!cur || cur.id !== MAP_DROP_PIN_ID) return;
          if (Math.abs(cur.lat - dropLat) > 1e-5 || Math.abs(cur.lng - dropLng) > 1e-5) {
            return;
          }
          ui.setPlacePopup({ ...cur, name: resolved, category: cur.category || 'Ort' });
        });
      }
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
    (mode: 'center' | 'zoom_in' | 'lock') => {
      const apply = (lat: number, lng: number) => {
        lastFollowGps.current = { lat, lng };
        didCameraLock.current = true;
        // Center/Zoom: einmal GPS, detached bleiben — kein reattachFollow.
        if (mode === 'lock') {
          mapRef.current?.reattachFollow();
          followRef.current = true;
          locationFollowRef.current = true;
          setLocationFollow(true);
          const zoom = gpsZoomIsCloseEnough(currentMapZoomRef.current)
            ? undefined
            : GPS_RECENTER_STREET_ZOOM;
          mapRef.current?.jumpTo(lat, lng, zoom, true);
          return;
        }
        followRef.current = false;
        locationFollowRef.current = false;
        setLocationFollow(false);
        mapRef.current?.jumpTo(
          lat,
          lng,
          mode === 'zoom_in' ? GPS_RECENTER_STREET_ZOOM : undefined,
          true,
        );
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
          // One-shot: kein zweiter Nachzug (sonst reißt freie Erkundung zurück).
          if (mode !== 'lock') return;
          if (mode === 'lock' && !locationFollowRef.current) return;
          apply(fresh.lat, fresh.lng);
        })
        .catch(() => undefined);
    },
    [cityId],
  );

  const onRecenter = useCallback(() => {
    // Live-Nav: ein Tap = sofort zentrieren + Follow (kein Multi-Stage-Lag).
    if (useFinnusStore.getState().navActive) {
      locationFollowRef.current = true;
      lastGpsTapAt.current = Date.now();
      gpsTapStageRef.current = undefined;
      setLocationFollow(true);
      noteHomeMapHudFollowPrefs({
        locationFollow: true,
        headingFollow: headingFollowRef.current,
      });
      ignoreUserPanUntil.current = Date.now() + 700;
      mapRef.current?.reattachFollow();
      mapRef.current?.setHeadingFollow(headingFollowRef.current);
      snapGps('lock');
      return;
    }
    const next = nextGpsRecenterTap(
      {
        locked: locationFollowRef.current,
        lastTapAt: lastGpsTapAt.current,
        stage: gpsTapStageRef.current,
      },
      Date.now(),
      currentMapZoomRef.current,
    );
    lastGpsTapAt.current = next.lastTapAt;
    gpsTapStageRef.current = next.stage;
    locationFollowRef.current = next.locked;
    setLocationFollow(next.locked);
    if (next.action === 'unlock') {
      followRef.current = false;
      noteHomeMapHudFollowPrefs({ locationFollow: false });
      mapRef.current?.releaseFollow();
      return;
    }
    // Zentrieren/Zoom/Lock ändern niemals den separat gewählten Kompassmodus.
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'lock') {
      noteHomeMapHudFollowPrefs({
        locationFollow: true,
        headingFollow: headingFollowRef.current,
      });
      mapRef.current?.reattachFollow();
      // Heading nur wenn User den Kompass-Button schon aktiv hat.
      mapRef.current?.setHeadingFollow(headingFollowRef.current);
    } else {
      noteHomeMapHudFollowPrefs({ locationFollow: false });
    }
    snapGps(next.action);
  }, [snapGps]);

  const onRecenterLock = useCallback(() => {
    locationFollowRef.current = true;
    lastGpsTapAt.current = Date.now();
    gpsTapStageRef.current = undefined;
    setLocationFollow(true);
    // Kein Kompass-Zwang — Location-Follow allein.
    noteHomeMapHudFollowPrefs({
      locationFollow: true,
      headingFollow: headingFollowRef.current,
    });
    ignoreUserPanUntil.current = Date.now() + 700;
    mapRef.current?.reattachFollow();
    mapRef.current?.setHeadingFollow(headingFollowRef.current);
    snapGps('lock');
  }, [snapGps]);

  const onNorthUp = useCallback(() => {
    const next = nextCompassTap(
      {
        follow: headingFollowRef.current,
        armedForFollow: lastCompassTapAt.current > 0,
        mapOffNorth: true,
        lastTapAt: lastCompassTapAt.current,
      },
      Date.now(),
    );
    lastCompassTapAt.current = next.lastTapAt;
    headingFollowRef.current = next.follow;
    setHeadingFollow(next.follow);
    noteHomeMapHudFollowPrefs({ headingFollow: next.follow });
    ignoreUserPanUntil.current = Date.now() + 700;
    if (next.action === 'heading_lock') {
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
        onUserRotate={onNativeUserRotate}
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
