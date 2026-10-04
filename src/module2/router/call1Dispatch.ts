/**
 * Call-1 Dispatch — einzige Weiche nach dem Manager-JSON.
 * Soft-Overrides nur als Airbag: Safety flips immer; sonst nur wenn execution fehlt.
 */

import type { ManagerAnalysis } from './types';
import { frameHasWorker, frameOwnsDayPlan, emptyTurnFrame } from './turnFrame';
import {
  detectMobilityCompoundKind,
} from './call1MobilityCompound';

export type Call1ExecutionBackend =
  | 'chat_lane'
  | 'pitch_module'
  | 'flight_advisor'
  | 'plan_module'
  | 'plan_walkthrough'
  | 'tour_module'
  | 'events_research'
  | 'nav_execute'
  | 'm1_poi'
  | 'memory'
  | 'task_fanout'
  | 'reisebuero';

const EXECUTION_VALUES: Call1ExecutionBackend[] = [
  'chat_lane',
  'pitch_module',
  'flight_advisor',
  'plan_module',
  'plan_walkthrough',
  'tour_module',
  'events_research',
  'nav_execute',
  'm1_poi',
  'memory',
  'task_fanout',
  'reisebuero',
];

export function asCall1Execution(
  raw: unknown,
): Call1ExecutionBackend | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return EXECUTION_VALUES.includes(s as Call1ExecutionBackend)
    ? (s as Call1ExecutionBackend)
    : null;
}

/** Ableitung nur aus Call-1-Output — nie aus userText.
 * Phase C: frame.work[] / tasks Worker sind SSOT; lane/route nur Fallback.
 */
export function deriveCall1Execution(
  analysis: ManagerAnalysis,
): Call1ExecutionBackend {
  const frame = analysis.frame;
  const lane = String(analysis.chatLane || 'chat');
  const route = analysis.route;
  const handoff = String(analysis.handoff || '').toLowerCase();

  if (handoff === 'reisebuero') return 'reisebuero';

  // work[] zuerst
  try {
    const { workersFromAnalysis } = require('./call1WorkOrchestrator') as {
      workersFromAnalysis: (a: ManagerAnalysis) => string[];
    };
    const { executionFromWorkers } = require('./call1CapabilityMap') as {
      executionFromWorkers: (w: string[]) => Call1ExecutionBackend;
    };
    const workers = workersFromAnalysis(analysis);
    if (workers.length) {
      const fromWork = executionFromWorkers(workers as never);
      // plan_walkthrough nur bei continue + plan
      if (
        fromWork === 'plan_module' &&
        analysis.session === 'continue' &&
        frameOwnsDayPlan(frame)
      ) {
        return 'plan_walkthrough';
      }
      return fromWork;
    }
  } catch {
    /* soft — legacy unten */
  }

  if (frameHasWorker(frame, 'flight') || analysis.jobHint === 'flight_trip') {
    return 'flight_advisor';
  }
  if (frameHasWorker(frame, 'events' as never)) return 'events_research';
  if (frameHasWorker(frame, 'tour' as never)) return 'tour_module';
  if (frameHasWorker(frame, 'place' as never)) return 'pitch_module';
  if (lane === 'nav' || frameHasWorker(frame, 'nav') || route === 'm3_nav_start') {
    return 'nav_execute';
  }
  if (
    lane === 'm1' ||
    frameHasWorker(frame, 'm1') ||
    frameHasWorker(frame, 'm1_poi' as never) ||
    route === 'm1_poi'
  ) {
    return 'm1_poi';
  }
  if (
    analysis.execution === 'plan_walkthrough' ||
    (frameOwnsDayPlan(frame) && analysis.session === 'continue')
  ) {
    return 'plan_walkthrough';
  }
  if (lane === 'plan' || frameOwnsDayPlan(frame) || route === 'm5_plan') {
    return 'plan_module';
  }
  if (lane === 'pitch' || frameHasWorker(frame, 'pitch') || frameHasWorker(frame, 'dining')) {
    return 'pitch_module';
  }
  if (
    (frameHasWorker(frame, 'hotel') || frameHasWorker(frame, 'dining')) &&
    (analysis.tasks?.length ?? 0) > 1
  ) {
    return 'task_fanout';
  }
  if (frameHasWorker(frame, 'hotel') && lane === 'pitch') {
    return 'pitch_module';
  }
  if (frameHasWorker(frame, 'weather') && lane === 'chat' && !analysis.blueprintId) {
    return 'chat_lane';
  }
  if (route === 'memory' || frameHasWorker(frame, 'memory_prefs' as never)) {
    return 'memory';
  }
  if (
    frameHasWorker(frame, 'memory_recall' as never) ||
    frameHasWorker(frame, 'deep_web' as never) ||
    frameHasWorker(frame, 'identify_nearby' as never) ||
    frameHasWorker(frame, 'map_pin' as never) ||
    frameHasWorker(frame, 'voice_settings' as never) ||
    frameHasWorker(frame, 'device_action' as never)
  ) {
    return 'task_fanout';
  }
  if (lane === 'chat' || route === 'blueprint' || route === 'smalltalk') {
    return 'chat_lane';
  }
  if (analysis.tasks?.length) return 'task_fanout';
  return 'chat_lane';
}

