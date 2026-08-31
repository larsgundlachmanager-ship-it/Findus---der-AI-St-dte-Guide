/**
 * Native Homescreen-Karte — MapLibre Native, kein WebView, keine HTTP-Kacheln.
 * Stadt-Extract + Fog + Orte + GPS + Route liegen als ShapeSources auf dem GL-Thread.
 */

import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CircleLayer,
  FillLayer,
  Images,
  LineLayer,
  MapView,
  MarkerView,
  ShapeSource,
  SymbolLayer,
  type OnPressEvent,
  type RegionPayload,
  type ShapeSourceRef,
} from '@maplibre/maplibre-react-native';
import { InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  YorroHomeCamera,
  type YorroHomeCameraRef,
} from './YorroHomeCamera';
import type { CityMapExtract } from '../../services/homeMap/cityMapExtract';
import {
  cityMapExtractToGeojson,
  emptyExtractGeojson,
} from '../../services/homeMap/cityMapExtractGeojson';
import type {
  ExtractGeojsonPhase,
  GeoJsonFc,
  GeoJsonFeature,
} from '../../services/homeMap/cityMapExtractGeojson';
import { OFFLINE_HOME_MAP_STYLE } from '../../services/homeMap/offlineHomeMapStyle';
import {
  getWorldOverview,
  getWorldLabels,
  type WorldLabelsBundle,
  type WorldOverviewBundle,
} from '../../services/homeMap/worldOverviewGeojson';
import {
  HOME_MAP_BUILDINGS_AFTER_CORE_MS,
  HOME_MAP_WORLD_AFTER_CORE_MS,
} from '../../services/homeMap/homeMapBootSchedule';
import { markHomeMapBoot } from '../../services/homeMap/homeMapBootMetrics';
import {
  HOME_MAP_ADMIN1_BORDER,
  HOME_MAP_ADMIN1_FILL,
  HOME_MAP_BG,
  HOME_MAP_BUILDING_FILL,
  HOME_MAP_BUILDING_STROKE,
  HOME_MAP_CHROME_DIM,
  HOME_MAP_DETAIL_FADE,
  HOME_MAP_FOG_ENABLED,
  HOME_MAP_FOG_FILL,
  HOME_MAP_FOG_MASK_ENABLED,
  HOME_MAP_FOG_REVEAL,
  HOME_MAP_FOG_ZOOM,
  HOME_MAP_LAND_FAR,
  HOME_MAP_OCEAN,
  HOME_MAP_OVERVIEW_LOD,
  HOME_MAP_WORLD_STRUCTURE_LOD,
  HOME_MAP_STREET_LABEL_LOD,
  HOME_MAP_PARK,
  HOME_MAP_RAIL,
  HOME_MAP_ROAD_COLORS,
  HOME_MAP_ROUTE_AHEAD,
  HOME_MAP_ROUTE_AHEAD_CASING,
  HOME_MAP_ROUTE_LINE,
  HOME_MAP_ROUTE_LINE_CASING,
  HOME_MAP_URBAN_FILL,
  HOME_MAP_COUNTRY_BORDER,
  HOME_MAP_WATER,
  HOME_MAP_WOOD,
  HOME_MAP_BASE_LOD,
  HOME_MAP_CITY_FILL_ZOOM,
  HOME_MAP_CITY_OUTLINE_UNTIL,
  HOME_MAP_PLACE_FILL_OPACITY,
} from '../../services/homeMap/homeMapStyle';
import {
  buildExploredPolygons,
  fogMaskFromExplored,
  fogPolygonsToGeoJSON,
  fogTrackCacheKey,
  fogBoundsCacheKey,
  FOG_MERGE_GAP_M,
  type FogBounds,
} from '../../services/discovery/fogCoverage';
import { WALK_REVEAL_RADIUS_M, type WalkTrackPoint } from '../../services/discovery/walkTrackService';
import type { NavRouteMapPayload } from '../../services/navigation/navRouteMapPayload';
import { MAP_DROP_PIN_ID } from '../../services/homeMap/mapPlacePreview';
import { useSensorStore } from '../../store/useSensorStore';
import { useFogStore } from '../../store/useFogStore';
import { useRegionalFallbackStore } from '../../store/useRegionalFallbackStore';
import {
  getMapDisplayHeadingDegSticky,
} from '../../services/navigation/liveDeviceHeading';
import {
  HOME_MAP_ICON_LOD_ZOOM,
  HOME_MAP_PARK_ICONS,
  HOME_MAP_TRANSIT_ICONS,
  homeMapIconLod,
  type HomeMapIconLod,
} from '../../services/homeMap/homeMapPlaceType';
import {
  amenityIconImageName,
  HOME_MAP_AMENITY_IMAGES,
} from './homeMapAmenityImages';
import { exclusiveCityRings } from '../../services/homeMap/exclusiveCityPolygons';

export type NativeMapPlace = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  color: string;
  ring: Array<[number, number]> | null;
  category: string;
  keepDot?: boolean;
  amenityDot?: boolean;
  icon?: string;
  iconLod?: HomeMapIconLod;
  story?: number;
};

export type NativeMapCity = {
  id: string;
  name: string;
  ring: Array<[number, number]>;
  fill: string;
  stroke: string;
  fillOpacity: number;
  dashed: boolean;
};

export type NativeHomeMapHandle = {
  jumpTo: (lat: number, lng: number, zoom?: number, reattach?: boolean) => void;
  fitBounds: (
    south: number,
    west: number,
    north: number,
    east: number,
    reattach?: boolean,
  ) => void;
  setNorthUp: () => void;
  /** Blickrichtungs-Follow sofort (ohne React-Prop-Lag). */
  setHeadingFollow: (on: boolean) => void;
  /** Follow wieder anbinden ohne Kamera-Sprung. */
  reattachFollow: () => void;
  /** Freie Erkundung: GPS darf die Kamera nie zurückziehen. */
  releaseFollow: () => void;
};

type Props = {
  extract: CityMapExtract | null;
  places: NativeMapPlace[];
  cities: NativeMapCity[];
  route: NavRouteMapPayload | null;
  walkTrack: WalkTrackPoint[];
  dropPin: { lat: number; lng: number } | null;
  locationFollow: boolean;
  headingFollow: boolean;
  chromeDim: boolean;
  initialLat: number;
  initialLng: number;
  initialZoom: number;
  onReady: () => void;
  onUserPan: () => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Live-Kompassnadel während Dreh-Geste (leicht gedrosselt). */
  onBearing?: (bearing: number) => void;
  onViewport: (v: {
    south: number;
    west: number;
    north: number;
    east: number;
    zoom: number;
    bearing: number;
  }) => void;
  onPlaceTap: (place: {
    id: number;
    name: string;
    category: string;
    lat: number;
    lng: number;
  }) => void;
  onDropPin: (lat: number, lng: number) => void;
  onBlankTap: () => void;
};

const EMPTY_FC: GeoJsonFc = { type: 'FeatureCollection', features: [] };
const EMPTY_PUCK_FC = { accuracy: EMPTY_FC, arrow: EMPTY_FC };
const EMPTY_WORLD: WorldOverviewBundle = {
  v: 0,
  land: EMPTY_FC,
  lakes: EMPTY_FC,
  borders: EMPTY_FC,
  urban: EMPTY_FC,
  admin1: EMPTY_FC,
  admin1De: EMPTY_FC,
};
const EMPTY_LABELS: WorldLabelsBundle = {
  v: 0,
  cities: EMPTY_FC,
  rivers: EMPTY_FC,
  roads: EMPTY_FC,
  regions: EMPTY_FC,
};
const MAP_TEXT_FONT = ['Noto Sans Regular'];

function ringTooWideForFill(
  ring: Array<[number, number]>,
  story?: boolean,
): boolean {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const [lat, lng] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const m = Math.hypot(
    (maxLat - minLat) * 111_320,
    (maxLng - minLng) * 111_320 * 0.6,
  );
  return m > (story ? 2200 : 420);
}

function ringToPolygon(
  ring: Array<[number, number]>,
  holes: Array<Array<[number, number]>> = [],
): GeoJsonFeature | null {
  if (!ring || ring.length < 3) return null;
  const coords = ring.map((p) => [p[1], p[0]] as [number, number]);
  const a = coords[0]!;
  const b = coords[coords.length - 1]!;
  if (a[0] !== b[0] || a[1] !== b[1]) coords.push(a);
  const holeCoords: Array<Array<[number, number]>> = [];
  for (const h of holes) {
    if (!h || h.length < 3) continue;
    const c = h.map((p) => [p[1], p[0]] as [number, number]);
    const ha = c[0]!;
    const hb = c[c.length - 1]!;
    if (ha[0] !== hb[0] || ha[1] !== hb[1]) c.push(ha);
    holeCoords.push(c);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords, ...holeCoords] },
  };
}

function placesToGeojson(places: NativeMapPlace[]): {
  fills: GeoJsonFc;
  dots: GeoJsonFc;
  amenities: GeoJsonFc;
} {
  const fills: GeoJsonFeature[] = [];
  const dots: GeoJsonFeature[] = [];
  const amenities: GeoJsonFeature[] = [];
  for (const p of places) {
    const props = {
      id: p.id,
      name: p.name,
      category: p.category,
      color: p.color,
      lat: p.lat,
      lng: p.lng,
      icon: p.icon || '',
      iconImg: amenityIconImageName(p.icon),
      kind: p.iconLod || homeMapIconLod(p.icon),
    };
    const poly =
      p.ring && p.ring.length >= 3 && !ringTooWideForFill(p.ring, !!p.story)
        ? ringToPolygon(p.ring)
        : null;
    if (poly) {
      fills.push({ ...poly, properties: props });
    }
    const pt: GeoJsonFeature = {
      type: 'Feature',
      properties: props,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    };
    if (poly) {
      /* Gebäudefläche statt Punkt */
    } else if ((p.amenityDot || p.icon) && amenityIconImageName(p.icon)) {
      amenities.push(pt);
    } else {
      dots.push(pt);
    }
  }
  return {
    fills: { type: 'FeatureCollection', features: fills },
    dots: { type: 'FeatureCollection', features: dots },
    amenities: { type: 'FeatureCollection', features: amenities },
  };
}

function headingDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return Math.abs(d);
}

function shortestSignedBearing(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

function destLngLat(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number,
): [number, number] {
  const r = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const ang = distM / r;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function gpsAccuracyFc(
  lat: number | null,
  lng: number | null,
  accuracyM: number | null,
): GeoJsonFc {
  if (lat == null || lng == null) return EMPTY_FC;
  const ring: Array<[number, number]> = [];
  const acc = Math.max(12, Math.min(40, accuracyM ?? 18));
  for (let i = 0; i <= 48; i++) {
    ring.push(destLngLat(lat, lng, (i / 48) * 360, acc));
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'accuracy' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
}

function gpsArrowFc(
  lat: number | null,
  lng: number | null,
  deg: number,
): GeoJsonFc {
  if (lat == null || lng == null) return EMPTY_FC;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'arrow', heading: Number.isFinite(deg) ? deg : 0 },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      },
    ],
  };
}

