/**
 * Brief-Builder: Wish (M5) / User-Text (M2) → PitchRequest.
 */

import { anchorCoords, readRucksackSync } from '../rucksack/rucksackStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import type { IngestOpenWish } from '../planning/planningTypes';
import {
  buildPrefSliceForPitch,
  clampBridgeWords,
  buildPitchParentBridge,
  detectPitchKind,
  parseWishesFromText,
  resolveSearchMode,
  resolveVisitAtMs,
} from './parentBrief';
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
  const kind = detectPitchKind(opts.text);
  const visitAtMs = resolveVisitAtMs(opts.text);
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
  const request: PitchRequest = {
    requestId: opts.requestId ?? `pitch_${Date.now()}`,
    title: opts.text.slice(0, 80),
    context: opts.text,
    kind,
    searchMode: effectiveSearchMode,
    visitAtMs,
    wishes: parseWishesFromText(opts.text),
    prefs: buildPrefSliceForPitch(opts.text),
    anchor: { lat: anchor.lat, lng: anchor.lng },
    cityHint: explicitCity || cityHint,
    route:
      effectiveSearchMode === 'on_route' || effectiveSearchMode === 'between_stops'
        ? route
        : null,
    landmark: null,
    uiLayout:
      opts.uiLayout ??
      (calendarOpen ? 'timeline_stack' : 'live_split'),
    bridgeAlreadySpoken: true,
    signal: opts.signal,
  };
  const bridge = clampBridgeWords(
    buildPitchParentBridge({
      searchMode: effectiveSearchMode,
      kind,
      cityBest: effectiveSearchMode === 'city_best',
    }),
  );
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
  if (wish.lat != null && wish.lng != null) {
    built.request.anchor = { lat: wish.lat, lng: wish.lng };
  }
  built.request.title = wish.title;
  built.request.context = wish.context;
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
