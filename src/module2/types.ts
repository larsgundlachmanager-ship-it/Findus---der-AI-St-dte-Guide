/**
 * Modul 2 Greenfield — Kern-Typen (Pipeline, Agents, Synthese).
 */

export type GpsPoint = {
  lat: number;
  lng: number;
  atMs: number;
  accuracyM?: number | null;
};

export type MotionVector = {
  /** Grad 0–360, null wenn unklar */
  bearingDeg: number | null;
  /** Meter zwischen letztem Segment */
  speedMps: number | null;
  label: 'north' | 'east' | 'south' | 'west' | 'unknown';
};

export type WeatherSnapshot = {
  updatedAtMs: number;
  tempC: number | null;
  feelsLikeC: number | null;
  precipProbability: number | null;
  summary: string | null;
  rainRadarHint: string | null;
};

export type ConnectivityState = {
  offline: boolean;
  checkedAtMs: number;
};

export type AgentIntent =
  | 'emergency'
  | 'gastro'
  | 'mobility'
  | 'knowledge'
  | 'planning'
  | 'booking'
  | 'umwelt'
  | 'system'
  | 'memory'
  | 'translation'
  | 'trigger'
  | 'deep_research'
  | 'smalltalk'
  | 'unknown';

export type PipelineTask = {
  id: string;
  rawText: string;
  rewrittenText: string;
  intent: AgentIntent;
  priority: number;
  /** LLM-Router: Ort/Objekt (z. B. Eisenbahnbrücke) */
  subject?: string | null;
  /** LLM-Router: Zielstadt der Frage */
  city?: string | null;
  /** Job-Contract (Classifier) */
  jobId?: string | null;
  commitment?: 'exploring' | 'committed' | 'urgent' | null;
  mustHaves?: string[];
};

export type MoneyAmount = {
  amount: number;
  currency: string;
  amountEur: number;
};

export type ActionPayload =
  | { kind: 'deep_link'; url: string; destName?: string }
  | { kind: 'dial'; phone: string }
  | {
      kind: 'navigate';
      lat: number;
      lng: number;
      label: string;
      /** Notfall: Karte/Stichpunkte nach Nav behalten */
      keepCard?: boolean;
      skipClosingGate?: boolean;
      /** Radweg-Empfehlung → Routing im Bike-Modus */
      preferBike?: boolean;
    }
  | { kind: 'ui'; action: string; data?: Record<string, unknown> }
  | { kind: 'vapi_call'; target: string }
  | {
      kind: 'book_uber';
      destLat: number;
      destLng: number;
      destName: string;
    };

export type Module2ActionButton = {
  id: string;
  /** Max 20 Zeichen inkl. Emoji; Validator kürzt */
  label: string;
  payload: ActionPayload;
};

export type AgentResult = {
  agent: AgentIntent | string;
  ok: boolean;
  /** Langer Draft (Wissen bis 3000) — UI/Rucksack */
  draftText: string;
  bullets?: string[];
  buttons?: Module2ActionButton[];
  money?: MoneyAmount[];
  error?: { code: string; message: string; retryAfterSec?: number };
  slowLane?: boolean;
  meta?: Record<string, unknown>;
};

export type LogicNodeOutput = {
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  moneyEur: MoneyAmount[];
  warnings: string[];
  offline?: boolean;
};

export type SynthesisPayload = {
  spokenChunks: string[];
  bullets: string[];
  buttons: Module2ActionButton[];
  fullDraftForUi: string;
};

export type PipelineTurnInput = {
  userText: string;
  turnId: string;
  signal?: AbortSignal;
};

export type PipelineTurnResult = {
  turnId: string;
  tasks: PipelineTask[];
  bridgingText: string | null;
  logic: LogicNodeOutput;
  synthesis: SynthesisPayload;
  deepResearchQueued: boolean;
  /** Job-Completeness (Phase A) */
  jobId?: string | null;
  jobCompletenessOk?: boolean;
};

/** Prisdorf Fallback (Tests / kein GPS) */
export const PRISDORF_FALLBACK: GpsPoint = {
  lat: 53.6799982,
  lng: 9.7606944,
  atMs: 0,
  accuracyM: null,
};
