/**
 * Native Homescreen-Karte — MapLibre Native, kein WebView, keine HTTP-Kacheln.
 * Stadt-Extract + Fog + Orte + GPS + Route liegen als ShapeSources auf dem GL-Thread.
 */

import React, {
  forwardRef,
  memo,
  useCallback,
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
  type MapViewRef,
  type OnPressEvent,
  type RegionPayload,
  type ShapeSourceRef,
} from '@maplibre/maplibre-react-native';
import { Image, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { MapLayerGate } from './MapLayerGate';
import {
  YorroHomeCamera,
  type YorroHomeCameraRef,
} from './YorroHomeCamera';
import type { HomeMapFollowMode } from './nativeHomeMapCamera';
import type { CityMapExtract } from '../../services/homeMap/cityMapExtract';
import {
  cityMapExtractToGeojson,
  cityMapExtractToGeojsonAsync,
  emptyExtractGeojson,
} from '../../services/homeMap/cityMapExtractGeojson';
import type {
  ExtractGeojsonPhase,
  GeoJsonFc,
  GeoJsonFeature,
} from '../../services/homeMap/cityMapExtractGeojson';
import { OFFLINE_HOME_MAP_STYLE } from '../../services/homeMap/offlineHomeMapStyle';
import { isVectorBasemapEnabled } from '../../services/homeMap/mapTileConfig';
import {
  loadYorroProtomapsBasemapStyle,
  peekYorroProtomapsBasemapStyle,
} from '../../services/homeMap/yorroProtomapsBasemapStyle';
import {
  firstBasemapRoadLabelLayerId,
  listBasemapBuildingLayerIds,
  hasBasemapPoiSymbolNear,
  listBasemapPoiLayerIds,
  MAP_BASEMAP_POI_ID,
  BASEMAP_POI_TAP_PIXEL_OFFSETS,
  pickBasemapPoiAt,
  pickBasemapPoiKindFallback,
  pickBestBuildingRingAt,
  PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK,
} from '../../services/homeMap/basemapFeatureQuery';
import { buildYorroVectorMapStyle } from '../../services/homeMap/yorroVectorMapStyle';
import {
  getWorldOverview,
  getWorldLabels,
  type WorldLabelsBundle,
  type WorldOverviewBundle,
} from '../../services/homeMap/worldOverviewGeojson';
import {
  HOME_MAP_WORLD_AFTER_CORE_MS,
} from '../../services/homeMap/homeMapBootSchedule';
import {
  combineMapLayerFilters,
  HOME_MAP_FILTER_IDS,
  mapPlaceVisibilityFilter,
  type HomeMapFilterId,
} from '../../services/homeMap/homeMapPlaceFilter';
import type { HomeMapPlaceIcon } from '../../services/homeMap/homeMapPlaceType';
import { markHomeMapBoot } from '../../services/homeMap/homeMapBootMetrics';
import { noteSplashMapCoreReady } from '../../services/homeMap/splashReadyGate';
import { whenMapWorldAllowed, peekMapLoadPhases, isMapWorldReleaseAllowed, isMapExtractFrozen } from '../../services/homeMap/mapLoadPhases';
import {
  isMapLayerDebugEnabled,
  isMapLayerDebugExtractLocked,
  isMapLayerGroupVisible,
  mapLayerDebugAllows,
} from '../../services/homeMap/mapLayerDebug';
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
  HOME_MAP_FOG_MASK_OPACITY,
  HOME_MAP_FOG_REVEAL,
  HOME_MAP_FOG_REVEAL_EDGE,
  HOME_MAP_FOG_REVEAL_OPACITY,
  HOME_MAP_FOG_TRAIL_CORE_OPACITY,
  HOME_MAP_FOG_TRAIL_CORE_WIDTH,
  HOME_MAP_FOG_ZOOM,
  HOME_MAP_LAND_FAR,
  HOME_MAP_OVERVIEW_LOD,
  HOME_MAP_WORLD_MAX_ZOOM,
  HOME_MAP_WORLD_STRUCTURE_LOD,
  HOME_MAP_STREET_LABEL_LOD,
  HOME_MAP_PARK,
  HOME_MAP_RAIL,
  HOME_MAP_ROAD_COLORS,
  HOME_MAP_ROUTE_AHEAD,
  HOME_MAP_ROUTE_AHEAD_CASING,
  HOME_MAP_ROUTE_LINE,
  HOME_MAP_ROUTE_LINE_CASING,
  HOME_MAP_ROUTE_PREVIEW,
  HOME_MAP_ROUTE_PREVIEW_CASING,
  HOME_MAP_URBAN_FILL,
  HOME_MAP_WATER,
  HOME_MAP_WOOD,
  HOME_MAP_BASE_LOD,
  HOME_MAP_CITY_FILL_ZOOM,
  HOME_MAP_CITY_OUTLINE_UNTIL,
  HOME_MAP_PLACE_FILL_OPACITY,
} from '../../services/homeMap/homeMapStyle';
import {
  fogMaskFromExplored,
  fogPolygonsToGeoJSON,
  fogTrackCacheKey,
  fogBoundsCacheKey,
  type FogBounds,
} from '../../services/discovery/fogCoverage';
import type { WalkTrackPoint } from '../../services/discovery/walkTrackService';
import type { NavRouteMapPayload } from '../../services/navigation/navRouteMapPayload';
import { isGenericMapPointLabel } from '../../services/navigation/streetAddressQuery';
import { MAP_DROP_PIN_ID } from '../../services/homeMap/mapPlacePreview';
import { useSensorStore } from '../../store/useSensorStore';
import { useFogStore } from '../../store/useFogStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useRegionalFallbackStore } from '../../store/useRegionalFallbackStore';
import {
  getMapDisplayHeadingDegSticky,
} from '../../services/navigation/liveDeviceHeading';
import {
  HOME_MAP_ICON_LOD_ZOOM,
  HOME_MAP_PARK_ICONS,
  HOME_MAP_TRANSIT_ICONS,
  homeMapIconLod,
  isTransitIconLod,
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
  /** Chip-Tags für MapLibre Layer-Filter (ohne GeoJSON-Rebuild). */
  filterTags?: string[];
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
  /**
   * Gebäudeumriss unter GPS-Punkt aus der gerenderten Protomaps-Basiskarte.
   * Vector-Basemap: extract={null} → Pack-Boxen können hier auf echten Umriss snappen.
   * Soft-Fail: null bei jedem Fehler.
   */
  queryBuildingRingAt: (
    lat: number,
    lng: number,
  ) => Promise<Array<[number, number]> | null>;
  /**
   * true = Protomaps hat an dem Punkt schon ein POI-Label/Symbol.
   * Soft-Fail: null (unbekannt, nicht „kein Label“).
   */
  queryBasemapLabelAt: (lat: number, lng: number) => Promise<boolean | null>;
};

type Props = {
  extract: CityMapExtract | null;
  places: NativeMapPlace[];
  cities: NativeMapCity[];
  placeFilters: Record<HomeMapFilterId, boolean>;
  amenityIcons: Record<HomeMapPlaceIcon, boolean>;
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
  onUserRotate?: () => void;
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
  countries: EMPTY_FC,
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

function closeRingLngLat(ring: Array<[number, number]>): Array<[number, number]> | null {
  if (!ring || ring.length < 3) return null;
  const cleaned: Array<[number, number]> = [];
  for (const p of ring) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    cleaned.push([p[0], p[1]]);
  }
  if (cleaned.length < 3) return null;
  const a = cleaned[0]!;
  const b = cleaned[cleaned.length - 1]!;
  const closed =
    a[0] === b[0] && a[1] === b[1] ? cleaned : cleaned.concat([[a[0], a[1]]]);
  // MapLibre: Ring braucht ≥4 Positionen (3 Ecken + Schluss).
  if (closed.length < 4) return null;
  let unique = 1;
  for (let i = 1; i < closed.length - 1; i += 1) {
    const p = closed[i]!;
    const prev = closed[i - 1]!;
    if (p[0] !== prev[0] || p[1] !== prev[1]) unique += 1;
  }
  return unique >= 3 ? closed : null;
}

function ringToPolygon(
  ring: Array<[number, number]>,
  holes: Array<Array<[number, number]>> = [],
): GeoJsonFeature | null {
  if (!ring || ring.length < 3) return null;
  const coords = closeRingLngLat(ring.map((p) => [p[1], p[0]] as [number, number]));
  if (!coords || coords.length < 4) return null;
  const holeCoords: Array<Array<[number, number]>> = [];
  for (const h of holes) {
    if (!h || h.length < 3) continue;
    const c = closeRingLngLat(h.map((p) => [p[1], p[0]] as [number, number]));
    if (c && c.length >= 4) holeCoords.push(c);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords, ...holeCoords] },
  };
}

/** MapLibre-JNI: kaputte Polygone → Blackscreen. Nur gültige Ringe durchlassen. */
function sanitizePolygonRing(
  ring: unknown,
): Array<[number, number]> | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const cleaned: Array<[number, number]> = [];
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev[0] === lng && prev[1] === lat) continue;
    cleaned.push([lng, lat]);
  }
  if (cleaned.length < 3) return null;
  const a = cleaned[0]!;
  const b = cleaned[cleaned.length - 1]!;
  const closed =
    a[0] === b[0] && a[1] === b[1] ? cleaned : cleaned.concat([[a[0], a[1]]]);
  return closed.length >= 4 ? closed : null;
}

