/**
 * Brief-Builder: Wish (M5) / User-Text (M2) → PitchRequest.
 */

import { anchorCoords, readRucksackSync } from '../rucksack/rucksackStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import type { IngestOpenWish } from '../planning/planningTypes';
import {
  buildPrefSliceForPitch,
  detectPitchKind,
  mergeProfileDietIntoWishes,
  parseWishesFromText,
  resolveSearchMode,
  resolveVisitAtMs,
} from './parentBrief';
import { looksLikePicnicQuery } from './picnicIntent';
import type { PitchRequest, PitchRouteBrief } from './types';

function activeNavRoute(): PitchRouteBrief | null {
  try {
    const s = useFinnusStore.getState();
    if (!s.navActive) return null;
    const bag = readRucksackSync();
    const origin = anchorCoords(bag);
    const tour = s.multiStopTour;
    const stop = tour?.stops?.[tour.currentIndex ?? 0];
    if (
      stop &&
      typeof stop.lat === 'number' &&
      typeof stop.lng === 'number'
    ) {
      return {
        start: { lat: origin.lat, lng: origin.lng },
        end: { lat: stop.lat, lng: stop.lng },
        user: { lat: origin.lat, lng: origin.lng },
        polyline: null,
      };
    }
    // Echte Nav-Zielkoordinaten — kein Fake-Endpunkt (sonst „auf dem Weg“-Müll)
    try {
      const { getActiveNavDestination } = require('../../services/navigation/navigationService') as {
        getActiveNavDestination: () => {
          lat: number;
          lng: number;
          name: string;
        } | null;
      };
      const dest = getActiveNavDestination();
      if (
        dest &&
        Number.isFinite(dest.lat) &&
        Number.isFinite(dest.lng)
      ) {
        return {
          start: { lat: origin.lat, lng: origin.lng },
          end: { lat: dest.lat, lng: dest.lng },
          user: { lat: origin.lat, lng: origin.lng },
          polyline: null,
        };
      }
    } catch {
      /* soft */
    }
    return null;
  } catch {
    return null;
  }
}

