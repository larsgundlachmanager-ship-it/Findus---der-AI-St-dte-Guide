/**
 * Call-1 Parallel-Work — Research/Pitch/Timeline/Wecker/Suche/Geocode
 * fire-and-forget. Nie auf Speech warten. Call-1-TTS und Worker gleichzeitig.
 */

type EarlyJustDoItHit = {
  kind: string;
  speech: string;
  bullets: string[];
  quickActions: unknown[];
  cardTitle: string;
} | null;

let lastKickKey = '';
let justDoItKick: { key: string; p: Promise<EarlyJustDoItHit> } | null = null;

export function takeEarlyJustDoItKick(
  text: string,
): Promise<EarlyJustDoItHit> | null {
  const key = (text || '').replace(/\s+/g, ' ').trim();
  if (!key || !justDoItKick) return null;
  if (justDoItKick.key === key) return justDoItKick.p;
  return null;
}

export function kickCall1ParallelWork(opts: {
  userText: string;
  rewritten?: string | null;
}): void {
  const raw = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const rewritten = (opts.rewritten || raw).replace(/\s+/g, ' ').trim();
  if (raw.length < 2 && rewritten.length < 2) return;
  const key = rewritten || raw;
  if (key === lastKickKey) return;
  lastKickKey = key;

  let family = 'unknown';
  try {
    const { classifyUtteranceFamily } = require('../../module2/kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    family = classifyUtteranceFamily(raw || rewritten).family;
  } catch {
    family = 'unknown';
  }

  // Sofort — nicht hinter setTimeout: Wecker/Timer/Erinnerung, Wetter,
  // Web-Suche, Events, Pitch-Loading, Timeline.
  kickImmediateWorkers({ raw, rewritten, family });

  // Yield once before loading geocode/navigation modules. `async` geocode still runs
  // synchronously up to its first await; on a cold bundle that work used to delay
  // the Call-1 TTS hook and starve the UI frame that acknowledged the request.
  setTimeout(() => {
    kickNavPrefetch(raw, rewritten, family);
  }, 0);
}

function kickImmediateWorkers(opts: {
  raw: string;
  rewritten: string;
  family: string;
}): void {
  const { raw, rewritten, family } = opts;
  const text = rewritten || raw;

  if (family === 'weather') {
    try {
      const { ensureWeatherFresh } = require('../weatherService') as {
        ensureWeatherFresh: (
          reason: 'tick',
          coords?: { lat: number; lng: number } | null,
          o?: { userAsked?: boolean },
        ) => Promise<unknown>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
      };
      const gps = useGpsStore.getState();
      void ensureWeatherFresh(
        'tick',
        gps.lat != null && gps.lng != null ? { lat: gps.lat, lng: gps.lng } : null,
        { userAsked: true },
      );
    } catch {
      /* soft */
    }
  }

  // Pitch/Events: Loading + echte Suche sofort — nicht erst nach Call-1 execution.
  if (family === 'pitch') {
    try {
      const { useLivePitchStore } = require('../../module2/pitch/publishPitchUi') as {
        useLivePitchStore: {
          getState: () => { setLoading: (s: string) => void };
        };
      };
      useLivePitchStore.getState().setLoading(text.slice(0, 48));
    } catch {
      /* soft */
    }
    try {
      const { searchPlacesByText } = require('../navigation/googleMapsNav') as {
        searchPlacesByText: (o: {
          query: string;
          lat: number;
          lng: number;
        }) => Promise<unknown>;
      };
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
      };
      const gps = useGpsStore.getState();
      if (gps.lat != null && gps.lng != null) {
        void searchPlacesByText({
          query: text.slice(0, 80),
          lat: gps.lat,
          lng: gps.lng,
        });
      }
    } catch {
      /* soft */
    }
  }

  if (family === 'plan') {
    try {
      const { hydratePlanTimeline } = require('../../module2/timeline/planPersistence') as {
        hydratePlanTimeline: () => Promise<unknown>;
      };
      void hydratePlanTimeline();
    } catch {
      /* soft */
    }
  }

  let wantJustDo =
    family === 'clock' ||
    family === 'plan' ||
    /\b(wecker|timer|erinner|trag\s+(?:das|es|mir)|einplanen)\b/iu.test(text);
  if (!wantJustDo) {
    try {
      const { isTimerIntent } = require('../alarms/timerService') as {
        isTimerIntent: (s: string) => boolean;
      };
      wantJustDo = isTimerIntent(text);
    } catch {
      /* soft */
    }
  }
  if (!justDoItKick && wantJustDo) {
    const p = import('./earlyJustDoIt')
      .then((m) => m.tryEarlyJustDoIt(text))
      .catch(() => null);
    justDoItKick = { key: text, p };
  }

  let wantEvents = false;
  try {
    const { isEventResearchQuery } = require('./eventResearchService') as {
      isEventResearchQuery: (s: string) => boolean;
    };
    wantEvents = isEventResearchQuery(text);
  } catch {
    wantEvents = /\b(was\s+geht|events?|veranstaltung)\b/iu.test(text);
  }
  if (wantEvents) {
    void import('./eventResearchService')
      .then((m) => m.researchTodaysEvents(text, { force: true }))
      .catch(() => null);
  }

  let wantWeb =
    family === 'knowledge' || family === 'flight' || family === 'unknown';
  if (wantWeb) {
    try {
      const { isWebResearchQuery } = require('../research/webResearchService') as {
        isWebResearchQuery: (s: string) => boolean;
      };
      if (family === 'unknown') wantWeb = isWebResearchQuery(text);
    } catch {
      wantWeb = family !== 'unknown';
    }
  }
  if (wantWeb && text.length >= 8) {
    void import('../research/webResearchService')
      .then((m) => m.runWebResearch(text, { force: true }))
      .catch(() => null);
  }

  if (family === 'flight') {
    void import('../flights/flightTripSession')
      .then((m) => m.hydrateFlightTripSession())
      .catch(() => undefined);
  }
}

