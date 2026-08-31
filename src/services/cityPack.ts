import type { RemoteFact, RemotePoi } from './supabase';
import type { GeoLatLng, PoiTriggerKind } from '../types/poiGeo';
import { serializePolygon, serializePolygonRings } from './geo/polygon';
import { clearNavWaypointsRegistry, setNavWaypointsForSpot } from './navigation/navWaypointsRegistry';
import {
  clearTransitStationRegistry,
  setTransitPackConfig,
  type PackTransitConfig,
} from './transit/stationRegistry';
import {
  clearMobilityPackConfig,
  setMobilityPackConfig,
  type PackMobilityConfig,
} from './mobility/mobilityRegistry';
import {
  clearLiveResearchPackConfig,
  setLiveResearchPackConfig,
  type PackLiveResearchPrompt,
} from './research/liveResearchRegistry';
import {
  clearOfflineQaPackConfig,
  setOfflineQaPackConfig,
  type PackOfflineQa,
} from './research/offlineQaRegistry';
import { registerCoverageBoundsFromPack } from './discovery/cityCoverageBounds';
import {
  APPROACH_STORY_MIN_M,
  AREA_STORY_MIN_M,
  isStoryTriggerPoi,
} from './geo/triggerRadius';

type PlaceFactsPack = {
  origin?: string;
  architecture?: string;
  now?: string;
  famousPersonConnected?: string;
  tags?: string[];
};

type ApproachPack = {
  id: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  radius_m?: number;
  radiusMeters?: number;
  teaser_text?: string;
  teaserText?: string;
  condition_rule?: string;
  conditionRule?: string;
};

type SubPoiPack = {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  radius_m?: number;
  radiusMeters?: number;
  fact_details?: string;
  factDetails?: string;
  tags?: string[];
};

type CitySpot = {
  id?: string;
  name: string;
  district?: string;
  category?: string;
  bullets?: string[];
  tags?: string[];
  facts?: PlaceFactsPack;
  /** story = Trigger/Narration; directory = Offline-Katalog ohne Wegweiser-Spam */
  pack_role?: 'story' | 'directory' | string;
  place_tier?: number;
  relevance?: string[];
  polygon?: Array<{ lat: number; lng: number } | GeoLatLng>;
  polygonCoordinates?: GeoLatLng[];
  /** Mehrere OSM-Ringe (z. B. zwei Bahnsteige) — Karte zeichnet alle. */
  polygonRings?: GeoLatLng[][];
  approach_triggers?: ApproachPack[];
  approachTriggers?: ApproachPack[];
  sub_pois?: SubPoiPack[];
  subPois?: SubPoiPack[];
  /**
   * Buchungs-IDs / URL (Touristen Stage A).
   * Werden als Tags `ot:` / `qd:` / `rm:` / `booking_url:` in SQLite geschrieben.
   */
  booking?: {
    openTableId?: string;
    quandooId?: string;
    resmioId?: string;
    url?: string;
  };
  openTableId?: string;
  quandooId?: string;
  resmioId?: string;
  bookingUrl?: string;
  booking_url?: string;
  /** Baked Smart Compass waypoints (Phase 1 routing UI). */
  nav_waypoints?: Array<{
    lat: number;
    lng: number;
    maneuver?: string;
    roadName?: string;
    road_name?: string;
    landmark?: string;
    cue?: string;
    instruction?: string;
  }>;
  navWaypoints?: Array<{ lat: number; lng: number }>;
};

type DeepDataEntry =
  | { text: string; tags?: string[] }
  | [string, string[]?]
  | string;

type CityTriggerPoint = {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  radius_m?: number;
  special_radius_m?: number;
  general_info?: string;
  deep_data_pool?: DeepDataEntry[];
  trigger_kind?: PoiTriggerKind;
  trigger_type?: string;
  parent_id?: string;
  polygon?: Array<{ lat: number; lng: number } | GeoLatLng>;
  teaser_text?: string;
  condition_rule?: string;
};

export type CityPackLink = {
  id: string;
  title: string;
  url: string;
  provider?: string;
  description?: string;
  tags?: string[];
};

export type CityPackCoverage = {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  /** Optional [lat,lng][] Stadtgrenze für Stempelkarte */
  polygon?: Array<[number, number]>;
};

