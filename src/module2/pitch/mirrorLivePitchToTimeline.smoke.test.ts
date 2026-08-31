/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/mirrorLivePitchToTimeline.smoke.test.ts
 */
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { mirrorLivePitchChoiceToTimeline } from './mirrorLivePitchToTimeline';
import type { PitchOptionCard } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dayKey = '2026-08-28';
const visitAt = Date.parse(`${dayKey}T12:00:00`);

usePlanCalendarUiStore.setState({ calendarVisible: false, requestedDayKey: null });
useFuturePlanStore.getState().setPlan({
  dayKey,
  label: dayKey,
  base: { label: 'Home', kind: 'gps' },
  transportDefault: 'walk',
  stops: [],
  updatedAtMs: Date.now(),
});

const opt: PitchOptionCard = {
  id: 'opt_a',
  name: 'Restaurant Miro',
  lat: 53.55,
  lng: 9.99,
  role: 'favorite',
  speechPitch: 'Gutes Lokal.',
  bullets: ['Terrasse', 'Vegetarisch'],
  mapsUrl: 'https://maps.example/miro',
  menuUrl: 'https://example/menu',
  actions: [],
};

mirrorLivePitchChoiceToTimeline({
  requestId: 'pitch_test_1',
  option: opt,
  visitAtMs: visitAt,
  pitchKind: 'food',
  pitchContext: 'Mittagessen um 12 Uhr',
});

const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
const stop = plan.stops.find((s) => s.id === 'live_pitch_pitch_test_1');
assert(stop?.title === 'Restaurant Miro', 'stop title');
assert(stop?.plannedStartMs === visitAt, '12:00 start');
assert(stop?.status === 'planned', 'confirmed planned not pending');
assert(stop?.userFixedTime === true, 'fixed time from context');
assert(usePlanCalendarUiStore.getState().calendarVisible !== true, 'calendar stays closed');

useFuturePlanStore.getState().setPlan({
  dayKey,
  label: dayKey,
  base: { label: 'Home', kind: 'gps' },
  transportDefault: 'walk',
  stops: [],
  updatedAtMs: Date.now(),
});

console.log('mirrorLivePitchToTimeline.smoke.test.ts OK');