function sanitizePolygonFc(fc: GeoJsonFc | null | undefined): GeoJsonFc {
  if (!fc?.features?.length) return EMPTY_FC;
  const features: GeoJsonFeature[] = [];
  for (const f of fc.features) {
    if (!f?.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      const ringsIn = f.geometry.coordinates as unknown[];
      if (!Array.isArray(ringsIn) || ringsIn.length < 1) continue;
      const rings: Array<Array<[number, number]>> = [];
      for (const r of ringsIn) {
        const ok = sanitizePolygonRing(r);
        if (ok) rings.push(ok);
        else if (rings.length === 0) break; // outer kaputt → Feature weg
      }
      if (rings.length < 1) continue;
      features.push({
        ...f,
        geometry: { type: 'Polygon', coordinates: rings },
      });
      continue;
    }
    if ((f.geometry as { type?: string }).type === 'MultiPolygon') {
      const polys = (f.geometry as { coordinates?: unknown[] }).coordinates;
      if (!Array.isArray(polys)) continue;
      for (const poly of polys) {
        if (!Array.isArray(poly) || poly.length < 1) continue;
        const rings: Array<Array<[number, number]>> = [];
        for (const r of poly) {
          const ok = sanitizePolygonRing(r);
          if (ok) rings.push(ok);
          else if (rings.length === 0) break;
        }
        if (rings.length < 1) continue;
        features.push({
          type: 'Feature',
          properties: f.properties ?? {},
          geometry: { type: 'Polygon', coordinates: rings },
        });
      }
      continue;
    }
    // Points / LineStrings unverändert
    features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

function placesToGeojson(places: NativeMapPlace[]): {
  fills: GeoJsonFc;
  dots: GeoJsonFc;
  amenities: GeoJsonFc;
  hits: GeoJsonFc;
} {
  const fills: GeoJsonFeature[] = [];
  const dots: GeoJsonFeature[] = [];
  const amenities: GeoJsonFeature[] = [];
  const hits: GeoJsonFeature[] = [];
  for (const p of places) {
    // Halt ohne Icon (Story/Ring-Pfad) → trotzdem Bahn-Piktogramm, nie nackter Status-Punkt.
    const inferredRail =
      !p.icon &&
      /\b(bahnhof|haltepunkt|hbf)\b/i.test(`${p.name ?? ''} ${p.category ?? ''}`) &&
      !/\b(toilette|parkplatz|p\+r|kiosk|praxis|café|cafe|restaurant)\b/i.test(
        `${p.name ?? ''} ${p.category ?? ''}`,
      );
    const icon = p.icon || (inferredRail ? 'rail' : undefined);
    const iconLod =
      p.iconLod ||
      (icon ? homeMapIconLod(icon) : undefined) ||
      (inferredRail ? 'transit' : undefined);
    const props = {
      id: p.id,
      name: p.name,
      category: p.category,
      color: p.color,
      lat: p.lat,
      lng: p.lng,
      icon: icon || '',
      iconImg: amenityIconImageName(icon),
      kind: iconLod || homeMapIconLod(icon),
      tags: p.filterTags ?? [],
    };
    // Haltepunkt/Bahnhof: nie Bahnsteig-Polygon als Riesen-Fläche
    const skipFillForPoint =
      !!p.keepDot ||
      isTransitIconLod(props.kind) ||
      !!p.amenityDot ||
      inferredRail;
    const poly =
      !skipFillForPoint &&
      p.ring &&
      p.ring.length >= 3 &&
      !ringTooWideForFill(p.ring, !!p.story)
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
    const hasAmenityIcon =
      (p.amenityDot || icon || inferredRail) && amenityIconImageName(icon);
    if (hasAmenityIcon) {
      amenities.push(pt);
    } else if (!poly) {
      // Nicht-Fill: unsichtbar tippbar (Basemap-Label first) — kein Status-Rot-Punkt.
      hits.push(pt);
    }
  }
  return {
    fills: { type: 'FeatureCollection', features: fills },
    dots: { type: 'FeatureCollection', features: dots },
    amenities: { type: 'FeatureCollection', features: amenities },
    hits: { type: 'FeatureCollection', features: hits },
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
  _accuracyM: number | null,
): { accuracy: GeoJsonFc; arrow: GeoJsonFc } {
  return { accuracy: EMPTY_FC, arrow: gpsArrowFc(lat, lng, deg) };
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
    // Ein Label-Punkt (Centroid) — nie Polygon-Mehrfach-Labels.
    let latSum = 0;
    let lngSum = 0;
    let n = 0;
    for (const [lat, lng] of c.ring) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      latSum += lat;
      lngSum += lng;
      n += 1;
    }
    if (n > 0 && c.name) {
      features.push({
        type: 'Feature',
        properties: {
          id: c.id,
          n: c.name,
          kind: 'city-label',
        },
        geometry: {
          type: 'Point',
          coordinates: [lngSum / n, latSum / n],
        },
      });
    }
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
function maxChordDevM(
  pts: Array<{ lat: number; lng: number }>,
): number {
  if (pts.length < 3) return 0;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const chord = haversineRouteM(a, b);
  if (chord < 1) return 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!;
    const d1 = haversineRouteM(a, p);
    const d2 = haversineRouteM(p, b);
    const s = (chord + d1 + d2) / 2;
    const area2 = Math.max(0, s * (s - chord) * (s - d1) * (s - d2));
    const h = (2 * Math.sqrt(area2)) / chord;
    if (h > max) max = h;
  }
  return max;
}

function lineFromCoords(
  pts: Array<{ lat: number; lng: number }> | undefined,
  props: Record<string, string | number | boolean | null> = {},
): GeoJsonFeature | null {
  if (!pts || pts.length < 2) return null;
  const span = haversineRouteM(pts[0]!, pts[pts.length - 1]!);
  // 2-Punkt oder Quasi-Sehne = Luftlinie — nie zeichnen
  if (pts.length === 2 && span > 80) return null;
  if (pts.length >= 3 && span > 80 && maxChordDevM(pts) < 40) return null;
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
  turnBands: GeoJsonFc;
  turnHeads: GeoJsonFc;
} {
  if (!route) {
    return {
      current: EMPTY_FC,
      ahead: EMPTY_FC,
      pins: EMPTY_FC,
      arrows: EMPTY_FC,
      turnBands: EMPTY_FC,
      turnHeads: EMPTY_FC,
    };
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
  // Kein Preview-Halo unter nummerierten Pins.
  if (route.previewPin && pins.length === 0) {
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
    if (a.kind === 'turn') continue; // Turn = Geometrie, kein Symbol
    arrows.push({
      type: 'Feature',
      properties: {
        bearing: a.bearing,
        kind: 'flow',
        lod: a.lod === 'hi' ? 'hi' : 'lo',
      },
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
    });
  }
  const turnBands: GeoJsonFeature[] = [];
  for (const band of route.turnBands ?? []) {
    const line = lineFromCoords(band);
    if (line) turnBands.push(line);
  }
  const turnHeads: GeoJsonFeature[] = [];
  for (const head of route.turnHeads ?? []) {
    // Ausgefülltes Dreieck — nur valide geschlossene Ringe (≥4 Positionen).
    if (!head || head.length < 4) continue;
    const ring: Array<[number, number]> = [];
    for (const p of head) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
        ring.length = 0;
        break;
      }
      const prev = ring[ring.length - 1];
      if (prev && prev[0] === p.lng && prev[1] === p.lat) continue;
      ring.push([p.lng, p.lat]);
    }
    if (ring.length < 3) continue;
    const a = ring[0]!;
    const b = ring[ring.length - 1]!;
    const closed =
      a[0] === b[0] && a[1] === b[1] ? ring : ring.concat([[a[0], a[1]]]);
    if (closed.length < 4) continue;
    turnHeads.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closed] },
    });
  }
  return {
    current: { type: 'FeatureCollection', features: current },
    ahead: { type: 'FeatureCollection', features: ahead },
    pins: { type: 'FeatureCollection', features: pins },
    arrows: { type: 'FeatureCollection', features: arrows },
    turnBands: { type: 'FeatureCollection', features: turnBands },
    turnHeads: sanitizePolygonFc({
      type: 'FeatureCollection',
      features: turnHeads,
    }),
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

function placesPaintSig(places: NativeMapPlace[]): string {
  if (!places.length) return '0';
  return `${places.length}:${places[0]?.id}:${places[places.length - 1]?.id}`;
}

function filtersSig(flags: Record<HomeMapFilterId, boolean>): string {
  return HOME_MAP_FILTER_IDS.map((id) => (flags[id] ? '1' : '0')).join('');
}

function nativeMapPropsEqual(prev: Props, next: Props): boolean {
  if (prev.locationFollow !== next.locationFollow) return false;
  if (prev.headingFollow !== next.headingFollow) return false;
  if (prev.chromeDim !== next.chromeDim) return false;
  if (prev.dropPin !== next.dropPin) return false;
  if (isVectorBasemapEnabled()) {
    if (prev.places !== next.places) return false;
    if (prev.cities !== next.cities) return false;
    if (prev.route !== next.route) return false;
    if (filtersSig(prev.placeFilters) !== filtersSig(next.placeFilters)) {
      return false;
    }
    // walkTrack absichtlich ignorieren — Fog kommt aus useFogStore (sonst Remount+Snap).
    return true;
  }
  if (prev.walkTrack !== next.walkTrack) {
    const fogWanted =
      HOME_MAP_FOG_ENABLED &&
      (!isMapLayerDebugEnabled() || isMapLayerGroupVisible('fog'));
    if (fogWanted) return false;
  }
  if (prev.route !== next.route) return false;
  if (filtersSig(prev.placeFilters) !== filtersSig(next.placeFilters)) {
    return false;
  }

  const frozenCity = next.extract?.cityId;
  if (frozenCity && isMapExtractFrozen(frozenCity)) {
    const exSig = (e: CityMapExtract | null) =>
      e
        ? `${e.cityId}:${e.roads?.length ?? 0}:${e.buildings?.length ?? 0}`
        : '';
    if (exSig(prev.extract) !== exSig(next.extract)) return false;
    if (placesPaintSig(prev.places) !== placesPaintSig(next.places)) {
      return false;
    }
    if ((prev.cities?.length ?? 0) !== (next.cities?.length ?? 0)) {
      return false;
    }
    return true;
  }

  return (
    prev.extract === next.extract &&
    prev.places === next.places &&
    prev.cities === next.cities
  );
}

export const NativeHomeMapView = memo(
  forwardRef(function NativeHomeMapView(
  props: Props,
  ref: React.ForwardedRef<NativeHomeMapHandle>,
) {
    const cameraRef = useRef<YorroHomeCameraRef>(null);
    const mapViewRef = useRef<MapViewRef>(null);
    const gpsArrowRef = useRef<ShapeSourceRef>(null);
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
    /** Pinch/Zoom oft ohne isUserInteraction — nach Zoom-Commit Restore kurz aus. */
    const lastUserZoomAt = useRef(0);
    /** Kamera beim Finger-down — Unlock erst bei echtem Verschieben/Zoomen, nicht bei Tippen. */
    const gestureOriginCam = useRef<{
      lat: number;
      lng: number;
      zoom: number;
    } | null>(null);
    /**
     * Freie Erkundung (Default). Zentrum darf sich NUR bewegen wenn:
     * - centerMoveArmedUntil (Boot / Zentrieren-Pulse / Nav-Fit), oder
     * - GPS-Lock (locationFollow && !detached).
     * Kein Restore/Gegenwehr — Idle / Extract / Layer-Reload setzen die Kamera nie.
     */
    const userDetached = useRef(true);
    /** GPS-Lock: ein Map-Puck, Kamera gleitet ihn in die Mitte. */
    const [gpsLockCenter, setGpsLockCenter] = useState(false);
    const gpsLockCenterRef = useRef(false);
    const lockGlideUntil = useRef(0);
    const centerMoveArmedUntil = useRef(0);
    const armCenterMove = (ms = 1_500) => {
      centerMoveArmedUntil.current = Date.now() + ms;
    };
    const headingRef = useRef(getMapDisplayHeadingDegSticky() ?? 0);
    const displayBearingRef = useRef(0);
    const targetBearingRef = useRef<number | null>(null);
    const bearingRafRef = useRef(0);
    const lastBearingFrameAt = useRef(0);
    const lastBearingCameraAt = useRef(0);
    const programmaticBearingRef = useRef(false);
    const programmaticBearingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastBearingUiAt = useRef(0);
    /** MapView schluckt Touches — Bearing/Pan-Delta = Live-Geste. */
    const liveMapTurnRef = useRef(false);
    /** User hat schon erkundet → keine Boot-World/Layer-Nachzieh-Snaps. */
    const userHasExploredRef = useRef(false);
    const gpsPosRef = useRef({
      lat: null as number | null,
      lng: null as number | null,
      acc: null as number | null,
    });
    const headingFollowRef = useRef(props.headingFollow);
    const locationFollowRef = useRef(props.locationFollow);
    /** Follow-Throttle: kein setCamera-Sturm bei jedem GPS-Tick. */
    const lastFollowCamAt = useRef(0);
    const lastFollowPos = useRef({ lat: 0, lng: 0 });
    /** Moving: heading setCamera throttle. */
    const lastMovingHeadingCamAt = useRef(0);
    const MOVING_HEADING_CAM_MIN_MS = 150;
    const MOVING_SPEED_MS = 2;
    /** Letzter programmierter Center-Move — Region-Events danach kurz = Echo, nicht User-Pan. */
    const lastProgrammaticCenterAt = useRef(0);
    /**
     * Fixierung + Pinch: Follow darf während Zoom nicht gegen den Finger kämpfen,
     * aber Unlock erst bei echtem Pan (Zentrum wegschieben).
     */
    const lockZoomHoldUntil = useRef(0);
    // Prop → Ref immer syncen. Attach nur über reattachFollow (nie still userDetached=false).
    useEffect(() => {
      locationFollowRef.current = props.locationFollow;
      if (props.locationFollow) {
        followMode.current = 'gps';
      } else {
        // React-State aus → hart frei (Pan darf nie hinter altem Lock kleben).
        userDetached.current = true;
        followMode.current = 'explore';
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
      }
    }, [props.locationFollow]);

    const postBearingUi = (bearing: number) => {
      if (!Number.isFinite(bearing)) return;
      const now = Date.now();
      // Live mit Kartendrehung: kein Throttle während Finger / MapView-Turn.
      const live =
        fingerDown.current ||
        userGesturing.current ||
        liveMapTurnRef.current;
      const minGap = live ? 16 : 24;
      if (minGap > 0 && now - lastBearingUiAt.current < minGap) return;
      lastBearingUiAt.current = now;
      props.onBearing?.(bearing);
    };

    const markProgrammaticBearing = () => {
      programmaticBearingRef.current = true;
      // Heading-Follow feuert oft — Echo darf Follow nicht als User-Drehung killen.
      const hold = headingFollowRef.current ? 320 : 140;
      suppressRegionUntil.current = Date.now() + hold;
      if (programmaticBearingClearTimer.current) {
        clearTimeout(programmaticBearingClearTimer.current);
      }
      programmaticBearingClearTimer.current = setTimeout(() => {
        programmaticBearingClearTimer.current = null;
        programmaticBearingRef.current = false;
      }, headingFollowRef.current ? 360 : 160);
    };

    const applyMapBearing = (bearing: number) => {
      const b = ((bearing % 360) + 360) % 360;
      displayBearingRef.current = b;
      camLiveRef.current = { ...camLiveRef.current, heading: b };
      // While moving: throttle setCamera heading (JS-thread bike starvation).
      // Heading-Follow / Fixieren: nie skippen — sonst wirkt Lock tot bei Tempo.
      try {
        const { getSmoothedSpeedMs } = require('../../services/navigation/transportMode') as {
          getSmoothedSpeedMs: () => number;
        };
        const speed = getSmoothedSpeedMs();
        if (
          !headingFollowRef.current &&
          typeof speed === 'number' &&
          speed >= MOVING_SPEED_MS
        ) {
          const nowH = Date.now();
          if (
            lastMovingHeadingCamAt.current > 0 &&
            nowH - lastMovingHeadingCamAt.current < MOVING_HEADING_CAM_MIN_MS
          ) {
            postBearingUi(b);
            return;
          }
          lastMovingHeadingCamAt.current = nowH;
        }
      } catch {
        /* soft */
      }
      markProgrammaticBearing();
      // Android: Heading-only setCamera fällt oft auf defaultStop-Zentrum (Boot-GPS)
      // zurück — immer Live-Center+Zoom mitschicken (Google: drehen ≠ springen).
      const live = camLiveRef.current;
      // Heading-Follow: um GPS drehen (nicht Kamera-Mitte) — sonst wirkt Lock tot in Nav.
      let cLat = live.lat;
      let cLng = live.lng;
      if (headingFollowRef.current) {
        const gps = gpsPosRef.current;
        if (
          gps.lat != null &&
          gps.lng != null &&
          Number.isFinite(gps.lat) &&
          Number.isFinite(gps.lng)
        ) {
          cLat = gps.lat;
          cLng = gps.lng;
        }
      }
      // Follow: kein gestapeltes easeTo (sonst Ruckeln gegen Sensor). Sonst kurz weich.
      const follow = headingFollowRef.current;
      camLiveRef.current = { ...live, lat: cLat, lng: cLng, heading: b };
      cameraRef.current?.setCamera({
        centerCoordinate: [cLng, cLat],
        zoomLevel: live.zoom,
        heading: b,
        animationDuration: follow ? 0 : 90,
        animationMode: follow ? 'moveTo' : 'easeTo',
      });
      postBearingUi(b);
    };

    const stopHeadingFollowLoop = () => {
      if (bearingRafRef.current) {
        cancelAnimationFrame(bearingRafRef.current);
        bearingRafRef.current = 0;
      }
      targetBearingRef.current = null;
      lastBearingFrameAt.current = 0;
    };

    const retargetHeadingFollow = (rawBearing: number) => {
      if (!Number.isFinite(rawBearing)) return;
      const raw = ((rawBearing % 360) + 360) % 360;
      const previous = targetBearingRef.current ?? displayBearingRef.current;
      const delta = shortestSignedBearing(previous, raw);
      const abs = Math.abs(delta);
      // Kleine Sensor-Zacken gar nicht erst an die native Kamera weiterreichen.
      if (abs < 0.65) return;
      // Ziel-Low-Pass: echte Kurven holen schnell auf, Handzittern bleibt ruhig.
      const alpha = abs >= 45 ? 0.72 : abs >= 15 ? 0.5 : 0.3;
      targetBearingRef.current =
        ((previous + delta * alpha) % 360 + 360) % 360;
    };

    const tickDisplayBearing = () => {
      bearingRafRef.current = 0;
      if (!headingFollowRef.current) return;
      // User-Finger/Geste → Follow pausieren (sonst festgenagelt).
      // liveMapTurnRef allein pausiert Follow nicht — Region-Echos setzen das oft falsch.
      if (fingerDown.current || userGesturing.current) {
        // Nach Geste weiter tippen — sonst bleibt Heading hängen.
        bearingRafRef.current = requestAnimationFrame(tickDisplayBearing);
        return;
      }
      const target = targetBearingRef.current;
      if (target == null || !Number.isFinite(target)) return;
      const now = Date.now();
      const dtMs =
        lastBearingFrameAt.current > 0
          ? Math.max(8, Math.min(50, now - lastBearingFrameAt.current))
          : 16;
      lastBearingFrameAt.current = now;
      let current = displayBearingRef.current;
      const d = shortestSignedBearing(current, target);
      const ad = Math.abs(d);
      // Zeitbasierte Exponential-Glättung plus Winkelgeschwindigkeits-Limit.
      // Dadurch hängt die Reaktion nicht von 60/90/120-Hz-Displays ab.
      if (ad < 0.35) {
        current = target;
      } else {
        const tauMs = ad >= 45 ? 90 : ad >= 15 ? 115 : 155;
        const exponentialStep = ad * (1 - Math.exp(-dtMs / tauMs));
        const maxVelocityDegS = ad >= 45 ? 190 : ad >= 15 ? 165 : 120;
        const step = Math.min(exponentialStep, (maxVelocityDegS * dtMs) / 1000);
        current =
          ((current + Math.sign(d) * step) % 360 + 360) % 360;
      }
      displayBearingRef.current = current;
      camLiveRef.current = { ...camLiveRef.current, heading: current };
      // Native Camera höchstens ~30 Hz. RAF interpoliert weiter, aber wir
      // vermeiden den bisherigen 60/120-Hz-setCamera-Sturm auf dem JS-Thread.
      if (
        now - lastBearingCameraAt.current >= 32 ||
        Math.abs(shortestSignedBearing(current, target)) < 0.4
      ) {
        lastBearingCameraAt.current = now;
        applyMapBearing(current);
      }
      if (Math.abs(shortestSignedBearing(current, target)) >= 0.4) {
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
      liveMapTurnRef.current = false;
      // Sofort GPS als Drehzentrum (Nav Heading-up), nicht alter Kamera-Anker.
      {
        const gps = gpsPosRef.current;
        if (
          gps.lat != null &&
          gps.lng != null &&
          Number.isFinite(gps.lat) &&
          Number.isFinite(gps.lng)
        ) {
          camLiveRef.current = {
            ...camLiveRef.current,
            lat: gps.lat,
            lng: gps.lng,
          };
        }
      }
      displayBearingRef.current = camLiveRef.current.heading;
      targetBearingRef.current = null;
      retargetHeadingFollow(headingRef.current);
      try {
        const { noteHomeMapFollowState } = require('../../services/ui/homeMapPause') as {
          noteHomeMapFollowState: (o: { headingFollow?: boolean }) => void;
        };
        noteHomeMapFollowState({ headingFollow: true });
      } catch {
        /* soft */
      }
      if (fromUserTap) {
        ignorePanUntil.current = Date.now() + 220;
        suppressRegionUntil.current = Date.now() + 220;
      }
      queueHeadingFollowTick();
    };

    useEffect(() => {
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
    /** Letzte Geste-Mitte aus IsChanging — DidChange kann schon Snap-Back auf Boot sein. */
    const gestureCamRef = useRef<{
      lat: number;
      lng: number;
      zoom: number;
      heading: number;
    } | null>(null);
    /** gps = Follow-Puck · explore = freie User-View · nav = Route-Follow */
    const followMode = useRef<HomeMapFollowMode>('gps');
    const bootCam = useRef({
      centerCoordinate: [props.initialLng, props.initialLat] as [number, number],
      zoomLevel: props.initialZoom,
      heading: 0,
    }).current;
    const [viewBounds, setViewBounds] = useState<FogBounds | null>(null);
    /** Fog-Maske: Bounds einmal setzen, bis Final — Pan darf ShapeSource nicht neu laden. */
    const fogBoundsFrozenRef = useRef(false);
    const gps0 = useSensorStore.getState();
    gpsPosRef.current = { lat: gps0.lat, lng: gps0.lng, acc: gps0.accuracyM };
    headingRef.current = gps0.headingDeg;

    const pushArrowNative = (
      lat: number | null,
      lng: number | null,
      heading: number,
    ) => {
      // Immer echte GPS-Koordinaten — nie Kamera-Center (sonst wandert Puck beim Pan).
      const g = gpsPosRef.current;
      const useLat =
        lat != null && Number.isFinite(lat)
          ? lat
          : g.lat != null && Number.isFinite(g.lat)
            ? g.lat
            : null;
      const useLng =
        lng != null && Number.isFinite(lng)
          ? lng
          : g.lng != null && Number.isFinite(g.lng)
            ? g.lng
            : null;
      gpsArrowRef.current?.setNativeProps({
        shape: gpsArrowFc(useLat, useLng, heading),
      });
    };

    const pushPuckPosition = (
      lat: number | null,
      lng: number | null,
      _acc: number | null,
    ) => {
      // Ein Puck auf GPS — Lock gleitet über Kamera, kein zweites Overlay.
      if (lat != null && lng != null) {
        gpsPosRef.current = {
          lat,
          lng,
          acc: gpsPosRef.current.acc,
        };
      }
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
          retargetHeadingFollow(heading);
          queueHeadingFollowTick();
        }
        return;
      }
      // Lock-Follow nur wenn bewusst angebunden UND locationFollow aktiv.
      if (!followLoc) {
        if (followHead && Number.isFinite(heading)) {
          retargetHeadingFollow(heading);
          queueHeadingFollowTick();
        }
        return;
      }
      if (Date.now() < ignorePanUntil.current) return;
      if (Date.now() < lockGlideUntil.current) return;
      // Pinch bei Fix: Zoom frei, GPS-Mitte nicht gegen den Finger ziehen.
      if (Date.now() < lockZoomHoldUntil.current) return;
      if (Date.now() < suppressRegionUntil.current && !followHead) return;
      if (lat == null || lng == null) return;
      const nowFollow = Date.now();
      const dLat = (lat - lastFollowPos.current.lat) * 111_320;
      const cosF = Math.cos((lat * Math.PI) / 180);
      const dLng =
        (lng - lastFollowPos.current.lng) * 111_320 * Math.max(0.2, cosF);
      const movedM = Math.sqrt(dLat * dLat + dLng * dLng);
      const since = nowFollow - lastFollowCamAt.current;
      // Zug/Auto: dichter nachziehen — sonst Teleport. Gehen: etwas sparsamer.
      let minMs = 90;
      let minM = 3.5;
      try {
        const { getSmoothedSpeedMs } = require('../../services/navigation/transportMode') as {
          getSmoothedSpeedMs: () => number;
        };
        const speed = getSmoothedSpeedMs();
        if (typeof speed === 'number' && speed >= 8) {
          minMs = 120;
          minM = 1.2;
        } else if (typeof speed === 'number' && speed >= 2) {
          minMs = 80;
          minM = 1.2;
        }
      } catch {
        /* soft */
      }
      if (lastFollowCamAt.current > 0 && since < minMs && movedM < minM) {
        if (followHead && Number.isFinite(heading)) {
          retargetHeadingFollow(heading);
          queueHeadingFollowTick();
        }
        return;
      }
      // Lock: Center+Heading in einem setCamera (Android Heading-only-Snap vermeiden).
      const headForCam =
        followHead && Number.isFinite(heading)
          ? displayBearingRef.current
          : followHead
            ? undefined
            : 0;
      if (
        !applyCenterMove(lng, lat, {
          kind: 'follow',
          heading: headForCam,
        })
      ) {
        return;
      }
      lastFollowCamAt.current = nowFollow;
      lastFollowPos.current = { lat, lng };
      // Follow-Ticks: nur Live-Kamera — NICHT userViewCam überschreiben.
      // Sonst misst Pan gegen GPS und Follow gewinnt immer (Ruckeln / klebt).
      const liveHead =
        followHead && Number.isFinite(heading)
          ? displayBearingRef.current
          : followHead
            ? userViewCamRef.current.heading
            : 0;
      camLiveRef.current = {
        lat,
        lng,
        zoom: userViewCamRef.current.zoom,
        heading: liveHead,
      };
      if (!followHead) {
        lastCamHeading.current = 0;
        displayBearingRef.current = 0;
        return;
      }
      if (Number.isFinite(heading)) {
        retargetHeadingFollow(heading);
        queueHeadingFollowTick();
      }
    };

    /**
     * bootCam (JS) immer; native defaultStop NACH Boot nie mehr anfassen.
     * setNativeProps(defaultStop) = Kamera-Snap auf Android (Pan/Rotate tot).
     */
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
    };

    /** defaultStop = User-Anker bei freier Erkundung (nie Live-GPS-Snap). */
    const currentDefaultStopCam = () => userViewCamRef.current;

    const commitUserView = (c: {
      lat: number;
      lng: number;
      zoom: number;
      heading: number;
    }) => {
      userViewCamRef.current = { ...c };
      camLiveRef.current = { ...c };
      anchorCamRef.current = { ...c };
      followMode.current = 'explore';
      // Mid-Geste nie syncDefaultStop — MapView schluckt oft fingerDown,
      // liveMapTurnRef hält Drehen/Pan frei (sonst Rotation blockiert).
      if (
        fingerDown.current ||
        userGesturing.current ||
        liveMapTurnRef.current
      ) {
        return;
      }
      syncBootCamFrom(c);
    };

    /**
     * Finger weg: nur JS-Anker = Live-View.
     * Kein setCamera / syncDefaultStop — Maps-Verfassung: Kamera bleibt wo der Finger sie ließ
     * (Fling-Trägheit inkl.). Snap-Ursachen am Paint beheben, nicht gegensteuern.
     */
    const endMapFingerGesture = () => {
      fingerDown.current = false;
      liveMapTurnRef.current = false;
      userHasExploredRef.current = true;
      const live = { ...(gestureCamRef.current ?? camLiveRef.current) };
      // Fix + Pinch: nach Finger-hoch GPS wieder in die Mitte, Zoom behalten.
      if (locationFollowRef.current && !userDetached.current) {
        repinLockAfterZoom(live.zoom);
      } else {
        userViewCamRef.current = live;
        camLiveRef.current = live;
        anchorCamRef.current = live;
        syncBootCamFrom(live);
      }
      userGesturing.current = false;
      gestureOriginCam.current = null;
      lastFingerUpAt.current = Date.now();
      props.onGestureEnd?.();
    };

    /**
     * Einziger Pfad für programmierte Zentrums-Moves.
     * kind=armed → Boot/Zentrieren/Nav (vorher armCenterMove).
     * kind=follow → nur GPS-Lock.
     * Kein restore/Gegenwehr — nie zurückspringen.
     */
    const applyCenterMove = (
      lng: number,
      lat: number,
      opts: {
        kind: 'armed' | 'follow';
        zoom?: number;
        heading?: number;
        animateMs?: number;
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
      }
      markProgrammaticBearing();
      lastProgrammaticCenterAt.current = Date.now();
      // Lock-Tap: weich in die Fix-Position. Follow-Ticks danach hart (Zug sonst hinterher).
      const animMs = Math.max(0, opts.animateMs ?? 0);
      cameraRef.current?.setCamera({
        centerCoordinate: [lng, lat],
        ...(opts.zoom != null ? { zoomLevel: opts.zoom } : {}),
        ...(opts.heading != null ? { heading: opts.heading } : {}),
        animationDuration: animMs,
        animationMode: animMs > 0 ? 'easeTo' : 'moveTo',
      });
      return true;
    };

    useEffect(() => {
      const unsubSensor = useSensorStore.subscribe((s, prev) => {
        // Accuracy / Fallback wenn DR noch kalt — Position kommt primär aus Dead Reckoning.
        if (s.accuracyM !== prev.accuracyM) {
          gpsPosRef.current = {
            lat: gpsPosRef.current.lat ?? s.lat,
            lng: gpsPosRef.current.lng ?? s.lng,
            acc: s.accuracyM,
          };
        }
      });
      const { subscribeDeadReckonPosition, noteDeadReckonHeading } =
        require('../../services/navigation/gpsDeadReckoning') as {
          subscribeDeadReckonPosition: (
            cb: (s: {
              lat: number;
              lng: number;
              atMs: number;
              coasting: boolean;
            }) => void,
          ) => () => void;
          noteDeadReckonHeading: (deg: number) => void;
        };
      const unsubDr = subscribeDeadReckonPosition((s) => {
        let lat = s.lat;
        let lng = s.lng;
        let heading = headingRef.current;
        try {
          const { getTransitDisplayFix } = require('../../services/navigation/navigationService') as {
            getTransitDisplayFix: () => {
              lat: number;
              lng: number;
              bearingDeg: number;
            } | null;
          };
          const snap = getTransitDisplayFix();
          if (snap) {
            lat = snap.lat;
            lng = snap.lng;
            heading = snap.bearingDeg;
            headingRef.current = heading;
          }
        } catch {
          /* soft */
        }
        gpsPosRef.current = {
          lat,
          lng,
          acc: gpsPosRef.current.acc,
        };
        pushPuckPosition(lat, lng, gpsPosRef.current.acc);
        maybeFollowCamera(lat, lng, heading);
      });
      // Direkt vom Sensor — unabhängig vom Store-Filter (Pfeil folgt Handy-Drehung).
      const { subscribeMapHeading } = require('../../services/navigation/liveDeviceHeading') as {
        subscribeMapHeading: (cb: (deg: number) => void) => () => void;
      };
      const unsubHeading = subscribeMapHeading((deg) => {
        if (!Number.isFinite(deg)) return;
        noteDeadReckonHeading(deg);
        let useDeg = deg;
        let lat = gpsPosRef.current.lat;
        let lng = gpsPosRef.current.lng;
        try {
          const { getTransitDisplayFix } = require('../../services/navigation/navigationService') as {
            getTransitDisplayFix: () => {
              lat: number;
              lng: number;
              bearingDeg: number;
            } | null;
          };
          const snap = getTransitDisplayFix();
          if (snap) {
            useDeg = snap.bearingDeg;
            lat = snap.lat;
            lng = snap.lng;
            gpsPosRef.current = {
              lat,
              lng,
              acc: gpsPosRef.current.acc,
            };
          }
        } catch {
          /* soft */
        }
        pushPuckHeading(useDeg);
        maybeFollowCamera(lat, lng, useDeg);
      });
      // Kalter Start: letzter Sensor-Fix als DR-Anker.
      try {
        const { noteGpsDeadReckonFix } = require('../../services/navigation/gpsDeadReckoning') as {
          noteGpsDeadReckonFix: (f: {
            lat: number;
            lng: number;
            speedMs?: number | null;
          }) => void;
        };
        const g = useSensorStore.getState();
        if (g.lat != null && g.lng != null) {
          noteGpsDeadReckonFix({ lat: g.lat, lng: g.lng, speedMs: 0 });
        }
      } catch {
        /* soft */
      }
      return () => {
        unsubSensor();
        unsubDr();
        unsubHeading();
        stopHeadingFollowLoop();
      };
    }, []);

    // Zwei-Phasen: Straßen/Wasser sofort, Gebäude kurz danach.
    const vectorBasemap = isVectorBasemapEnabled();
    const basemapReady = vectorBasemap;
    /**
     * Protomaps Style als Objekt (Fetch) — remote styleURL auf Android oft ohne Straßen.
     * Init aus RAM-Peek (Splash-Warmup/Disk), damit kein OFFLINE-Grün vor dem Style-Swap.
     */
    const [vectorStyle, setVectorStyle] = useState<Record<string, unknown> | null>(
      () => {
        if (!isVectorBasemapEnabled()) return null;
        const peeked = peekYorroProtomapsBasemapStyle();
        return peeked
          ? (peeked as unknown as Record<string, unknown>)
          : null;
      },
    );
    useEffect(() => {
      if (!vectorBasemap) {
        setVectorStyle(null);
        return;
      }
      let cancelled = false;
      const peeked = peekYorroProtomapsBasemapStyle();
      if (peeked) {
        setVectorStyle(peeked as unknown as Record<string, unknown>);
      }
      void loadYorroProtomapsBasemapStyle().then((style) => {
        if (cancelled) return;
        if (style) {
          setVectorStyle(style as unknown as Record<string, unknown>);
          return;
        }
        // Kein Hosted-Style (R2/pmtiles) → eigener Style-Builder.
        setVectorStyle(buildYorroVectorMapStyle());
      });
      return () => {
        cancelled = true;
      };
    }, [vectorBasemap]);
    /** Vector: Route unter Straßennamen — nur wenn der Label-Layer im Style wirklich existiert. */
    const routeBelowStreetLabelId = useMemo(() => {
      if (!vectorBasemap || !vectorStyle) return undefined;
      const fromStyle = firstBasemapRoadLabelLayerId(vectorStyle);
      if (fromStyle) return fromStyle;
      const layers = Array.isArray((vectorStyle as { layers?: unknown }).layers)
        ? ((vectorStyle as { layers: Array<{ id?: unknown }> }).layers)
        : [];
      const hasFallback = layers.some(
        (l) => String(l?.id ?? '') === PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK,
      );
      return hasFallback ? PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK : undefined;
    }, [vectorBasemap, vectorStyle]);
    const mapBasemapStyle =
      vectorBasemap
        ? vectorStyle ?? OFFLINE_HOME_MAP_STYLE
        : OFFLINE_HOME_MAP_STYLE;
    const [geo, setGeo] = useState(emptyExtractGeojson);
    const lastExtractSigRef = useRef('');
    const lastExtractCityRef = useRef<string | null>(null);
    const extractPaintGenRef = useRef(0);
    const geojsonCacheRef = useRef<{
      sig: string;
      bundle: ReturnType<typeof cityMapExtractToGeojson>;
    } | null>(null);
    const [world, setWorld] = useState<WorldOverviewBundle>(EMPTY_WORLD);
    const [labels, setLabels] = useState<WorldLabelsBundle>(EMPTY_LABELS);

    /** EU/World einmal mit Stadt-Final — nicht Near/Partial, nicht doppelt. */
    const worldPaintedRef = useRef(false);

    /**
     * Kamera-Verfassung (Maps): Zentrum nur über applyCenterMove (Boot/Recenter/Nav/Follow).
     * Layer-Paint darf die Kamera nie anfassen — kein native defaultStop, kein setCamera-Hold.
     * pinDefaultStopToUser = nur JS-Refs für Legacy-Extract (Vector: ungenutzt).
     */
    const pinDefaultStopToUser = () => {
      if (
        fingerDown.current ||
        userGesturing.current ||
        liveMapTurnRef.current
      ) {
        return;
      }
      const hold = currentDefaultStopCam();
      if (!Number.isFinite(hold.lat) || !Number.isFinite(hold.lng)) return;
      userViewCamRef.current = { ...hold };
      anchorCamRef.current = { ...hold };
      syncBootCamFrom(hold);
      // kein native defaultStop — Android setInitialCamera
    };

    /** Legacy-Extract: Hold absichtlich no-op (kämpfte gegen Pan). */
    const scheduleHoldCameraAfterLayerPaint = () => {
      /* no-op */
    };

    const paintEuWorldBundle = () => {
      // Vector-Basemap: Welt kommt aus Kacheln — kein GeoJSON-World (Snap).
      if (isVectorBasemapEnabled()) return;
      if (worldPaintedRef.current) return;
      if (isMapLayerDebugEnabled() && !mapLayerDebugAllows('world')) return;
      worldPaintedRef.current = true;
      pinDefaultStopToUser();
      setWorld(getWorldOverview());
      setLabels(getWorldLabels());
      scheduleHoldCameraAfterLayerPaint();
      markHomeMapBoot('world');
    };

    /** Ein Final-Idle-Scheduler — wartet auf Finger-weg, läuft trotzdem (auch nach Erkunden). */
    const finalIdleQueuedRef = useRef(false);
    const finalIdleFnsRef = useRef<Array<() => void>>([]);
    const runWhenMapIdleForFinal = (fn: () => void) => {
      finalIdleFnsRef.current.push(fn);
      if (finalIdleQueuedRef.current) return;
      finalIdleQueuedRef.current = true;
      const tryRun = () => {
        if (
          fingerDown.current ||
          userGesturing.current ||
          liveMapTurnRef.current ||
          Date.now() - lastFingerUpAt.current < 2_800
        ) {
          setTimeout(tryRun, 350);
          return;
        }
        const batch = finalIdleFnsRef.current.splice(0);
        finalIdleQueuedRef.current = false;
        // Nach User-Pan: Final-Paint darf Kamera nicht auf Boot-GPS ziehen.
        // userViewCam vorher einfrieren, ShapeSource danach mehrfach zurückholen.
        pinDefaultStopToUser();
        for (const job of batch) {
          try {
            job();
          } catch {
            /* soft */
          }
        }
        scheduleHoldCameraAfterLayerPaint();
        layerApplyQuietUntil.current = Date.now() + 600;
        suppressRegionUntil.current = Date.now() + 600;
      };
      InteractionManager.runAfterInteractions(tryRun);
    };

    useEffect(() => {
      // Vector: keine World-ShapeSources. Legacy: EU/World lazy nach Idle.
      if (vectorBasemap) return;
      let cancelled = false;
      const applyWorld = () => {
        if (cancelled) return;
        // Nur Safety: Extract-Final paintet World selbst. Hier nur wenn noch leer.
        runWhenMapIdleForFinal(() => {
          if (cancelled || worldPaintedRef.current) return;
          if (isMapLayerDebugEnabled() && !mapLayerDebugAllows('world')) return;
          paintEuWorldBundle();
        });
      };
      const unsub = whenMapWorldAllowed(applyWorld);
      const timer = setTimeout(() => {
        if (cancelled) return;
        if (!isMapWorldReleaseAllowed()) {
          const { releaseMapWorld } = require('../../services/homeMap/mapLoadPhases') as {
            releaseMapWorld: () => void;
          };
          releaseMapWorld();
        }
      }, Math.max(HOME_MAP_WORLD_AFTER_CORE_MS * 3, 180_000));
      return () => {
        cancelled = true;
        clearTimeout(timer);
        unsub();
      };
    }, []);
    useEffect(() => {
      if (vectorBasemap) return;
      const extract = props.extract;
      if (!extract) return;
      const sig = `${extract.cityId}:${extract.roads?.length ?? 0}:${extract.buildings?.length ?? 0}:${extract.housenumbers?.length ?? 0}`;
      const citySwitched =
        lastExtractCityRef.current != null &&
        lastExtractCityRef.current !== extract.cityId;
      lastExtractCityRef.current = extract.cityId;
      if (citySwitched) {
        worldPaintedRef.current = false;
        fogBoundsFrozenRef.current = false;
        // Stadtwechsel = freie Erkundung — NIE Explore-Flag löschen
        // (sonst pinDefaultStop + Suppress → Karte springt zurück / „Radern“).
        userDetached.current = true;
        userHasExploredRef.current = true;
        locationFollowRef.current = false;
        headingFollowRef.current = false;
        stopHeadingFollowLoop();
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
      }
      if (
        !citySwitched &&
        geo.hasRoads &&
        isMapLayerDebugExtractLocked() &&
        lastExtractSigRef.current
      ) {
        return;
      }
      if (sig === lastExtractSigRef.current && geo.hasRoads && !citySwitched) return;
      // Nach Freeze: gleiche Stadt nie neu painten (auch bei Store-Churn / Force).
      if (
        !citySwitched &&
        geo.hasRoads &&
        lastExtractSigRef.current &&
        isMapExtractFrozen(extract.cityId)
      ) {
        return;
      }
      const loadPhase = peekMapLoadPhases().phase;
      const finalRelease =
        loadPhase === 'final' || isMapWorldReleaseAllowed();
      const sigUnchanged =
        sig === lastExtractSigRef.current && lastExtractSigRef.current !== '';
      // R1→R3: Extract wächst (mehr Straßen/Gebäude) — trotzdem painten.
      if (!citySwitched && geo.hasRoads && !finalRelease && sigUnchanged) {
        return;
      }
      let cancelled = false;
      const apply = (phase: ExtractGeojsonPhase) => {
        if (cancelled) return;
        const cacheKey = `${sig}:${phase}`;
        const cached = geojsonCacheRef.current;
        const finish = (bundle: ReturnType<typeof cityMapExtractToGeojson>) => {
          if (cancelled) return;
          if (phase === 'full') {
            lastExtractSigRef.current = sig;
            geojsonCacheRef.current = { sig: cacheKey, bundle };
          } else if (phase === 'core') {
            lastExtractSigRef.current = `${sig}:core`;
          }
          const doPaint = () => {
            if (cancelled) return;
            if (fingerDown.current || userGesturing.current || liveMapTurnRef.current) {
              runWhenMapIdleForFinal(doPaint);
              return;
            }
            pinDefaultStopToUser();
            setGeo({
              ...bundle,
              land: sanitizePolygonFc(bundle.land),
              woods: sanitizePolygonFc(bundle.woods),
              parks: sanitizePolygonFc(bundle.parks),
              water: sanitizePolygonFc(bundle.water),
              buildings: sanitizePolygonFc(bundle.buildings),
            });
            scheduleHoldCameraAfterLayerPaint();
            // EU/World separat nach Idle — nicht im selben Tick wie Full-Extract.
            if (finalRelease && phase === 'full') {
              runWhenMapIdleForFinal(() => {
                if (cancelled) return;
                paintEuWorldBundle();
              });
            }
            const quietMs =
              userDetached.current || userHasExploredRef.current
                ? 120
                : finalRelease
                  ? 600
                  : 320;
            suppressRegionUntil.current = Date.now() + Math.max(80, quietMs);
            layerApplyQuietUntil.current = Date.now() + quietMs;
            if (bundle.hasRoads) {
              markHomeMapBoot('roads');
              noteSplashMapCoreReady();
              // Fog-Bounds einmal um Boot-Kamera — danach hart eingefroren (kein Pan-Idle).
              if (!fogBoundsFrozenRef.current) {
                const hold = camLiveRef.current;
                if (Number.isFinite(hold.lat) && Number.isFinite(hold.lng)) {
                  const dLat = 0.045;
                  const dLng = 0.07;
                  setViewBounds({
                    west: hold.lng - dLng,
                    east: hold.lng + dLng,
                    south: hold.lat - dLat,
                    north: hold.lat + dLat,
                  });
                  fogBoundsFrozenRef.current = true;
                }
              }
            }
            if (phase === 'full' && (bundle.buildings.features?.length ?? 0) > 0) {
              markHomeMapBoot('buildings');
              if (__DEV__) {
                console.log('[map-extract] buildings features', bundle.buildings.features.length);
              }
            }
          };
          if (finalRelease && phase === 'full') {
            runWhenMapIdleForFinal(doPaint);
          } else {
            doPaint();
          }
        };
        if (cached?.sig === cacheKey) {
          finish(cached.bundle);
          return;
        }
        if (phase === 'core') {
          finish(cityMapExtractToGeojson(extract, phase));
          return;
        }
        const paintGen = ++extractPaintGenRef.current;
        void cityMapExtractToGeojsonAsync(extract, phase).then((bundle) => {
          if (cancelled || paintGen !== extractPaintGenRef.current) return;
          finish(bundle);
        });
      };
      // Viewport-Stadtwechsel / leere Karte: ein Paint pro Release (core ODER full).
      if (citySwitched || !geo.hasRoads) {
        lastExtractSigRef.current = '';
        if (finalRelease) {
          apply('full');
        } else {
          apply('core');
        }
        return () => {
          cancelled = true;
        };
      }
      // Final-Release: Stadt noch einmal voll (Clip) + EU/World.
      apply('full');
      return () => {
        cancelled = true;
      };
    }, [props.extract, geo.hasRoads, vectorBasemap]);

    const placeFc = useMemo(() => {
      const raw = placesToGeojson(props.places);
      return {
        fills: sanitizePolygonFc(raw.fills),
        dots: raw.dots,
        amenities: raw.amenities,
        hits: raw.hits,
      };
    }, [props.places]);
    const placeVisFilter = useMemo(
      () => mapPlaceVisibilityFilter(props.placeFilters),
      [props.placeFilters],
    );
    const cityFc = useMemo(
      () => sanitizePolygonFc(citiesToGeojson(props.cities)),
      [props.cities],
    );
    // Orte/Städte: kein setCamera-Hold nach ShapeSource — Kamera-Verfassung.
    const routeFc = useMemo(() => routeToGeojson(props.route), [props.route]);
    const routePreview = props.route?.preview === true;
    const [dismissedRouteChips, setDismissedRouteChips] = useState<Record<string, true>>({});
    /** Übersicht: Chips aus — sie verdecken die Route (User-Ausschnitt). */
    const [showRouteChips, setShowRouteChips] = useState(true);
    const showRouteChipsRef = useRef(true);
    const noteRouteChipZoom = useCallback((zoom: number) => {
      const next = zoom >= 14.15;
      if (next === showRouteChipsRef.current) return;
      showRouteChipsRef.current = next;
      setShowRouteChips(next);
    }, []);
    useEffect(() => {
      setDismissedRouteChips({});
    }, [props.route?.fitKey]);
    const routeChipMarkers = useMemo(() => {
      if (!showRouteChips) return [] as React.ReactNode[];
      const pins = props.route?.pins ?? [];
      const out: React.ReactNode[] = [];
      const seen = new Set<string>();
      for (const pin of pins) {
        const title = pin.chip?.title?.trim();
        if (!title || isGenericMapPointLabel(title)) continue;
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
            {/* Abstand nach unten: Pin-Spitze bleibt frei (MarkerViews liegen über GL-Layers). */}
            <View style={styles.navChipWrap} pointerEvents="box-none">
              <View style={styles.navChip} pointerEvents="box-none">
                <View style={styles.navChipBody}>
                  <Text style={styles.navChipTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  {pin.chip?.sub ? (
                    <Text style={styles.navChipSub} numberOfLines={1}>
                      {pin.chip.sub}
                    </Text>
                  ) : null}
                </View>
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
            </View>
          </MarkerView>,
        );
      }
      return out;
    }, [props.route?.pins, dismissedRouteChips, showRouteChips]);
    /** Nummerierte Wegpunkt-Pins als MarkerView — über Orts-Chips (zuerst sichtbar). */
    const routePinMarkers = useMemo(() => {
      const pins = props.route?.pins ?? [];
      if (!pins.length) return [] as React.ReactNode[];
      const out: React.ReactNode[] = [];
      for (const pin of pins) {
        if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue;
        const n = Math.min(9, Math.max(0, Number(pin.n) || 0));
        const icon =
          pin.icon ||
          (pin.current
            ? n > 0
              ? `route-pin-now-${n}`
              : 'route-pin-now'
            : `route-pin-next-${Math.max(1, n || 1)}`);
        const src = HOME_MAP_AMENITY_IMAGES[icon];
        if (src == null) continue;
        out.push(
          <MarkerView
            key={`nav-pin-${n}-${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`}
            coordinate={[pin.lng, pin.lat]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <Image
              source={src}
              style={styles.navPinMarker}
              accessibilityLabel={
                pin.name?.trim()
                  ? `Wegpunkt ${n || ''} ${pin.name}`.trim()
                  : `Wegpunkt ${n || ''}`.trim()
              }
            />
          </MarkerView>,
        );
      }
      return out;
    }, [props.route?.pins]);
    const pinFc = useMemo(() => dropPinGeojson(props.dropPin), [props.dropPin]);
    const regionalGeo = sanitizePolygonFc(
      useRegionalFallbackStore((s) => s.snap?.geojson ?? EMPTY_FC),
    );
    const hasRegional = useRegionalFallbackStore(
      (s) => (s.snap?.geojson?.features?.length ?? 0) > 0,
    );

    const fogViewKey = viewBounds ? fogBoundsCacheKey(viewBounds) : '';
    const exploredFromStore = useFogStore((s) => s.exploredPolygons);
    const fogStoreTrackKey = useFogStore((s) => s.trackKey);

    const fogLayersWanted =
      HOME_MAP_FOG_ENABLED &&
      (!isMapLayerDebugEnabled() || isMapLayerGroupVisible('fog'));

    // Viewport-Maske: kühler Schleier (eingefroren nach erstem Paint — kein Snap).
    const mapCoreReady = vectorBasemap || geo.hasRoads;

    /**
     * Fog-Snapshot nur während Finger/Geste — sonst live aus Store nachziehen.
     * Früher: nach erstem Pan dauerhaft eingefroren → Spur blieb tot.
     * Follow an: Freeze leeren, damit die Fläche sofort nachzieht.
     * Nav löscht die Fläche nicht — der Rebuild pausiert nur in der Engine.
     */
    const fogRevealFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);
    const fogMaskFrozenRef = useRef<GeoJsonFc>(EMPTY_FC);

    useEffect(() => {
      if (!props.locationFollow) return;
      fogRevealFrozenRef.current = EMPTY_FC;
      fogMaskFrozenRef.current = EMPTY_FC;
    }, [props.locationFollow]);

    const fogFc = useMemo(() => {
      if (
        !fogLayersWanted ||
        !HOME_MAP_FOG_MASK_ENABLED ||
        !mapCoreReady ||
        !viewBounds
      ) {
        return EMPTY_FC;
      }
      const midGesture = fingerDown.current || userGesturing.current;
      if (
        midGesture &&
        (fogMaskFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogMaskFrozenRef.current;
      }
      // 0 % erkundet: volle Viewport-Maske (Fog sichtbar, nicht erst nach erster Spur).
      const mask = fogMaskFromExplored(viewBounds, exploredFromStore);
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(mask));
      fogMaskFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      mapCoreReady,
      fogStoreTrackKey,
      fogViewKey,
      exploredFromStore.length,
      props.locationFollow,
    ]);

    const revealFc = useMemo(() => {
      if (!fogLayersWanted || !mapCoreReady) return EMPTY_FC;
      // Nur Store (idle forceFogRecompute). Sync-Fallback aus walkTrack =
      // Doppel-Fog + Sekunden Freeze + Kamera-Snap auf Boot-GPS.
      if (exploredFromStore.length === 0) return EMPTY_FC;
      const midGesture = fingerDown.current || userGesturing.current;
      if (
        midGesture &&
        (fogRevealFrozenRef.current.features?.length ?? 0) > 0
      ) {
        return fogRevealFrozenRef.current;
      }
      const next = sanitizePolygonFc(fogPolygonsToGeoJSON(exploredFromStore));
      fogRevealFrozenRef.current = next;
      return next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      mapCoreReady,
      fogStoreTrackKey,
      exploredFromStore.length,
      props.locationFollow,
    ]);

    // Kein zweiter Trail über der Fläche — sonst stapelt sich das Eis-Cyan.
    const trailFc = useMemo(() => EMPTY_FC, []);

    /** Nach ShapeSource-Update: User-View halten (Android MapLibre → defaultStop). */
    const reassertUserCamera = () => {
      if (!userHasExploredRef.current && !userDetached.current) return;
      if (fingerDown.current || userGesturing.current) return;
      // Live-Cam bevorzugen — userView kann hinter Pan hängen → sonst Snap auf Boot-GPS.
      const live = camLiveRef.current;
      const anchor = userViewCamRef.current;
      const c =
        Number.isFinite(live.lat) && Number.isFinite(live.lng) ? live : anchor;
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      cameraRef.current?.setCamera({
        centerCoordinate: [c.lng, c.lat],
        zoomLevel: c.zoom,
        heading: Number.isFinite(c.heading) ? c.heading : 0,
        animationDuration: 0,
        animationMode: 'moveTo',
      });
    };

    useEffect(() => {
      if (exploredFromStore.length === 0) return;
      // Follow-Lock: Fog darf Kamera nicht mit setCamera nachziehen (Session-Last).
      if (gpsLockCenterRef.current || locationFollowRef.current) return;
      // Freie Erkundung: User besitzt die Kamera — Fog-Nachzug ohne Snap.
      if (userHasExploredRef.current || userDetached.current) return;
      const t = setTimeout(reassertUserCamera, 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fogStoreTrackKey, exploredFromStore.length]);

    useEffect(() => {
      if (!userHasExploredRef.current && !userDetached.current) return;
      const t = setTimeout(reassertUserCamera, 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.places, props.cities]);

    // Statische Start-Shape — Live-Puck nur per setNativeProps, sonst ShapeSource-Churn.
    const puckFc = EMPTY_PUCK_FC;

    const noteUserGesture = (kind: 'position' | 'heading' = 'position') => {
      if (programmaticBearingRef.current) return;
      // Pan/Zoom und Rotation lösen ihre Follow-Achse unabhängig voneinander.
      const wasExploring = userGesturing.current || liveMapTurnRef.current;
      lastUserGestureAt.current = Date.now();
      try {
        const { noteHomeMapExploreActivity } = require('../../services/ui/homeMapPause') as {
          noteHomeMapExploreActivity: () => void;
        };
        noteHomeMapExploreActivity();
      } catch {
        /* soft */
      }
      userGesturing.current = true;
      userHasExploredRef.current = true;
      liveMapTurnRef.current = true;
      fingerDown.current = true;
      if (!gestureOriginCam.current) {
        gestureOriginCam.current = {
          lat: camLiveRef.current.lat,
          lng: camLiveRef.current.lng,
          zoom: camLiveRef.current.zoom,
        };
      }
      if (kind === 'position') {
        userDetached.current = true;
        locationFollowRef.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
        // Wegziehen = volle freie Ansicht: auch Blickrichtungs-Follow sofort raus.
        if (headingFollowRef.current) {
          stopHeadingFollowLoop();
          headingFollowRef.current = false;
        }
      } else {
        stopHeadingFollowLoop();
        headingFollowRef.current = false;
      }
      // Geo-fix: Puck sofort auf GPS neu setzen (Screen-Lock-Overlay ist aus).
      const pos = gpsPosRef.current;
      pushArrowNative(pos.lat, pos.lng, headingRef.current);
      // Pending Follow-/GPS-setCamera abbrechen — Finger gewinnt (Google).
      cameraRef.current?.setCamera({});
      if (!wasExploring) props.onGestureStart?.();
      if (kind === 'position') props.onUserPan();
      else props.onUserRotate?.();
    };

    /**
     * Android/MapLibre: Pan/Pinch oft ohne isUserInteraction und ohne Parent-fingerDown
     * (Native MapView schluckt Touches). Bewegung = User — nie GPS-Snap-Heuristik.
     */
    const likelyUserExploreMotion = (
      lat: number,
      lng: number,
      zoom: number,
      opts?: { userInteract?: boolean },
    ) => {
      // Detached/Stadtwechsel: Suppress darf Pan nicht schlucken (Android oft ohne isUserInteraction).
      if (
        Date.now() < suppressRegionUntil.current &&
        !opts?.userInteract &&
        !userDetached.current &&
        !userHasExploredRef.current &&
        !fingerDown.current &&
        !userGesturing.current
      ) {
        return false;
      }
      // GPS-/Heading-Follow-Ticks nicht als User werten — sonst fliegt der Lock von allein.
      if (
        (locationFollowRef.current || headingFollowRef.current) &&
        !opts?.userInteract &&
        !fingerDown.current &&
        !userGesturing.current
      ) {
        return false;
      }
      const u = userViewCamRef.current;
      const zoomDelta = Math.abs(zoom - u.zoom);
      const centerDelta =
        Math.abs(lat - u.lat) + Math.abs(lng - u.lng);
      // Bei aktivem Follow: kleinere Bewegung reicht zum Unlock.
      const followOn =
        locationFollowRef.current || headingFollowRef.current;
      const zoomGate = followOn ? 0.03 : 0.05;
      const centerGate = followOn ? 0.00008 : 0.00014;
      if (opts?.userInteract || fingerDown.current || userGesturing.current) {
        return zoomDelta >= zoomGate || centerDelta > centerGate;
      }
      return zoomDelta >= 0.08 || centerDelta > 0.00014;
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

    /**
     * Fixierung: nur echtes Verschieben löst den Standort-Lock.
     * Zoom/Pinch bleibt erlaubt — der blaue GPS-Pfeil sitzt weiter auf GPS.
     * Kleiner Center-Drift beim Pinch zählt nicht als Pan.
     */
    const isPanUnlockWhileLocked = (
      lat: number,
      lng: number,
      zoom: number,
    ): boolean => {
      if (!locationFollowRef.current) return false;
      const o = gestureOriginCam.current ?? userViewCamRef.current;
      const dLat = Math.abs(lat - o.lat);
      const dLng = Math.abs(lng - o.lng);
      const dZoom = Math.abs(zoom - o.zoom);
      const pan = dLat > 0.0001 || dLng > 0.0001;
      if (!pan) return false;
      // Pinch oft mit kleinem Center-Drift — Zoom führt → Fix bleibt.
      if (dZoom >= 0.04 && dLat < 0.00028 && dLng < 0.00028) return false;
      return true;
    };

    /** Zoom bei Fix: Zoom merken, Follow kurz pausieren, nicht unlocken. */
    const absorbLockZoom = (zoom: number) => {
      if (!locationFollowRef.current) return;
      if (!Number.isFinite(zoom)) return;
      lockZoomHoldUntil.current = Date.now() + 480;
      lastUserZoomAt.current = Date.now();
      userViewCamRef.current = { ...userViewCamRef.current, zoom };
      camLiveRef.current = { ...camLiveRef.current, zoom };
      if (!gestureOriginCam.current) {
        gestureOriginCam.current = {
          lat: camLiveRef.current.lat,
          lng: camLiveRef.current.lng,
          zoom,
        };
      }
    };

    /** Nach Pinch bei Fix: wieder GPS-Mitte mit neuem Zoom. */
    const repinLockAfterZoom = (zoom: number) => {
      if (!locationFollowRef.current || userDetached.current) return;
      const gps = gpsPosRef.current;
      if (gps.lat == null || gps.lng == null) return;
      if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) return;
      lockZoomHoldUntil.current = 0;
      const z = Number.isFinite(zoom) ? zoom : userViewCamRef.current.zoom;
      userViewCamRef.current = {
        ...userViewCamRef.current,
        lat: gps.lat,
        lng: gps.lng,
        zoom: z,
      };
      camLiveRef.current = { ...userViewCamRef.current };
      armCenterMove(500);
      applyCenterMove(gps.lng, gps.lat, {
        kind: 'armed',
        zoom: z,
        animateMs: 0,
      });
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
        // Pulse/Boot/Nav/Stadtwechsel: einmal springen, detached bleiben.
        // Lock: Caller setzt locationFollow + reattachFollow vorher.
        if (!locationFollowRef.current) {
          userDetached.current = true;
          userHasExploredRef.current = true;
          gpsLockCenterRef.current = false;
          setGpsLockCenter(false);
        } else {
          userDetached.current = false;
          gpsLockCenterRef.current = true;
          setGpsLockCenter(true);
          {
            const pos = gpsPosRef.current;
            pushArrowNative(pos.lat, pos.lng, headingRef.current);
          }
        }
        userGesturing.current = false;
        const glide = locationFollowRef.current;
        if (glide) lockGlideUntil.current = Date.now() + 640;
        // Glide: Echo nicht als Pan werten, sonst fliegt der Fix sofort wieder raus.
        suppressRegionUntil.current = Date.now() + (glide ? 700 : 180);
        ignorePanUntil.current = Date.now() + (glide ? 700 : 180);
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
          animateMs: glide ? 560 : 0,
        });
      },
      fitBounds(south, west, north, east, reattach = false) {
        if (!reattach) return;
        armCenterMove(2_000);
        // Route-Overview: nie Follow anlocken.
        userDetached.current = true;
        userGesturing.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
        suppressRegionUntil.current = Date.now() + 500;
        ignorePanUntil.current = Date.now() + 500;
        // Mehr Padding = Überblick (GPS + Ziel), kein Street-Tight-Fit.
        // 132 ≈ User-Ausschnitt mit Platz für HUD, ohne Chip-Überdeckung.
        cameraRef.current?.fitBounds([east, north], [west, south], 132, 0);
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
        // Center+Zoom mitschicken — Heading-only = Android-Snap auf Boot-GPS.
        cameraRef.current?.setCamera({
          centerCoordinate: [next.lng, next.lat],
          zoomLevel: next.zoom,
          heading: 0,
          animationDuration: 0,
          animationMode: 'moveTo',
        });
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
      /** Follow wieder anbinden (GPS-Lock) — setzt locationFollow lokal mit. */
      reattachFollow() {
        userDetached.current = false;
        userGesturing.current = false;
        fingerDown.current = false;
        locationFollowRef.current = true;
        followMode.current = 'gps';
        // Anker = Live — ohne commitUserView (das flippt auf explore).
        const live = { ...camLiveRef.current };
        userViewCamRef.current = live;
        camLiveRef.current = live;
        anchorCamRef.current = live;
        // Google: Overlay Mitte + Map-Pfeil bleibt auf GPS (Crossfade ohne Pop).
        gpsLockCenterRef.current = true;
        setGpsLockCenter(true);
        // GPS-Fix ändert den separat gewählten Blickrichtungsmodus nicht.
        if (!headingFollowRef.current) {
          enableHeadingFollowInternal(false);
        }
        {
          const pos = gpsPosRef.current;
          pushArrowNative(pos.lat, pos.lng, headingRef.current);
        }
        try {
          const { noteHomeMapFollowState } = require('../../services/ui/homeMapPause') as {
            noteHomeMapFollowState: (o: {
              locationFollow?: boolean;
              headingFollow?: boolean;
            }) => void;
          };
          noteHomeMapFollowState({
            locationFollow: true,
            headingFollow: headingFollowRef.current,
          });
        } catch {
          /* soft */
        }
      },
      releaseFollow() {
        userDetached.current = true;
        // userGesturing/fingerDown NICHT löschen — sonst Mid-Pan Anker-Race + Snap-Back.
        locationFollowRef.current = false;
        gpsLockCenterRef.current = false;
        setGpsLockCenter(false);
        const pos = gpsPosRef.current;
        pushArrowNative(pos.lat, pos.lng, headingRef.current);
        try {
          const { noteHomeMapFollowState } = require('../../services/ui/homeMapPause') as {
            noteHomeMapFollowState: (o: {
              locationFollow?: boolean;
              headingFollow?: boolean;
            }) => void;
          };
          noteHomeMapFollowState({
            locationFollow: false,
            headingFollow: headingFollowRef.current,
          });
        } catch {
          /* soft */
        }
      },
      async queryBuildingRingAt(lat, lng) {
        try {
          const mv = mapViewRef.current;
          if (!mv) return null;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const layerIds = listBasemapBuildingLayerIds(
            peekYorroProtomapsBasemapStyle(),
          );
          const px = await mv.getPointInView([lng, lat]);
          if (!px || px.length < 2) return null;
          const fc = await mv.queryRenderedFeaturesAtPoint(
            [px[0]!, px[1]!],
            undefined,
            layerIds,
          );
          return pickBestBuildingRingAt(lat, lng, fc?.features ?? []);
        } catch {
          return null;
        }
      },
      async queryBasemapLabelAt(lat, lng) {
        try {
          const mv = mapViewRef.current;
          if (!mv) return null;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const layerIds = listBasemapPoiLayerIds(
            peekYorroProtomapsBasemapStyle(),
          );
          if (!layerIds.length) return null;
          const px = await mv.getPointInView([lng, lat]);
          if (!px || px.length < 2) return null;
          const fc = await mv.queryRenderedFeaturesAtPoint(
            [px[0]!, px[1]!],
            undefined,
            layerIds,
          );
          return hasBasemapPoiSymbolNear(lat, lng, fc?.features ?? []);
        } catch {
          return null;
        }
      },
    }));

    const ignoreBlankUntil = useRef(0);
    /** Nach Ort-Tap: kein Extract-Flush (TouchEnd kommt oft vor onPress). */
    const placeTapQuietUntil = useRef(0);
    const readyOnce = useRef(false);
    /**
     * Vector-Splash: Core erst wenn Protomaps-Style da UND Kacheln voll gerendert.
     * onDidFinishLoadingMap feuerte oft schon beim Offline-Hintergrund → Splash weg, Straßen leer.
     */
    const vectorStyleAppliedRef = useRef(false);
    const vectorStreetsSplashOnce = useRef(false);
    vectorStyleAppliedRef.current = vectorBasemap && vectorStyle != null;
    const noteVectorStreetsSplashReady = () => {
      if (!vectorBasemap) return;
      if (!vectorStyleAppliedRef.current) return;
      if (vectorStreetsSplashOnce.current) return;
      vectorStreetsSplashOnce.current = true;
      noteSplashMapCoreReady();
      markHomeMapBoot('roads');
    };
    const onMapPress = (feature: {
      geometry?: { type?: string; coordinates?: unknown } | null;
    }) => {
      if (Date.now() < ignoreBlankUntil.current) return;
      if (Date.now() < placeTapQuietUntil.current) return;
      const g = feature?.geometry;
      let lat = camLiveRef.current.lat;
      let lng = camLiveRef.current.lng;
      if (g && g.type === 'Point' && Array.isArray(g.coordinates)) {
        const x = Number(g.coordinates[0]);
        const y = Number(g.coordinates[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          lng = x;
          lat = y;
        }
      }
      // Basemap-POI: Skeleton sobald Features unter dem Tap — kein Flash bei Blank-Tap.
      void (async () => {
        try {
          const mv = mapViewRef.current;
          const poiLayers = listBasemapPoiLayerIds(
            peekYorroProtomapsBasemapStyle(),
          );
          if (mv && Number.isFinite(lat) && Number.isFinite(lng)) {
            const px = await mv.getPointInView([lng, lat]);
            if (px && px.length >= 2) {
              const layerFilter =
                poiLayers.length > 0 ? poiLayers : undefined;
              const seen = new Set<string>();
              const feats: unknown[] = [];
              for (const [dx, dy] of BASEMAP_POI_TAP_PIXEL_OFFSETS) {
                const fc = await mv.queryRenderedFeaturesAtPoint(
                  [px[0]! + dx, px[1]! + dy],
                  undefined,
                  layerFilter,
                );
                for (const f of fc?.features ?? []) {
                  const key = JSON.stringify(
                    (f as { properties?: unknown })?.properties ?? f,
                  ).slice(0, 180);
                  if (seen.has(key)) continue;
                  seen.add(key);
                  feats.push(f);
                }
                if (feats.length >= 12) break;
              }
              if (feats.length) {
                placeTapQuietUntil.current = Date.now() + 450;
                ignoreBlankUntil.current = Date.now() + 280;
                // Sofort Skeleton, dann Name — nie „nothing“ bei Label-Treffer.
                props.onPlaceTap({
                  id: MAP_BASEMAP_POI_ID,
                  name: '…',
                  category: 'ort',
                  lat,
                  lng,
                });
                const hit =
                  pickBasemapPoiAt(lat, lng, feats) ??
                  pickBasemapPoiKindFallback(lat, lng, feats);
                if (hit) {
                  props.onPlaceTap({
                    id: MAP_BASEMAP_POI_ID,
                    name: hit.name,
                    category: hit.kind || 'ort',
                    lat: hit.lat,
                    lng: hit.lng,
                  });
                  return;
                }
                // Features da, aber ohne Name — Popup trotzdem (Tipp war treffer).
                props.onPlaceTap({
                  id: MAP_BASEMAP_POI_ID,
                  name: 'Ort auf der Karte',
                  category: 'ort',
                  lat,
                  lng,
                });
                return;
              }
            }
          }
        } catch {
          /* soft → blank */
        }
        props.onBlankTap();
      })();
    };

    const onLongPress = (feature: {
      geometry?: { type?: string; coordinates?: unknown } | null;
    }) => {
      const g = feature.geometry;
      if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
      const lng = Number(g.coordinates[0]);
      const lat = Number(g.coordinates[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      props.onDropPin(lat, lng);
    };

    const onPlacePress = (e: OnPressEvent) => {
      placeTapQuietUntil.current = Date.now() + 450;
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
      <View style={styles.root} collapsable={false}>
        <MapView
          ref={mapViewRef}
          style={styles.map}
          mapStyle={mapBasemapStyle}
          // TextureView (Default) — SurfaceView frisst sonst Mic/Dock/Kompass-Touches.
          surfaceView={false}
          compassEnabled={false}
          logoEnabled={false}
          attributionEnabled={false}
          rotateEnabled
          pitchEnabled={false}
          scrollEnabled
          zoomEnabled
          regionWillChangeDebounceTime={0}
          regionDidChangeDebounceTime={64}
          onDidFinishLoadingMap={() => {
            if (readyOnce.current) return;
            readyOnce.current = true;
            markHomeMapBoot('mapReady');
            // Vector: Splash-Core nicht hier — Style-Load ≠ Straßen (oft noch Offline-BG).
            props.onReady();
          }}
          onDidFinishRenderingMapFully={() => {
            // Protomaps-Kacheln im Viewport fertig → Straßen da → Splash darf weg.
            noteVectorStreetsSplashReady();
          }}
          onRegionWillChange={(feature) => {
            const b = feature.properties as RegionPayload;
            const userInteract = b?.isUserInteraction === true;
            const zoomEarly = b?.zoomLevel ?? camLiveRef.current.zoom;
            const zoomDeltaEarly = Math.abs(zoomEarly - camLiveRef.current.zoom);
            // Pinch oft ohne isUserInteraction — Zoom-Delta darf Suppress nicht schlucken.
            if (
              !userInteract &&
              zoomDeltaEarly < 0.05 &&
              Date.now() < suppressRegionUntil.current
            ) {
              return;
            }
            if (
              !userInteract &&
              zoomDeltaEarly < 0.05 &&
              Date.now() < ignorePanUntil.current
            ) {
              return;
            }
            const zoom = zoomEarly;
            const zoomDelta = zoomDeltaEarly;
            const vb = b?.visibleBounds;
            let midLat = camLiveRef.current.lat;
            let midLng = camLiveRef.current.lng;
            if (vb?.[0] && vb?.[1]) {
              midLat = (vb[1][1]! + vb[0][1]!) / 2;
              midLng = (vb[1][0]! + vb[0][0]!) / 2;
            }
            const moved =
              gestureMovedEnough(midLat, midLng, zoom) || zoomDelta >= 0.06;
            // Fixierung: nur echtes Verschieben unlockt. Zoom/Pinch bleibt erlaubt.
            if (locationFollowRef.current) {
              if (
                Date.now() - lastProgrammaticCenterAt.current > 100 &&
                isPanUnlockWhileLocked(midLat, midLng, zoom)
              ) {
                noteUserGesture('position');
              } else if (zoomDelta >= 0.03) {
                absorbLockZoom(zoom);
              }
            } else if (
              moved &&
              likelyUserExploreMotion(midLat, midLng, zoom, { userInteract })
            ) {
              noteUserGesture('position');
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
            }
          }}
          onRegionIsChanging={(feature) => {
            const b = feature.properties as RegionPayload;
            const userInteract = b?.isUserInteraction === true;
            const bearing = b?.heading;
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
            // Live immer tracken (auch ohne commit) — sonst ist touchEnd-Anker stale.
            camLiveRef.current = {
              lat: midLat,
              lng: midLng,
              zoom,
              heading:
                typeof bearing === 'number' && Number.isFinite(bearing)
                  ? bearing
                  : camLiveRef.current.heading,
            };
            gestureCamRef.current = { ...camLiveRef.current };
            // Sofort raus aus Zentriert + Blickrichtung bei aktiver Bewegung.
            // Heading-Follow dreht die Kamera selbst — reine Bearing-Deltas sind kein Unlock.
            if (
              !programmaticBearingRef.current &&
              (locationFollowRef.current || headingFollowRef.current)
            ) {
              const rotD =
                typeof bearing === 'number' && Number.isFinite(bearing)
                  ? Math.abs(
                      shortestSignedBearing(displayBearingRef.current, bearing),
                    )
                  : 0;
              // Zoom allein löst Follow NICHT — nur echtes Pan (Zentrum).
              if (isPanUnlockWhileLocked(midLat, midLng, zoom)) {
                noteUserGesture('position');
              } else if (
                locationFollowRef.current &&
                typeof zoom === 'number' &&
                Math.abs(zoom - userViewCamRef.current.zoom) >= 0.03
              ) {
                absorbLockZoom(zoom);
              }
              if (
                rotD > 2.5 &&
                (userInteract || fingerDown.current) &&
                Date.now() >= suppressRegionUntil.current
              ) {
                noteUserGesture('heading');
              }
            }
            if (typeof bearing === 'number' && Number.isFinite(bearing)) {
              // Kompass-Nadel immer live mitdrehen — auch ohne isUserInteraction (Android).
              const rotDelta = Math.abs(
                shortestSignedBearing(displayBearingRef.current, bearing),
              );
              // Heading-Follow / setCamera → nicht als User-Drehung werten.
              if (programmaticBearingRef.current || headingFollowRef.current) {
                // MapLibre-Bearing immer an die Nadel — nicht nur displayBearingRef
                // (RAF kann unter JS-Last hängen, Karte dreht trotzdem).
                displayBearingRef.current = bearing;
                postBearingUi(bearing);
                // Echte Finger-Drehung gegen Follow → Unlock.
                if (
                  headingFollowRef.current &&
                  (fingerDown.current || userInteract) &&
                  rotDelta > 2.5 &&
                  Date.now() >= suppressRegionUntil.current
                ) {
                  noteUserGesture('heading');
                }
              } else {
                const userRotating =
                  userInteract ||
                  fingerDown.current ||
                  userGesturing.current ||
                  rotDelta > 0.5;
                if (rotDelta > 0.25 || userInteract || fingerDown.current) {
                  liveMapTurnRef.current = true;
                }
                if (userRotating || rotDelta > 0.2) {
                  displayBearingRef.current = bearing;
                }
                if (rotDelta > 0.08 || userRotating) {
                  postBearingUi(bearing);
                }
                // Heading in Anker (ohne syncDefaultStop mid-turn).
                if (
                  userRotating &&
                  rotDelta > 0.4 &&
                  !locationFollowRef.current
                ) {
                  commitUserView({
                    lat: midLat,
                    lng: midLng,
                    zoom,
                    heading: bearing,
                  });
                }
                if (
                  rotDelta > 2.5 &&
                  userRotating &&
                  Date.now() >= suppressRegionUntil.current
                ) {
                  noteUserGesture('heading');
                }
              }
            }
            const zoomDelta = Math.abs(zoom - userViewCamRef.current.zoom);
            const moved = gestureMovedEnough(midLat, midLng, zoom) || zoomDelta >= 0.05;
            const explore = likelyUserExploreMotion(midLat, midLng, zoom, {
              userInteract,
            });
            if (explore) {
              // Reine Rotation ≠ Pan: Standort-Fix bleibt, nur Heading-Follow fliegt.
              // Zoom bei Fix: halten + Zoom übernehmen — Pfeil bleibt auf GPS.
              if (locationFollowRef.current) {
                if (isPanUnlockWhileLocked(midLat, midLng, zoom)) {
                  noteUserGesture('position');
                } else if (zoomDelta >= 0.03) {
                  absorbLockZoom(zoom);
                } else if (
                  typeof bearing === 'number' &&
                  Number.isFinite(bearing) &&
                  Math.abs(
                    shortestSignedBearing(displayBearingRef.current, bearing),
                  ) > 2.5
                ) {
                  noteUserGesture('heading');
                }
              } else {
                const centerMovedNow = gestureMovedEnough(midLat, midLng, zoom);
                if (centerMovedNow || zoomDelta >= 0.05) {
                  noteUserGesture('position');
                } else if (
                  typeof bearing === 'number' &&
                  Number.isFinite(bearing) &&
                  Math.abs(
                    shortestSignedBearing(displayBearingRef.current, bearing),
                  ) > 2.5
                ) {
                  noteUserGesture('heading');
                } else {
                  noteUserGesture('position');
                }
              }
              liveMapTurnRef.current = true;
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
              // Detached: Pan sofort in User-View — sonst holt Layer-Idle Boot-GPS.
              if (!locationFollowRef.current && vb?.[0] && vb?.[1]) {
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
            }
            // User-View bei Finger / isUserInteraction / erkanntem Pinch-Zoom.
            // Nie nach Idle (sonst vergiftet Extract den Anker Richtung GPS).
            if (
              moved &&
              explore &&
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
            if (
              !userInteract &&
              zoomDelta < 0.05 &&
              Date.now() < suppressRegionUntil.current
            ) {
              return;
            }
            if (
              !userInteract &&
              zoomDelta < 0.05 &&
              Date.now() < ignorePanUntil.current
            ) {
              return;
            }
            if (
              !fingerDown.current &&
              Math.abs(zoom - camLiveRef.current.zoom) >= 0.08 &&
              !locationFollowRef.current &&
              (userInteract || explore)
            ) {
              noteUserGesture('position');
              lastUserZoomAt.current = Date.now();
            }
          }}
          onRegionDidChange={(feature) => {
            const b = feature.properties as RegionPayload;
            const suppressed = Date.now() < suppressRegionUntil.current;
            // Nur kurze Trägheit nach Finger-hoch — kein 12s-Fenster
            // (Extract/Regional nach ~5–10s sonst als „User“ gespeichert).
            const recentFinger =
              Date.now() - lastFingerUpAt.current < 2_800;
            const recentZoom = Date.now() - lastUserZoomAt.current < 3_200;
            const recentGesture =
              Date.now() - lastUserGestureAt.current < 2_800;
            const zoom = b?.zoomLevel ?? camLiveRef.current.zoom;
            const zoomDelta = Math.abs(zoom - userViewCamRef.current.zoom);
            noteRouteChipZoom(zoom);

            const vb = b?.visibleBounds;
            const headingRaw = b?.heading;
            const bearing =
              typeof headingRaw === 'number' && Number.isFinite(headingRaw)
                ? headingRaw
                : camLiveRef.current.heading;
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
            const moved = gestureMovedEnough(midLat, midLng, zoom) || zoomDelta >= 0.06;
            // Finales Gesture-Event oft ohne isUserInteraction.
            // Tippen (finger ohne Move) unlockt den GPS-Fix nicht.
            // Pinch-Zoom: Zoom-Delta / recentZoom zählen auch ohne Flags.
            // Keine GPS-Snap-Heuristik — nie zurückspringen / Gegenwehr.
            const finalUserInteract = b?.isUserInteraction === true;
            const user =
              finalUserInteract ||
              (fingerDown.current && moved) ||
              (recentFinger && moved) ||
              (recentZoom && moved) ||
              (recentGesture && moved) ||
              likelyUserExploreMotion(midLat, midLng, zoom, {
                userInteract: finalUserInteract,
              });

            // Extract/Programmatic: Anker nicht anfassen — syncDefaultStop wäre Snap.
            if (suppressed && !user) {
              return;
            }
            if (user && moved) {
              if (locationFollowRef.current) {
                if (isPanUnlockWhileLocked(midLat, midLng, zoom)) {
                  noteUserGesture('position');
                } else if (zoomDelta >= 0.03) {
                  absorbLockZoom(zoom);
                  repinLockAfterZoom(zoom);
                }
              } else {
                const centerMovedFinal = gestureMovedEnough(midLat, midLng, zoom);
                if (centerMovedFinal || zoomDelta >= 0.05) {
                  noteUserGesture('position');
                } else {
                  noteUserGesture('heading');
                }
              }
              if (zoomDelta >= 0.05) lastUserZoomAt.current = Date.now();
            } else if (
              zoomDelta >= 0.08 &&
              locationFollowRef.current &&
              (b?.isUserInteraction === true || recentZoom || recentGesture)
            ) {
              // Fix hält: nur Zoom übernehmen + GPS wieder Mitte.
              absorbLockZoom(zoom);
              repinLockAfterZoom(zoom);
            } else if (
              zoomDelta >= 0.08 &&
              !locationFollowRef.current &&
              (b?.isUserInteraction === true || recentZoom || recentGesture)
            ) {
              noteUserGesture('position');
              lastUserZoomAt.current = Date.now();
            }

            if (user && !headingFollowRef.current && typeof b?.heading === 'number') {
              displayBearingRef.current = bearing;
            }
            // MapView-Geste vorbei: Live → Anker (JS), Flags räumen.
            const wasTurning =
              liveMapTurnRef.current ||
              userGesturing.current ||
              fingerDown.current;
            if (wasTurning || user) {
              userHasExploredRef.current = true;
              const fromDid = {
                lat: midLat,
                lng: midLng,
                zoom,
                heading:
                  typeof bearing === 'number' && Number.isFinite(bearing)
                    ? bearing
                    : camLiveRef.current.heading,
              };
              const g = gestureCamRef.current;
              const gps = gpsPosRef.current;
              let settle = fromDid;
              // Snap-Back: DidChange klebt wieder am GPS, IsChanging war schon woanders.
              if (
                g &&
                gps.lat != null &&
                gps.lng != null &&
                Number.isFinite(gps.lat) &&
                Number.isFinite(gps.lng)
              ) {
                const didToGps = Math.hypot(fromDid.lat - gps.lat, fromDid.lng - gps.lng);
                const gestToGps = Math.hypot(g.lat - gps.lat, g.lng - gps.lng);
                if (didToGps + 0.00015 < gestToGps) settle = g;
              } else if (g) {
                settle = g;
              }
              userViewCamRef.current = settle;
              camLiveRef.current = settle;
              anchorCamRef.current = settle;
              syncBootCamFrom(settle);
            }
            // Gesten-Ende nur wenn MapLibre idle (kein isUserInteraction) —
            // sonst Zwei-Finger-Rotate / Pinch abwürgen.
            if ((wasTurning || user) && !b?.isUserInteraction) {
              endMapFingerGesture();
            } else if (!b?.isUserInteraction) {
              liveMapTurnRef.current = false;
              fingerDown.current = false;
            }
            if (typeof bearing === 'number' && Number.isFinite(bearing)) {
              postBearingUi(bearing);
            }
            if (!hasBounds || !vb?.[0] || !vb?.[1]) return;

            const headingDelta =
              typeof bearing === 'number' && Number.isFinite(bearing)
                ? Math.abs(
                    shortestSignedBearing(userViewCamRef.current.heading, bearing),
                  )
                : 0;
            // Reines Drehen (Zentrum gleich): Heading trotzdem ankern.
            if (
              headingDelta > 1.5 &&
              (user || recentFinger || recentGesture) &&
              !locationFollowRef.current &&
              !headingFollowRef.current
            ) {
              commitUserView({
                lat: midLat,
                lng: midLng,
                zoom,
                heading: bearing,
              });
            }

            const movedFromAnchor =
              Math.abs(midLat - userViewCamRef.current.lat) > 0.00045 ||
              Math.abs(midLng - userViewCamRef.current.lng) > 0.00045 ||
              Math.abs(zoom - userViewCamRef.current.zoom) > 0.08;
            // Nur echte Geste / kurze Fling-Trägheit / Pinch schreibt den Anker.
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

            // Kein Idle/Extract-Drift → User-View: das war die Snap-Vergiftung
            // (MapLibre springt auf defaultStop, Idle übernimmt das als „User“).

            rememberCamera(midLat, midLng, zoom, bearing, {
              fromUser: !!user,
            });
            // Fog-Bounds: nach Idle-Pan am Ausschnitt halten (Maske bleibt sichtbar).
            if (
              !fingerDown.current &&
              !recentFinger &&
              !recentGesture
            ) {
              const padLat = (north - south) * 0.25;
              const padLng = (east - west) * 0.25;
              const nextBounds = {
                west: Math.min(west, east) - padLng,
                east: Math.max(west, east) + padLng,
                south: Math.min(south, north) - padLat,
                north: Math.max(south, north) + padLat,
              };
              const prev = viewBounds;
              const moved =
                !prev ||
                Math.abs(prev.west - nextBounds.west) > 0.002 ||
                Math.abs(prev.east - nextBounds.east) > 0.002 ||
                Math.abs(prev.south - nextBounds.south) > 0.002 ||
                Math.abs(prev.north - nextBounds.north) > 0.002;
              if (moved) setViewBounds(nextBounds);
              fogBoundsFrozenRef.current = true;
            }
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
          <MapLayerGate group="world-base">
          <ShapeSource id="world-land" shape={world.land}>
            <FillLayer
              id="world-land-fill"
              maxZoomLevel={HOME_MAP_WORLD_MAX_ZOOM}
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
              maxZoomLevel={HOME_MAP_WORLD_MAX_ZOOM}
              style={{ fillColor: HOME_MAP_WATER, fillOpacity: 1 }}
            />
          </ShapeSource>
          </MapLayerGate>
          <MapLayerGate group="world-labels">
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
                // Städte weichen Ländernamen bei Weit-Zoom.
                symbolSortKey: [
                  '+',
                  20,
                  ['to-number', ['coalesce', ['get', 'r'], 5]],
                ],
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
                symbolSortKey: [
                  '+',
                  24,
                  ['to-number', ['coalesce', ['get', 'r'], 8]],
                ],
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="world-countries"
            shape={labels.countries ?? EMPTY_FC}
          >
            <SymbolLayer
              id="world-countries-label"
              minZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.countriesFrom}
              maxZoomLevel={HOME_MAP_WORLD_STRUCTURE_LOD.countriesUntil}
              filter={['<=', ['to-number', ['get', 'r']], 5]}
              style={{
                textField: ['to-string', ['get', 'n']],
                textFont: MAP_TEXT_FONT,
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  1.5,
                  13,
                  3.2,
                  16,
                  5.2,
                  14,
                ],
                textColor: '#FFFFFF',
                textHaloColor: '#0A241C',
                textHaloWidth: 1.6,
                textOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  1.4,
                  0.92,
                  4.2,
                  0.88,
                  5.6,
                  0.35,
                ],
                textAllowOverlap: false,
                textOptional: false,
                // Niedriger SortKey = Länder vor Städten bei Collision.
                symbolSortKey: [
                  'to-number',
                  ['coalesce', ['get', 'r'], 3],
                ],
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
          </MapLayerGate>
          <MapLayerGate group="world-base">
          {/* Weltweite Länder-/Admin1-Grenzen aus — nur Pack-Länder unten. */}
          <ShapeSource id="world-admin1" shape={EMPTY_FC}>
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
          </MapLayerGate>
          {hasRegional ? (
            <MapLayerGate group="regional">
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
            </MapLayerGate>
          ) : null}
          <MapLayerGate group="extract">
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
          </MapLayerGate>
          <MapLayerGate group="fog">
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
                  0,
                  HOME_MAP_FOG_ZOOM.fullAt,
                  HOME_MAP_FOG_REVEAL_OPACITY,
                ],
                fillOutlineColor: HOME_MAP_FOG_REVEAL_EDGE,
              }}
            />
          </ShapeSource>
          <ShapeSource id="fog-trail" shape={trailFc}>
            <LineLayer
              id="fog-trail-core"
              minZoomLevel={HOME_MAP_FOG_ZOOM.goneAt}
              style={{
                lineColor: HOME_MAP_FOG_REVEAL,
                lineWidth: HOME_MAP_FOG_TRAIL_CORE_WIDTH,
                lineOpacity: HOME_MAP_FOG_TRAIL_CORE_OPACITY,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          </MapLayerGate>
          <MapLayerGate group="extract">
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
              filter={['==', ['to-number', ['get', 'k']], 0]}
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
              filter={['==', ['to-number', ['get', 'k']], 1]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.street,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  9.2,
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
              filter={['==', ['to-number', ['get', 'k']], 2]}
              style={{
                lineColor: HOME_MAP_ROAD_COLORS.path,
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10.4,
                  0.5,
                  14,
                  1.35,
                  16.5,
                  2.8,
                ],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource id="extract-buildings" shape={geo.buildings}>
            <FillLayer
              id="extract-buildings-fill"
              minZoomLevel={10.4}
              style={{
                fillColor: HOME_MAP_BUILDING_FILL,
                // Leicht — Form über Fill + haarfeine Outline (wie Story-Orte).
                fillOpacity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10.4,
                  0,
                  12.0,
                  0.22,
                  14.0,
                  0.34,
                  16.0,
                  0.42,
                ],
                // 1-px-Kontrast wie places-fill — kein dicker LineLayer-Rahmen.
                fillOutlineColor: HOME_MAP_BUILDING_STROKE,
              }}
            />
          </ShapeSource>
          </MapLayerGate>
          {HOME_MAP_FOG_MASK_ENABLED ? (
            <MapLayerGate group="fog">
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
                    HOME_MAP_FOG_MASK_OPACITY,
                  ],
                }}
              />
            </ShapeSource>
            </MapLayerGate>
          ) : null}
          {/* Ländergrenzen: Protomaps boundaries_country (weiß) — siehe yorroProtomapsBasemapStyle. */}
          <MapLayerGate group="cities">
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
              filter={[
                'all',
                ['==', ['geometry-type'], 'Point'],
                ['>', ['length', ['to-string', ['get', 'n']]], 1],
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
          </MapLayerGate>
          {/* Ort-Status-Gebäude (lila/grün/blau/rot) — eine feste Layer, Inhalt = Orte-Filter.
              Route/Pins kommen DANACH, sonst liegen Linie + Pin unter dem Gebäude-Fill. */}
          <MapLayerGate group="places-fill">
          <ShapeSource
            id="places-fill"
            shape={placeFc.fills}
            onPress={onPlacePress}
            hitbox={{ width: 44, height: 44 }}
          >
            <FillLayer
              id="places-fill-layer"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              filter={placeVisFilter as never}
              style={{
                visibility:
                  (placeFc.fills.features?.length ?? 0) > 0
                    ? 'visible'
                    : 'none',
                fillColor: ['get', 'color'],
                fillOpacity: HOME_MAP_PLACE_FILL_OPACITY,
                fillOutlineColor: ['get', 'color'],
              }}
            />
            <LineLayer
              id="places-fill-outline"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              filter={placeVisFilter as never}
              style={{
                visibility:
                  (placeFc.fills.features?.length ?? 0) > 0
                    ? 'visible'
                    : 'none',
                lineColor: ['get', 'color'],
                lineWidth: 2.2,
                lineOpacity: 0.95,
              }}
            />
          </ShapeSource>
          </MapLayerGate>
          <MapLayerGate group="places-icons">
          <ShapeSource
            id="places-amenity" /* Icons via amenityIcons — nicht Typ-Chips (Standard) */
            shape={placeFc.amenities}
            onPress={onPlacePress}
            hitbox={{ width: 56, height: 56 }}
          >
            <SymbolLayer
              id="places-icon-transit"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.transitMajor.goneAt}
              filter={
                [
                  'any',
                  ['==', ['get', 'kind'], 'transitMajor'],
                  ['==', ['get', 'kind'], 'transit'],
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                // Wie Everyday — früher absichtlich ~1.5× größer, wirkte „klebt“.
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10,
                  0.11,
                  12,
                  0.14,
                  14,
                  0.2,
                  16,
                  0.28,
                  18,
                  0.36,
                ],
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <SymbolLayer
              id="places-icon-transit-local"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.transitLocal.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'transitLocal',
                ] as never
              }
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
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <SymbolLayer
              id="places-icon-highlight"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.highlight.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'highlight',
                ] as never
              }
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
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'gastroTop',
                ] as never
              }
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
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'everyday',
                ] as never
              }
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
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'gastro',
                ] as never
              }
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
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'micro',
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14.8,
                  0.16,
                  16.5,
                  0.28,
                  18,
                  0.36,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            {/* WC / Wasserspender: weißer Halo + Icon — rund um Bahnhöfe gut sichtbar */}
            <CircleLayer
              id="places-icon-micro-white-halo"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.microWhite.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'microWhite',
                ] as never
              }
              style={{
                circleColor: '#FFFFFF',
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  13.8,
                  9,
                  16,
                  12,
                  18,
                  15,
                ],
                circleOpacity: 0.95,
                circleStrokeWidth: 1.2,
                circleStrokeColor: '#1A3D32',
              }}
            />
            <SymbolLayer
              id="places-icon-micro-white"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.microWhite.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'microWhite',
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  13.8,
                  0.18,
                  16,
                  0.3,
                  18,
                  0.38,
                ],
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
            <SymbolLayer
              id="places-icon-micro-close"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.microClose.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'microClose',
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  15.0,
                  0.18,
                  16.8,
                  0.28,
                  18,
                  0.36,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-micro-clinic"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.microClinic.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'microClinic',
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  16.2,
                  0.2,
                  17.2,
                  0.3,
                  18.2,
                  0.38,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
            <SymbolLayer
              id="places-icon-park"
              minZoomLevel={HOME_MAP_ICON_LOD_ZOOM.park.goneAt}
              filter={
                [
                  '==',
                  ['get', 'kind'],
                  'park',
                ] as never
              }
              style={{
                iconImage: ['get', 'iconImg'],
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14.5,
                  0.14,
                  16.5,
                  0.26,
                  18,
                  0.34,
                ],
                iconAllowOverlap: false,
                iconIgnorePlacement: false,
              }}
            />
          </ShapeSource>
          </MapLayerGate>
          <MapLayerGate group="places-dot">
          {/* Unsichtbarer Hit für Nicht-Fill-Pack-Pins (Basemap-Label sichtbar). */}
          <ShapeSource
            id="places-hit"
            shape={placeFc.hits}
            onPress={onPlacePress}
            hitbox={{ width: 56, height: 56 }}
          >
            <CircleLayer
              id="places-hit-target"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              filter={placeVisFilter as never}
              style={{
                circleColor: '#FFFFFF',
                circleRadius: 14,
                circleOpacity: 0,
                circleStrokeWidth: 0,
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="places-dot"
            shape={placeFc.dots}
            onPress={onPlacePress}
            hitbox={{ width: 52, height: 52 }}
          >
            <CircleLayer
              id="places-dot-halo"
              minZoomLevel={HOME_MAP_DETAIL_FADE.goneAt}
              filter={placeVisFilter as never}
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
              filter={placeVisFilter as never}
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
          </MapLayerGate>
          {/* Route: solid blau; goldener Garmin-Pfeil; unter Straßennamen wenn Vector. */}
          <ShapeSource
            id="route-ahead"
            key={`route-ahead-${routeBelowStreetLabelId ?? 'x'}`}
            shape={routeFc.ahead}
          >
            <LineLayer
              id="route-ahead-casing"
              {...(routeBelowStreetLabelId
                ? { belowLayerID: routeBelowStreetLabelId }
                : {})}
              style={{
                lineColor: HOME_MAP_ROUTE_AHEAD_CASING,
                lineWidth: 7,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="route-ahead-line"
              {...(routeBelowStreetLabelId
                ? { belowLayerID: routeBelowStreetLabelId }
                : {})}
              style={{
                lineColor: HOME_MAP_ROUTE_AHEAD,
                lineWidth: 4.2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
          <ShapeSource
            id="route-current"
            key={`route-current-${routePreview ? 'p' : 'l'}-${routeBelowStreetLabelId ?? 'x'}`}
            shape={routeFc.current}
          >
            <LineLayer
              id="route-casing"
              {...(routeBelowStreetLabelId
                ? { belowLayerID: routeBelowStreetLabelId }
                : {})}
              style={{
                lineColor: routePreview
                  ? HOME_MAP_ROUTE_PREVIEW_CASING
                  : HOME_MAP_ROUTE_LINE_CASING,
                lineWidth: routePreview ? 5 : 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routePreview ? 0.7 : 1,
                ...(routePreview
                  ? { lineDasharray: [2, 1.4] }
                  : { lineDasharray: [1, 0] }),
              }}
            />
            <LineLayer
              id="route-line"
              {...(routeBelowStreetLabelId
                ? { belowLayerID: routeBelowStreetLabelId }
                : {})}
              style={{
                lineColor: routePreview
                  ? HOME_MAP_ROUTE_PREVIEW
                  : HOME_MAP_ROUTE_LINE,
                // Live immer durchgezogen wie die lila Folgeroute — nie Stricheln.
                lineWidth: routePreview ? 3.4 : 5,
                lineCap: 'round',
                lineJoin: 'round',
                lineOpacity: routePreview ? 0.92 : 1,
                ...(routePreview
                  ? { lineDasharray: [2, 1.4] }
                  : { lineDasharray: [1, 0] }),
              }}
            />
          </ShapeSource>
          {!routePreview && (props.route?.turnBands?.length ?? 0) > 0 ? (
            <ShapeSource
              id="route-turn-shafts"
              key={`route-turn-shafts-${routeBelowStreetLabelId ?? 'x'}`}
              shape={routeFc.turnBands}
            >
              {/* Goldener Shaft — schlängelt auf der Route um die Ecke (Garmin). */}
              <LineLayer
                id="route-turn-shaft-casing"
                {...(routeBelowStreetLabelId
                  ? { belowLayerID: routeBelowStreetLabelId }
                  : {})}
                style={{
                  lineColor: HOME_MAP_ROUTE_PREVIEW_CASING,
                  lineWidth: 5.5,
                  lineCap: 'butt',
                  lineJoin: 'round',
                  lineOpacity: 1,
                }}
              />
              <LineLayer
                id="route-turn-shaft"
                {...(routeBelowStreetLabelId
                  ? { belowLayerID: routeBelowStreetLabelId }
                  : {})}
                style={{
                  lineColor: HOME_MAP_ROUTE_PREVIEW,
                  lineWidth: 3.6,
                  lineCap: 'butt',
                  lineJoin: 'round',
                  lineOpacity: 1,
                }}
              />
            </ShapeSource>
          ) : null}
          {!routePreview && (routeFc.turnHeads.features.length ?? 0) > 0 ? (
            <ShapeSource
              id="route-turn-heads"
              key={`route-turn-heads-${routeBelowStreetLabelId ?? 'x'}`}
              shape={routeFc.turnHeads}
            >
              {/* Ausgefüllter goldener Pfeilkopf (valides Dreieck-Polygon). */}
              <FillLayer
                id="route-turn-head-fill"
                {...(routeBelowStreetLabelId
                  ? { belowLayerID: routeBelowStreetLabelId }
                  : {})}
                style={{
                  fillColor: HOME_MAP_ROUTE_PREVIEW,
                  fillOpacity: 1,
                  fillOutlineColor: HOME_MAP_ROUTE_PREVIEW_CASING,
                }}
              />
            </ShapeSource>
          ) : null}
          {!routePreview && (props.route?.arrows?.length ?? 0) > 0 ? (
            <ShapeSource
              id="route-arrows"
              key={`route-flow-${routeBelowStreetLabelId ?? 'x'}`}
              shape={routeFc.arrows}
            >
              {/* Kleine Flow-Chevrons in der blauen Linie (Garmin >>). */}
              <SymbolLayer
                id="route-chevrons-far"
                minZoomLevel={13.8}
                maxZoomLevel={14.55}
                {...(routeBelowStreetLabelId
                  ? { belowLayerID: routeBelowStreetLabelId }
                  : {})}
                filter={['==', ['get', 'lod'], 'lo']}
                style={{
                  iconImage: 'route-chevron',
                  iconSize: 0.28,
                  iconRotate: ['to-number', ['coalesce', ['get', 'bearing'], 0]],
                  iconRotationAlignment: 'map',
                  iconPitchAlignment: 'map',
                  iconAllowOverlap: false,
                  iconIgnorePlacement: false,
                  iconAnchor: 'center',
                }}
              />
              <SymbolLayer
                id="route-chevrons-near"
                minZoomLevel={14.5}
                {...(routeBelowStreetLabelId
                  ? { belowLayerID: routeBelowStreetLabelId }
                  : {})}
                filter={['==', ['get', 'lod'], 'hi']}
                style={{
                  iconImage: 'route-chevron',
                  iconSize: 0.36,
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
          <MapLayerGate group="extract">
            {/* Straßennamen ganz oben über Route/Pfeil — unter Pins. */}
            <ShapeSource id="extract-road-names" shape={geo.roads}>
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
          </MapLayerGate>
          <ShapeSource id="route-pins" shape={routeFc.pins} onPress={onPlacePress} hitbox={{ width: 52, height: 52 }}>
            {/* Kein weißer Kreis unter Pins — nur Hit-Target (unsichtbar). */}
            <CircleLayer
              id="route-pins-halo"
              style={{
                circleColor: '#FFFFFF',
                circleRadius: 14,
                circleOpacity: 0,
                circleStrokeWidth: 0,
              }}
            />
            <SymbolLayer
              id="route-pins-icon"
              style={{
                iconImage: ['coalesce', ['get', 'icon'], 'route-pin-now'],
                iconSize: 0.52,
                iconAnchor: 'bottom',
                iconOffset: [0, 2],
                iconOpacity: 0,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </ShapeSource>
          {routeChipMarkers}
          {routePinMarkers}
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
          <ShapeSource id="gps-arrow" shape={puckFc.arrow} ref={gpsArrowRef}>
            <SymbolLayer
              id="gps-arrow-icon"
              style={{
                iconImage: 'user-arrow',
                iconOpacity: 1,
                // Rauszoomen: kleiner (sonst dominiert der Pfeil die Übersicht).
                // Straßen-Zoom ≈ 0.5 (wie früher „perfekt“).
                iconSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6,
                  0.22,
                  9,
                  0.28,
                  11,
                  0.34,
                  13,
                  0.42,
                  15,
                  0.5,
                  17,
                  0.54,
                ],
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
        {/* Ein GPS-Pfeil (ShapeSource) — Fixierung = Kamera gleitet auf GPS, kein zweites Overlay. */}
        {props.chromeDim ? <View style={styles.dim} pointerEvents="none" /> : null}
      </View>
    );
  }),
  nativeMapPropsEqual,
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HOME_MAP_BG },
  map: { flex: 1, backgroundColor: HOME_MAP_BG },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(0,0,0,${HOME_MAP_CHROME_DIM})`,
  },
  // Inhaltshuggend — MarkerView darf den Chip nicht auf volle Breite ziehen.
  navChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 200,
    backgroundColor: '#0C100E',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 4,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  navChipWrap: {
    paddingTop: 14,
    alignItems: 'center',
  },
  navChipBody: {
    flexShrink: 1,
    maxWidth: 160,
    paddingRight: 2,
  },
  navPinMarker: {
    width: 36,
    height: 44,
    resizeMode: 'contain',
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
    marginTop: 1,
    lineHeight: 14,
  },
  navChipClose: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navChipCloseText: {
    color: '#F2F5F3',
    fontSize: 14,
    lineHeight: 16,
    opacity: 0.75,
  },
});