export type CityPack = {
  city_id: string;
  name?: string;
  data_version?: number;
  symbol?: string;
  lat?: number;
  lng?: number;
  /**
   * Stadtauswahl-Hero (HTTPS, z. B. Supabase staedte/covers oder Wikimedia).
   * Hat Vorrang vor optionalen lokalen Fallbacks in cityCovers.ts.
   */
  cover_url?: string;
  district_division?: string[];
  spots: CitySpot[];
  trigger_points: CityTriggerPoint[];
  /** Offizielle Hilfs-Links (Ortsplan, Webcam, …) — UI, nicht Story-Fakten. */
  _links?: CityPackLink[];
  /** Quellen-URLs aus dem Pack-Build (Website/Events) — für Action-Buttons. */
  _meta?: {
    sources?: string[];
    scan_date?: string;
    data_version?: number;
    cover_url?: string;
    [key: string]: unknown;
  };
  /** ÖPNV: Haltestellen + Verbund-/GTFS-Config. */
  _transit?: PackTransitConfig;
  /** Bike-Share / Parking. */
  _mobility?: PackMobilityConfig;
  /**
   * Ephemeral Live-Research-Prompts (Preise, Speisekarten, heutige Events, Hotels).
   * Nie als feste Pack-Fakten speichern — App sucht zur Laufzeit frisch.
   */
  _live_research?: PackLiveResearchPrompt[];
  /**
   * Stadt-Fläche für Stempelkarte / „% erkundet“ / „in dieser Stadt“.
   * Nicht dasselbe wie POI-Polygone.
   */
  _coverage?: CityPackCoverage;
  /** Stadtweite Offline-Fragen/Antworten (Infrastruktur, Katalog-Zusammenfassungen). */
  _offline_qa?: PackOfflineQa[];
  /** UI-Zahlen: Story vs Directory vs Gesamt. */
  _pack_index?: {
    total?: number;
    story?: number;
    directory?: number;
    offline_qa?: number;
    note?: string;
  };
};

const BULLET_PREFIX = /^[➔➤►]\s*/u;

function cleanFactText(text: string): string {
  return text.replace(BULLET_PREFIX, '').trim();
}

function normalizeDeepEntry(
  entry: DeepDataEntry,
): { text: string; tags: string[] } | null {
  if (typeof entry === 'string') {
    const text = cleanFactText(entry);
    return text ? { text, tags: [] } : null;
  }
  if (Array.isArray(entry)) {
    const text = cleanFactText(String(entry[0] ?? ''));
    if (!text) return null;
    const tags = Array.isArray(entry[1])
      ? entry[1].map(String).filter(Boolean)
      : [];
    return { text, tags };
  }
  const text = cleanFactText(entry.text ?? '');
  if (!text) return null;
  return { text, tags: (entry.tags ?? []).map(String).filter(Boolean) };
}

function toGeoLatLng(
  p: { lat?: number; lng?: number; latitude?: number; longitude?: number },
): GeoLatLng | null {
  const latitude = p.latitude ?? p.lat;
  const longitude = p.longitude ?? p.lng;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return { latitude, longitude };
}

function normalizePolygon(
  raw?: Array<{ lat?: number; lng?: number; latitude?: number; longitude?: number }>,
): GeoLatLng[] | null {
  if (!raw || raw.length < 3) return null;
  const out: GeoLatLng[] = [];
  for (const p of raw) {
    const g = toGeoLatLng(p);
    if (g) out.push(g);
  }
  return out.length >= 3 ? out : null;
}

function centroidOf(polygon: GeoLatLng[]): { lat: number; lng: number } {
  const lat =
    polygon.reduce((s, p) => s + p.latitude, 0) / polygon.length;
  const lng =
    polygon.reduce((s, p) => s + p.longitude, 0) / polygon.length;
  return { lat, lng };
}