function gpsPuckFc(
  lat: number | null,
  lng: number | null,
  deg: number,
  accuracyM: number | null,
): { accuracy: GeoJsonFc; arrow: GeoJsonFc } {
  if (lat == null || lng == null) {
    return { accuracy: EMPTY_FC, arrow: EMPTY_FC };
  }
  const ring: Array<[number, number]> = [];
  const acc = Math.max(12, Math.min(40, accuracyM ?? 18));
  for (let i = 0; i <= 48; i++) {
    ring.push(destLngLat(lat, lng, (i / 48) * 360, acc));
  }
  return {
    accuracy: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'accuracy' },
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
      ],
    },
    arrow: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'arrow', heading: Number.isFinite(deg) ? deg : 0 },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        },
      ],
    },
  };
}

function citiesToGeojson(cities: NativeMapCity[]): GeoJsonFc {
  const features: GeoJsonFeature[] = [];
  const exclusive = exclusiveCityRings(cities);
  for (const c of exclusive) {
    const feat = ringToPolygon(c.ring, c.holes);
    if (!feat) continue;
    feat.properties = {
      id: c.id,
      n: c.name,
      fill: c.fill,
      stroke: c.stroke,
      fillOpacity: c.fillOpacity,
      dashed: c.dashed ? 1 : 0,
    };
    features.push(feat);
  }
  return { type: 'FeatureCollection', features };
}

function haversineRouteM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** 2 Punkte über Distanz = Luftlinie — wie WebView toLine nicht zeichnen. */
function lineFromCoords(
  pts: Array<{ lat: number; lng: number }> | undefined,
  props: Record<string, string | number | boolean | null> = {},
): GeoJsonFeature | null {
  if (!pts || pts.length < 2) return null;
  if (
    pts.length === 2 &&
    haversineRouteM(pts[0]!, pts[1]!) > 80
  ) {
    return null;
  }
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'LineString',
      coordinates: pts.map((p) => [p.lng, p.lat] as [number, number]),
    },
  };
}

function routeToGeojson(route: NavRouteMapPayload | null): {
  current: GeoJsonFc;
  ahead: GeoJsonFc;
  pins: GeoJsonFc;
  arrows: GeoJsonFc;
} {
  if (!route) {
    return { current: EMPTY_FC, ahead: EMPTY_FC, pins: EMPTY_FC, arrows: EMPTY_FC };
  }
  const current: GeoJsonFeature[] = [];
  const cur = lineFromCoords(route.current);
  if (cur) current.push(cur);
  const ahead: GeoJsonFeature[] = [];
  for (const leg of route.ahead ?? []) {
    const line = lineFromCoords(leg);
    if (line) ahead.push(line);
  }
  const pins: GeoJsonFeature[] = [];
  for (const pin of route.pins ?? []) {
    const n = Math.min(9, Math.max(0, Number(pin.n) || 0));
    const icon =
      pin.icon ||
      (pin.current
        ? n > 0
          ? `route-pin-now-${n}`
          : 'route-pin-now'
        : `route-pin-next-${Math.max(1, n || 1)}`);
    pins.push({
      type: 'Feature',
      properties: {
        id: -20_000 - (n || 1),
        n,
        name: pin.name,
        category: 'Route',
        lat: pin.lat,
        lng: pin.lng,
        current: pin.current ? 1 : 0,
        icon,
        chip: pin.chip?.title || pin.name || '',
        chipSub: pin.chip?.sub || '',
      },
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    });
  }
  if (route.previewPin) {
    pins.push({
      type: 'Feature',
      properties: { n: 0, name: '', current: 0 },
      geometry: {
        type: 'Point',
        coordinates: [route.previewPin.lng, route.previewPin.lat],
      },
    });
  }
  const arrows: GeoJsonFeature[] = [];
  for (const a of route.arrows ?? []) {
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    arrows.push({
      type: 'Feature',
      properties: {
        bearing: a.bearing,
        kind: a.kind === 'turn' ? 'turn' : 'flow',
      },
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
    });
  }
  return {
    current: { type: 'FeatureCollection', features: current },
    ahead: { type: 'FeatureCollection', features: ahead },
    pins: { type: 'FeatureCollection', features: pins },
    arrows: { type: 'FeatureCollection', features: arrows },
  };
}

function dropPinGeojson(pin: { lat: number; lng: number } | null): GeoJsonFc {
  if (!pin) return EMPTY_FC;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          id: MAP_DROP_PIN_ID,
          name: 'Punkt auf der Karte',
          category: 'Ort',
          lat: pin.lat,
          lng: pin.lng,
        },
        geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      },
    ],
  };
}