function kickNavPrefetch(
  raw: string,
  rewritten: string,
  family: string,
): void {
  if (family !== 'nav' && family !== 'unknown') return;
  try {
    const { isExplicitNavIntent } = require('../intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    const { extractStreetAddressFromUtterance } = require('../navigation/streetAddressQuery') as {
      extractStreetAddressFromUtterance: (s: string) => string | null;
    };
    const streetAddr =
      extractStreetAddressFromUtterance(rewritten) ||
      extractStreetAddressFromUtterance(raw);
    // Adresse allein = Nav-Auftrag (Hard-Dest) — Prefetch nicht hinter Verb-Gate stellen.
    if (
      isExplicitNavIntent(raw) ||
      isExplicitNavIntent(rewritten) ||
      !!streetAddr
    ) {
      const { detectHardNavOverride } = require('../navigation/hardNavOverride') as {
        detectHardNavOverride: (t: string) => string | null;
      };
      const { extractNamedDestinationLabel } = require('../concierge/canonicalDestination') as {
        extractNamedDestinationLabel: (t: string) => string | null;
      };
      const { kickInstantMapNav } = require('../navigation/navDestPrefetch') as {
        kickInstantMapNav: (o: {
          destLabel: string;
          userText?: string | null;
        }) => void;
      };
      const earlyDest =
        streetAddr ||
        detectHardNavOverride(rewritten) ||
        detectHardNavOverride(raw) ||
        extractNamedDestinationLabel(rewritten) ||
        extractNamedDestinationLabel(raw);
      let startedWithCoords = false;
      try {
        const { resolveLocalAnchor } = require('../../module2/context/shortTermContext') as {
          resolveLocalAnchor: (s: string) => {
            name: string;
            lat: number;
            lng: number;
          } | null;
        };
        const anchor =
          resolveLocalAnchor(rewritten) ||
          resolveLocalAnchor(raw) ||
          (earlyDest ? resolveLocalAnchor(earlyDest) : null);
        if (anchor) {
          const { commitHandsFreeNavStart } = require('../navigation/handsFreeNav') as {
            commitHandsFreeNavStart: (
              i: {
                name: string;
                poiId: null;
                lat: number;
                lng: number;
                userQuery?: string | null;
              },
              o?: { skipClosingGate?: boolean; skipDestVerify?: boolean },
            ) => Promise<unknown>;
          };
          startedWithCoords = true;
          void commitHandsFreeNavStart(
            {
              name: anchor.name,
              poiId: null,
              lat: anchor.lat,
              lng: anchor.lng,
              userQuery: raw || rewritten,
            },
            { skipClosingGate: true, skipDestVerify: true },
          );
        }
      } catch {
        startedWithCoords = false;
      }
      if (!startedWithCoords && earlyDest) {
        kickInstantMapNav({
          destLabel: earlyDest,
          userText: raw || rewritten,
        });
      }
    }
  } catch {
    /* soft */
  }
}