function collectTags(spot: CitySpot): string[] {
  const tags = new Set<string>();
  for (const t of spot.tags ?? []) tags.add(String(t).toLowerCase());
  for (const t of spot.facts?.tags ?? []) tags.add(String(t).toLowerCase());
  if (spot.category) tags.add(spot.category.toLowerCase());
  if (spot.pack_role) tags.add(String(spot.pack_role).toLowerCase());
  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);
  if (
    spot.pack_role === 'directory' ||
    Number(spot.place_tier) === 4
  ) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
  if (spot.facts?.famousPersonConnected) {
    tags.add('promi');
    tags.add(`famous:${spot.facts.famousPersonConnected}`);
  }

  const ot =
    spot.booking?.openTableId?.trim() || spot.openTableId?.trim() || '';
  const qd = spot.booking?.quandooId?.trim() || spot.quandooId?.trim() || '';
  const rm = spot.booking?.resmioId?.trim() || spot.resmioId?.trim() || '';
  const bookUrl =
    spot.booking?.url?.trim() ||
    spot.bookingUrl?.trim() ||
    spot.booking_url?.trim() ||
    '';
  if (ot) {
    tags.add('opentable');
    tags.add(`ot:${ot}`);
  }
  if (qd) {
    tags.add('quandoo');
    tags.add(`qd:${qd}`);
  }
  if (rm) {
    tags.add('resmio');
    tags.add(`rm:${rm}`);
  }
  if (bookUrl && /^https?:\/\//i.test(bookUrl)) {
    tags.add(`booking_url:${bookUrl}`);
  }

  return [...tags];
}

/**
 * Mappt ein Stadt-JSON aus dem Storage-Bucket `staedte` auf
 * typisierte POI-/Fakten-Zeilen für SQLite + Recherche.
 *
 * Prefix-Konvention:
 * - [Kurzfakt]  – bullets / fact matrix
 * - [Erzählung] – general_info
 * - [Thema:tag] – deep_data_pool
 * - [Detail]    – deep_data ohne Tag / Sub-Details
 * - [Teaser]    – Approach-Wegweiser
 *
 * Pro Spot: 1 Area (+ optional Polygon) + N Approaches + N Subs.
 */
