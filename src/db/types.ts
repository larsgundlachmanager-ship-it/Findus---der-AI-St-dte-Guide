export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  id?: string;
  createdAt?: number;
}

export interface Poi {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
}

export interface Fact {
  id: number;
  poi_id: number;
  fact_text: string;
}

export interface PoiWithFacts extends Poi {
  facts: Fact[];
}