export function buildPitchRequestFromText(opts: {
  text: string;
  requestId?: string;
  uiLayout?: PitchRequest['uiLayout'];
  signal?: AbortSignal;
  continueFromBridge?: string | null;
  /** Call-1 Must-Haves / authorIntent — Backend-Filter + Call-2-Brief */
  call1MustHaves?: string[] | null;
  call1Criteria?: import('./call1Criteria').Call1Criterion[] | null;
  authorIntent?: string | null;
  /** Call-1 destCity / researchCity — Anker der Äußerung */
  call1DestCity?: string | null;
  /** Call-1 when-Slots → visitAtMs */
  call1When?: Array<{
    kind?: string;
    at?: string | null;
    dateKey?: string | null;
    label?: string | null;
  }> | null;
}): { request: PitchRequest; bridge: string } {
  const bag = readRucksackSync();
  const anchor = anchorCoords(bag);
  const route = activeNavRoute();
  const calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const navActive = useFinnusStore.getState().navActive === true;
  const searchMode = resolveSearchMode({
    text: opts.text,
    hasActiveNav: navActive || Boolean(route),
    hasTimelineNext: calendarOpen,
  });
  let visitAtMs = resolveVisitAtMs(opts.text);
  try {
    const { visitAtMsFromCall1When } = require('./call1Criteria') as {
      visitAtMsFromCall1When: (
        w: typeof opts.call1When,
        n?: number,
      ) => number | null;
    };
    const fromCall1 = visitAtMsFromCall1When(opts.call1When);
    if (typeof fromCall1 === 'number' && Number.isFinite(fromCall1)) {
      visitAtMs = fromCall1;
    }
  } catch {
    /* soft */
  }
  const short = (() => {
    try {
      const { getShortTerm } = require('../context/shortTermContext') as {
        getShortTerm: () => { lastMentionedCity?: string | null };
      };
      return getShortTerm();
    } catch {
      return { lastMentionedCity: null as string | null };
    }
  })();
  const packCity = (() => {
    try {
      const id = String((bag as { cityId?: string; cityHint?: string }).cityId || '')
        .replace(/_/g, ' ')
        .trim();
      return id && !/^\d+$/.test(id) ? id : '';
    } catch {
      return '';
    }
  })();
  const explicitCity = (() => {
    try {
      const { extractCityFromText } = require('../context/shortTermContext') as {
        extractCityFromText: (s: string) => string | null;
      };
      return extractCityFromText(opts.text);
    } catch {
      return null as string | null;
    }
  })();
  const rawCity = (explicitCity || short.lastMentionedCity || packCity || '').trim();
  const cityHint =
    rawCity &&
    !/\d/.test(rawCity) &&
    !/\b(straße|strasse|weg|allee|platz|hoop|gasse)\b/i.test(rawCity)
      ? rawCity
      : packCity || null;
  // Explizite Stadt in der Frage schlägt Sticky/Pack und GPS-Anker-Label
  const effectiveSearchMode =
    explicitCity && searchMode === 'here_now' ? 'city_best' : searchMode;
  const kind = detectPitchKind(opts.text);
  const prefs = buildPrefSliceForPitch(opts.text);
  const baseWishes = mergeProfileDietIntoWishes(
    parseWishesFromText(opts.text),
    prefs,
    kind,
    opts.text,
  );
  const { buildPitchSearchBrief } = require('./searchBrief') as {
    buildPitchSearchBrief: (o: {
      userText: string;
      kind: typeof kind;
      baseWishes: typeof baseWishes;
      call1MustHaves?: string[] | null;
      call1Criteria?: import('./call1Criteria').Call1Criterion[] | null;
      authorIntent?: string | null;
    }) => {
      wishes: typeof baseWishes;
      mustHaves: string[];
      criteria: import('./call1Criteria').Call1Criterion[];
      authorIntent: string | null;
      shortlistSize: number;
    };
  };
  // Compound: Sonnenuntergang → visitAt nahe Sunset (Puffer −45 Min für Ankommen)
  if (
    /\b(sonnenuntergang|sunset)\b/iu.test(opts.text) &&
    (kind === 'food' || kind === 'bar' || kind === 'sight')
  ) {
    try {
      const { getLastWeatherSnapshot } = require('../../services/weatherService') as {
        getLastWeatherSnapshot: () => { sunsetMs?: number | null } | null;
      };
      const sunset = getLastWeatherSnapshot?.()?.sunsetMs;
      if (typeof sunset === 'number' && sunset > Date.now()) {
        visitAtMs = sunset - 45 * 60_000;
      }
    } catch {
      /* soft */
    }
  }

  const brief = buildPitchSearchBrief({
    userText: opts.text,
    kind,
    baseWishes,
    call1MustHaves: opts.call1MustHaves,
    call1Criteria: opts.call1Criteria,
    authorIntent: opts.authorIntent,
  });
  // Compound topic-cut: authorIntent markieren
  try {
    const { detectCall1Situation } = require('../reboot/pipeline/call1AnswerContract') as {
      detectCall1Situation: (t: string) => string;
    };
    if (detectCall1Situation(opts.text) === 'dining_compound' && !brief.authorIntent) {
      brief.authorIntent =
        'Compound-Abend: Gericht + Blick/Sunset — Top-2 nach Kriterien, kein alter Chat-Faden.';
    }
  } catch {
    /* soft */
  }
  const call1City = (opts.call1DestCity || '').replace(/\s+/g, ' ').trim();
  const request: PitchRequest = {
    requestId: opts.requestId ?? `pitch_${Date.now()}`,
    title: opts.text.slice(0, 80),
    context: opts.text,
    kind,
    searchMode: effectiveSearchMode,
    visitAtMs,
    wishes: brief.wishes,
    prefs,
    anchor: { lat: anchor.lat, lng: anchor.lng },
    cityHint: call1City || explicitCity || cityHint,
    route:
      effectiveSearchMode === 'on_route' || effectiveSearchMode === 'between_stops'
        ? route
        : null,
    landmark: null,
    uiLayout:
      opts.uiLayout ??
      (looksLikePicnicQuery(opts.text)
        ? 'live_split'
        : calendarOpen
          ? 'timeline_stack'
          : 'live_split'),
    bridgeAlreadySpoken: true,
    continueFromBridge: (opts.continueFromBridge || '').trim() || null,
    signal: opts.signal,
    authorIntent: brief.authorIntent,
    call1MustHaves: brief.mustHaves,
    call1Criteria: brief.criteria,
    shortlistSize: brief.shortlistSize,
  };
  const bridge = (opts.continueFromBridge || '').replace(/\s+/g, ' ').trim();
  return { request, bridge };
}