export function resolveCall1Execution(
  analysis: ManagerAnalysis,
): Call1ExecutionBackend {
  const explicit = asCall1Execution(analysis.execution);
  if (explicit) return explicit;
  return deriveCall1Execution(analysis);
}

export function isLocalHotelAmenityQuery(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const stay =
    /\b(hotel|hotels|unterkunft|übernacht|uebernacht|hostel|pension|airbnb|ferienwohnung)\b/iu.test(
      t,
    );
  if (!stay) return false;
  if (
    /\b(flug|fliegen|flieger|mietwagen|reisebüro|reisebuero|urlaub|kurztrip|städtetrip|staedtetrip)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(nach|in)\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-']{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-']{2,}){0,2}\b/u.test(
      t,
    ) &&
    !/\b(in\s+der\s+nähe|in\s+der\s+naehe|hier|vor\s+ort)\b/iu.test(t)
  ) {
    return false;
  }
  if (/\b(irgendwo|inspiration|wo\s+hin)\b/iu.test(t)) return false;
  return (
    /\b(pool|sauna|spa|massage|terrasse|balkon|meerblick|seeblick|frühstück|fruehstueck|all.?inclusive|wellness)\b/iu.test(
      t,
    ) ||
    /\b(\d+)\s*(€|euro)\b/iu.test(t) ||
    /\b(unter|bis|max\.?)\s*\d+/iu.test(t) ||
    /\b(freitag|samstag|sonntag|montag|dienstag|mittwoch|donnerstag|wochenende|heute|morgen)\b/iu.test(
      t,
    ) ||
    /\b(nacht|nächte|naechte|übernachtung|uebernachtung)\b/iu.test(t)
  );
}

function logCall1SoftOverride(opts: {
  before: Call1ExecutionBackend;
  after: Call1ExecutionBackend;
  reason: string;
  safety: boolean;
}): void {
  if (opts.before === opts.after) return;
  try {
    const g = globalThis as { __DEV__?: boolean };
    if (g.__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[call1_soft_override]', {
        before: opts.before,
        after: opts.after,
        reason: opts.reason,
        safety: opts.safety,
      });
    }
  } catch {
    /* soft */
  }
}

/** Frame anreichern ohne execution zu flippen. */
function enrichFrameForSoft(
  analysis: ManagerAnalysis,
  userText: string,
  hint: string,
): void {
  try {
    const frame = analysis.frame ?? emptyTurnFrame();
    const ahead = [...(frame.thinkAhead ?? [])];
    if (!ahead.some((x) => x.includes(hint.slice(0, 24)))) {
      ahead.push(hint.slice(0, 160));
    }
    analysis.frame = { ...frame, thinkAhead: ahead.slice(0, 4) };
    const must = [...(analysis.mustHaves ?? []), ...(frame.mustHaves ?? [])];
    if (/ayce|all\s*you\s*can\s*eat|kein\s+asiatisch/i.test(userText)) {
      if (!must.some((m) => /asiatisch|cuisine_not|avoid_cuisine/i.test(m))) {
        /* leave must as-is — Call-1 owns criteria */
      }
    }
  } catch {
    /* soft */
  }
}

/**
 * Session-aware Ausführung nach Call 1.
 * Safety-Flips immer; Soft-Backups nur wenn Call-1 kein gültiges execution gesetzt hat.
 */
