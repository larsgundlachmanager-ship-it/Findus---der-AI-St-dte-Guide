/**
 * Vector-Basemap Feature-Query: Gebäudeumriss unter dem Pin aus den bereits
 * gezeichneten Protomaps-Kacheln holen (MapLibre queryRenderedFeaturesAtPoint).
 * Pack-Ringe sind mit Vector-Basemap oft GPS-Boxen ohne Extract-Fallback →
 * hier snappen wir auf denselben Umriss, den die Karte schon rendert.
 */

import { approxPolygonAreaM2 } from '../geo/polygon';
import type { GeoLatLng } from '../../types/poiGeo';
import {
  findExtractBuildingUnderPin,
  type LatLngRing,
} from './extractBuildingUnderPin';

type BasemapStyleLike =
  | { layers?: unknown }
  | null
  | undefined;

function styleLayers(
  style: BasemapStyleLike,
): Array<{ id?: unknown; type?: unknown }> {
  const layers = style?.layers;
  return Array.isArray(layers) ? (layers as Array<{ id?: unknown; type?: unknown }>) : [];
}

/** Fill-Layer der Basiskarte, deren ID auf Gebäude deutet (Fallback `buildings`). */
export function listBasemapBuildingLayerIds(style: BasemapStyleLike): string[] {
  const ids: string[] = [];
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id) continue;
    if (id.toLowerCase().includes('building') && type === 'fill') {
      ids.push(id);
    }
  }
  return ids.length ? ids : ['buildings'];
}

/** POI-/Place-/Park-Label-Layer der Basiskarte (für Screen-Tap-Auflösung). */
export function listBasemapPoiLayerIds(style: BasemapStyleLike): string[] {
  const ids: string[] = [];
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id || type !== 'symbol') continue;
    const lid = id.toLowerCase();
    // Straßen-/Admin-/Hausnummern — nicht tippbar als Ort
    if (
      /housenumber|address|boundary|admin|contour|mountain_peak/.test(lid)
    ) {
      continue;
    }
    if (
      (/road|street|highway|waterway|transport|rail_label|roads_label/.test(lid) ||
        (lid.includes('label') &&
          (lid.includes('road') || lid.includes('street')))) &&
      !/poi|place|amenity|shop|brand/.test(lid)
    ) {
      continue;
    }
    // Stadt-/Ort-Labels sind oft aus — trotzdem nicht als Shop-Tap
    if (
      /^(places?_?(country|state|city|town|village|suburb|neighbourhood|neighborhood|locality)|place-(city|town|village))/.test(
        lid,
      )
    ) {
      continue;
    }
    const isPoiLike =
      lid.includes('poi') ||
      lid.includes('place') ||
      lid.includes('park') ||
      lid.includes('wood') ||
      lid.includes('forest') ||
      lid.includes('landuse') ||
      lid.includes('leisure') ||
      lid.includes('amenity') ||
      lid.includes('shop') ||
      lid.includes('brand') ||
      lid.includes('natural') ||
      // Protomaps: oft nur „pois“ / generische Symbol-Layer
      lid === 'pois' ||
      lid.startsWith('pois_') ||
      lid.includes('label');
    if (isPoiLike) ids.push(id);
  }
  return ids;
}

/**
 * Erster Straßenname-Layer der Vector-Basemap (Protomaps: `roads_labels_minor`).
 * Route darunter legen, sonst überdecken LineLayers die Namen.
 */
export function firstBasemapRoadLabelLayerId(
  style: BasemapStyleLike,
): string | null {
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id || type !== 'symbol') continue;
    const lid = id.toLowerCase();
    if (
      lid.includes('roads_labels') ||
      lid.includes('road_label') ||
      lid.includes('roads_label') ||
      (lid.includes('highway') && lid.includes('label')) ||
      (lid.includes('street') && lid.includes('label') && !lid.includes('place'))
    ) {
      return id;
    }
  }
  return null;
}

