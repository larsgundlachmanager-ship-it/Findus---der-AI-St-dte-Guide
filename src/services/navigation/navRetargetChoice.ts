/**
 * Zweit-Ziel während laufender Navigation: Route neu vs. Stopp einfügen.
 * Wortlaut ist Struktur, kein Skript — Namen kommen aus dem aktuellen Ziel.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import type { QuickActionPayload } from '../../types/concierge';
import {
  buildNavRetargetChoice,
  isSameNavTarget,
} from './navRetargetChoiceLogic';

export { buildNavRetargetChoice, isSameNavTarget } from './navRetargetChoiceLogic';

export function shouldOfferNavRetarget(next: {
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  poiId?: string | number | null;
}): boolean {
  const store = useFinnusStore.getState();
  if (!store.navActive && !store.multiStopTour?.stops?.some((s) => !s.done)) {
    return false;
  }
  let dest: {
    name: string;
    lat: number;
    lng: number;
    poiId: number;
  } | null = null;
  try {
    const { getActiveNavDestination } = require('./navigationService') as {
      getActiveNavDestination: () => {
        name: string;
        lat: number;
        lng: number;
        poiId: number;
      } | null;
    };
    dest = getActiveNavDestination();
  } catch {
    dest = null;
  }
  const tourStops = (store.multiStopTour?.stops ?? []).filter((s) => !s.done);
  const tourDest = tourStops.find((s) => s.role === 'dest') ?? tourStops[tourStops.length - 1];
  if (tourDest && isSameNavTarget(tourDest, next)) return false;
  if (tourStops.some((s) => isSameNavTarget(s, next))) return false;
  if (!dest) return false;
  const nextName = (next.name ?? '').trim();
  const hasCoords =
    typeof next.lat === 'number' &&
    typeof next.lng === 'number' &&
    Number.isFinite(next.lat) &&
    Number.isFinite(next.lng);
  const poiOk =
    typeof next.poiId === 'number' && next.poiId >= 0
      ? true
      : typeof next.poiId === 'string' && /^\d+$/.test(next.poiId.trim());
  if (!nextName && !hasCoords && !poiOk) {
    return false;
  }
  return !isSameNavTarget(dest, next);
}

export function presentNavRetargetChoice(
  payload: QuickActionPayload,
  opts?: { speak?: boolean },
): { speech: string } {
  const built = buildNavRetargetChoice(payload);
  try {
    useFinnusStore.getState().setNavRouteLoading(false);
    useFinnusStore.getState().setActiveConciergeCard({
      id: `nav-retarget-${Date.now()}`,
      createdAtMs: Date.now(),
      cardTitle: 'Route oder Stopp',
      speechText: built.speech,
      visualBullets: built.bullets,
      quickActions: built.actions,
    });
  } catch {
    /* soft */
  }
  if (opts?.speak !== false) {
    try {
      const { speakAssistantText } = require('../ttsService') as {
        speakAssistantText: (t: string) => Promise<void>;
      };
      void speakAssistantText(built.speech).catch(() => undefined);
    } catch {
      /* soft */
    }
  }
  return { speech: built.speech };
}
