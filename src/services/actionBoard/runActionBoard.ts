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
  let working: ActionBoardInput = input;
  const seed = working.seedActions ?? [];
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
    working.entities?.length
      ? working.entities
      : working.module1
        ? [
            {
              name: working.module1.name,
              rank: 1 as const,
              lat: working.module1.lat,
              lng: working.module1.lng,
              websiteUrl: working.module1.websiteUrl,
              category: working.module1.hotel
                ? 'hotel'
                : working.module1.activity
                  ? 'attraction'
                  : working.module1.category,
              poiId: working.module1.poiId,
            },
          ]
        : // Kein Speech-Mining wenn schon echte Nav/URL-Seeds da sind
          seedHasGroundedNav || seedHasUrl
          ? []
          : extractActionEntities(working.speechText, working.userText);

  let opportunities = scanOpportunities({
    speechText: working.speechText,
    userText: working.userText,
    entities,
    module1: working.module1,
  });

  // Nav-Seed da / Nav-Intent: kein WLAN / totes „Mehr“ / doppelte Route
  if (seedHasGroundedNav) {
    opportunities = opportunities.filter(
      (o) =>
        o.kind !== 'wifi_place' &&
        o.kind !== 'expand' &&
        o.kind !== 'esim' &&
        o.kind !== 'route' &&
        o.kind !== 'maps',
    );
  }

  // Gesetz: Route nur ≤10 Min / explizit — sonst Maps statt START_NAV
  try {
    const { shouldSuppressNavActions } = require('../../module2/pitch/navActionPolicy') as {
      shouldSuppressNavActions: (o?: {
        visitAtMs?: number | null;
        forceSoon?: boolean;
      }) => boolean;
    };
    const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
      isExplicitNavIntent: (t: string) => boolean;
    };
    const force =
      working.forceNavActions === true ||
      isExplicitNavIntent(working.userText || '') ||
      isExplicitNavIntent(working.speechText || '');
    const suppressRoute = shouldSuppressNavActions({
      visitAtMs: working.visitAtMs ?? null,
      forceSoon: force,
    });
    if (suppressRoute) {
      opportunities = opportunities.map((o) =>
        o.kind === 'route'
          ? {
              ...o,
              kind: 'maps' as const,
              reason: 'Route unterdrückt (nicht ≤10 Min / kein Nav-Intent) → Maps',
              score: Math.min(o.score, 70),
            }
          : o,
      );
      if (working.seedActions?.length) {
        working = {
          ...working,
          seedActions: working.seedActions.filter((a) => {
            if (a.type !== 'START_NAVIGATION') return true;
            return force;
          }),
        };
      }
    }
  } catch {
    /* soft */
  }

  const { actions, deepJobs } = buildFastline({
    input: { ...working, entities },
    opportunities,
    entities,
  });

  const capped = prioritizeQuickActions(actions, {
    maxActions: working.maxActions ?? 4,
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
  const { shouldOfferExpandMore, isExpandShowMoreAction } =
    require('./opportunityScan') as typeof import('./opportunityScan');
  const hints = seed.filter(
    (a) =>
      !PRESERVED_ACTION_TYPES.has(a.type) &&
      ((a.type === 'START_NAVIGATION' &&
        typeof a.payload.destLat === 'number') ||
        (a.type === 'OPEN_URL' &&
          a.payload.url &&
          !/koche|peiner/i.test(a.label)) ||
        a.type === 'BOOK_STAY22' ||
        (a.type === 'SHOW_MORE' &&
          isExpandShowMoreAction(a) &&
          shouldOfferExpandMore({
            userText: opts?.userText,
            speechText: response.speechText,
            module1: opts?.module1,
          }))),
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
      quickActions: (() => {
        try {
          const { stripUnbackedActions } = require('../concierge/zeroFakeActions') as {
            stripUnbackedActions: (
              a: typeof board.actions,
              o?: { userText?: string; speechText?: string },
            ) => typeof board.actions;
          };
          return stripUnbackedActions(board.actions, {
            userText: opts?.userText,
            speechText: response.speechText,
          });
        } catch {
          return board.actions;
        }
      })(),
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
