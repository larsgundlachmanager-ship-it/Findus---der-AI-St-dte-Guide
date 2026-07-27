/**
 * Reiches Geo-Modell für City-Packs (Polygon / Approach / Sub-POI).
 * Runtime-SQLite speichert eine abgeflachte Variante (siehe db/types).
 */

export type GeoLatLng = {
  latitude: number;
  longitude: number;
};

export type TriggerConditionRule =
  | 'user_preference_match'
  | 'always'
  | 'soft_pitch_ok'
  | 'tide_low';

export type PoiTriggerKind = 'area' | 'approach' | 'sub' | 'legacy';

export type ApproachTrigger = {
  id: string;
  latitude: number;
  longitude: number;
  /** Typisch 25–40 m an Kreuzungen / Sichtachsen. */
  radiusMeters: number;
  /** Navigations-Teaser, keine Hauptstory. */
  teaserText: string;
  conditionRule?: TriggerConditionRule;
};

export type SubPoi = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Typisch 8–15 m vor Mikro-Highlights. */
  radiusMeters: number;
  factDetails: string;
  tags?: string[];
};

export type PlaceFactMatrix = {
  origin?: string;
  architecture?: string;
  now?: string;
  famousPersonConnected?: string;
  tags: string[];
};

export type PlaceSpot = {
  id: string;
  name: string;
  category: string;
  polygonCoordinates?: GeoLatLng[];
  approachTriggers?: ApproachTrigger[];
  subPois?: SubPoi[];
  facts: PlaceFactMatrix;
};

export type MealSlot = 'fruehstueck' | 'mittag' | 'kaffee' | 'abendessen' | 'none';

export type TriggerPolicyDecision =
  | { action: 'skip'; reason: string }
  | { action: 'soft_pitch'; reason: string; pitchText: string }
  | { action: 'full'; reason: string };
