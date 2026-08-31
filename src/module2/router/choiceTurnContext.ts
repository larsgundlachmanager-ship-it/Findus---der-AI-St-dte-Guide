/**
 * Parent-Turn-Kontext für Tap-Fast-Path (ohne Call 1).
 */

import type { ManagerAnalysis } from './types';
import type { AgentResult } from '../types';

export type ChoiceTurnContext = {
  parentTurnId: string;
  userText: string;
  jobId: string;
  analysis: ManagerAnalysis;
  factSummary: {
    draftText: string;
    bullets: string[];
    meta?: Record<string, unknown>;
  };
  bridgeOnce: string | null;
  cityKey: string | null;
  cityHint: string | null;
  subject: string | null;
  storedAtMs: number;
};

const TTL_MS = 30 * 60_000;
const store = new Map<string, ChoiceTurnContext>();
let lastParentTurnId: string | null = null;

export function getLastParentTurnId(): string | null {
  return lastParentTurnId;
}

export function rememberChoiceTurnContext(ctx: ChoiceTurnContext): void {
  lastParentTurnId = ctx.parentTurnId;
  store.set(ctx.parentTurnId, { ...ctx, storedAtMs: Date.now() });
  if (store.size > 12) {
    const oldest = [...store.entries()].sort(
      (a, b) => a[1].storedAtMs - b[1].storedAtMs,
    )[0];
    if (oldest) store.delete(oldest[0]);
  }
}

export function getChoiceTurnContext(
  parentTurnId: string,
): ChoiceTurnContext | null {
  const hit = store.get(parentTurnId);
  if (!hit) return null;
  if (Date.now() - hit.storedAtMs > TTL_MS) {
    store.delete(parentTurnId);
    return null;
  }
  return hit;
}

export function applyChoiceInventoryPatch(
  patch: Record<string, string | number | boolean | null> | undefined,
): void {
  if (!patch || !Object.keys(patch).length) return;
  try {
    const { noteLastLiveInventory, getLastLiveInventory } = require(
      '../context/shortTermContext',
    ) as {
      noteLastLiveInventory: (q: string, k: string) => void;
      getLastLiveInventory: () => { query: string; kind: string } | null;
    };
    const live = getLastLiveInventory();
    if (live) {
      const merged = `${live.query} ${Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`.trim();
      noteLastLiveInventory(merged, live.kind);
    }
  } catch {
    /* soft */
  }

  // Flug-Gepäck-Chip: Slot sofort schließen — Timeline-Schnellantwort darf nicht offen bleiben.
  const luggageRaw = patch.luggage;
  if (luggageRaw === 'carry' || luggageRaw === 'checked') {
    try {
      const {
        getFlightTripSession,
        setFlightTripSession,
      } = require('../../services/flights/flightTripSession') as {
        getFlightTripSession: () => {
          luggage?: string;
          pendingAsk?: string | null;
          updatedAtMs?: number;
        } | null;
        setFlightTripSession: (s: unknown) => void;
      };
      const sess = getFlightTripSession();
      if (sess) {
        setFlightTripSession({
          ...sess,
          luggage: luggageRaw,
          pendingAsk: null,
          updatedAtMs: Date.now(),
        });
      }
    } catch {
      /* soft */
    }
    try {
      const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: {
          getState: () => {
            clearShortAnswers: () => void;
            clearMirroredActions: () => void;
          };
        };
      };
      const ui = usePlanCalendarUiStore.getState();
      ui.clearShortAnswers();
      ui.clearMirroredActions();
    } catch {
      /* soft */
    }
  }

  try {
    const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          setPendingChoice: (c: unknown) => void;
          pendingChoice: unknown;
        };
      };
    };
    const ui = usePlanCalendarUiStore.getState();
    if (ui.pendingChoice && patch.choice) {
      ui.setPendingChoice({
        ...(ui.pendingChoice as object),
        picked: String(patch.choice),
      });
    }
  } catch {
    /* soft */
  }
}

export type ChoiceFastPathArm = {
  parentTurnId: string;
  choiceId: string;
  label: string;
  slotKey: string;
  inventoryPatch?: Record<string, string | number | boolean | null>;
};

let armedFastPath: ChoiceFastPathArm | null = null;

export function armChoiceFastPath(input: ChoiceFastPathArm): void {
  armedFastPath = input;
}

/** Ohne zu konsumieren — Early-Bridge darf Choice-Fast nicht anstoßen. */
export function peekChoiceFastPath(): ChoiceFastPathArm | null {
  return armedFastPath;
}

