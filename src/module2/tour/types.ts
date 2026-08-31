/**
 * Tour-Modul Contract — Parent (M2/M5) liefert Brief; Tour plant/führt.
 * Keine Bridge im Modul; Parent spricht parallel.
 */

import type { QuickAction } from '../../types/concierge';

export type TourMode = 'stop_tour' | 'path_tour';

export type TourStartMode = 'now' | 'scheduled';

export type TourMobility = 'walk' | 'bike' | 'transit_ok';

export type TourUiLayout = 'timeline_stack' | 'queue_preview' | 'start_nav_now';

export type TourLatLng = { lat: number; lng: number };

export type TourEndAnchor = TourLatLng & {
  name?: string;
  poiId?: number;
};

export type TourPathSpec = {
  distanceKm?: number | null;
  durationMin?: number | null;
  loop: boolean;
};

export type TourPrefSlice = {
  avoidCategories?: string[];
  loveCategories?: string[];
  diet?: string[];
  denserStops?: boolean;
};

/** Parent → Tour */
export type TourRequest = {
  requestId: string;
  title: string;
  context: string;
  mode: TourMode;
  startMode: TourStartMode;
  startAtMs?: number | null;
  timeBudgetMin?: number | null;
  softDurationMin?: number | null;
  hardArriveByMs?: number | null;
  anchor: TourLatLng;
  endAnchor?: TourEndAnchor | null;
  radiusM?: number | null;
  areaHint?: string | null;
  themeFilters: string[];
  categoryMust: string[];
  categoryAvoid: string[];
  mobility: TourMobility;
  pathSpec?: TourPathSpec | null;
  /** true = Dauer fehlt → nachfragen, nicht planen */
  needsDurationAsk: boolean;
  visitedExclude: boolean;
  uiLayout: TourUiLayout;
  prefs: TourPrefSlice;
  cityHint?: string | null;
  bridgeAlreadySpoken?: boolean;
  signal?: AbortSignal;
  /** Plan-Tag für Timeline-Spiegel (nicht wall-clock today) */
  planDayKey?: string | null;
  /** Wunschfenster-Start für Timeline */
  preferStartMs?: number | null;
};

export type TourCandidate = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  category: string;
  tags: string[];
  distanceM: number;
  score: number;
  priority: 'must' | 'high' | 'soft';
  source: 'pack' | 'places';
  spotKey?: string | null;
};

export type TourStopPlan = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  dwellMin: number;
  priority: 'must' | 'high' | 'soft';
  /** Wegpunkt ohne Story-POI (Path-Tour) */
  waypoint?: boolean;
};

export type TourLegTransport = 'walk' | 'bike' | 'transit';

export type TourLegPlan = {
  fromName: string;
  toName: string;
  durationSec: number;
  distanceM: number;
  transport: TourLegTransport;
  /** Transit: Abfahrt / Linie */
  transitLine?: string | null;
  transitDepartAtMs?: number | null;
};

export type TourResult = {
  requestId: string;
  softFail: boolean;
  needsDurationAsk: boolean;
  spokenText: string;
  summary?: string;
  stops: TourStopPlan[];
  legs: TourLegPlan[];
  totalMin: number;
  bufferMin: number;
  attempts: number;
  uiLayout: TourUiLayout;
  actions: QuickAction[];
  bullets: string[];
};

export type TourLiveMeta = {
  requestId: string;
  hardArriveByMs: number | null;
  softDurationMin: number | null;
  bufferMin: number;
  plannedArriveByMs: number | null;
  startedAtMs: number;
  restPool: TourCandidate[];
  denserStops: boolean;
  mobility: TourMobility;
};
