export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  id?: string;
  createdAt?: number;
}

export type PoiKind = 'area' | 'approach' | 'sub' | 'legacy';

export interface Poi {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  /** Stable pack spot id (parent for approach/sub). */
  spot_key?: string | null;
  parent_poi_id?: number | null;
  kind?: PoiKind | null;
  category?: string | null;
  tags_json?: string | null;
  polygon_json?: string | null;
  teaser_text?: string | null;
  condition_rule?: string | null;
  special_radius_m?: number | null;
}

export interface Fact {
  id: number;
  poi_id: number;
  fact_text: string;
}

export interface PoiWithFacts extends Poi {
  facts: Fact[];
}