export function takeChoiceFastPath(): ChoiceFastPathArm | null {
  const x = armedFastPath;
  armedFastPath = null;
  return x;
}

export function buildAnalysisFromChoice(
  arm: ChoiceFastPathArm,
  ctx: ChoiceTurnContext | null,
): ManagerAnalysis {
  if (ctx?.analysis) {
    return {
      ...ctx.analysis,
      bridge: null,
      bridgeSpokenEarly: true,
      session: 'continue',
      topicScope: {
        mode: 'followup',
        turnsForCall2: Math.min(10, (ctx.analysis.topicScope?.turnsForCall2 ?? 4) + 1),
        inheritLiveInventory: true,
      },
    };
  }
  const slotJob: Record<string, string> = {
    baggage_type: 'flight_trip',
    pitch_option: 'live_events',
    plan_fork: 'day_plan_budget',
    sup_own_vs_rent: 'activity_sport',
    generic_fork: 'smalltalk_general',
  };
  const jobHint = slotJob[arm.slotKey] || 'smalltalk_general';
  return {
    intentSummary: `Tap ${arm.slotKey}: ${arm.label}`,
    route: arm.slotKey === 'plan_fork' ? 'm5_plan' : 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'continue',
    threadMatchId: null,
    subject: arm.label,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 28,
    fastDeadlineMs: 6000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint,
    bridgeSpokenEarly: true,
    topicScope: {
      mode: 'followup',
      turnsForCall2: 4,
      inheritLiveInventory: true,
    },
    authorIntent: arm.label,
  };
}

export type ResolvedChoiceSlot = {
  slotKey: string;
  choiceId: string;
  label: string;
  inventoryPatch?: Record<string, string | number | boolean | null>;
};

/** SHOW_MORE textPrompt / Label → Tap-Fast-Path Slot (Flug-Gepäck, Pitch, …). */
export function resolveChoiceSlotFromPrompt(
  prompt: string,
  label?: string,
): ResolvedChoiceSlot | null {
  const combined = `${label || ''} ${prompt}`.trim();
  if (!combined) return null;

  if (
    /\b(aufgabegepäck|aufgepäck|checked\s*bag)\b/i.test(combined) &&
    !/\b(handgepäck|nur\s+hand)\b/i.test(combined)
  ) {
    return {
      slotKey: 'baggage_type',
      choiceId: 'checked',
      label: label?.trim() || 'Aufgabegepäck',
      inventoryPatch: { luggage: 'checked' },
    };
  }
  if (/\b(handgepäck|nur\s+hand|carry[\s-]?on)\b/i.test(combined)) {
    return {
      slotKey: 'baggage_type',
      choiceId: 'carry',
      label: label?.trim() || 'Handgepäck',
      inventoryPatch: { luggage: 'carry' },
    };
  }
  if (/\b(option\s*[12]|erste\s+option|zweite\s+option)\b/i.test(combined)) {
    const n = /2|zweit/i.test(combined) ? '2' : '1';
    return {
      slotKey: 'pitch_option',
      choiceId: `opt_${n}`,
      label: label?.trim() || `Option ${n}`,
    };
  }
  if (/\b(eigenes\s+sup|sup\s+eigen|mitbringen)\b/i.test(combined)) {
    return {
      slotKey: 'sup_own_vs_rent',
      choiceId: 'own',
      label: label?.trim() || 'Eigenes SUP',
    };
  }
  if (/\b(sup\s+verleih|leihen|mieten)\b/i.test(combined) && /\bsup\b/i.test(combined)) {
    return {
      slotKey: 'sup_own_vs_rent',
      choiceId: 'rent',
      label: label?.trim() || 'SUP-Verleih',
    };
  }
  return null;
}

export function rememberTurnForChoices(opts: {
  turnId: string;
  userText: string;
  jobId: string;
  analysis: ManagerAnalysis;
  speech?: string;
  bullets?: string[];
  cityKey?: string | null;
  cityHint?: string | null;
}): void {
  rememberChoiceTurnContext({
    parentTurnId: opts.turnId,
    userText: opts.userText,
    jobId: opts.jobId,
    analysis: opts.analysis,
    factSummary: {
      draftText: opts.speech || '',
      bullets: opts.bullets || [],
    },
    bridgeOnce: null,
    cityKey: opts.cityKey ?? null,
    cityHint: opts.cityHint ?? null,
    subject: opts.analysis.subject,
    storedAtMs: Date.now(),
  });
}