export function mapCityPackToRemote(
  pack: CityPack,
): { pois: RemotePoi[]; facts: RemoteFact[] } {
  clearNavWaypointsRegistry();
  clearTransitStationRegistry();
  clearMobilityPackConfig();
  clearLiveResearchPackConfig();
  clearOfflineQaPackConfig();
  if (pack._transit) setTransitPackConfig(pack._transit);
  if (pack._mobility) setMobilityPackConfig(pack._mobility);
  if (pack._live_research?.length) {
    setLiveResearchPackConfig(pack._live_research);
  }
  if (pack._offline_qa?.length) {
    setOfflineQaPackConfig(pack._offline_qa);
  }
  if (pack._coverage) {
    registerCoverageBoundsFromPack({
      cityId: pack.city_id,
      name: pack.name,
      latMin: pack._coverage.latMin,
      latMax: pack._coverage.latMax,
      lngMin: pack._coverage.lngMin,
      lngMax: pack._coverage.lngMax,
      polygon: pack._coverage.polygon,
    });
    // Straßennetz einmal cachen (Homescreen-Karte offline) — fire-and-forget
    void import('./homeMap/mapRoadsCache').then((m) =>
      m.ensureCityMapRoads(pack.city_id),
    );
  }
  const triggers = pack.trigger_points ?? [];
  const triggerById = new Map(triggers.map((tp) => [tp.id, tp]));
  const triggersByName = new Map<string, CityTriggerPoint[]>();
  for (const tp of triggers) {
    const key = (tp.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = triggersByName.get(key) ?? [];
    list.push(tp);
    triggersByName.set(key, list);
  }

  const pois: RemotePoi[] = [];
  const facts: RemoteFact[] = [];
  let factId = 1;
  let nextPoiId = 1;
  const usedTriggerIds = new Set<string>();
  const spotKeyToAreaId = new Map<string, number>();

  const pushFact = (poiId: number, prefixed: string, seen: Set<string>) => {
    const key = prefixed.toLowerCase();
    if (!prefixed || seen.has(key)) return;
    seen.add(key);
    facts.push({ id: factId++, poi_id: poiId, fact_text: prefixed });
  };

  const pushMatrixFacts = (
    poiId: number,
    spot: CitySpot,
    seen: Set<string>,
  ) => {
    const m = spot.facts;
    if (!m) return;
    if (m.origin) pushFact(poiId, `[Kurzfakt] ${cleanFactText(m.origin)}`, seen);
    if (m.architecture) {
      pushFact(
        poiId,
        `[Thema:architecture] ${cleanFactText(m.architecture)}`,
        seen,
      );
    }
    if (m.now) pushFact(poiId, `[Kurzfakt] ${cleanFactText(m.now)}`, seen);
    if (m.famousPersonConnected) {
      pushFact(
        poiId,
        `[Thema:celebs_and_stories] ${cleanFactText(m.famousPersonConnected)}`,
        seen,
      );
    }
  };

  const pushFactsForArea = (
    poiId: number,
    spot: CitySpot,
    trigger: CityTriggerPoint,
    relatedTriggers: CityTriggerPoint[],
  ) => {
    const seen = new Set<string>();
    for (const bullet of spot.bullets ?? []) {
      const text = cleanFactText(bullet);
      if (text) pushFact(poiId, `[Kurzfakt] ${text}`, seen);
    }
    pushMatrixFacts(poiId, spot, seen);

    for (const tp of relatedTriggers.length > 0 ? relatedTriggers : [trigger]) {
      // Nur Area-/Legacy-Trigger-Fakten am Area-POI (nicht approach/sub rows)
      if (tp.trigger_kind === 'approach' || tp.trigger_kind === 'sub') continue;
      const general = cleanFactText(tp.general_info ?? '');
      if (general) pushFact(poiId, `[Erzählung] ${general}`, seen);

      for (const raw of tp.deep_data_pool ?? []) {
        const entry = normalizeDeepEntry(raw);
        if (!entry) continue;
        if (entry.tags.length === 0) {
          pushFact(poiId, `[Detail] ${entry.text}`, seen);
          continue;
        }
        for (const tag of entry.tags) {
          pushFact(poiId, `[Thema:${tag}] ${entry.text}`, seen);
        }
      }
    }
  };

  const resolveTrigger = (spot: CitySpot): CityTriggerPoint | undefined => {
    if (spot.id && triggerById.has(spot.id)) {
      return triggerById.get(spot.id);
    }
    const byName = triggersByName.get(spot.name.trim().toLowerCase());
    return byName?.find(
      (t) => typeof t.lat === 'number' && typeof t.lng === 'number',
    );
  };

  const emitApproachAndSubs = (
    spot: CitySpot,
    areaPoiId: number,
    spotKey: string,
    tags: string[],
    category: string | null,
  ) => {
    const approaches =
      spot.approach_triggers ?? spot.approachTriggers ?? [];
    for (const a of approaches) {
      const lat = a.latitude ?? a.lat;
      const lng = a.longitude ?? a.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const teaser = cleanFactText(a.teaserText ?? a.teaser_text ?? '');
      const id = nextPoiId++;
      const tagsJson = JSON.stringify(tags);
      const storyApproach = isStoryTriggerPoi(tagsJson);
      const rawApproachR = a.radiusMeters ?? a.radius_m ?? 35;
      pois.push({
        id,
        name: `${spot.name} · Wegweiser`,
        lat,
        lng,
        radius_meters: storyApproach
          ? Math.max(rawApproachR, APPROACH_STORY_MIN_M)
          : rawApproachR,
        spot_key: spotKey,
        parent_poi_id: areaPoiId,
        kind: 'approach',
        category,
        tags_json: tagsJson,
        polygon_json: null,
        teaser_text: teaser || null,
        condition_rule: a.conditionRule ?? a.condition_rule ?? 'always',
        special_radius_m: null,
      });
      if (teaser) {
        facts.push({
          id: factId++,
          poi_id: id,
          fact_text: `[Teaser] ${teaser}`,
        });
      }
    }

    const subs = spot.sub_pois ?? spot.subPois ?? [];
    for (const s of subs) {
      const lat = s.latitude ?? s.lat;
      const lng = s.longitude ?? s.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const detail = cleanFactText(s.factDetails ?? s.fact_details ?? '');
      const id = nextPoiId++;
      const subTags = [
        ...tags,
        ...(s.tags ?? []).map((t) => String(t).toLowerCase()),
      ];
      pois.push({
        id,
        name: s.name,
        lat,
        lng,
        radius_meters: s.radiusMeters ?? s.radius_m ?? 12,
        spot_key: s.id || `${spotKey}__${s.name}`,
        parent_poi_id: areaPoiId,
        kind: 'sub',
        category,
        tags_json: JSON.stringify(subTags),
        polygon_json: null,
        teaser_text: null,
        condition_rule: 'always',
        special_radius_m: null,
      });
      if (detail) {
        facts.push({
          id: factId++,
          poi_id: id,
          fact_text: `[Detail] ${detail}`,
        });
      }
    }
  };

  for (const spot of pack.spots ?? []) {
    const trigger = resolveTrigger(spot);
    const extraRings = (spot.polygonRings ?? [])
      .map((r) => normalizePolygon(r as GeoLatLng[]))
      .filter((r): r is GeoLatLng[] => !!r && r.length >= 2);
    const polygon =
      extraRings[0] ??
      normalizePolygon(spot.polygonCoordinates) ??
      normalizePolygon(spot.polygon) ??
      (trigger ? normalizePolygon(trigger.polygon) : null);
    const mapRings =
      extraRings.length >= 2
        ? extraRings
        : polygon
          ? [polygon]
          : [];

    let lat: number | undefined;
    let lng: number | undefined;
    // Reihenfolge: Spot-Lat → Trigger → Polygon-Zentroid → gps_entrance gewinnt zuletzt.
    if (typeof spot.lat === 'number' && typeof spot.lng === 'number') {
      lat = spot.lat;
      lng = spot.lng;
    }
    if (typeof trigger?.lat === 'number' && typeof trigger?.lng === 'number') {
      lat = trigger.lat;
      lng = trigger.lng;
    }
    if (polygon) {
      const c = centroidOf(polygon);
      lat = lat ?? c.lat;
      lng = lng ?? c.lng;
    }
    // Nav-/Karten-Pin: gps_entrance / nav_target Sub-POI schlägt alles andere.
    const subsEarly = spot.sub_pois ?? spot.subPois ?? [];
    for (const s of subsEarly) {
      const tags = (s.tags ?? []).map((t) => String(t).toLowerCase());
      const name = String(s.name ?? '').toLowerCase();
      const isEntrance =
        tags.includes('nav_target') ||
        tags.includes('gps_entrance') ||
        /haupteingang|eingang/.test(name);
      if (!isEntrance) continue;
      const slat = s.latitude ?? s.lat;
      const slng = s.longitude ?? s.lng;
      if (typeof slat === 'number' && typeof slng === 'number') {
        lat = slat;
        lng = slng;
        break;
      }
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      console.warn(
        `[cityPack] Spot ohne Koordinaten übersprungen: ${spot.id || spot.name}`,
      );
      continue;
    }

    if (trigger) {
      const related =
        triggersByName.get(spot.name.trim().toLowerCase()) ?? [trigger];
      for (const tp of related) usedTriggerIds.add(tp.id);
      usedTriggerIds.add(trigger.id);
    }

    const spotKey = spot.id ?? spot.name;
    const tags = collectTags(spot);
    const category = spot.category ?? spot.district ?? null;
    const areaId = nextPoiId++;
    spotKeyToAreaId.set(spotKey, areaId);

    const navWps = spot.nav_waypoints ?? spot.navWaypoints ?? [];
    if (navWps.length > 0) {
      setNavWaypointsForSpot(
        spotKey,
        navWps
          .filter(
            (w) => typeof w.lat === 'number' && typeof w.lng === 'number',
          )
          .map((w) => ({
            lat: w.lat,
            lng: w.lng,
            maneuver: (w as { maneuver?: string }).maneuver ?? null,
            roadName:
              (w as { roadName?: string; road_name?: string }).roadName ??
              (w as { road_name?: string }).road_name ??
              null,
            landmark: (w as { landmark?: string }).landmark ?? null,
            cue: (w as { cue?: string }).cue ?? null,
            instruction: (w as { instruction?: string }).instruction ?? null,
            isStation:
              (w as { isStation?: boolean; is_station?: boolean }).isStation ===
                true ||
              (w as { is_station?: boolean }).is_station === true,
            stationName:
              (w as { stationName?: string; station_name?: string })
                .stationName ??
              (w as { station_name?: string }).station_name ??
              null,
          })),
      );
    }

    const kind: PoiTriggerKind = polygon ? 'area' : 'legacy';
    const tagsJson = JSON.stringify(tags);
    const storyArea = isStoryTriggerPoi(tagsJson);
    const rawAreaR = trigger?.radius_m ?? (polygon ? 40 : 80);
    pois.push({
      id: areaId,
      name: spot.name,
      lat,
      lng,
      radius_meters: storyArea ? Math.max(rawAreaR, AREA_STORY_MIN_M) : rawAreaR,
      spot_key: spotKey,
      parent_poi_id: null,
      kind,
      category,
      tags_json: tagsJson,
      polygon_json: mapRings.length
        ? serializePolygonRings(mapRings)
        : polygon
          ? serializePolygon(polygon)
          : null,
      teaser_text: null,
      condition_rule: trigger?.condition_rule ?? 'always',
      special_radius_m: trigger?.special_radius_m ?? null,
    });

    if (trigger) {
      const related =
        triggersByName.get(spot.name.trim().toLowerCase()) ?? [trigger];
      pushFactsForArea(areaId, spot, trigger, related);
    } else {
      const seen = new Set<string>();
      for (const bullet of spot.bullets ?? []) {
        const text = cleanFactText(bullet);
        if (text) pushFact(areaId, `[Kurzfakt] ${text}`, seen);
      }
      pushMatrixFacts(areaId, spot, seen);
    }

    emitApproachAndSubs(spot, areaId, spotKey, tags, category);
  }

  // Explizite approach/sub trigger_points ohne Spot-Einbettung
  for (const tp of triggers) {
    if (usedTriggerIds.has(tp.id)) continue;
    if (typeof tp.lat !== 'number' || typeof tp.lng !== 'number') continue;

    const kind: PoiTriggerKind =
      tp.trigger_kind ??
      (tp.trigger_type === 'polygon' ? 'area' : 'legacy');

    if (kind === 'approach' || kind === 'sub') {
      const parentKey = tp.parent_id ?? null;
      const parentId = parentKey ? spotKeyToAreaId.get(parentKey) ?? null : null;
      const id = nextPoiId++;
      const polygon = normalizePolygon(tp.polygon);
      pois.push({
        id,
        name: tp.name ?? tp.id,
        lat: tp.lat,
        lng: tp.lng,
        radius_meters: tp.radius_m ?? (kind === 'sub' ? 12 : 35),
        spot_key: tp.id,
        parent_poi_id: parentId,
        kind,
        category: null,
        tags_json: null,
        polygon_json: polygon ? serializePolygon(polygon) : null,
        teaser_text: tp.teaser_text ?? null,
        condition_rule: tp.condition_rule ?? 'always',
        special_radius_m: tp.special_radius_m ?? null,
      });
      if (tp.teaser_text) {
        facts.push({
          id: factId++,
          poi_id: id,
          fact_text: `[Teaser] ${cleanFactText(tp.teaser_text)}`,
        });
      }
      if (tp.general_info) {
        facts.push({
          id: factId++,
          poi_id: id,
          fact_text: `[Erzählung] ${cleanFactText(tp.general_info)}`,
        });
      }
      usedTriggerIds.add(tp.id);
      continue;
    }

    // Legacy leftover trigger without spot
    const id = nextPoiId++;
    const polygon = normalizePolygon(tp.polygon);
    pois.push({
      id,
      name: tp.name ?? tp.id,
      lat: tp.lat,
      lng: tp.lng,
      radius_meters: tp.radius_m ?? 80,
      spot_key: tp.id,
      parent_poi_id: null,
      kind: polygon ? 'area' : 'legacy',
      category: null,
      tags_json: null,
      polygon_json: polygon ? serializePolygon(polygon) : null,
      teaser_text: null,
      condition_rule: tp.condition_rule ?? 'always',
      special_radius_m: tp.special_radius_m ?? null,
    });
    const seen = new Set<string>();
    if (tp.general_info) {
      pushFact(id, `[Erzählung] ${cleanFactText(tp.general_info)}`, seen);
    }
    for (const raw of tp.deep_data_pool ?? []) {
      const entry = normalizeDeepEntry(raw);
      if (!entry) continue;
      if (entry.tags.length === 0) {
        pushFact(id, `[Detail] ${entry.text}`, seen);
      } else {
        for (const tag of entry.tags) {
          pushFact(id, `[Thema:${tag}] ${entry.text}`, seen);
        }
      }
    }
    usedTriggerIds.add(tp.id);
  }

  return { pois, facts };
}