export const PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK = 'roads_labels_minor';
export const EXTRACT_ROAD_LABEL_LAYER_ID = 'extract-roads-label';

function toGeo(ring: LatLngRing): GeoLatLng[] {
  return ring.map(([latitude, longitude]) => ({ latitude, longitude }));
}

function ringFromLngLatCoords(
  coords: unknown,
): LatLngRing | null {
  if (!Array.isArray(coords) || coords.length < 3) return null;
  const out: LatLngRing = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push([lat, lng]);
  }
  return out.length >= 3 ? out : null;
}

/** GeoJSON-Feature (Polygon/MultiPolygon, lng,lat) → Ring [lat,lng]; größter Ring bei MultiPolygon. */
export function ringFromGeoJsonFeature(feature: unknown): LatLngRing | null {
  const geometry =
    feature && typeof feature === 'object'
      ? (feature as { geometry?: unknown }).geometry
      : null;
  if (!geometry || typeof geometry !== 'object') return null;
  const type = (geometry as { type?: unknown }).type;
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;

  if (type === 'Polygon') {
    return ringFromLngLatCoords(
      Array.isArray(coordinates) ? coordinates[0] : null,
    );
  }
  if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
    let best: LatLngRing | null = null;
    let bestArea = -1;
    for (const poly of coordinates) {
      const ring = ringFromLngLatCoords(Array.isArray(poly) ? poly[0] : null);
      if (!ring) continue;
      const area = approxPolygonAreaM2(toGeo(ring));
      if (Number.isFinite(area) && area > bestArea) {
        bestArea = area;
        best = ring;
      }
    }
    return best;
  }
  return null;
}

/** Ephemeres Popup für Basemap-POI ohne Pack-Treffer (Famila-Label etc.). */
export const MAP_BASEMAP_POI_ID = -3;

export type BasemapPoiHit = {
  name: string;
  kind: string;
  lat: number;
  lng: number;
};

