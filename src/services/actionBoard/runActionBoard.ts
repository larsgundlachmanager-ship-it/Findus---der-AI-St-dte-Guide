/**
 * ActionBoard Orchestrator — Speech fertig → Fastline → Deep nachreichen.
 */

import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { prioritizeQuickActions } from '../affiliate/prioritizeActions';
import { extractActionEntities } from './entityBind';
import { scanOpportunities } from './opportunityScan';
import { buildFastline } from './fastline';
import { queueDeepRecharge } from './deepRecharge';
import type { ActionBoardInput, ActionBoardResult } from './types';
import { PRESERVED_ACTION_TYPES } from './types';

let lastDeepAbort: AbortController | null = null;

export function abortActionBoardDeep(): void {
  lastDeepAbort?.abort();
  lastDeepAbort = null;
}

export function runActionBoard(input: ActionBoardInput): ActionBoardResult {
  const seed = input.seedActions ?? [];
  const seedHasGroundedNav = seed.some(
    (a) =>
      a.type === 'START_NAVIGATION' &&
      typeof a.payload.destLat === 'number' &&
      typeof a.payload.destLng === 'number',
  );
  const seedHasUrl = seed.some(
    (a) => a.type === 'OPEN_URL' && Boolean(a.payload.url),
  );

  const entities =
    input.entities?.length
      ? input.entities
      : input.module1
        ? [
            {
              name: input.module1.name,
              rank: 1 as const,
              lat: input.module1.lat,
              lng: input.module1.lng,
              websiteUrl: input.module1.websiteUrl,
              category: input.module1.hotel
                ? 'hotel'
                : input.module1.activity
                  ? 'attraction'
                  : input.module1.category,
              poiId: input.module1.poiId,
            },
          ]
        : // Kein Speech-Mining wenn schon echte Nav/URL-Seeds da sind
          seedHasGroundedNav || seedHasUrl
          ? []
          : extractActionEntities(input.speechText, input.userText);

  const opportunities = scanOpportunities({
    speechText: input.speechText,
    userText: input.userText,
    entities,
    module1: input.module1,
  });

  const { actions, deepJobs } = buildFastline({
    input: { ...input, entities },
    opportunities,
    entities,
  });

  const capped = prioritizeQuickActions(actions, {
    maxActions: input.maxActions ?? 4,
  });

  return { actions: capped, deepJobs, opportunities };
}

/**
 * Wendet ActionBoard auf eine Concierge-Response an.
 * LLM-quickActions werden als Seed gefiltert — System-Types bleiben.
 */
export function applyActionBoardToResponse(
  response: GeminiConciergeResponse,
  opts?: {
    userText?: string;
    cardId?: string;
    startDeep?: boolean;
    entities?: ActionBoardInput['entities'];
    module1?: ActionBoardInput['module1'];
  },
): { response: GeminiConciergeResponse; deepJobs: ActionBoardResult['deepJobs'] } {
  const seed = response.quickActions ?? [];
  const preserved = seed.filter((a) => PRESERVED_ACTION_TYPES.has(a.type));
  const hints = seed.filter(
    (a) =>
      !PRESERVED_ACTION_TYPES.has(a.type) &&
      ((a.type === 'START_NAVIGATION' &&
        typeof a.payload.destLat === 'number') ||
        (a.type === 'OPEN_URL' &&
          a.payload.url &&
          !/koche|peiner/i.test(a.label)) ||
        a.type === 'BOOK_STAY22'),
  );

  const board = runActionBoard({
    speechText: response.speechText,
    userText: opts?.userText,
    seedActions: [...preserved, ...hints],
    entities: opts?.entities,
    module1: opts?.module1,
    cardId: opts?.cardId,
  });

  if (opts?.startDeep !== false && board.deepJobs.length > 0) {
    abortActionBoardDeep();
    lastDeepAbort = queueDeepRecharge({
      jobs: board.deepJobs,
      cardId: opts?.cardId,
    });
  }

  return {
    response: {
      ...response,
      quickActions: board.actions,
    },
    deepJobs: board.deepJobs,
  };
}

/** Deep nach Card-Mount starten (Audio läuft bereits). */
export function startActionBoardDeep(opts: {
  jobs: ActionBoardResult['deepJobs'];
  cardId?: string;
}): void {
  if (!opts.jobs.length) return;
  abortActionBoardDeep();
  lastDeepAbort = queueDeepRecharge({
    jobs: opts.jobs,
    cardId: opts.cardId,
  });
}

/** Modul-2 / Live-Card: nur Actions neu bauen. */
export function rebuildActionsWithBoard(
  speechText: string,
  seed: QuickAction[],
  opts?: {
    userText?: string;
    cardId?: string;
    startDeep?: boolean;
    entities?: ActionBoardInput['entities'];
    module1?: ActionBoardInput['module1'];
  },
): QuickAction[] {
  const result = applyActionBoardToResponse(
    {
      speechText,
      visualBullets: [],
      quickActions: seed,
    },
    opts,
  );
  return result.response.quickActions;
}
