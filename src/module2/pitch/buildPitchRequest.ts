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
    // Nav aktiv ohne Koordinaten — Parent markiert on_route trotzdem via hasActiveNav
    return {
      start: { lat: origin.lat, lng: origin.lng },
      end: {
        lat: origin.lat + 0.01,
        lng: origin.lng,
      },
      user: { lat: origin.lat, lng: origin.lng },
      polyline: null,
    };
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
  const request: PitchRequest = {
    requestId: opts.requestId ?? `pitch_${Date.now()}`,
    title: opts.text.slice(0, 80),
    context: opts.text,
    kind,
    searchMode,
    visitAtMs,
    wishes: parseWishesFromText(opts.text),
    prefs: buildPrefSliceForPitch(opts.text),
    anchor: { lat: anchor.lat, lng: anchor.lng },
    cityHint: bag.cityHint ?? null,
    route: searchMode === 'on_route' || searchMode === 'between_stops' ? route : null,
    landmark: null,
    uiLayout:
      opts.uiLayout ??
      (calendarOpen ? 'timeline_stack' : 'live_split'),
    bridgeAlreadySpoken: true,
    signal: opts.signal,
  };
  const bridge = clampBridgeWords(
    buildPitchParentBridge({
      searchMode,
      kind,
      cityBest: searchMode === 'city_best',
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
    built.request.visitAtMs = resolveVisitAtMs(`um ${wish.estimatedTime} Uhr`);
  }
  if (wish.lat != null && wish.lng != null) {
    built.request.anchor = { lat: wish.lat, lng: wish.lng };
  }
  built.request.title = wish.title;
  built.request.context = wish.context;
  return built;
}