export function finalizeCall1Execution(
  analysis: ManagerAnalysis,
  userText: string,
): Call1ExecutionBackend {
  const explicit = asCall1Execution(analysis.execution);
  const baseline = explicit ?? resolveCall1Execution(analysis);

  const apply = (
    next: Call1ExecutionBackend,
    reason: string,
    safety: boolean,
  ): Call1ExecutionBackend => {
    logCall1SoftOverride({
      before: baseline,
      after: next,
      reason,
      safety,
    });
    return next;
  };

  // ——— SAFETY (immer) ———
  // Timing / Blocker: „morgen dahin“ ≠ Nav jetzt; Taxi Flughafen ohne Flug → askBack
  try {
    const {
      isPrematureNavStart,
      detectTaxiAirportBlocker,
      applyBriefTimingToFrame,
    } = require('./call1TaskBrief') as {
      isPrematureNavStart: (s: string) => boolean;
      detectTaxiAirportBlocker: (s: string) => {
        blocked: boolean;
        askBack: string | null;
      };
      applyBriefTimingToFrame: (
        frame: ManagerAnalysis['frame'],
        text: string,
      ) => ManagerAnalysis['frame'];
    };
    analysis.frame = applyBriefTimingToFrame(analysis.frame, userText) ?? analysis.frame;
    const taxiBlock = detectTaxiAirportBlocker(userText);
    if (taxiBlock.blocked) {
      if (taxiBlock.askBack && !analysis.bridgeComplete) {
        analysis.bridgeComplete = true;
        analysis.askBack = taxiBlock.askBack;
        if (!analysis.bridge || analysis.bridge.length < 12) {
          analysis.bridge = taxiBlock.askBack;
        }
      }
      if (baseline === 'nav_execute') {
        return apply('chat_lane', 'taxi_airport_blocker', true);
      }
    }
    if (isPrematureNavStart(userText) && baseline === 'nav_execute') {
      return apply('chat_lane', 'premature_nav_later', true);
    }
  } catch {
    /* soft */
  }

  // Compose-Shapes: Fanout + ComposeRunner — kein exklusives flight/nav
  try {
    const {
      inferCall1JobShape,
      jobShapeNeedsCompose,
      jobShapeToExecutionHint,
      asCall1JobShape,
    } = require('./call1JobShape') as typeof import('./call1JobShape');
    const shape =
      (analysis.order?.jobShape
        ? asCall1JobShape(analysis.order.jobShape)
        : null) || inferCall1JobShape(userText);
    if (jobShapeNeedsCompose(shape)) {
      return apply('task_fanout', 'job_shape_compose', true);
    }
    const shapeHint = jobShapeToExecutionHint(shape);
    if (shapeHint === 'plan_module' && shape === 'schedule_write') {
      return apply('plan_module', 'schedule_write', true);
    }
    if (shape === 'place_dining' && (!explicit || baseline === 'chat_lane')) {
      return apply('pitch_module', 'job_shape_place_dining', true);
    }
    if (
      (shape === 'weather_info' ||
        shape === 'weather_rain' ||
        shape === 'weather_outfit') &&
      (!explicit || baseline === 'nav_execute' || baseline === 'pitch_module')
    ) {
      return apply('chat_lane', `job_shape_${shape}`, true);
    }
  } catch {
    /* soft */
  }

  // Hard: Flug+Taxi / Leave-by / Solo A→B → flight_advisor (schlägt JEDE andere Lane)
  try {
    const {
      blocksExploreDriftForFlight,
      isSoloFlightAbSearch,
    } = require('../../services/flights/flightTripIntent') as {
      blocksExploreDriftForFlight: (s: string) => boolean;
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(userText) || blocksExploreDriftForFlight(userText)) {
      return apply(
        'flight_advisor',
        isSoloFlightAbSearch(userText) ? 'solo_flight_ab' : 'flight_blocks_explore',
        true,
      );
    }
  } catch {
    /* soft */
  }

  // Presence-Gap: kein Explore/Pitch-Drift bevor Anreise sitzt
  try {
    const {
      blocksExploreDriftForPresenceGap,
      hasOpenSurpriseAnchor,
    } = require('./missionGapEngine') as {
      blocksExploreDriftForPresenceGap: (o: {
        userText: string;
        gpsCity?: string | null;
        researchCity?: string | null;
      }) => boolean;
      hasOpenSurpriseAnchor: (o: { userText?: string }) => boolean;
    };
    let gpsCity: string | null = null;
    try {
      const { useGpsStore } = require('../../store/useGpsStore') as {
        useGpsStore: {
          getState: () => { cityName?: string | null; city?: string | null };
        };
      };
      const g = useGpsStore.getState();
      gpsCity = g.cityName || g.city || null;
    } catch {
      /* soft */
    }
    if (
      blocksExploreDriftForPresenceGap({
        userText,
        gpsCity,
        researchCity: analysis.cityScope?.researchCity || analysis.frame?.destCity,
      }) &&
      (baseline === 'pitch_module' || baseline === 'tour_module')
    ) {
      return apply('task_fanout', 'presence_gap_blocks_explore', true);
    }
    if (
      hasOpenSurpriseAnchor({ userText }) &&
      baseline === 'pitch_module' &&
      /\b(theater|karten|ticket|vorstellung|stück|stueck)\b/iu.test(userText)
    ) {
      return apply('events_research', 'surprise_anchor_events_first', true);
    }
  } catch {
    /* soft */
  }

  try {
    const {
      isActiveNavTravelModeSwitchIntent,
    } = require('../../services/navigation/switchActiveNavTravelMode') as {
      isActiveNavTravelModeSwitchIntent: (s: string) => 'foot' | 'bike' | null;
    };
    let navLive = false;
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      navLive = Boolean(useFinnusStore.getState().navActive);
    } catch {
      navLive = false;
    }
    if (navLive) {
      const mode = isActiveNavTravelModeSwitchIntent(userText);
      if (mode === 'foot' || mode === 'bike') {
        return apply('nav_execute', 'nav_mode_switch', true);
      }
    }
  } catch {
    /* soft */
  }

  try {
    const { isStickyVenueTaskIntent } = require('../pitch/shouldHandoffPitch') as {
      isStickyVenueTaskIntent: (s: string) => boolean;
    };
    if (
      isStickyVenueTaskIntent(userText) &&
      /\b(reservier|tisch\s+(?:anfrag|buch|vorbereiten|reserv)|speisekarte|menükarte|menuekarte)\b/iu.test(
        userText,
      )
    ) {
      return apply('chat_lane', 'sticky_venue_task', true);
    }
  } catch {
    /* soft */
  }

  // Kino/Filme — nie Tour/Lauf-Tipp (Pack-FAQ „wie weit laufen“)
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|kinoticket)\b/iu.test(userText) ||
    /\bwelche\s+filme\b/iu.test(userText) ||
    (/\bfilme?\b/iu.test(userText) &&
      /\b(laufen|heute|abend|schauen|programm|ticket)\b/iu.test(userText))
  ) {
    analysis.blueprintId = 'cinema';
    analysis.blueprintStage = 'cinema_orient';
    if (baseline === 'tour_module' || baseline === 'chat_lane' || !explicit) {
      return apply('pitch_module', 'cinema_force', true);
    }
  }

  // Reines Taxi-Hail — nur wenn Call-1 kein Backend gesetzt hat (sonst SSOT ehren)
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const compound = detectMobilityCompoundKind(userText);
    if (
      !explicit &&
      wantsTaxiRide(userText) &&
      compound === 'taxi_only' &&
      !/\b(flieg(?:e|st|t)?|fliegen|flugnummer|boarding)\b/iu.test(userText)
    ) {
      return apply('task_fanout', 'taxi_hail', true);
    }
  } catch {
    /* soft */
  }

  try {
    const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
      isExplicitNavIntent: (s: string) => boolean;
    };
    if (isExplicitNavIntent(userText)) {
      try {
        const { isPrematureNavStart } = require('./call1TaskBrief') as {
          isPrematureNavStart: (s: string) => boolean;
        };
        const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
          isFindusReisebueroHandoff: (s: string) => boolean;
        };
        const { inferCall1JobShape } = require('./call1JobShape') as {
          inferCall1JobShape: (s: string) => string;
        };
        const shape = inferCall1JobShape(userText);
        if (
          isFindusReisebueroHandoff(userText) ||
          shape === 'trip_package' ||
          shape === 'place_dining' ||
          shape === 'flight_only' ||
          shape === 'weather_info' ||
          shape === 'weather_rain' ||
          shape === 'weather_outfit' ||
          shape === 'fact_lookup' ||
          shape === 'arrival_home'
        ) {
          /* Dining/Flug/RB/Wetter — Nav nicht stehlen */
        } else if (isPrematureNavStart(userText)) {
          /* morgen dahin — kein Sofort-Nav trotz Nav-Keywords */
        } else {
          return apply('nav_execute', 'explicit_nav', true);
        }
      } catch {
        return apply('nav_execute', 'explicit_nav', true);
      }
    }
  } catch {
    /* soft */
  }

  // Produkt-Angebot: nie Reisebüro/Pitch
  try {
    const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(userText)) {
      return apply('chat_lane', 'supermarket_offer', true);
    }
  } catch {
    /* soft */
  }

  // Wetter-Opener: Topic-Cut gegen Sticky Pitch/Nav
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(userText) &&
      !weatherAskWantsConversationPlace(userText) &&
      !looksLikePicnicQuery(userText)
    ) {
      return apply('chat_lane', 'weather_topic_cut', true);
    }
  } catch {
    /* soft */
  }

  // Flight Leave-by / offene Flug-Session
  try {
    const { shouldEnterFlightAdvisor } = require('../../services/flights/flightTripIntent') as {
      shouldEnterFlightAdvisor: (o: {
        userText: string;
        chatLane?: string | null;
        session?: string | null;
        jobHint?: string | null;
        intentSummary?: string | null;
        hasOpenSession?: boolean;
        flightWorker?: boolean;
      }) => boolean;
    };
    const { hasFlightTripSession } = require('../../services/flights/flightTripSession') as {
      hasFlightTripSession: () => boolean;
    };
    const { hasStickyFlightRoot } = require('../../services/flights/flightTripIntent') as {
      hasStickyFlightRoot: () => boolean;
    };
    const flightWorker =
      frameHasWorker(analysis.frame, 'flight') || analysis.jobHint === 'flight_trip';
    if (
      shouldEnterFlightAdvisor({
        userText,
        chatLane: analysis.chatLane,
        session: analysis.session,
        jobHint: analysis.jobHint,
        intentSummary: analysis.intentSummary,
        hasOpenSession: hasFlightTripSession() || hasStickyFlightRoot(),
        flightWorker,
      })
    ) {
      return apply('flight_advisor', 'flight_advisor_safety', true);
    }
  } catch {
    /* soft */
  }

  // Datum+Stadt Events vs. Reisebüro — FRAGE-ART Airbag
  try {
    const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
      looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
    };
    if (looksLikeDateWindowWhatsOnAsk(userText)) {
      return apply('events_research', 'date_window_events', true);
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeNamedScheduleQuery } = require('../../services/concierge/sportsScheduleQuery') as {
      looksLikeNamedScheduleQuery: (s: string) => boolean;
    };
    if (looksLikeNamedScheduleQuery(userText)) {
      return apply('events_research', 'named_schedule', true);
    }
  } catch {
    /* soft */
  }

  // AYCE: immer Pitch-Belts — nie Chat Soft-Fill (Goldschätzchen o. ä.)
  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    if (
      looksLikeAyceQuery(userText) &&
      (baseline === 'chat_lane' || baseline === 'task_fanout')
    ) {
      return apply('pitch_module', 'ayce_blocks_chat_safety', true);
    }
  } catch {
    /* soft */
  }

  // Mission-Find: nie inventing chat_lane — auch wenn Call-1 explizit chat sagt
  // Ausnahme: Reisebüro-Collect / Full-Trip — nicht zu flight_advisor stehlen
  try {
    const { resolveMissionExecutionSoft } = require('../mission/missionFamilyRouting') as {
      resolveMissionExecutionSoft: (t: string) => {
        execution: Call1ExecutionBackend | null;
        family: string;
      };
    };
    const soft = resolveMissionExecutionSoft(userText);
    let reisebueroOwns = false;
    try {
      const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
        detectCall1Situation: (t: string) => string;
      };
      const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
        isFindusReisebueroHandoff: (t: string) => boolean;
      };
      const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
        isSoloFlightAbSearch: (t: string) => boolean;
      };
      reisebueroOwns =
        !isSoloFlightAbSearch(userText) &&
        (detectCall1Situation(userText) === 'reisebuero_collect' ||
          isFindusReisebueroHandoff(userText));
    } catch {
      /* soft */
    }
    if (
      soft.execution &&
      soft.execution !== 'chat_lane' &&
      baseline === 'chat_lane' &&
      !(reisebueroOwns && soft.execution === 'flight_advisor')
    ) {
      return apply(
        soft.execution,
        `mission_${soft.family}_blocks_chat_safety`,
        true,
      );
    }
  } catch {
    /* soft */
  }

  // Specialty / Food-Pitch: nie inventing chat (Spaghetti-Eis o. ä.)
  try {
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const { looksLikeSpecialtyFoodAsk } = require('../pitch/specializedFoodMatch') as {
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
    };
    let reisebueroOwns = false;
    try {
      const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
        detectCall1Situation: (t: string) => string;
      };
      const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
        isFindusReisebueroHandoff: (t: string) => boolean;
      };
      const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
        isSoloFlightAbSearch: (t: string) => boolean;
      };
      reisebueroOwns =
        !isSoloFlightAbSearch(userText) &&
        (detectCall1Situation(userText) === 'reisebuero_collect' ||
          isFindusReisebueroHandoff(userText));
    } catch {
      /* soft */
    }
    const kind = detectPitchKind(userText);
    if (
      !reisebueroOwns &&
      baseline === 'chat_lane' &&
      (kind === 'food' ||
        kind === 'hotel' ||
        looksLikeSpecialtyFoodAsk(userText) ||
        /\b(spaghettieis|spaghetti[\s-]?eis|eisdiele|gelato|pannfisch|fischbrötchen|fischbroetchen|aperol|mittagsspezial\w*|heimisch\w*\s+mittag|frühstück|fruehstueck|to\s*go)\b/iu.test(
          userText,
        ))
    ) {
      return apply('pitch_module', 'food_hotel_blocks_chat_safety', true);
    }
  } catch {
    /* soft */
  }

  // ——— SOFT: nur wenn Call-1 kein execution gesetzt hat ———
  // Explicit execution = Call-1 SSOT — nur Frame anreichern, nie umbiegen.
  if (explicit) {
    if (isLocalHotelAmenityQuery(userText)) {
      enrichFrameForSoft(analysis, userText, 'local hotel amenities → Stay22 pitch preferred');
    }
    try {
      const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
        looksLikeAyceQuery: (s: string) => boolean;
      };
      if (looksLikeAyceQuery(userText)) {
        enrichFrameForSoft(analysis, userText, 'AYCE dining — pitch form preferred');
      }
    } catch {
      /* soft */
    }
    return baseline;
  }

  // Mini-Airbags nur bei fehlendem Call-1-execution
  if (isLocalHotelAmenityQuery(userText)) {
    return apply('pitch_module', 'local_hotel_soft', false);
  }

  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const { detectTaxiAirportBlocker } = require('./call1TaskBrief') as {
      detectTaxiAirportBlocker: (s: string) => { blocked: boolean };
    };
    const compound = detectMobilityCompoundKind(userText);
    if (
      wantsTaxiRide(userText) &&
      compound === 'taxi_only' &&
      !detectTaxiAirportBlocker(userText).blocked &&
      !/\b(flieg(?:e|st|t)?|fliegen|flugnummer|boarding)\b/iu.test(userText)
    ) {
      return apply('task_fanout', 'taxi_soft', false);
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    if (looksLikeAyceQuery(userText) || detectPitchKind(userText) === 'food') {
      return apply('pitch_module', 'ayce_food_soft', false);
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
      looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
    };
    if (looksLikeDateWindowWhatsOnAsk(userText)) {
      return apply('events_research', 'date_window_events_soft', false);
    }
  } catch {
    /* soft */
  }

  // Mini: Pauschal/Package-Schnelllinks → Pitch (nicht Reisebüro-Wizard, nicht Chat)
  // Demote: volle Trip-Pakete / Gap-Fill bleiben reisebuero
  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (t: string) => boolean;
    };
    if (isFindusReisebueroHandoff(userText)) {
      return apply('reisebuero', 'reisebuero_beats_package_quick', false);
    }
    if (
      /\b(pauschal|package|all[\s-]?inclusive\s+reise|check\s*24|check24)\b/iu.test(
        userText,
      ) &&
      !/\b(flug\s*\+|flug.{0,24}hotel|hotel.{0,24}flug|mietwagen|reise\s+planen|plane\s+mir|kurztrip|städtetrip|staedtetrip|messe|für\s+\d+\s+tage|tage\s+urlaub)\b/iu.test(
        userText,
      )
    ) {
      return apply('pitch_module', 'package_quick_soft', false);
    }
  } catch {
    /* soft */
  }

  // Kreuzfahrt Quick → chat_lane (Partner-Links); Paket → reisebuero
  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (t: string) => string;
    };
    const sit = detectCall1Situation(userText);
    if (sit === 'cruise_quick') {
      return apply('chat_lane', 'cruise_quick_soft', false);
    }
    if (sit === 'reisebuero_collect' && /\bkreuzfahrt\b/iu.test(userText)) {
      return apply('reisebuero', 'cruise_package_soft', false);
    }
  } catch {
    /* soft */
  }

  // Teil-Inventar / Gap-Fill → Reisebüro (auch ohne Wochenende-Wort)
  try {
    const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (t: string) => boolean;
    };
    if (isSoloFlightAbSearch(userText)) {
      return apply('flight_advisor', 'solo_flight_ab_soft', false);
    }
  } catch {
    /* soft */
  }
  try {
    const { isFindusReisebueroHandoff } = require('../../reisebuero/handoff') as {
      isFindusReisebueroHandoff: (t: string) => boolean;
    };
    if (isFindusReisebueroHandoff(userText)) {
      return apply('reisebuero', 'reisebuero_gap_fill_soft', false);
    }
  } catch {
    /* soft */
  }

  // Mini: Multi-Tag-Trip ohne Call-1-execution → reisebuero (vor Mission-Find)
  try {
    const { isSoloFlightAbSearch } = require('../../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (t: string) => boolean;
    };
    if (isSoloFlightAbSearch(userText)) {
      return apply('flight_advisor', 'solo_flight_ab_multi', false);
    }
    const multiDayTrip =
      /\b(wochenende|woche\b|urlaub|kurztrip|städtetrip|staedtetrip|flug\s*\+|flug.{0,24}hotel|hotel.{0,24}flug|mietwagen|reise\s+planen|plane\s+mir)\b/iu.test(
        userText,
      );
    if (multiDayTrip) {
      return apply('reisebuero', 'reisebuero_soft', false);
    }
  } catch {
    /* soft */
  }

  // Mini: Stay-Day / Tagesplan ohne Call-1-execution
  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (t: string, o?: { correction?: boolean }) => string;
    };
    if (detectCall1Situation(userText) === 'stay_day_interactive') {
      try {
        const { isEventResearchQuery } = require('../../services/concierge/eventResearchService') as {
          isEventResearchQuery: (s: string) => boolean;
        };
        if (isEventResearchQuery(userText)) {
          return apply('events_research', 'stay_day_events_soft', false);
        }
      } catch {
        /* soft */
      }
      return apply('plan_walkthrough', 'stay_day_soft', false);
    }
  } catch {
    /* soft */
  }

  // Mission-Familien (Phase 5): Amenity/Hotel/Events/Transit/Flight — nie Chat-Leak
  // Nur wenn Baseline noch Chat — Trip/Plan oben haben Vorrang.
  if (baseline === 'chat_lane') {
    try {
      const { resolveMissionExecutionSoft } = require('../mission/missionFamilyRouting') as {
        resolveMissionExecutionSoft: (t: string) => {
          execution: Call1ExecutionBackend | null;
          family: string;
        };
      };
      const soft = resolveMissionExecutionSoft(userText);
      if (soft.execution && soft.execution !== 'chat_lane') {
        return apply(
          soft.execution,
          `mission_${soft.family}_soft`,
          false,
        );
      }
    } catch {
      /* soft */
    }
  }

  return baseline;
}

export function shouldSpeakManagerBridge(analysis: ManagerAnalysis): boolean {
  if (analysis.bridgeSpokenEarly) return false;
  // Call-1 Bridge ist SSOT — auch bei continue/resume (SUP/Rad/Filter…).
  return Boolean(analysis.bridge?.trim());
}

export function executionUsesChatLane(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'chat_lane';
}

export function executionUsesPitchModule(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'pitch_module' || execution === 'tour_module';
}

export function executionUsesPlanModule(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'plan_module' || execution === 'plan_walkthrough';
}

export function executionUsesFlightAdvisor(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'flight_advisor';
}

export function executionUsesNav(
  execution: Call1ExecutionBackend,
): boolean {
  return execution === 'nav_execute';
}
