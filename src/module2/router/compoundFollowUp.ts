/**
 * Compound-Intents: Parken zuerst pitchen, danach Tour vom gewählten Spot.
 * Kein LLM-Router — harte Reihenfolge.
 */

import { isParkingSearchIntent } from '../../services/concierge/timeCareIntent';
import { parseDurationMin, wantsCityExplore } from '../tour/parentBrief';
import { shouldHandoffToTourModule } from '../tour/shouldHandoffTour';

export type PendingTourAfterPitch = {
  durationMin: number;
  context: string;
};

let pendingTour: PendingTourAfterPitch | null = null;

export function isParkingThenTour(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || !isParkingSearchIntent(t)) return false;
  return (
    wantsCityExplore(t) ||
    shouldHandoffToTourModule(t.replace(/\b(parkplatz|parken|parken)\b/giu, ' ')) ||
    /\b(tour|rundgang|erkunden|angucken|anschauen|stunden?)\b/iu.test(t)
  );
}

export function noteTourAfterParkingPitch(text: string): void {
  if (!isParkingThenTour(text)) return;
  pendingTour = {
    durationMin: parseDurationMin(text) ?? 90,
    context: text,
  };
}

export function peekTourAfterParking(): PendingTourAfterPitch | null {
  return pendingTour;
}

export function takeTourAfterParking(): PendingTourAfterPitch | null {
  const p = pendingTour;
  pendingTour = null;
  return p;
}

export async function continueTourFromPickedSpot(opts: {
  name: string;
  lat: number;
  lng: number;
}): Promise<void> {
  const pending = takeTourAfterParking();
  if (!pending) return;
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) return;

  const { buildTourRequestFromText, runTourModule } = await import('../tour');
  const { presentToUi } = await import('../pipeline/presentToUi');
  const { enqueueSpeech } = await import('../speech/speechQueue');
  const built = buildTourRequestFromText({
    text: `Tour ${pending.durationMin} Minuten durch die Stadt von ${opts.name}`,
    requestId: `tour_after_park_${Date.now()}`,
    uiLayout: 'timeline_stack',
    forceDurationMin: pending.durationMin,
  });
  built.request.anchor = { lat: opts.lat, lng: opts.lng };
  built.request.needsDurationAsk = false;
  built.request.timeBudgetMin = pending.durationMin;
  built.request.softDurationMin = pending.durationMin;
  const result = await runTourModule(built.request);
  const tourButtons = result.actions.map((a, i) => ({
    id: a.payload.actionBoardId ?? `tour_btn_${i}`,
    label: a.label,
    payload: {
      kind: 'navigate' as const,
      lat: a.payload.destLat!,
      lng: a.payload.destLng!,
      label: a.payload.destName ?? a.label,
      multiStop: a.payload.multiStop,
    },
  }));
  await presentToUi(result.spokenText, result.bullets, tourButtons as never, {
    userText: pending.context,
    forceAutoNav: false,
  });
  if (result.spokenText.trim()) {
    enqueueSpeech({
      kind: 'main',
      text: result.spokenText,
      turnId: `tour_after_park_${Date.now()}`,
    });
  }
}
