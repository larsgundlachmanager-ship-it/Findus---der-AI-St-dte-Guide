/**
 * Run: npx --yes tsx src/module2/tour/tourExplore.smoke.test.ts
 */
import {
  detectTourMode,
  needsDurationAsk,
  parseDurationMin,
  wantsCityExplore,
} from './parentBrief';
import { shouldHandoffToTourModule } from './shouldHandoffTour';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const hourTour = 'dann eine Tour von ein zwei Stunden durch die Stadt';
assert(parseDurationMin(hourTour) === 90, 'ein zwei Stunden → 90 min');
assert(detectTourMode(hourTour) === 'stop_tour', 'duration+tour is stop_tour');
assert(wantsCityExplore(hourTour), 'generic tour uses city highlights');
assert(shouldHandoffToTourModule(hourTour), 'hour tour → tour module');
assert(
  !shouldHandoffToTourModule(
    'Morgen 9 Uhr los nach Hamburg frühstücken abends Pannfisch Michel und zwischendurch eine Tour',
  ),
  'Hamburg day with a tour slot is not the tour module',
);

assert(
  !shouldHandoffToTourModule(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus von denen ich die Stadt super erkunden kann',
  ),
  'parking search is not a tour',
);

assert(parseDurationMin('so schnell es geht eine Tour') === 60, 'so schnell → 60');
assert(
  detectTourMode('ich möchte Lübeck erkunden was schlägst du mir vor') ===
    'stop_tour',
  'erkunden is stop_tour',
);
assert(
  !needsDurationAsk({
    text: 'ich möchte Lübeck erkunden was schlägst du mir vor',
    durationMin: null,
    distanceKm: null,
    hardArriveByMs: null,
  }),
  'city explore never asks duration',
);
assert(!wantsCityExplore('eine Stunde joggen'), 'jog is not city explore');
assert(
  shouldHandoffToTourModule('kannst du mir bitte eine Tour raussuchen damit ich Lübeck effektiv erkunden kann'),
  'explore tour handoff',
);

console.log('tourExplore.smoke.test.ts OK');