function featureProps(feature: unknown): Record<string, unknown> {
  if (!feature || typeof feature !== 'object') return {};
  const p = (feature as { properties?: unknown }).properties;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

function featurePoint(
  feature: unknown,
  fallbackLat: number,
  fallbackLng: number,
): { lat: number; lng: number } {
  const g =
    feature && typeof feature === 'object'
      ? (feature as { geometry?: unknown }).geometry
      : null;
  if (g && typeof g === 'object' && (g as { type?: string }).type === 'Point') {
    const c = (g as { coordinates?: unknown }).coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return { lat: fallbackLat, lng: fallbackLng };
}

/**
 * Sichtbares Basemap-POI-Label unter dem Tap (Name/Kind aus Tile-Props).
 * Protomaps: name + kind/amenity/shop — keine Öffnungszeiten in den Tiles.
 */
export function pickBasemapPoiAt(
  lat: number,
  lng: number,
  features: readonly unknown[] | null | undefined,
  maxDistM = 110,
): BasemapPoiHit | null {
  if (!features?.length) return null;
  let best: BasemapPoiHit | null = null;
  let bestScore = -1;
  for (const feature of features) {
    const props = featureProps(feature);
    const name = String(
      props.name ??
        props['name:de'] ??
        props['name:en'] ??
        props.pmap_name ??
        props.brand ??
        props.operator ??
        props.ref ??
        '',
    ).trim();
    if (name.length < 2) continue;
    const kind = String(
      props.kind ??
        props.amenity ??
        props.shop ??
        props.tourism ??
        props.leisure ??
        props.railway ??
        props.brand ??
        '',
    )
      .trim()
      .toLowerCase();
    // Straßen-/Stadt-Labels überspringen
    if (
      /^(locality|neighbourhood|suburb|city|town|village|hamlet|street|road)$/i.test(
        kind,
      )
    ) {
      continue;
    }
    const pt = featurePoint(feature, lat, lng);
    const dLat = (pt.lat - lat) * 111_320;
    const dLng = (pt.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const dist = Math.hypot(dLat, dLng);
    if (dist > maxDistM) continue;
    const score = 1000 - dist + Math.min(40, name.length);
    if (score > bestScore) {
      bestScore = score;
      best = { name, kind: kind || 'ort', lat: pt.lat, lng: pt.lng };
    }
  }
  return best;
}

/** Pixel-Offsets um den Tap — Icons sind klein, ein Punkt reicht oft nicht. */
export const BASEMAP_POI_TAP_PIXEL_OFFSETS: ReadonlyArray<readonly [number, number]> =
  [
    [0, 0],
    [14, 0],
    [-14, 0],
    [0, 14],
    [0, -14],
    [10, 10],
    [-10, 10],
    [10, -10],
    [-10, -10],
  ];

/**
 * Fallback wenn Tiles Features ohne brauchbaren Namen liefern
 * (nur kind/shop) — trotzdem Popup, nicht stiller Blank.
 */
export function pickBasemapPoiKindFallback(
  lat: number,
  lng: number,
  features: readonly unknown[] | null | undefined,
): BasemapPoiHit | null {
  if (!features?.length) return null;
  for (const feature of features) {
    const props = featureProps(feature);
    const kind = String(
      props.kind ??
        props.amenity ??
        props.shop ??
        props.tourism ??
        props.leisure ??
        props.brand ??
        '',
    )
      .trim()
      .toLowerCase();
    if (
      !kind ||
      /^(locality|neighbourhood|suburb|city|town|village|hamlet|street|road)$/i.test(
        kind,
      )
    ) {
      continue;
    }
    const pt = featurePoint(feature, lat, lng);
    const label =
      kind === 'fast_food'
        ? 'Imbiss'
        : kind === 'clothes'
          ? 'Geschäft'
          : kind.replace(/_/g, ' ');
    return {
      name: label.charAt(0).toUpperCase() + label.slice(1),
      kind,
      lat: pt.lat,
      lng: pt.lng,
    };
  }
  return null;
}

/**
 * Protomaps zeichnet an diesem Punkt schon ein POI-Symbol/Label.
 * Eigenes Yorro-Icon nur, wenn das false ist.
 */
export function hasBasemapPoiSymbolNear(
  lat: number,
  lng: number,
  features: readonly unknown[] | null | undefined,
  maxM = 40,
): boolean {
  if (!features?.length) return false;
  for (const feature of features) {
    const props = featureProps(feature);
    const kind = String(
      props.kind ??
        props.amenity ??
        props.shop ??
        props.tourism ??
        props.leisure ??
        props.railway ??
        '',
    )
      .trim()
      .toLowerCase();
    if (
      /^(locality|neighbourhood|suburb|city|town|village|hamlet|street|road)$/i.test(
        kind,
      )
    ) {
      continue;
    }
    const name = String(
      props.name ?? props['name:de'] ?? props.pmap_name ?? '',
    ).trim();
    if (kind.length < 2 && name.length < 2) continue;
    const pt = featurePoint(feature, lat, lng);
    const dLat = (pt.lat - lat) * 111_320;
    const dLng = (pt.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    if (Math.hypot(dLat, dLng) <= maxM) return true;
  }
  return false;
}

/**
 * Bestes Gebäude unter dem Pin aus gerenderten Features — gleiche Heuristik wie
 * `findExtractBuildingUnderPin` (kleinstes enthaltendes, sonst nächstes ≤38 m, Fläche 12–12000).
 */
export function pickBestBuildingRingAt(
  lat: number,
  lng: number,
  features: readonly unknown[] | null | undefined,
): LatLngRing | null {
  if (!features?.length) return null;
  const rings: LatLngRing[] = [];
  for (const feature of features) {
    const ring = ringFromGeoJsonFeature(feature);
    if (ring) rings.push(ring);
  }
  return findExtractBuildingUnderPin(lat, lng, rings);
}
