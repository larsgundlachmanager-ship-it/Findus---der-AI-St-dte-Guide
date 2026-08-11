/**
 * Tour Speech + Actions + UI Publish.
 */

import type { QuickAction } from '../../types/concierge';
import type { TourRequest, TourResult, TourStopPlan } from './types';
import { TOUR_BUFFER_MIN } from './exactValidate';
import { create } from 'zustand';
import { mirrorTourToTimeline } from './mirrorTourToTimeline';

export function buildTourSpeech(opts: {
  req: TourRequest;
  stops: TourStopPlan[];
  totalMin: number;
  softFail: boolean;
  needsDurationAsk: boolean;
}): string {
  if (opts.needsDurationAsk) {
    return 'Wie lange soll die Tour ungefähr dauern — eher eine halbe Stunde, eine Stunde oder länger?';
  }
  if (opts.softFail || !opts.stops.length) {
    return 'Ich finde gerade zu wenig passende Stopps für eine Tour. Sag ein Gebiet oder ein Thema — dann versuche ich es nochmal.';
  }
  const names = opts.stops
    .filter((s) => !s.waypoint)
    .map((s) => s.name)
    .slice(0, 5);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
      : names[0] ?? 'ein paar Wegpunkte';
  const mode =
    opts.req.mode === 'path_tour'
      ? 'Strecke'
      : `${opts.stops.length} Stopps`;
  const end = opts.req.endAnchor?.name
    ? ` Ende bei ${opts.req.endAnchor.name}.`
    : '';
  return `Passt — ${mode}, grob ${opts.totalMin} Minuten inkl. Puffer: ${list}.${end} ${
    opts.req.uiLayout === 'start_nav_now'
      ? 'Ich starte die Navigation — die Stopps stehen auch in deiner Timeline.'
      : 'Die Stopps sind in der Timeline — prüf den Überblick und starte die Tour, wenn du bereit bist.'
  }`;
}

export function buildTourActions(opts: {
  req: TourRequest;
  stops: TourStopPlan[];
  resultId: string;
}): QuickAction[] {
  if (!opts.stops.length) return [];
  const multiStop = opts.stops.map((s) => ({
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    poiId: s.poiId > 0 ? s.poiId : undefined,
  }));
  return [
    {
      type: 'START_NAVIGATION',
      label: 'Tour starten',
      payload: {
        destName: opts.stops[0]!.name,
        destLat: opts.stops[0]!.lat,
        destLng: opts.stops[0]!.lng,
        multiStop,
        actionBoardId: `tour_start_${opts.resultId}`,
      },
    },
  ];
}

export function buildTourBullets(
  stops: TourStopPlan[],
  totalMin: number,
): string[] {
  const bullets = stops.slice(0, 6).map((s, i) => {
    const dwell = s.dwellMin > 0 ? ` · ~${s.dwellMin} Min` : '';
    return `${i + 1}. ${s.name}${dwell}`;
  });
  bullets.push(`Gesamt ~${totalMin} Min (Puffer ${TOUR_BUFFER_MIN} Min)`);
  return bullets;
}

export type LiveTourUiState = {
  requestId: string | null;
  headline: string;
  stops: TourStopPlan[];
  spokenText: string;
  actions: QuickAction[];
  setTour: (r: TourResult) => void;
  clear: () => void;
};

export const useLiveTourStore = create<LiveTourUiState>((set) => ({
  requestId: null,
  headline: '',
  stops: [],
  spokenText: '',
  actions: [],
  setTour: (r) =>
    set({
      requestId: r.requestId,
      headline: r.summary || 'Tour',
      stops: r.stops,
      spokenText: r.spokenText,
      actions: r.actions,
    }),
  clear: () =>
    set({
      requestId: null,
      headline: '',
      stops: [],
      spokenText: '',
      actions: [],
    }),
}));

export function publishTourResult(result: TourResult, req: TourRequest): void {
  if (result.needsDurationAsk) return;
  useLiveTourStore.getState().setTour(result);

  // Immer Timeline spiegeln (auch bei Live-Nav) — Überblick + Route nachvollziehbar
  try {
    mirrorTourToTimeline(result, req);
  } catch (err) {
    console.warn('[tour] mirrorTourToTimeline failed', err);
  }
}
