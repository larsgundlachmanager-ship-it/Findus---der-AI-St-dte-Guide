/**
 * Run: npx --yes tsx src/module2/timeline/timelineNavGestures.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const handler = read('src/services/actionHandlerService.ts');
assert(
  handler.includes('preferTransit !== true') &&
    handler.includes('journeyNav !== true'),
  'ÖPNV-Wahl nicht als Nav-Retarget abfangen',
);

const pitch = read('src/module2/pitch/pitchStartNav.ts');
assert(pitch.includes('modeSwitch'), 'Fuß/ÖPNV/Rad = Moduswechsel, kein Insert');
assert(
  pitch.includes('forceStart: true') && pitch.includes('replace: true'),
  'explizite ÖPNV-Wahl startet sofort',
);
assert(
  !/addOptimizedTourStop[\s\S]{0,400}addPlanStop/.test(pitch),
  'kein doppelter Plan-Stop nach Tour-Insert',
);

const journey = read('src/services/navigation/startJourneyNavigation.ts');
assert(journey.includes('forceStart?: boolean'), 'Journey forceStart Option');
assert(
  journey.includes('opts.forceStart !== true'),
  'explizite Wahl übergeht Leave-by-Defer',
);

const tour = read('src/services/navigation/multiStopTour.ts');
assert(tour.includes('collectSoftVisitStops'), 'Plan-Besuche in Tour-Optimierung');
assert(
  tour.includes('export function applyUpcomingVisitOrder'),
  'Timeline-Drag setzt Tour-Reihenfolge',
);

const modal = read('src/components/PlanCalendarModal.tsx');
assert(modal.includes('applyUpcomingVisitOrder'), 'Drag verdrahtet');
assert(modal.includes("['transit', '🚌']"), 'ÖPNV-Chip an Live-Route');
assert(modal.includes('!isLiveNav'), 'Live-Stopps nicht per Wischen löschen');
assert(
  !modal.includes('g.dy > OPEN_ROW_H * 2.5'),
  'Offene Pläne: Drag nach unten löscht nicht',
);
assert(
  modal.includes('isCardBoundPlaceLinkAction'),
  'Maps/Speisekarte raus aus Top-Chrome',
);
assert(
  /showPlaceActions[\s\S]{0,220}!isOpenBand/.test(modal) &&
    !/showPlaceActions[\s\S]{0,220}!isChoice/.test(modal),
  'PlaceActionChips auch auf Choice-Karten',
);
assert(
  /showPlaceActions && !\(selected && accordion\)[\s\S]{0,40}<PlaceActionChips/.test(
    modal,
  ),
  'PlaceActionChips rendert bei showPlaceActions',
);

const planned = read('src/module2/timeline/plannedJourneyGroup.ts');
assert(planned.includes('gleisBadge'), 'Gleis-Badge auf geplanten Beinen');
assert(
  !planned.includes('requestOpenPlanCalendar'),
  'ÖPNV nicht automatisch Timeline aufklappen',
);

const home = read('src/services/homeMap/homeMapNavStart.ts');
assert(!home.includes('addPlanStop'), 'Map-Add ohne Timeline-Duplikat');


assert(
  modal.includes('resolveOverlapsQuietly'),
  'quiet resolve vor Konflikt-Banner',
);
assert(
  modal.includes('hasOverlapConflict = showPlanningChrome && hasTimeOverlap()') ||
    /hasOverlapConflict\s*=\s*showPlanningChrome\s*&&\s*hasTimeOverlap\(\)/.test(
      modal,
    ),
  'Banner nur bei echtem hasTimeOverlap nach quiet resolve',
);
assert(
  /tripadvisor\|opentable\|quandoo/.test(modal) ||
    modal.includes('tripadvisor|opentable|quandoo'),
  'Place-Links härter aus Top-Chrome gefiltert',
);
assert(
  modal.includes('!node.groupId') &&
    modal.includes("Echte Journey-Gruppe: kein Spinner"),
  'kein stale ? für Journey-Gruppen',
);

const gapPolicy = read('src/module2/timeline/gapFillTravelPolicy.ts');
assert(gapPolicy.includes('navLegDestKey'), 'dest-key für ÖPNV-Dedupe');
assert(
  gapPolicy.includes('pruneStaleFallbackLegsForDest'),
  'stale Fallback-Prune',
);
assert(
  gapPolicy.includes('countTravelHeadsForDest'),
  'Travel-Heads-Zähler für Smoke',
);

const helpers = read('src/module2/timeline/planTravelHelpers.ts');
assert(
  helpers.includes('pruneStaleFallbackLegsForDest'),
  'refine pruned stale fallbacks after journey',
);

console.log('timelineNavGestures.smoke.test.ts OK');