export function buildPitchRequestFromWish(
  wish: IngestOpenWish,
  opts?: { signal?: AbortSignal; uiLayout?: PitchRequest['uiLayout'] },
): { request: PitchRequest; bridge: string } {
  const blob = `${wish.title} ${wish.context}`;
  const built = buildPitchRequestFromText({
    text: blob,
    requestId: wish.id ?? `wish_${Date.now()}`,
    uiLayout: opts?.uiLayout ?? 'timeline_stack',
    signal: opts?.signal,
  });
  if (wish.estimatedTime) {
    // Uhrzeit am Plan-Tag (nicht „heute +1 wenn vorbei“)
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanDayKey();
      const m = wish.estimatedTime.match(/^(\d{1,2}):(\d{2})$/);
      if (m && dayKey) {
        const [y, mo, d] = dayKey.split('-').map(Number);
        built.request.visitAtMs = new Date(
          y!,
          mo! - 1,
          d!,
          Number(m[1]),
          Number(m[2]),
          0,
          0,
        ).getTime();
      } else {
        built.request.visitAtMs = resolveVisitAtMs(
          `um ${wish.estimatedTime} Uhr ${blob}`,
        );
      }
    } catch {
      built.request.visitAtMs = resolveVisitAtMs(
        `um ${wish.estimatedTime} Uhr ${blob}`,
      );
    }
  }
  // Abendessen ohne Uhr → ~19:00 am Plan-Tag
  if (
    !wish.estimatedTime &&
    /\b(abend|dinner|tonight|abendessen)\b/i.test(blob)
  ) {
    try {
      const dayKey =
        usePlanCalendarUiStore.getState().requestedDayKey ||
        useFuturePlanDayKey();
      if (dayKey) {
        const [y, mo, d] = dayKey.split('-').map(Number);
        built.request.visitAtMs = new Date(
          y!,
          mo! - 1,
          d!,
          19,
          0,
          0,
          0,
        ).getTime();
      }
    } catch {
      /* soft */
    }
  }
  // Planung: Stadt aus Plan/Anker — nicht GPS-Heimat (Prisdorf-Müll)
  try {
    const { extractCityFromText } = require('../context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    const { usePlanSessionStore } = require('../planning/planSessionState') as {
      usePlanSessionStore: {
        getState: () => {
          cityHint: string | null;
          plan: {
            destinationCity?: string | null;
            geoAnchor?: { name?: string } | null;
          } | null;
        };
      };
    };
    const session = usePlanSessionStore.getState();
    const planCity =
      extractCityFromText(blob) ||
      session.plan?.destinationCity ||
      session.cityHint ||
      null;
    if (
      planCity &&
      (built.request.kind === 'food' ||
        built.request.kind === 'bar' ||
        built.request.kind === 'hotel' ||
        opts?.uiLayout === 'timeline_stack')
    ) {
      built.request.searchMode = 'city_best';
      built.request.cityHint = planCity;
    }
  } catch {
    /* soft */
  }
  // Freier Slot + Anker (vorheriger Stop) vor dem Pitch
  try {
    const dayKey =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      useFuturePlanDayKey();
    if (dayKey && opts?.uiLayout === 'timeline_stack') {
      const {
        dayBoundsMs,
        findFreeSlotStartMs,
        hardIntervalsFromStops,
      } = require('../planning/planHardLock') as typeof import('../planning/planHardLock');
      const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
        useFuturePlanStore: {
          getState: () => {
            getPlanForDay: (k: string) => { stops: unknown[] };
          };
        };
      };
      const bounds = dayBoundsMs(dayKey);
      const dayStops = useFuturePlanStore.getState().getPlanForDay(dayKey).stops;
      const stayMs =
        (built.request.kind === 'food' ? 75 : 45) * 60_000;
      const free = findFreeSlotStartMs({
        preferredStartMs: built.request.visitAtMs,
        durationMs: stayMs,
        hardIntervals: hardIntervalsFromStops(dayStops as never),
        dayStartMs: bounds.start,
        dayEndMs: bounds.end,
        nowFloorMs:
          dayKey ===
          (() => {
            try {
              const { todayDateKey } = require('../../utils/dateKeys') as {
                todayDateKey: () => string;
              };
              return todayDateKey();
            } catch {
              return '';
            }
          })()
            ? Date.now() + 20 * 60_000
            : bounds.start,
      });
      if (free != null) built.request.visitAtMs = free;
    }
  } catch {
    /* soft */
  }
  if (wish.lat != null && wish.lng != null) {
    built.request.anchor = { lat: wish.lat, lng: wish.lng };
  }
  built.request.title = wish.title;
  built.request.context = wish.context;
  try {
    const { looksLikeLandmarkPitchText } = require('../planning/planWalkOrder') as {
      looksLikeLandmarkPitchText: (s: string) => boolean;
    };
    if (looksLikeLandmarkPitchText(wish.title) || looksLikeLandmarkPitchText(blob)) {
      built.request.kind = 'sight';
      built.request.searchMode = 'city_best';
    }
  } catch {
    /* soft */
  }
  return built;
}

function useFuturePlanDayKey(): string | null {
  try {
    const { useFuturePlanStore } = require('../timeline/futurePlanState') as {
      useFuturePlanStore: {
        getState: () => { plan: { dayKey: string } };
      };
    };
    return useFuturePlanStore.getState().plan.dayKey;
  } catch {
    return null;
  }
}