function fogTrackSegments(
  track: WalkTrackPoint[],
): Array<Array<{ lat: number; lng: number }>> {
  if (!track.length) return [];
  const BREAK_M = 60;
  const BREAK_MS = 5 * 60_000;
  const segs: Array<Array<{ lat: number; lng: number }>> = [];
  let cur: Array<{ lat: number; lng: number }> = [];
  let prev: WalkTrackPoint | null = null;
  for (const p of track) {
    if (!prev) {
      cur = [{ lat: p.lat, lng: p.lng }];
      prev = p;
      continue;
    }
    const dt = p.at - prev.at;
    const dLat = (p.lat - prev.lat) * 111_320;
    const cos = Math.cos((prev.lat * Math.PI) / 180);
    const dLng = (p.lng - prev.lng) * 111_320 * Math.max(0.2, cos);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dt < 0 || dt > BREAK_MS || dist > BREAK_M) {
      if (cur.length) segs.push(cur);
      cur = [{ lat: p.lat, lng: p.lng }];
    } else {
      cur.push({ lat: p.lat, lng: p.lng });
    }
    prev = p;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

export const NativeHomeMapView = memo(
  forwardRef(function NativeHomeMapView(
  props: Props,
  ref: React.ForwardedRef<NativeHomeMapHandle>,
) {
    const cameraRef = useRef<YorroHomeCameraRef>(null);
    const gpsArrowRef = useRef<ShapeSourceRef>(null);
    const gpsAccRef = useRef<ShapeSourceRef>(null);
    const ignorePanUntil = useRef(0);
    /** Während Extract-/Programmatic-Restore: Region-Events dürfen den Anker nicht überschreiben. */
    const suppressRegionUntil = useRef(0);
    /** Extract core→full→world + erstes Places: Restore aus — kein Kamera-Zack. */
    const layerApplyQuietUntil = useRef(0);
    const fingerDown = useRef(false);
    const userGesturing = useRef(false);
    /** Nach Finger-hoch: finales Region-Event oft ohne isUserInteraction — trotzdem User-View schreiben. */
    const lastFingerUpAt = useRef(0);
    /** Freies Pan/Zoom — längeres Fenster für Trägheit + Region-Events ohne isUserInteraction. */
    const lastUserGestureAt = useRef(0);
    /** Kamera beim Finger-down — Unlock erst bei echtem Verschieben/Zoomen, nicht bei Tippen. */
    const gestureOriginCam = useRef<{
      lat: number;
      lng: number;
      zoom: number;
    } | null>(null);
    /** Debounce gegen Undo↔Region-Ruckel-Loop. */
    const lastHoldAt = useRef(0);
    /**
     * Freie Erkundung (Default). Zentrum darf sich NUR bewegen wenn:
     * - centerMoveArmedUntil (Boot / Zentrieren-Pulse / Nav-Fit), oder
     * - GPS-Lock (locationFollow && !detached), oder
     * - restore nach erkanntem MapLibre-GPS-Snap (weg VOM GPS, nicht hin).
     * Idle / Extract / 30‑Min-Scroll: kein Zentrums-Move.
     */
    const userDetached = useRef(true);
    const centerMoveArmedUntil = useRef(0);
    const armCenterMove = (ms = 1_500) => {
      centerMoveArmedUntil.current = Date.now() + ms;
    };
    const headingRef = useRef(getMapDisplayHeadingDegSticky() ?? 0);
    const displayBearingRef = useRef(0);
    const targetBearingRef = useRef<number | null>(null);
    const bearingRafRef = useRef(0);
    const programmaticBearingRef = useRef(false);
    const lastBearingUiAt = useRef(0);
    const gpsPosRef = useRef({
      lat: null as number | null,
      lng: null as number | null,
      acc: null as number | null,
    });
    const headingFollowRef = useRef(props.headingFollow);
    const locationFollowRef = useRef(props.locationFollow);
    // Nur bei Prop-Wechsel syncen — NICHT jeden Render.
    // Detached: nie wieder anlocken außer reattach/GPS-Button.
    useEffect(() => {
      if (userDetached.current) {
        if (!props.locationFollow) locationFollowRef.current = false;
        return;
      }
      locationFollowRef.current = props.locationFollow;
    }, [props.locationFollow]);

    const postBearingUi = (bearing: number) => {
      if (!Number.isFinite(bearing)) return;
      const now = Date.now();
      if (now - lastBearingUiAt.current < 40) return;
      lastBearingUiAt.current = now;
      props.onBearing?.(bearing);
    };

    const markProgrammaticBearing = () => {
      programmaticBearingRef.current = true;
      suppressRegionUntil.current = Date.now() + 140;
      setTimeout(() => {
        programmaticBearingRef.current = false;
      }, 160);
    };

    const applyMapBearing = (bearing: number) => {
      const b = ((bearing % 360) + 360) % 360;
      displayBearingRef.current = b;
      camLiveRef.current = { ...camLiveRef.current, heading: b };
      markProgrammaticBearing();
      cameraRef.current?.setCamera({
        heading: b,
        animationDuration: 0,
      });
      postBearingUi(b);
    };

    const stopHeadingFollowLoop = () => {
      if (bearingRafRef.current) {
        cancelAnimationFrame(bearingRafRef.current);
        bearingRafRef.current = 0;
      }
      targetBearingRef.current = null;
    };

    const tickDisplayBearing = () => {
      bearingRafRef.current = 0;
      if (!headingFollowRef.current) return;
      // Heading-Follow darf bei freier Erkundung (detached) weiterlaufen —
      // nur Finger/Geste pausiert die Rotation.
      if (fingerDown.current || userGesturing.current) {
        return;
      }
      const target = targetBearingRef.current;
      if (target == null || !Number.isFinite(target)) return;
      let current = displayBearingRef.current;
      const d = shortestSignedBearing(current, target);
      const ad = Math.abs(d);
      if (ad < 0.18) {
        current = target;
      } else {
        const k = ad > 14 ? 0.38 : ad > 6 ? 0.3 : 0.24;
        current = ((current + d * k) % 360 + 360) % 360;
      }
      if (Math.abs(shortestSignedBearing(current, displayBearingRef.current)) >= 0.08) {
        applyMapBearing(current);
      }
      if (Math.abs(shortestSignedBearing(current, target)) >= 0.18) {
        bearingRafRef.current = requestAnimationFrame(tickDisplayBearing);
      }
    };

    const queueHeadingFollowTick = () => {
      if (bearingRafRef.current) return;
      bearingRafRef.current = requestAnimationFrame(tickDisplayBearing);
    };

    const enableHeadingFollowInternal = (fromUserTap: boolean) => {
      headingFollowRef.current = true;
      // Nur Blickrichtung — userDetached bleibt true, sonst öffnet Kompass
      // wieder Host-Jumps und der GPS-Anker kann die freie Erkundung fressen.
      userGesturing.current = false;
      fingerDown.current = false;
      displayBearingRef.current = camLiveRef.current.heading;
      targetBearingRef.current = headingRef.current;
      if (fromUserTap) {
        ignorePanUntil.current = Date.now() + 900;
        suppressRegionUntil.current = Date.now() + 900;
      }
      queueHeadingFollowTick();
    };

    useEffect(() => {
      if (userDetached.current) {
        if (!props.headingFollow) {
          headingFollowRef.current = false;
          stopHeadingFollowLoop();
        }
        return;
      }
      if (props.headingFollow) {
        enableHeadingFollowInternal(false);
      } else {
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
      }
    }, [props.headingFollow]);

    const lastCamHeadingAt = useRef(0);
    const lastCamHeading = useRef(-999);
    const camLiveRef = useRef({
      lat: props.initialLat,
      lng: props.initialLng,
      zoom: props.initialZoom,
      heading: 0,
    });
    /** Letzte vom User gewollte Kamera — überlebt MapLibre-Resets auf defaultSettings. */
    const anchorCamRef = useRef({
      lat: props.initialLat,
      lng: props.initialLng,
      zoom: props.initialZoom,
      heading: 0,
    });
    /**
     * Freie Erkundung: einzige Kamera-Wahrheit.
     * Wird NUR bei User-Geste / bewusstem jumpTo gesetzt — nie von Extract/GPS-Region-Events.
     */
    const userViewCamRef = useRef({
      lat: props.initialLat,
      lng: props.initialLng,
      zoom: props.initialZoom,
      heading: 0,
    });
    const bootCam = useRef({
      centerCoordinate: [props.initialLng, props.initialLat] as [number, number],
      zoomLevel: props.initialZoom,
      heading: 0,
    }).current;
    const [viewBounds, setViewBounds] = useState<FogBounds | null>(null);
    const gps0 = useSensorStore.getState();
    gpsPosRef.current = { lat: gps0.lat, lng: gps0.lng, acc: gps0.accuracyM };
    headingRef.current = gps0.headingDeg;

    const pushAccNative = (
      lat: number | null,
      lng: number | null,
      acc: number | null,
    ) => {
      gpsAccRef.current?.setNativeProps({
        shape: gpsAccuracyFc(lat, lng, acc),
      });
    };

    const pushArrowNative = (
      lat: number | null,
      lng: number | null,
      heading: number,
    ) => {
      gpsArrowRef.current?.setNativeProps({
        shape: gpsArrowFc(lat, lng, heading),
      });
    };

    const pushPuckPosition = (
      lat: number | null,
      lng: number | null,
      acc: number | null,
    ) => {
      pushAccNative(lat, lng, acc);
      pushArrowNative(lat, lng, headingRef.current);
    };

    const pushPuckHeading = (heading: number) => {
      headingRef.current = heading;
      const pos = gpsPosRef.current;
      pushArrowNative(pos.lat, pos.lng, heading);
    };

    const maybeFollowCamera = (
      lat: number | null,
      lng: number | null,
      heading: number,
    ) => {
      // Freie Erkundung: nie GPS-Zentrieren — auch nicht nach Idle/Extract.
      if (fingerDown.current || userGesturing.current) {
        return;
      }
      const followHead = headingFollowRef.current;
      const followLoc = locationFollowRef.current;
      // Detached: höchstens Kompass-Rotation, nie GPS-Zentrieren.
      if (userDetached.current) {
        if (!followHead) return;
        if (Date.now() < ignorePanUntil.current) return;
        if (Number.isFinite(heading)) {
          targetBearingRef.current = heading;
          queueHeadingFollowTick();
        }
        return;
      }
      // Lock-Follow nur wenn bewusst angebunden UND locationFollow aktiv.
      if (!followLoc) {
        if (followHead && Number.isFinite(heading)) {
          targetBearingRef.current = heading;
          queueHeadingFollowTick();
        }
        return;
      }
      if (Date.now() < ignorePanUntil.current) return;
      if (Date.now() < suppressRegionUntil.current && !followHead) return;
      if (lat == null || lng == null) return;
      if (!applyCenterMove(lng, lat, {
        kind: 'follow',
        heading: followHead ? undefined : 0,
      })) {
        return;
      }
      if (!followHead) {
        lastCamHeading.current = 0;
        displayBearingRef.current = 0;
        commitUserView({
          lat,
          lng,
          zoom: userViewCamRef.current.zoom,
          heading: 0,
        });
        return;
      }
      if (Number.isFinite(heading)) {
        targetBearingRef.current = heading;
        queueHeadingFollowTick();
      }
      commitUserView({
        lat,
        lng,
        zoom: userViewCamRef.current.zoom,
        heading: userViewCamRef.current.heading,
      });
    };

    const syncBootCamFrom = (c: {
      lat: number;
      lng: number;
      zoom: number;
      heading: number;
    }) => {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      bootCam.centerCoordinate = [c.lng, c.lat];
      bootCam.zoomLevel = c.zoom;
      bootCam.heading = Number.isFinite(c.heading) ? c.heading : 0;
      // Native defaultStop mitziehen — Remount darf nicht auf Boot-GPS springen.
      cameraRef.current?.syncDefaultStop({
        centerCoordinate: [c.lng, c.lat],
        zoomLevel: c.zoom,
        heading: Number.isFinite(c.heading) ? c.heading : 0,
      });
    };

    /** defaultStop = User-Anker bei freier Erkundung (nie Live-GPS-Snap). */
    const currentDefaultStopCam = () => userViewCamRef.current;

    const isLiveNearGps = (lat: number, lng: number) => {
      const gps = gpsPosRef.current;
      return (
        gps.lat != null &&
        gps.lng != null &&
        Math.abs(lat - gps.lat) < 0.00035 &&
        Math.abs(lng - gps.lng) < 0.00035
      );
    };

    const isAnchorFarFromGps = () => {
      const gps = gpsPosRef.current;
      const u = userViewCamRef.current;
      return (
        gps.lat != null &&
        gps.lng != null &&
        (Math.abs(u.lat - gps.lat) > 0.0015 ||
          Math.abs(u.lng - gps.lng) > 0.0015)
      );
    };

    /** MapLibre zieht Richtung GPS — nie als Fling/User werten. */
    const looksLikeGpswardSnap = (lat: number, lng: number) => {
      const gps = gpsPosRef.current;
      const u = userViewCamRef.current;
      if (gps.lat == null || gps.lng == null) return false;
      if (isLiveNearGps(lat, lng) && isAnchorFarFromGps()) return true;
      const liveDist =
        Math.abs(lat - gps.lat) + Math.abs(lng - gps.lng);
      const userDist =
        Math.abs(u.lat - gps.lat) + Math.abs(u.lng - gps.lng);
      // Deutlich näher am GPS als die User-View → Snap, kein Fling.
      return userDist > 0.0012 && liveDist < userDist * 0.72;
    };

    const restoreExploreAnchorIfGpsSnap = (
      lat: number,
      lng: number,
      zoom: number,
      heading: number,
    ) => {
      if (!userDetached.current || locationFollowRef.current) return false;
      if (!isLiveNearGps(lat, lng) || !isAnchorFarFromGps()) return false;
      const u = userViewCamRef.current;
      syncBootCamFrom(u);
      applyCenterMove(u.lng, u.lat, {
        kind: 'restore',
        zoom: u.zoom,
        heading: Number.isFinite(u.heading) ? u.heading : 0,
      });
      camLiveRef.current = { ...u };
      return true;
    };

    const commitUserView = (c: {
      lat: number;
      lng: number;
      zoom: number;
      heading: number;
    }) => {
      userViewCamRef.current = { ...c };
      camLiveRef.current = { ...c };
      anchorCamRef.current = { ...c };
      syncBootCamFrom(c);
    };

    /**
     * Einziger Pfad für programmierte Zentrums-Moves.
     * kind=armed → Boot/Zentrieren/Nav (vorher armCenterMove).
     * kind=follow → nur GPS-Lock.
     * kind=restore → nur weg vom GPS-Snap zurück zur User-View.
     */
    const applyCenterMove = (
      lng: number,
      lat: number,
      opts: {
        kind: 'armed' | 'follow' | 'restore';
        zoom?: number;
        heading?: number;
      },
    ): boolean => {
      if (opts.kind === 'armed') {
        if (Date.now() > centerMoveArmedUntil.current) {
          if (__DEV__) console.log('[map-cam] center blocked (not armed)');
          return false;
        }
      } else if (opts.kind === 'follow') {
        if (userDetached.current || !locationFollowRef.current) {
          if (__DEV__) console.log('[map-cam] center blocked (no lock)');
          return false;
        }
      } else if (opts.kind === 'restore') {
        if (!userDetached.current || locationFollowRef.current) return false;
      }
      markProgrammaticBearing();
      cameraRef.current?.setCamera({
        centerCoordinate: [lng, lat],
        ...(opts.zoom != null ? { zoomLevel: opts.zoom } : {}),
        ...(opts.heading != null ? { heading: opts.heading } : {}),
        animationDuration: 0,
      });
      return true;
    };

    /**
     * Safety: MapLibre-Drift/Snap (Extract, Regional, Idle) → zurück zur User-View.
     * Bewegt NIE Richtung GPS — nur zurück zur letzten echten Geste.
     * Nie Live als neuen Anker übernehmen (sonst schleicht die Kamera zum GPS).
     */
    const restoreUserViewIfSnappedToGps = (opts?: { force?: boolean }) => {
      if (fingerDown.current) return;
      if (locationFollowRef.current) return;
      if (!userDetached.current) return;
      // Fling/Trägheit nach Finger-hoch kurz aushalten — danach hart halten.
      // force=true: Extract/Layer-Apply (kein Fling).
      if (!opts?.force && Date.now() - lastFingerUpAt.current < 2_800) return;
      const u = userViewCamRef.current;
      if (!Number.isFinite(u.lat) || !Number.isFinite(u.lng)) return;
      const live = camLiveRef.current;
      const drifted =
        Math.abs(live.lat - u.lat) > 0.00012 ||
        Math.abs(live.lng - u.lng) > 0.00012 ||
        Math.abs(live.zoom - u.zoom) > 0.06;
      if (!drifted) return;
      const now = Date.now();
      if (now - lastHoldAt.current < 120) return;
      lastHoldAt.current = now;
      if (__DEV__) {
        console.log('[map-cam] restore user view (blocked idle/extract drift)');
      }
      syncBootCamFrom(u);
      applyCenterMove(u.lng, u.lat, {
        kind: 'restore',
        zoom: u.zoom,
        heading: Number.isFinite(u.heading) ? u.heading : 0,
      });
      camLiveRef.current = { ...u };
    };

    /** Nur defaultStop frisch halten — kein setCamera. */
    const syncBootOnly = () => {
      syncBootCamFrom(currentDefaultStopCam());
    };

    useEffect(() => {
      const { lat, lng, acc } = gpsPosRef.current;
      pushPuckPosition(lat, lng, acc);
      const unsubSensor = useSensorStore.subscribe((s, prev) => {
        const posChanged =
          s.lat !== prev.lat || s.lng !== prev.lng || s.accuracyM !== prev.accuracyM;
        const headChanged = s.headingDeg !== prev.headingDeg;
        if (posChanged) {
          gpsPosRef.current = { lat: s.lat, lng: s.lng, acc: s.accuracyM };
          pushPuckPosition(s.lat, s.lng, s.accuracyM);
          maybeFollowCamera(s.lat, s.lng, headingRef.current);
        } else if (headChanged) {
          pushPuckHeading(s.headingDeg);
          maybeFollowCamera(gpsPosRef.current.lat, gpsPosRef.current.lng, s.headingDeg);
        }
      });
      return () => {
        unsubSensor();
        stopHeadingFollowLoop();
      };
    }, []);

    // Zwei-Phasen: Straßen/Wasser sofort, Gebäude kurz danach. Updates nur im Idle.
    const [geo, setGeo] = useState(emptyExtractGeojson);
    const lastExtractSigRef = useRef('');
    const lastExtractCityRef = useRef<string | null>(null);
    const geojsonCacheRef = useRef<{
      sig: string;
      bundle: ReturnType<typeof cityMapExtractToGeojson>;
    } | null>(null);
    const [world, setWorld] = useState<WorldOverviewBundle>(EMPTY_WORLD);
    const [labels, setLabels] = useState<WorldLabelsBundle>(EMPTY_LABELS);
    useEffect(() => {
      let cancelled = false;
      const timer = setTimeout(() => {
        const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
          runMapPolishWhenFree: (fn: () => void) => void;
        };
        runMapPolishWhenFree(() => {
          InteractionManager.runAfterInteractions(() => {
            if (cancelled) return;
            setWorld(getWorldOverview());
            setLabels(getWorldLabels());
            markHomeMapBoot('world');
            syncBootOnly();
            layerApplyQuietUntil.current = Date.now() + 900;
            suppressRegionUntil.current = Date.now() + 900;
            setTimeout(() => {
              if (!cancelled) restoreUserViewIfSnappedToGps({ force: true });
            }, 100);
          });
        });
      }, HOME_MAP_WORLD_AFTER_CORE_MS);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, []);
    useEffect(() => {
      const extract = props.extract;
      if (!extract) return;
      const sig = `${extract.cityId}:${extract.roads?.length ?? 0}:${extract.buildings?.length ?? 0}:${extract.housenumbers?.length ?? 0}`;
      const citySwitched =
        lastExtractCityRef.current != null &&
        lastExtractCityRef.current !== extract.cityId;
      lastExtractCityRef.current = extract.cityId;
      if (sig === lastExtractSigRef.current && geo.hasRoads && !citySwitched) return;
      let cancelled = false;
      let buildingsTimer: ReturnType<typeof setTimeout> | null = null;
      const apply = (phase: ExtractGeojsonPhase) => {
        if (cancelled) return;
        const cacheKey = `${sig}:${phase}`;
        const cached = geojsonCacheRef.current;
        const bundle =
          cached?.sig === cacheKey
            ? cached.bundle
            : cityMapExtractToGeojson(extract, phase);
        if (phase === 'full') {
          lastExtractSigRef.current = sig;
          geojsonCacheRef.current = { sig: cacheKey, bundle };
        }
        setGeo(bundle);
        syncBootOnly();
        setTimeout(() => {
          if (cancelled) return;
          if (!userDetached.current || locationFollowRef.current) return;
          const live = camLiveRef.current;
          if (
            !restoreExploreAnchorIfGpsSnap(
              live.lat,
              live.lng,
              live.zoom,
              live.heading,
            )
          ) {
            restoreUserViewIfSnappedToGps({ force: true });
          }
          syncBootOnly();
        }, 80);
        const quietMs = phase === 'core' ? 2_200 : 1_200;
        suppressRegionUntil.current = Date.now() + Math.max(700, quietMs);
        layerApplyQuietUntil.current = Date.now() + quietMs;
        if (bundle.hasRoads) markHomeMapBoot('roads');
        if (phase === 'full' && (bundle.buildings.features?.length ?? 0) > 0) {
          markHomeMapBoot('buildings');
        }
      };
      // Viewport-Stadtwechsel: sofort volles Extract — nicht auf Geste-Ende warten.
      if (citySwitched) {
        lastExtractSigRef.current = '';
        apply('full');
        return () => {
          cancelled = true;
        };
      }
      if (!geo.hasRoads) {
        apply('core');
        buildingsTimer = setTimeout(() => {
          const { runMapPolishWhenFree } = require('../../services/boot/interactiveBootGate') as {
            runMapPolishWhenFree: (fn: () => void) => void;
          };
          runMapPolishWhenFree(() => {
            if (!cancelled) apply('full');
          });
        }, HOME_MAP_BUILDINGS_AFTER_CORE_MS);
        return () => {
          cancelled = true;
          if (buildingsTimer) clearTimeout(buildingsTimer);
        };
      }
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      const task = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        if (fingerDown.current || userGesturing.current) {
          retryTimer = setTimeout(() => {
            if (!cancelled && !fingerDown.current) apply('full');
          }, 900);
          return;
        }
        apply('full');
      });
      return () => {
        cancelled = true;
        task.cancel();
        if (retryTimer) clearTimeout(retryTimer);
        if (buildingsTimer) clearTimeout(buildingsTimer);
      };
    }, [props.extract, geo.hasRoads]);

    // Places/Cities: nur Boot-Cam syncen, Kamera nicht anfassen.
    const placesHoldSig = useRef('');
    useEffect(() => {
      if (!userDetached.current || locationFollowRef.current) return;
      const sig = `${props.places?.length ?? 0}:${props.cities?.length ?? 0}`;
      if (sig === placesHoldSig.current) return;
      placesHoldSig.current = sig;
      syncBootOnly();
    }, [props.places, props.cities]);

    const placeFc = useMemo(() => placesToGeojson(props.places), [props.places]);
    const cityFc = useMemo(() => citiesToGeojson(props.cities), [props.cities]);
    const routeFc = useMemo(() => routeToGeojson(props.route), [props.route]);
    const routePreview = props.route?.preview === true;
    const [dismissedRouteChips, setDismissedRouteChips] = useState<Record<string, true>>({});
    useEffect(() => {
      setDismissedRouteChips({});
    }, [props.route?.fitKey]);
    const routeChipMarkers = useMemo(() => {
      const pins = props.route?.pins ?? [];
      const out: React.ReactNode[] = [];
      const seen = new Set<string>();
      for (const pin of pins) {
        const title = pin.chip?.title?.trim();
        if (!title) continue;
        const geoKey = `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;
        if (seen.has(geoKey)) continue;
        seen.add(geoKey);
        const key = `${pin.n || ''}:${pin.name || ''}`;
        if (dismissedRouteChips[key]) continue;
        out.push(
          <MarkerView
            key={`nav-chip-${key}-${geoKey}`}
            coordinate={[pin.lng, pin.lat]}
            anchor={{ x: 0.5, y: 0 }}
            allowOverlap
          >
            <View style={styles.navChip} pointerEvents="box-none">
              <Text style={styles.navChipTitle} numberOfLines={2}>
                {title}
              </Text>
              {pin.chip?.sub ? (
                <Text style={styles.navChipSub} numberOfLines={1}>
                  {pin.chip.sub}
                </Text>
              ) : null}
              <Pressable
                accessibilityLabel="Chip schließen"
                hitSlop={8}
                onPress={() =>
                  setDismissedRouteChips((prev) => ({ ...prev, [key]: true }))
                }
                style={styles.navChipClose}
              >
                <Text style={styles.navChipCloseText}>×</Text>
              </Pressable>
            </View>
          </MarkerView>,
        );
      }
      return out;
    }, [props.route?.pins, dismissedRouteChips]);
    const pinFc = useMemo(() => dropPinGeojson(props.dropPin), [props.dropPin]);
    const regionalGeo = useRegionalFallbackStore((s) => s.snap?.geojson ?? EMPTY_FC);
    const hasRegional = useRegionalFallbackStore(
      (s) => (s.snap?.geojson?.features?.length ?? 0) > 0,
    );

    const fogViewKey = viewBounds ? fogBoundsCacheKey(viewBounds) : '';
    const exploredFromStore = useFogStore((s) => s.exploredPolygons);
    const fogStoreTrackKey = useFogStore((s) => s.trackKey);

    // Viewport-Maske absichtlich aus: Abdunkeln = dunkle Basiskarte (kein Nachlade-Flash).
    const fogFc = useMemo(() => {
      if (
        !HOME_MAP_FOG_ENABLED ||
        !HOME_MAP_FOG_MASK_ENABLED ||
        !geo.hasRoads ||
        !viewBounds
      ) {
        return EMPTY_FC;
      }
      const explored =
        exploredFromStore.length > 0
          ? exploredFromStore
          : buildExploredPolygons(
              fogTrackSegments(props.walkTrack),
              WALK_REVEAL_RADIUS_M,
              FOG_MERGE_GAP_M,
            );
      const mask = fogMaskFromExplored(viewBounds, explored);
      return fogPolygonsToGeoJSON(mask);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geo.hasRoads, fogStoreTrackKey, fogViewKey, exploredFromStore.length]);

    const revealFc = useMemo(() => {
      if (!HOME_MAP_FOG_ENABLED || !geo.hasRoads) return EMPTY_FC;
      const explored =
        exploredFromStore.length > 0
          ? exploredFromStore
          : buildExploredPolygons(
              fogTrackSegments(props.walkTrack),
              WALK_REVEAL_RADIUS_M,
              FOG_MERGE_GAP_M,
            );
      return fogPolygonsToGeoJSON(explored);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geo.hasRoads, fogStoreTrackKey, exploredFromStore.length]);

    // Statische Start-Shape — Live-Puck nur per setNativeProps, sonst ShapeSource-Churn.
    const puckFc = EMPTY_PUCK_FC;

    const noteUserGesture = () => {
      if (programmaticBearingRef.current) return;
      if (headingFollowRef.current && Date.now() < suppressRegionUntil.current) {
        return;
      }
      lastUserGestureAt.current = Date.now();
      userGesturing.current = true;
      userDetached.current = true;
      stopHeadingFollowLoop();
      // Follow sofort lokal killen — sonst zieht GPS die Kamera zurück, bevor Parent reagiert.
      locationFollowRef.current = false;
      headingFollowRef.current = false;
      props.onUserPan();
    };

    /** Echtes Pan/Zoom vs. Tippen — Unlock nur bei aktiver Kartenbewegung. */
    const gestureMovedEnough = (lat: number, lng: number, zoom: number) => {
      const o = gestureOriginCam.current;
      if (!o) {
        const u = userViewCamRef.current;
        return (
          Math.abs(lat - u.lat) > 0.00007 ||
          Math.abs(lng - u.lng) > 0.00007 ||
          Math.abs(zoom - u.zoom) > 0.06
        );
      }
      const dLat = Math.abs(lat - o.lat);
      const dLng = Math.abs(lng - o.lng);
      const dZoom = Math.abs(zoom - o.zoom);
      return dLat > 0.00007 || dLng > 0.00007 || dZoom > 0.06;
    };

    const rememberCamera = (
      lat: number,
      lng: number,
      zoom: number,
      heading: number,
      opts?: { forceAnchor?: boolean; fromUser?: boolean },
    ) => {
      camLiveRef.current = { lat, lng, zoom, heading };
      const suppressed = Date.now() < suppressRegionUntil.current;
      // Während Extract-Reset: User-View NICHT mit Boot-GPS vergiften.
      if (suppressed && !opts?.fromUser && !opts?.forceAnchor) return;
      // Nur echte Geste schreibt User-View — nie userDetached allein
      // (sonst vergiftet MapLibre-Reset auf Boot-GPS den Anker → hold zieht zurück).
      const userMove =
        opts?.fromUser ||
        opts?.forceAnchor ||
        fingerDown.current ||
        userGesturing.current;
      if (!userMove) return;
      commitUserView({ lat, lng, zoom, heading });
    };

    useImperativeHandle(ref, () => ({
      jumpTo(lat, lng, zoom, reattach = false) {
        // Hart: ohne reattach nie bewegen — auch nicht wenn kurz „attached“.
        if (!reattach) return;
        armCenterMove(1_800);
        // Pulse/Boot/Nav: einmal springen, detached bleiben.
        // Lock: Caller setzt locationFollow + reattachFollow vorher.
        if (!locationFollowRef.current) {
          userDetached.current = true;
        } else {
          userDetached.current = false;
        }
        userGesturing.current = false;
        suppressRegionUntil.current = Date.now() + 500;
        ignorePanUntil.current = Date.now() + 500;
        const nextZoom = zoom ?? userViewCamRef.current.zoom;
        const next = {
          lat,
          lng,
          zoom: nextZoom,
          heading: userViewCamRef.current.heading,
        };
        commitUserView(next);
        applyCenterMove(lng, lat, {
          kind: 'armed',
          ...(zoom != null ? { zoom } : {}),
        });
      },
      fitBounds(south, west, north, east, reattach = false) {
        if (!reattach) return;
        armCenterMove(2_000);
        // Route-Overview: nie Follow anlocken.
        userDetached.current = true;
        userGesturing.current = false;
        suppressRegionUntil.current = Date.now() + 500;
        ignorePanUntil.current = Date.now() + 500;
        cameraRef.current?.fitBounds([east, north], [west, south], 28, 0);
        const mid = {
          lat: (south + north) / 2,
          lng: (west + east) / 2,
          zoom: userViewCamRef.current.zoom,
          heading: userViewCamRef.current.heading,
        };
        commitUserView(mid);
      },
      setNorthUp() {
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
        ignorePanUntil.current = Date.now() + 500;
        displayBearingRef.current = 0;
        const next = { ...userViewCamRef.current, heading: 0 };
        commitUserView(next);
        markProgrammaticBearing();
        cameraRef.current?.setCamera({ heading: 0, animationDuration: 0 });
        postBearingUi(0);
      },
      setHeadingFollow(on: boolean) {
        if (on) {
          enableHeadingFollowInternal(true);
          return;
        }
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
      },
      /** Follow wieder anbinden (nach Kompass-/GPS-Lock), ohne Kamera zu springen. */
      reattachFollow() {
        userDetached.current = false;
        userGesturing.current = false;
        fingerDown.current = false;
      },
      releaseFollow() {
        userDetached.current = true;
        userGesturing.current = false;
        locationFollowRef.current = false;
        headingFollowRef.current = false;
        stopHeadingFollowLoop();
      },
    }));

    const ignoreBlankUntil = useRef(0);
    const readyOnce = useRef(false);
    const onMapPress = () => {
      if (Date.now() < ignoreBlankUntil.current) return;
      props.onBlankTap();
    };

    const onLongPress = (feature: Feature) => {
      const g = feature.geometry;
      if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
      const lng = Number(g.coordinates[0]);
      const lat = Number(g.coordinates[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      props.onDropPin(lat, lng);
    };

    const onPlacePress = (e: OnPressEvent) => {
      ignoreBlankUntil.current = Date.now() + 280;
      const feat = e.features?.[0];
      const pr = feat?.properties;
      if (!pr || pr.id == null) return;
      const lat = Number(pr.lat ?? e.coordinates?.latitude);
      const lng = Number(pr.lng ?? e.coordinates?.longitude);
      props.onPlaceTap({
        id: Number(pr.id),
        name: String(pr.name || ''),
        category: String(pr.category || ''),
        lat,
        lng,
      });
    };

    return (
      <View
        style={styles.root}
        collapsable={false}
        onStartShouldSetResponderCapture={() => {
          // Finger down allein unlockt nicht — nur echtes Pan/Zoom (Region-Events).
          // Sonst würde ein Tippen den GPS-Fix sofort lösen.
          fingerDown.current = true;
          gestureOriginCam.current = {
            lat: camLiveRef.current.lat,
            lng: camLiveRef.current.lng,
            zoom: camLiveRef.current.zoom,
          };
          props.onGestureStart?.();
          return false;
        }}
        onResponderRelease={() => {
          fingerDown.current = false;
          // Nur nach echtem Pan/Zoom übernehmen — Tippen/teilweiser GPS-Snap nicht.
          const live = camLiveRef.current;
          const gps = gpsPosRef.current;
          const u = userViewCamRef.current;
          const liveNearGps =
            gps.lat != null &&
            gps.lng != null &&
            Math.abs(live.lat - gps.lat) < 0.00025 &&
            Math.abs(live.lng - gps.lng) < 0.00025;
          const userWasElsewhere =
            Number.isFinite(u.lat) &&
            (Math.abs(u.lat - live.lat) > 0.002 ||
              Math.abs(u.lng - live.lng) > 0.002 ||
              Math.abs(u.zoom - live.zoom) > 0.8);
          if (userGesturing.current) {
            if (!(liveNearGps && userWasElsewhere)) {
              commitUserView({ ...live });
            } else {
              restoreUserViewIfSnappedToGps({ force: true });
            }
          }
          userGesturing.current = false;
          gestureOriginCam.current = null;
          lastFingerUpAt.current = Date.now();
          props.onGestureEnd?.();
        }}
        onTouchEnd={() => {
          fingerDown.current = false;
          const live = camLiveRef.current;
          const gps = gpsPosRef.current;
          const u = userViewCamRef.current;
          const liveNearGps =
            gps.lat != null &&
            gps.lng != null &&
            Math.abs(live.lat - gps.lat) < 0.00025 &&
            Math.abs(live.lng - gps.lng) < 0.00025;
          const userWasElsewhere =
            Number.isFinite(u.lat) &&
            (Math.abs(u.lat - live.lat) > 0.002 ||
              Math.abs(u.lng - live.lng) > 0.002 ||
              Math.abs(u.zoom - live.zoom) > 0.8);
          if (userGesturing.current) {
            if (!(liveNearGps && userWasElsewhere)) {
              commitUserView({ ...live });
            } else {
              restoreUserViewIfSnappedToGps({ force: true });
            }
          }
          userGesturing.current = false;
          gestureOriginCam.current = null;
          lastFingerUpAt.current = Date.now();
          props.onGestureEnd?.();
        }}
      >
        <MapView
          style={styles.map}
          mapStyle={OFFLINE_HOME_MAP_STYLE}
          compassEnabled={false}
          logoEnabled={false}
          attributionEnabled={false}
          rotateEnabled
          pitchEnabled={false}
          scrollEnabled
          zoomEnabled
          regionWillChangeDebounceTime={0}
          regionDidChangeDebounceTime={0}
          onDidFinishLoadingMap={() => {
            if (readyOnce.current) return;
            readyOnce.current = true;
            markHomeMapBoot('mapReady');
            props.onReady();
          }}
          onRegionWillChange={(feature) => {
            const b = feature.properties as RegionPayload;
            const userInteract = b?.isUserInteraction === true;
            if (!userInteract && Date.now() < suppressRegionUntil.current) return;
            if (!userInteract && Date.now() < ignorePanUntil.current) return;
            const zoom = b?.zoomLevel ?? camLiveRef.current.zoom;
            const zoomDelta = Math.abs(zoom - camLiveRef.current.zoom);
            const vb = b?.visibleBounds;
            let midLat = camLiveRef.current.lat;
            let midLng = camLiveRef.current.lng;
            if (vb?.[0] && vb?.[1]) {
              midLat = (vb[1][1]! + vb[0][1]!) / 2;
              midLng = (vb[1][0]! + vb[0][0]!) / 2;
            }
            const moved =
              gestureMovedEnough(midLat, midLng, zoom) || zoomDelta >= 0.06;
            // Tippen ohne Move → Follow bleibt. Pan/Zoom → sofort Unlock.
            if ((userInteract || fingerDown.current) && moved) {
              noteUserGesture();
            }
          }}
          onRegionIsChanging={(feature) => {
            const b = feature.properties as RegionPayload;
            const userInteract = b?.isUserInteraction === true;
            const bearing = b?.heading;
            if (typeof bearing === 'number' && Number.isFinite(bearing)) {
              if (
                (userInteract || fingerDown.current) &&
                !headingFollowRef.current
              ) {
                displayBearingRef.current = bearing;
                postBearingUi(bearing);
              } else if (!userInteract && !programmaticBearingRef.current) {
                postBearingUi(bearing);
              }
            }
            const vb = b?.visibleBounds;
            const zoom = b?.zoomLevel ?? userViewCamRef.current.zoom;
            let midLat = camLiveRef.current.lat;
            let midLng = camLiveRef.current.lng;
            if (vb?.[0] && vb?.[1]) {
              const east = vb[0][0]!;
              const north = vb[0][1]!;
              const west = vb[1][0]!;
              const south = vb[1][1]!;
              midLat = (south + north) / 2;
              midLng = (west + east) / 2;
            }
            const moved = gestureMovedEnough(midLat, midLng, zoom);
            if (fingerDown.current && moved) {
              noteUserGesture();
            }
            // User-View NUR bei Finger/isUserInteraction — nie nach Idle
            // (sonst vergiften Extract/Regional-Resets den Anker Richtung GPS).
            if (
              moved &&
              (fingerDown.current || userInteract) &&
              !locationFollowRef.current &&
              vb?.[0] &&
              vb?.[1]
            ) {
              commitUserView({
                lat: midLat,
                lng: midLng,
                zoom,
                heading:
                  typeof bearing === 'number' && Number.isFinite(bearing)
                    ? bearing
                    : userViewCamRef.current.heading,
              });
            }
            if (!userInteract && Date.now() < suppressRegionUntil.current) return;
            if (!userInteract && Date.now() < ignorePanUntil.current) return;
            if (
              !fingerDown.current &&
              Math.abs(zoom - camLiveRef.current.zoom) >= 0.08 &&
              !locationFollowRef.current &&
              userInteract
            ) {
              noteUserGesture();
            }
          }}
          onRegionDidChange={(feature) => {
            const b = feature.properties as RegionPayload;
            const suppressed = Date.now() < suppressRegionUntil.current;
            // Nur kurze Trägheit nach Finger-hoch — kein 12s-Fenster
            // (Extract/Regional nach ~5–10s sonst als „User“ gespeichert).
            const recentFinger =
              Date.now() - lastFingerUpAt.current < 2_800;
            const zoom = b?.zoomLevel ?? camLiveRef.current.zoom;
            const zoomDelta = Math.abs(zoom - userViewCamRef.current.zoom);

            const vb = b?.visibleBounds;
            const bearing = b?.heading ?? 0;
            let midLat = camLiveRef.current.lat;
            let midLng = camLiveRef.current.lng;
            let hasBounds = false;
            if (vb && vb[0] && vb[1]) {
              const east = vb[0][0]!;
              const north = vb[0][1]!;
              const west = vb[1][0]!;
              const south = vb[1][1]!;
              midLat = (south + north) / 2;
              midLng = (west + east) / 2;
              hasBounds = true;
            }
            const drifted =
              Math.abs(midLat - userViewCamRef.current.lat) > 0.00009 ||
              Math.abs(midLng - userViewCamRef.current.lng) > 0.00009 ||
              Math.abs(zoom - userViewCamRef.current.zoom) > 0.12;
            const moved = gestureMovedEnough(midLat, midLng, zoom) || zoomDelta >= 0.06;
            const gpsward = looksLikeGpswardSnap(midLat, midLng);
            // Finales Gesture-Event oft ohne isUserInteraction — aber Snap ≠ Geste.
            // Tippen (finger ohne Move) unlockt den GPS-Fix nicht.
            const user =
              !gpsward &&
              (b?.isUserInteraction === true ||
                (fingerDown.current && moved) ||
                (recentFinger && moved));

            if (__DEV__ && userDetached.current && !locationFollowRef.current) {
              const gps = gpsPosRef.current;
              if (gps.lat != null && gps.lng != null && !user) {
                const prev = camLiveRef.current;
                const wasFarFromGps =
                  Math.abs(prev.lat - gps.lat) > 0.008 ||
                  Math.abs(prev.lng - gps.lng) > 0.008;
                const nowNearGps =
                  Math.abs(midLat - gps.lat) < 0.00035 &&
                  Math.abs(midLng - gps.lng) < 0.00035;
                if (wasFarFromGps && nowNearGps) {
                  console.log('[map-cam] SNAP-BACK detected', {
                    from: { lat: prev.lat, lng: prev.lng },
                    to: { lat: midLat, lng: midLng },
                    gps: { lat: gps.lat, lng: gps.lng },
                  });
                }
              }
            }

            // Programmatic Reset: Anker nie übernehmen — nur zurückdrücken.
            if (suppressed && !user) {
              if (hasBounds) {
                camLiveRef.current = {
                  lat: midLat,
                  lng: midLng,
                  zoom,
                  heading: bearing,
                };
                if (
                  !restoreExploreAnchorIfGpsSnap(midLat, midLng, zoom, bearing)
                ) {
                  restoreUserViewIfSnappedToGps({ force: true });
                }
                syncBootOnly();
              } else {
                syncBootOnly();
              }
              return;
            }
            if (user && moved) {
              noteUserGesture();
            } else if (
              zoomDelta >= 0.08 &&
              !locationFollowRef.current &&
              b?.isUserInteraction === true
            ) {
              noteUserGesture();
            }

            if (user && !headingFollowRef.current && typeof b?.heading === 'number') {
              displayBearingRef.current = bearing;
            }
            if (!hasBounds || !vb?.[0] || !vb?.[1]) return;

            const movedFromAnchor =
              Math.abs(midLat - userViewCamRef.current.lat) > 0.00045 ||
              Math.abs(midLng - userViewCamRef.current.lng) > 0.00045 ||
              Math.abs(zoom - userViewCamRef.current.zoom) > 0.08;
            // Nur echte Geste / kurze Fling-Trägheit schreibt den Anker.
            if (
              movedFromAnchor &&
              user &&
              !locationFollowRef.current
            ) {
              commitUserView({
                lat: midLat,
                lng: midLng,
                zoom,
                heading:
                  typeof bearing === 'number' && Number.isFinite(bearing)
                    ? bearing
                    : userViewCamRef.current.heading,
              });
            }

            const east = vb[0][0]!;
            const north = vb[0][1]!;
            const west = vb[1][0]!;
            const south = vb[1][1]!;

            // Idle/Extract ohne Finger: Drift zurück — Viewport NICHT mit Snap melden
            // (sonst Places/Extract am GPS während die Kamera woanders steht).
            if (
              !user &&
              userDetached.current &&
              !locationFollowRef.current &&
              drifted
            ) {
              camLiveRef.current = {
                lat: midLat,
                lng: midLng,
                zoom,
                heading: bearing,
              };
              if (
                !restoreExploreAnchorIfGpsSnap(midLat, midLng, zoom, bearing)
              ) {
                restoreUserViewIfSnappedToGps();
              }
              rememberCamera(midLat, midLng, zoom, bearing, {
                fromUser: false,
              });
              // Places bleiben am User-View — kein GPS-Inject.
              return;
            }

            rememberCamera(midLat, midLng, zoom, bearing, {
              fromUser: user,
            });
            const padLat = (north - south) * 0.25;
            const padLng = (east - west) * 0.25;
            const nextBounds = {
              west: Math.min(west, east) - padLng,
              east: Math.max(west, east) + padLng,
              south: Math.min(south, north) - padLat,
              north: Math.max(south, north) + padLat,
            };
            setViewBounds((prev) => {
              if (prev && fogBoundsCacheKey(prev) === fogBoundsCacheKey(nextBounds)) {
                return prev;
              }
              return nextBounds;
            });
            props.onViewport({
              south: Math.min(south, north),
              west: Math.min(west, east),
              north: Math.max(south, north),
              east: Math.max(west, east),
              zoom,
              bearing,
            });
          }}
          onPress={onMapPress}
          onLongPress={onLongPress}
        >
          <YorroHomeCamera
            ref={cameraRef}
            defaultSettings={bootCam}
          />
          <Images images={HOME_MAP_AMENITY_IMAGES} />
          <ShapeSource id="world-land" shape={world.land}>
            <FillLayer
              id="world-land-fill"
              style={{
                fillColor: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  2,
                  HOME_MAP_LAND_FAR,
                  6,
                  '#2A6B58',
                  10,
                  HOME_MAP_BG,
                ],
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  2,
                  0.52,
                  5,
                  0.72,
                  8,
                  1,
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource id="world-admin1-de" shape={world.admin1De}>
            <FillLayer
              id="world-admin1-de-fill"
              minZoomLevel={HOME_MAP_OVERVIEW_LOD.admin1From}
              maxZoomLevel={HOME_MAP_OVERVIEW_LOD.admin1Until}
              style={{ fillColor: HOME_MAP_ADMIN1_FILL, fillOpacity: 0.18 }}
            />
          </ShapeSource>
          <ShapeSource id="world-urban" shape={world.urban}>
            <FillLayer
              id="world-urban-fill"
              minZoomLevel={HOME_MAP_OVERVIEW_LOD.urbanFrom}
              maxZoomLevel={HOME_MAP_OVERVIEW_LOD.urbanUntil}
              style={{ fillColor: HOME_MAP_URBAN_FILL, fillOpacity: 0.18 }}
            />
          </ShapeSource>
          <ShapeSource id="world-lakes" shape={world.lakes}>
            <FillLayer
              id="world-lakes-fill"
              style={{ fillColor: HOME_MAP_WATER, fillOpacity: 1 }}
            />
          </ShapeSource>
          <ShapeSource id="world-rivers" shape={labels.rivers}>
            <LineLayer
              id="world-rivers-major"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.riversMajorFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.riversMajorUntil}
              filter={['<=', ['to-number', ['get', 'r']], 1]}
              style={{
                lineColor: HOME_MAP_WATER,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  2,
                  0.9,
                  5,
                  1.6,
                  8,
                  2.0,
                ],
                lineOpacity: 0.82,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="world-rivers-detail"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.riversDetailFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.riversDetailUntil}
              filter={[
                'all',
                ['>', ['to-number', ['get', 'r']], 1],
                ['<=', ['to-number', ['get', 'r']], 3],
              ]}
              style={{
                lineColor: HOME_MAP_WATER,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6.8,
                  0.7,
                  8,
                  1.05,
                  9.5,
                  1.35,
                ],
                lineOpacity: 0.55,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="world-roads" shape={labels.roads}>
            <LineLayer
              id="world-roads-far"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsFarFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsFarUntil}
              filter={['<=', ['to-number', ['get', 'r']], 3]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.major,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  3.2,
                  0.55,
                  5.4,
                  1.05,
                ],
                lineOpacity: 0.72,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="world-roads-near"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsNearFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsNearUntil}
              filter={[
                'all',
                ['>', ['to-number', ['get', 'r']], 3],
                ['<=', ['to-number', ['get', 'r']], 5],
              ]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.major,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  5.4,
                  0.7,
                  7.5,
                  1.2,
                  9,
                  1.45,
                ],
                lineOpacity: 0.75,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="world-roads-mid"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsMidFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.roadsMidUntil}
              filter={[
                'all',
                ['>', ['to-number', ['get', 'r']], 5],
                ['<=', ['to-number', ['get', 'r']], 8],
              ]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.street,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  7,
                  0.5,
                  9,
                  0.95,
                ],
                lineOpacity: 0.65,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="world-cities" shape={labels.cities}>
            <SymbolLayer
              id="world-cities-major"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMajorFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMajorUntil}
              filter={['<=', ['to-number', ['get', 'r']], 3]}
              style={{
                textField: ['to-string', ['get', 'n']],
                textFont: MAP_TEXT_FONT,
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  2.2,
                  11,
                  5,
                  14,
                  8,
                  13,
                ],
                textColor: '#F4F1EA',
                textHaloColor: '#0E2A22',
                textHaloWidth: 1.35,
                textAllowOverlap: false,
                textOptional: true,
              }}
            />
            <SymbolLayer
              id="world-cities-mid"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMidFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMidUntil}
              filter={[
                'all',
                ['>', ['to-number', ['get', 'r']], 3],
                ['<=', ['to-number', ['get', 'r']], 10],
              ]}
              style={{
                textField: ['to-string', ['get', 'n']],
                textFont: MAP_TEXT_FONT,
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  4.8,
                  9,
                  7,
                  11,
                  10,
                  12,
                ],
                textColor: '#E6EDE8',
                textHaloColor: '#0E2A22',
                textHaloWidth: 1.2,
                textAllowOverlap: false,
                textOptional: true,
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="world-regions"
            shape={labels.regions ?? EMPTY_FC}
          >
            <SymbolLayer
              id="world-regions-label"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.regionsFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.regionsUntil}
              filter={['<=', ['to-number', ['get', 'r']], 5]}
              style={{
                textField: ['to-string', ['get', 'n']],
                textFont: MAP_TEXT_FONT,
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  4.2,
                  10,
                  6.5,
                  12,
                  8,
                  11,
                ],
                textColor: '#B8D4C4',
                textHaloColor: '#0E2A22',
                textHaloWidth: 1.1,
                textAllowOverlap: false,
                textOptional: true,
                textOpacity: 0.85,
              }}
            />
          </ShapeSource>
          <ShapeSource id="world-borders" shape={world.borders}>
            <LineLayer
              id="world-borders-line"
              minZoomLevel={HOME_MAP_OVERVIEW_LOD.countryFrom}
              maxZoomLevel={8.0}
              style={{
                lineColor: HOME_MAP_COUNTRY_BORDER,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  2,
                  1.15,
                  HOME_MAP_OVERVIEW_LOD.europeFrom,
                  1.85,
                  7,
                  2.1,
                  9.5,
                  1.45,
                ],
                lineOpacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="world-admin1" shape={world.admin1}>
            <LineLayer
              id="world-admin1-line"
              minZoomLevel={HOME_MAP_OVERVIEW_LOD.admin1From}
              maxZoomLevel={HOME_MAP_OVERVIEW_LOD.admin1Until}
              style={{
                lineColor: HOME_MAP_ADMIN1_BORDER,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_OVERVIEW_LOD.admin1From,
                  0.55,
                  7.5,
                  0.9,
                  9.5,
                  0.55,
                ],
                lineOpacity: 0.55,
                lineDasharray: [1.4, 1.1],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          {hasRegional ? (
            <ShapeSource id="regional-fallback" shape={regionalGeo}>
              <FillLayer
                id="regional-urban-fill"
                minZoomLevel={5.5}
                maxZoomLevel={10.0}
                filter={['==', ['geometry-type'], 'Polygon']}
                style={{ fillColor: HOME_MAP_URBAN_FILL, fillOpacity: 0.18 }}
              />
              {/* Keine Regional-Straßen-Linien: doppeln World-Roads → Spaghetti/weiße Kanten. */}
              <CircleLayer
                id="regional-cities-dot"
                minZoomLevel={5.8}
                maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMidUntil}
                filter={['==', ['geometry-type'], 'Point']}
                style={{
                  circleRadius: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    5.8,
                    1.6,
                    8,
                    2.4,
                  ],
                  circleColor: '#E8F0EC',
                  circleOpacity: 0.8,
                  circleStrokeWidth: 0.8,
                  circleStrokeColor: '#1A3D32',
                }}
              />
              <SymbolLayer
                id="regional-cities-label"
                minZoomLevel={6.2}
                maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.citiesMidUntil}
                filter={[
                  'all',
                  ['==', ['geometry-type'], 'Point'],
                  ['>', ['length', ['to-string', ['coalesce', ['get', 'NAME'], ['get', 'n'], '']]], 1],
                ]}
                style={{
                  textField: [
                    'to-string',
                    ['coalesce', ['get', 'NAME'], ['get', 'NAME_DE'], ['get', 'n']],
                  ],
                  textFont: MAP_TEXT_FONT,
                  textSize: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6.2,
                    10,
                    8,
                    11.5,
                  ],
                  textColor: '#F4F1EA',
                  textHaloColor: '#0E2A22',
                  textHaloWidth: 1.25,
                  textOptional: true,
                  textAllowOverlap: false,
                  textOffset: [0, 1.1],
                }}
              />
            </ShapeSource>
          ) : null}
          <ShapeSource id="extract-land" shape={geo.land}>
            <FillLayer
              id="extract-land-fill"
              minZoomLevel={9.4}
              style={{
                fillColor: HOME_MAP_BG,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  9.4,
                  0,
                  11.2,
                  0.55,
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-woods" shape={geo.woods}>
            <FillLayer
              id="extract-woods-fill"
              minZoomLevel={7.2}
              style={{ fillColor: HOME_MAP_WOOD, fillOpacity: 0.72 }}
            />
          </ShapeSource>
          <ShapeSource id="extract-parks" shape={geo.parks}>
            <FillLayer
              id="extract-parks-fill"
              minZoomLevel={8.4}
              style={{ fillColor: HOME_MAP_PARK, fillOpacity: 0.65 }}
            />
          </ShapeSource>
          <ShapeSource id="extract-water" shape={geo.water}>
            <FillLayer
              id="extract-water-fill"
              style={{ fillColor: HOME_MAP_WATER, fillOpacity: 0.92 }}
            />
          </ShapeSource>
          <ShapeSource id="fog-reveal" shape={revealFc}>
            <FillLayer
              id="fog-reveal-fill"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                fillColor: HOME_MAP_FOG_REVEAL,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_FOG_ZOOM.goneAt,
                  0.18,
                  HOME_MAP_FOG_ZOOM.fullAt,
                  0.42,
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-buildings" shape={geo.buildings}>
            <FillLayer
              id="extract-buildings-fill"
              minZoomLevel={10.4}
              style={{
                fillColor: HOME_MAP_BUILDING_FILL,
                fillOutlineColor: HOME_MAP_BUILDING_STROKE,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10.4,
                  0,
                  11.0,
                  0.55,
                  12.5,
                  0.72,
                  14.5,
                  0.88,
                  16,
                  0.94,
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-housenumbers" shape={geo.housenumbers}>
            <SymbolLayer
              id="extract-housenumbers-label"
              minZoomLevel={17.2}
              style={{
                textField: ['to-string', ['get', 'n']],
                textSize: 10,
                textFont: MAP_TEXT_FONT,
                textColor: '#E8F0EC',
                textHaloColor: HOME_MAP_BG,
                textHaloWidth: 1.2,
                textAllowOverlap: false,
                textIgnorePlacement: false,
                textOptional: true,
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-rails" shape={geo.rails}>
            <LineLayer
              id="extract-rails-line"
              style={{
                lineColor: HOME_MAP_RAIL,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  11,
                  1.4,
                  14,
                  2.2,
                  16,
                  2.8,
                ],
                lineOpacity: 0.85,
                lineCap: 'butt',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-roads" shape={geo.roads}>
            <LineLayer
              id="extract-roads-major"
              minZoomLevel={9.4}
              filter={['==', ['get', 'k'], 0]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.major,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6.4,
                  1.15,
                  11,
                  2.4,
                  16,
                  5.6,
                ],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="extract-roads-street"
              minZoomLevel={HOME_MAP_BASE_LOD.secondaryFrom}
              filter={['==', ['get', 'k'], 1]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.street,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  9.7,
                  0.55,
                  12,
                  1.35,
                  16,
                  3.5,
                ],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="extract-roads-path"
              minZoomLevel={HOME_MAP_BASE_LOD.minorFrom}
              filter={['==', ['get', 'k'], 2]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.path,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  11.2,
                  0.35,
                  14,
                  1.05,
                  16,
                  2.3,
                ],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="fog-mask" shape={fogFc}>
            <FillLayer
              id="fog-mask-fill"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                fillColor: HOME_MAP_FOG_FILL,
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_FOG_ZOOM.goneAt,
                  0,
                  HOME_MAP_FOG_ZOOM.fullAt,
                  1,
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource id="cities" shape={cityFc}>
            <FillLayer
              id="cities-fill"
              minZoomLevel={HOME_MAP_CITY_FILL_ZOOM.visibleFrom}
              maxZoomLevel={HOME_MAP_CITY_FILL_ZOOM.noneAt + 0.4}
              style={{
                fillColor: ['get', 'fill'],
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_CITY_FILL_ZOOM.visibleFrom,
                  HOME_MAP_CITY_FILL_ZOOM.opacity35,
                  HOME_MAP_CITY_FILL_ZOOM.at35,
                  HOME_MAP_CITY_FILL_ZOOM.opacity35,
                  HOME_MAP_CITY_FILL_ZOOM.at57,
                  HOME_MAP_CITY_FILL_ZOOM.opacity57,
                  HOME_MAP_CITY_FILL_ZOOM.at85,
                  HOME_MAP_CITY_FILL_ZOOM.opacity85,
                  HOME_MAP_CITY_FILL_ZOOM.at10,
                  HOME_MAP_CITY_FILL_ZOOM.opacity10,
                  HOME_MAP_CITY_FILL_ZOOM.at12,
                  HOME_MAP_CITY_FILL_ZOOM.opacity12,
                  HOME_MAP_CITY_FILL_ZOOM.noneAt,
                  0,
                ],
              }}
            />
            <LineLayer
              id="cities-line"
              minZoomLevel={HOME_MAP_CITY_FILL_ZOOM.visibleFrom}
              maxZoomLevel={HOME_MAP_CITY_OUTLINE_UNTIL}
              filter={['!=', ['get', 'dashed'], 1]}
              style={{
                lineColor: ['get', 'stroke'],
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_CITY_FILL_ZOOM.visibleFrom,
                  0.9,
                  6.8,
                  1.35,
                  9,
                  1.65,
                  12,
                  1.85,
                  15,
                  2.1,
                ],
                lineOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_CITY_FILL_ZOOM.visibleFrom,
                  0.7,
                  6.8,
                  0.88,
                  10,
                  0.82,
                  14,
                  0.72,
                ],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="cities-line-dash"
              minZoomLevel={HOME_MAP_CITY_FILL_ZOOM.visibleFrom}
              maxZoomLevel={HOME_MAP_CITY_OUTLINE_UNTIL}
              filter={['==', ['get', 'dashed'], 1]}
              style={{
                lineColor: ['get', 'stroke'],
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6.8,
                  1.35,
                  9,
                  1.65,
                  12,
                  1.85,
                  15,
                  2.1,
                ],
                lineOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6.8,
                  0.88,
                  10,
                  0.82,
                  14,
                  0.72,
                ],
                lineDasharray: [1.6, 1.4],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <SymbolLayer
              id="cities-label"
              minZoomLevel={4.8}
              maxZoomLevel={HOME_MAP_CITY_OUTLINE_UNTIL}
              filter={['>', ['length', ['to-string', ['get', 'n']]], 1]}
              style={{
                textField: ['to-string', ['get', 'n']],
                textFont: MAP_TEXT_FONT,
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  4.8,
                  9,
                  7,
                  11,
                  10,
                  12.5,
                  12,
                  13.5,
                ],
                textColor: '#E8F2EC',
                textHaloColor: '#0A221C',
                textHaloWidth: 1.6,
                textAllowOverlap: false,
                textOptional: true,
                textOpacity: 0.88,
              }}
            />
          </ShapeSource>
          <ShapeSource id="route-ahead" shape={routeFc.ahead}>
            <LineLayer
              id="route-ahead-casing"
              style={{
                lineColor: HOME_MAP_ROUTE_AHEAD_CASING,
                lineWidth: 6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="route-ahead-line"
              style={{
                lineColor: HOME_MAP_ROUTE_AHEAD,
                lineWidth: 3.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="route-current" shape={routeFc.current}>
            <LineLayer
              id="route-casing"
              style={{
                lineColor: HOME_MAP_ROUTE_LINE_CASING,
                lineWidth: routePreview ? 5 : 7,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routePreview ? 0.55 : 1,
                ...(routePreview ? { lineDasharray: [2, 1.4] } : {}),
              }}
            />
            <LineLayer
              id="route-line"
              style={{
                lineColor: HOME_MAP_ROUTE_LINE,
                lineWidth: routePreview ? 3.2 : 4.5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routePreview ? 0.78 : 1,
                ...(routePreview ? { lineDasharray: [2, 1.4] } : {}),
              }}
            />
          </ShapeSource>
          {!routePreview && (props.route?.arrows?.length ?? 0) > 0 ? (
            <ShapeSource id="route-arrows" shape={routeFc.arrows}>
              <SymbolLayer
                id="route-chevrons"
                minZoomLevel={12}
                style={{
                  iconImage: 'route-chevron',
                  iconSize: [
                    'case',
                    ['==', ['get', 'kind'], 'turn'],
                    0.7,
                    0.5,
                  ],
                  iconRotate: ['to-number', ['coalesce', ['get', 'bearing'], 0]],
                  iconRotationAlignment: 'map',
                  iconPitchAlignment: 'map',
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                  iconAnchor: 'center',
                }}
              />
            </ShapeSource>
          ) : null}
          {/* Orte über der Route — sonst stehlen Linien die Taps. */}
          <ShapeSource
            id="places-fill"
            shape={placeFc.fills}
            onPress={onPlacePress}
            hitbox={{ width: 44, height: 44 }}
          >
            <FillLayer
              id="places-fill-layer"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              style={{
                fillColor: ['get', 'color'],
                fillOpacity: HOME_MAP_PLACE_FILL_OPACITY,
                fillOutlineColor: ['get', 'color'],
              }}
            />
          </ShapeSource>
          <ShapeSource id="places-amenity" shape={placeFc.amenities} onPress={onPlacePress} hitbox={{ width: 52, height: 52 }}>
            <SymbolLayer
              id="places-icon-transit"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.transit.goneAt}
              filter={['==', ['get', 'kind'], 'transit']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  11,
                  0.2,
                  14,
                  0.28,
                  16,
                  0.36,
                  18,
                  0.44,
                ],
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <SymbolLayer
              id="places-icon-highlight"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.highlight.goneAt}
              filter={['==', ['get', 'kind'], 'highlight']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  12.2,
                  0.16,
                  15,
                  0.26,
                  18,
                  0.38,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-gastro-top"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.gastroTop.goneAt}
              filter={['==', ['get', 'kind'], 'gastroTop']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  13.2,
                  0.16,
                  15,
                  0.26,
                  18,
                  0.38,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-everyday"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.everyday.goneAt}
              filter={['==', ['get', 'kind'], 'everyday']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14.2,
                  0.14,
                  16,
                  0.26,
                  18,
                  0.36,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-gastro"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.gastro.goneAt}
              filter={['==', ['get', 'kind'], 'gastro']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15.4,
                  0.14,
                  16.5,
                  0.24,
                  18,
                  0.34,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-micro"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.micro.goneAt}
              filter={['==', ['get', 'kind'], 'micro']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15.8,
                  0.14,
                  17,
                  0.24,
                  18,
                  0.32,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-park"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.park.goneAt}
              filter={['==', ['get', 'kind'], 'park']}
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15.6,
                  0.14,
                  16.5,
                  0.24,
                  18,
                  0.32,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
          </ShapeSource>
          <ShapeSource id="places-dot" shape={placeFc.dots} onPress={onPlacePress} hitbox={{ width: 48, height: 48 }}>
            <CircleLayer
              id="places-dot-halo"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              style={{
                circleColor: '#FFFFFF',
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10,
                  1.6,
                  14,
                  5.5,
                  16.5,
                  8.5,
                ],
                circleOpacity: 0.88,
              }}
            />
            <CircleLayer
              id="places-dot-circle"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              style={{
                circleColor: ['get', 'color'],
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10,
                  1.1,
                  14,
                  4.2,
                  16.5,
                  7,
                ],
                circleStrokeColor: '#0A1F18',
                circleStrokeWidth: 1.2,
              }}
            />
          </ShapeSource>
          {/* Straßennamen ÜBER Gebäuden/Orten — sonst liegen sie unsichtbar darunter. */}
          <ShapeSource id="extract-roads-labels" shape={geo.roads}>
            <SymbolLayer
              id="extract-roads-label-major"
              minZoomLevel={HOME_MAP_STREET_LABEL_LOD.majorFrom}
              filter={[
                'all',
                ['==', ['get', 'k'], 0],
                ['>', ['length', ['to-string', ['get', 'n']]], 1],
              ]}
              style={{
                symbolPlacement: 'line',
                textField: ['to-string', ['get', 'n']],
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_STREET_LABEL_LOD.majorFrom,
                  10.5,
                  14,
                  13,
                  16,
                  14.5,
                  18,
                  15.5,
                ],
                textFont: MAP_TEXT_FONT,
                textColor: '#FFE08A',
                textHaloColor: '#0A1F18',
                textHaloWidth: 1.6,
                textOptional: false,
                textAllowOverlap: true,
                textIgnorePlacement: true,
                textMaxAngle: HOME_MAP_STREET_LABEL_LOD.maxAngleDeg,
                textKeepUpright: true,
                textPitchAlignment: 'viewport',
                textRotationAlignment: 'map',
                symbolSpacing: HOME_MAP_STREET_LABEL_LOD.spacing,
              }}
            />
            <SymbolLayer
              id="extract-roads-label"
              minZoomLevel={HOME_MAP_STREET_LABEL_LOD.streetFrom}
              filter={[
                'all',
                ['==', ['get', 'k'], 1],
                ['>', ['length', ['to-string', ['get', 'n']]], 1],
              ]}
              style={{
                symbolPlacement: 'line',
                textField: ['to-string', ['get', 'n']],
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  HOME_MAP_STREET_LABEL_LOD.streetFrom,
                  10.5,
                  15,
                  12.5,
                  17,
                  13.5,
                  18,
                  14.5,
                ],
                textFont: MAP_TEXT_FONT,
                textColor: '#FFE08A',
                textHaloColor: '#0A1F18',
                textHaloWidth: 1.55,
                textOptional: false,
                textAllowOverlap: true,
                textIgnorePlacement: true,
                textMaxAngle: HOME_MAP_STREET_LABEL_LOD.maxAngleDeg,
                textKeepUpright: true,
                textPitchAlignment: 'viewport',
                textRotationAlignment: 'map',
                symbolSpacing: HOME_MAP_STREET_LABEL_LOD.spacing,
              }}
            />
          </ShapeSource>
          <ShapeSource id="route-pins" shape={routeFc.pins} onPress={onPlacePress} hitbox={{ width: 44, height: 44 }}>
            <SymbolLayer
              id="route-pins-icon"
              style={{
                iconImage: ['coalesce', ['get', 'icon'], 'route-pin-now'],
                iconSize: 0.42,
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </ShapeSource>
          {routeChipMarkers}
          <ShapeSource id="drop-pin" shape={pinFc} onPress={onPlacePress}>
            <CircleLayer
              id="drop-pin-circle"
              style={{
                circleColor: '#E24B4A',
                circleRadius: 8,
                circleStrokeColor: '#FFFFFF',
                circleStrokeWidth: 2.2,
              }}
            />
          </ShapeSource>
          <ShapeSource id="gps-accuracy" shape={puckFc.accuracy} ref={gpsAccRef}>
            <FillLayer
              id="gps-accuracy-fill"
              minZoomLevel={14.8}
              style={{ fillColor: '#4285F4', fillOpacity: 0.1 }}
            />
          </ShapeSource>
          <ShapeSource id="gps-arrow" shape={puckFc.arrow} ref={gpsArrowRef}>
            <SymbolLayer
              id="gps-arrow-icon"
              style={{
                iconImage: 'user-arrow',
                iconSize: 0.22,
                iconRotate: ['to-number', ['coalesce', ['get', 'heading'], 0]],
                iconRotationAlignment: 'map',
                iconPitchAlignment: 'viewport',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                iconAnchor: 'center',
              }}
            />
          </ShapeSource>
        </MapView>
        {props.chromeDim ? <View style={styles.dim} pointerEvents="none" /> : null}
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HOME_MAP_OCEAN },
  map: { flex: 1, backgroundColor: HOME_MAP_OCEAN },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(0,0,0,${HOME_MAP_CHROME_DIM})`,
  },
  navChip: {
    maxWidth: 240,
    minWidth: 88,
    backgroundColor: '#0C100E',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 12,
    paddingRight: 24,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  navChipTitle: {
    color: '#F4F1EA',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  navChipSub: {
    color: 'rgba(244,241,234,0.85)',
    fontSize: 11,
    marginTop: 2,
    lineHeight: 14,
  },
  navChipClose: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navChipCloseText: {
    color: '#F2F5F3',
    fontSize: 14,
    lineHeight: 16,
    opacity: 0.75,
  },
});
