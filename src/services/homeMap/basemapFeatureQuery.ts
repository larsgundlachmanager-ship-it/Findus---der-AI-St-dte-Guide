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

/** POI-/Place-Label-Layer der Basiskarte (für Screen-Tap-Auflösung). */
export function listBasemapPoiLayerIds(style: BasemapStyleLike): string[] {
  const ids: string[] = [];
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id) continue;
    const lid = id.toLowerCase();
    const isPoiLike = lid.includes('poi') || lid.includes('place');
    const isLabel = type === 'symbol' || lid.includes('label') || lid.includes('name');
    if (isPoiLike && isLabel) ids.push(id);
  }
  return ids;
}

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
): BasemapPoiHit | null {
  if (!features?.length) return null;
  let best: BasemapPoiHit | null = null;
  let bestScore = -1;
  for (const feature of features) {
    const props = featureProps(feature);
    const name = String(
      props.name ?? props['name:de'] ?? props.pmap_name ?? '',
    ).trim();
    if (name.length < 2) continue;
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
    if (dist > 48) continue;
    const score = 1000 - dist + Math.min(40, name.length);
    if (score > bestScore) {
      bestScore = score;
      best = { name, kind: kind || 'ort', lat: pt.lat, lng: pt.lng };
    }
  }
  return best;
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
