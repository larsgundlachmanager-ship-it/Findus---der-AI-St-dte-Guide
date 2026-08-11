/**
 * Brief-Builder: User-Text / Wish / Segment → TourRequest.
 */

import { anchorCoords, readRucksackSync } from '../rucksack/rucksackStore';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import type { IngestOpenWish } from '../planning/planningTypes';
import {
  buildPathSpec,
  buildTourParentBridge,
  buildTourPrefSlice,
  clampBridgeWords,
  detectTourMode,
  extractAreaHint,
  extractThemeFilters,
  needsDurationAsk,
  parseDistanceKm,
  parseDurationMin,
  parseHardArriveByMs,
  resolveMobility,
  resolveStartMode,
} from './parentBrief';
import type {
  TourEndAnchor,
  TourRequest,
  TourUiLayout,
} from './types';

export function buildTourRequestFromText(opts: {
  text: string;
  requestId?: string;
  uiLayout?: TourUiLayout;
  signal?: AbortSignal;
  endAnchor?: TourEndAnchor | null;
  /** Follow-up: Dauer schon geklärt */
  forceDurationMin?: number | null;
}): { request: TourRequest; bridge: string } {
  const bag = readRucksackSync();
  const anchor = anchorCoords(bag);
  const calendarOpen = usePlanCalendarUiStore.getState().calendarVisible;
  const text = opts.text.replace(/\s+/g, ' ').trim();
  const mode = detectTourMode(text) ?? 'stop_tour';
  const durationMin =
    opts.forceDurationMin ?? parseDurationMin(text);
  const distanceKm = parseDistanceKm(text);
  const hardArriveByMs = parseHardArriveByMs(text);
  const ask = needsDurationAsk({
    text,
    durationMin,
    distanceKm,
    hardArriveByMs,
  });
  const themes = extractThemeFilters(text);
  const prefs = buildTourPrefSlice(text);
  const pathSpec = mode === 'path_tour' ? buildPathSpec(text) : null;
  const startMode = resolveStartMode(text);
  const uiLayout: TourUiLayout =
    opts.uiLayout ??
    (startMode === 'now' && !calendarOpen
      ? 'start_nav_now'
      : calendarOpen
        ? 'timeline_stack'
        : 'queue_preview');

  const request: TourRequest = {
    requestId: opts.requestId ?? `tour_${Date.now()}`,
    title: text.slice(0, 80) || 'Tour',
    context: text,
    mode,
    startMode,
    startAtMs: startMode === 'now' ? Date.now() : null,
    timeBudgetMin: durationMin,
    softDurationMin: durationMin,
    hardArriveByMs,
    anchor: { lat: anchor.lat, lng: anchor.lng },
    endAnchor: opts.endAnchor ?? null,
    radiusM: mode === 'path_tour' ? null : distanceKm != null ? distanceKm * 1000 : 3000,
    areaHint: extractAreaHint(text),
    themeFilters: themes,
    categoryMust: themes,
    categoryAvoid: prefs.avoidCategories ?? [],
    mobility: resolveMobility(text),
    pathSpec,
    needsDurationAsk: ask,
    visitedExclude: !/\b(nochmal|erneut|noch\s+mal)\b/iu.test(text),
    uiLayout,
    prefs,
    cityHint: bag.cityHint ?? null,
    bridgeAlreadySpoken: true,
    signal: opts.signal,
  };

  const bridge = clampBridgeWords(
    buildTourParentBridge({ mode, needsDurationAsk: ask }),
  );
  return { request, bridge };
}

export function buildTourRequestFromWish(
  wish: IngestOpenWish,
  opts?: {
    signal?: AbortSignal;
    uiLayout?: TourUiLayout;
    endAnchor?: TourEndAnchor | null;
    forceDurationMin?: number | null;
  },
): { request: TourRequest; bridge: string } {
  const blob = `${wish.title} ${wish.context}`;
  const built = buildTourRequestFromText({
    text: blob,
    requestId: wish.id ?? `wish_tour_${Date.now()}`,
    uiLayout: opts?.uiLayout ?? 'timeline_stack',
    signal: opts?.signal,
    endAnchor: opts?.endAnchor,
    forceDurationMin: opts?.forceDurationMin,
  });
  built.request.title = wish.title || built.request.title;
  built.request.context = wish.context || built.request.context;
  if (wish.lat != null && wish.lng != null) {
    built.request.anchor = { lat: wish.lat, lng: wish.lng };
  }
  return built;
}

/** M5 Segment: von A nach B mit Zeitfenster füllen. */
export function buildTourRequestFromSegment(opts: {
  text?: string;
  requestId?: string;
  anchor: { lat: number; lng: number };
  endAnchor: TourEndAnchor;
  timeBudgetMin?: number | null;
  hardArriveByMs?: number | null;
  themeFilters?: string[];
  signal?: AbortSignal;
}): { request: TourRequest; bridge: string } {
  const text =
    opts.text ??
    `Tour von hier bis ${opts.endAnchor.name ?? 'Ziel'} mit Stopps unterwegs`;
  const budget =
    opts.timeBudgetMin ??
    (opts.hardArriveByMs != null
      ? Math.max(20, Math.round((opts.hardArriveByMs - Date.now()) / 60_000) - 10)
      : null);
  const ask = budget == null && opts.hardArriveByMs == null;
  const request: TourRequest = {
    requestId: opts.requestId ?? `seg_${Date.now()}`,
    title: text.slice(0, 80),
    context: text,
    mode: 'stop_tour',
    startMode: 'now',
    startAtMs: Date.now(),
    timeBudgetMin: budget,
    softDurationMin: budget,
    hardArriveByMs: opts.hardArriveByMs ?? null,
    anchor: opts.anchor,
    endAnchor: opts.endAnchor,
    radiusM: 5000,
    areaHint: null,
    themeFilters: opts.themeFilters ?? [],
    categoryMust: opts.themeFilters ?? [],
    categoryAvoid: [],
    mobility: 'transit_ok',
    pathSpec: null,
    needsDurationAsk: ask,
    visitedExclude: true,
    uiLayout: 'timeline_stack',
    prefs: {},
    cityHint: null,
    bridgeAlreadySpoken: true,
    signal: opts.signal,
  };
  const bridge = clampBridgeWords(
    buildTourParentBridge({
      mode: 'stop_tour',
      needsDurationAsk: ask,
    }),
  );
  return { request, bridge };
}
