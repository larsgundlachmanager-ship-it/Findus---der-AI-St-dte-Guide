/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/gapFillTravel.smoke.test.ts
 *
 * Node-sicher: Journey-Group + pure Gap-Fill-Policy (kein RN via travelMode/pace).
 */
import assert from 'node:assert/strict';
import { useFuturePlanStore } from './futurePlanState';
import {
  buildPlannedJourneyStops,
  replaceNavLegWithJourneyGroup,
} from './plannedJourneyGroup';
import type { JourneyItinerary } from '../../services/transit/journeyPlanner';
import {
  countOepnvNachZielTitles,
  countTravelHeadsForDest,
  isGapFillRealStop,
  mergeGapFillPlanStops,
  navLegDestKey,
  pruneStaleFallbackLegsForDest,
  shouldSkipTourInternalLeg,
} from './gapFillTravelPolicy';
import type { FuturePlanStop } from './futurePlanState';

useFuturePlanStore.getState().setPlan({
  dayKey: '2026-09-05',
  stops: [
    {
      id: 'nav_a_b',
      title: 'Fußweg nach Museum B',
      lat: 53.6835,
      lng: 9.8,
      plannedStartMs: Date.parse('2026-09-05T15:30:00'),
      plannedEndMs: Date.parse('2026-09-05T15:55:00'),
      bufferMin: 0,
      transport: 'walk',
      kind: 'nav_leg',
      status: 'planned',
      routeEstimate: 'fallback',
    },
  ],
  transportDefault: 'walk',
  vibe: null,
  base: null,
  originBase: null,
  updatedAtMs: Date.now(),
});

const itinerary = {
  startTime: new Date('2026-09-05T15:30:00'),
  endTime: new Date('2026-09-05T15:55:00'),
  durationSec: 25 * 60,
  legs: [
    {
      mode: 'WALK',
      fromName: 'Café A',
      toName: 'Haltestelle',
      startTime: new Date('2026-09-05T15:30:00'),
      endTime: new Date('2026-09-05T15:38:00'),
      durationSec: 8 * 60,
      fromLat: 53.68,
      fromLng: 9.8,
      toLat: 53.681,
      toLng: 9.801,
    },
    {
      mode: 'BUS',
      line: '185',
      headsign: 'Museum',
      fromName: 'Haltestelle',
      toName: 'Museum B',
      startTime: new Date('2026-09-05T15:40:00'),
      endTime: new Date('2026-09-05T15:52:00'),
      durationSec: 12 * 60,
      stationCount: 3,
      fromLat: 53.681,
      fromLng: 9.801,
      toLat: 53.6835,
      toLng: 9.8,
    },
  ],
} as JourneyItinerary;

const steps = buildPlannedJourneyStops({
  navId: 'nav_a_b',
  destTitle: 'Museum B',
  itinerary,
});
assert.ok(steps.length >= 2, `mind. 2 Beine, got ${steps.length}`);
assert.ok(replaceNavLegWithJourneyGroup({ navId: 'nav_a_b', itinerary }));
const after = useFuturePlanStore
  .getState()
  .plan.stops.filter((s) => s.groupId === 'nav_a_b');
assert.ok(after.length >= 2, 'Gruppe ersetzt Placeholder');
assert.ok(after.some((s) => s.transport === 'transit' || /185/i.test(s.title)));

useFuturePlanStore.getState().upsertStop({
  id: 'nav_solo',
  title: 'Fußweg nach X',
  lat: 53.68,
  lng: 9.8,
  plannedStartMs: Date.parse('2026-09-05T12:00:00'),
  plannedEndMs: Date.parse('2026-09-05T12:10:00'),
  bufferMin: 0,
  transport: 'walk',
  kind: 'nav_leg',
  status: 'planned',
});
const soloIt = {
  startTime: new Date('2026-09-05T12:00:00'),
  endTime: new Date('2026-09-05T12:08:00'),
  durationSec: 8 * 60,
  legs: [
    {
      mode: 'WALK',
      fromName: 'Hier',
      toName: 'X',
      startTime: new Date('2026-09-05T12:00:00'),
      endTime: new Date('2026-09-05T12:08:00'),
      durationSec: 8 * 60,
      fromLat: 53.68,
      fromLng: 9.8,
      toLat: 53.681,
      toLng: 9.801,
    },
  ],
} as JourneyItinerary;
assert.ok(
  replaceNavLegWithJourneyGroup({ navId: 'nav_solo', itinerary: soloIt }),
  'Einzel-Bein Journey Group ok',
);

const { upsertSpokenJourneyToTimeline } = require('./plannedJourneyGroup') as {
  upsertSpokenJourneyToTimeline: (o: {
    itinerary: JourneyItinerary;
    destName: string;
    destLat: number;
    destLng: number;
  }) => boolean;
};
assert.ok(
  upsertSpokenJourneyToTimeline({
    itinerary,
    destName: 'Hamburg Hbf',
    destLat: 53.55,
    destLng: 10.0,
  }),
  'Spoken Journey → Timeline',
);
const spoken = useFuturePlanStore.getState().plan.stops;
assert.ok(
  spoken.some((s) => s.groupId?.startsWith('voice_oepnv_')),
  'voice ÖPNV-Beine fehlen',
);
assert.ok(
  spoken.some(
    (s) =>
      (s.id.endsWith('_dest') || s.groupId?.startsWith('voice_oepnv_')) &&
      /Hamburg/i.test(`${s.title} ${s.groupLabel ?? ''}`),
  ),
  'Ziel-Stop / Gruppe fehlt',
);

const halt = after.find((s) => s.groupId);
assert.ok(halt);
assert.ok(
  !isGapFillRealStop({
    ...halt!,
    kind: 'stop',
    groupId: 'nav_a_b',
    title: '1 · Dammtor',
    lat: 53.56,
    lng: 9.99,
  }),
  'groupId halt excluded',
);

assert.ok(
  shouldSkipTourInternalLeg(
    { id: 'tour_req1_1', planTaskId: 'req1' },
    { id: 'tour_req1_2', planTaskId: 'req1' },
  ),
  'tour internal skip',
);
assert.ok(
  !shouldSkipTourInternalLeg(
    { id: 'wish_breakfast', planTaskId: null },
    { id: 'tour_req1_1', planTaskId: 'req1' },
  ),
  'wish→tour not internal',
);

function fakeLeg(id: string, title: string): FuturePlanStop {
  return {
    id,
    title,
    lat: 53.55,
    lng: 10,
    plannedStartMs: Date.parse('2026-09-05T11:00:00'),
    plannedEndMs: Date.parse('2026-09-05T11:20:00'),
    bufferMin: 0,
    transport: 'transit',
    kind: 'nav_leg',
    status: 'planned',
    routeEstimate: 'fallback',
  };
}

const breakfast: FuturePlanStop = {
  id: 'wish_bf',
  title: 'Frühstück',
  lat: 53.55,
  lng: 9.99,
  plannedStartMs: Date.parse('2026-09-05T10:00:00'),
  plannedEndMs: Date.parse('2026-09-05T10:40:00'),
  bufferMin: 5,
  transport: 'walk',
  kind: 'wish',
  status: 'pending_change',
};

const newLegs = [
  fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
  fakeLeg('nav_wish_bf_tour_1', 'ÖPNV nach Dammtor'),
  fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
];

let planStops: FuturePlanStop[] = [
  breakfast,
  fakeLeg('nav_stale', 'ÖPNV nach Ziel'),
];

const exists = (navId: string) =>
  planStops.some((s) => s.groupId === navId && s.kind === 'nav_leg');

planStops = mergeGapFillPlanStops({
  currentStops: planStops,
  newLegs,
  isLiveNavLegId: () => false,
  plannedJourneyGroupExists: exists,
});
const firstCount = countOepnvNachZielTitles(planStops);
assert.ok(firstCount <= 1, `after 1st merge ≤1 ÖPNV nach Ziel, got ${firstCount}`);

planStops = mergeGapFillPlanStops({
  currentStops: planStops,
  newLegs,
  isLiveNavLegId: () => false,
  plannedJourneyGroupExists: exists,
});
const secondCount = countOepnvNachZielTitles(planStops);
assert.equal(
  secondCount,
  firstCount,
  '2nd apply does not explode ÖPNV nach Ziel',
);


// Dest-Key: nav_here_X und nav_FROM_X teilen Ziel X
assert.equal(
  navLegDestKey('nav_here_tour_1', ['wish_bf', 'tour_1']),
  'tour_1',
);
assert.equal(
  navLegDestKey('nav_wish_bf_tour_1', ['wish_bf', 'tour_1']),
  'tour_1',
);

// Ein Ziel → max ein Travel-Head (kein Ziel+Dammtor-Paar)
{
  const knownStops: FuturePlanStop[] = [
    breakfast,
    {
      id: 'tour_1',
      title: 'Dammtor',
      lat: 53.56,
      lng: 9.99,
      plannedStartMs: Date.parse('2026-09-05T11:30:00'),
      plannedEndMs: Date.parse('2026-09-05T11:40:00'),
      bufferMin: 0,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
    },
  ];
  const pairLegs = [
    fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
    fakeLeg('nav_wish_bf_tour_1', 'ÖPNV nach Dammtor'),
  ];
  const mergedPair = mergeGapFillPlanStops({
    currentStops: knownStops,
    newLegs: pairLegs,
    isLiveNavLegId: () => false,
    plannedJourneyGroupExists: () => false,
  });
  assert.equal(
    countTravelHeadsForDest(mergedPair, 'tour_1'),
    1,
    'max one ÖPNV head per dest',
  );
}

// Stale Fallback weg wenn Journey-Gruppe existiert
{
  const groupLeg: FuturePlanStop = {
    ...fakeLeg('nav_wish_bf_tour_1_l0', 'S1 nach Dammtor'),
    groupId: 'nav_wish_bf_tour_1',
    groupLabel: 'ÖPNV nach Dammtor',
    routeEstimate: 'routed',
  };
  const withGroup = [
    breakfast,
    {
      id: 'tour_1',
      title: 'Dammtor',
      lat: 53.56,
      lng: 9.99,
      plannedStartMs: Date.parse('2026-09-05T11:30:00'),
      plannedEndMs: Date.parse('2026-09-05T11:40:00'),
      bufferMin: 0,
      transport: 'walk',
      kind: 'stop',
      status: 'planned',
    },
    fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel'),
    groupLeg,
  ];
  const existsG = (navId: string) =>
    withGroup.some((s) => s.groupId === navId && s.kind === 'nav_leg');
  const afterJourney = mergeGapFillPlanStops({
    currentStops: withGroup,
    newLegs: [fakeLeg('nav_here_tour_1', 'ÖPNV nach Ziel')],
    isLiveNavLegId: () => false,
    plannedJourneyGroupExists: existsG,
  });
  assert.equal(
    countOepnvNachZielTitles(afterJourney),
    0,
    'no stale ÖPNV nach Ziel beside journey',
  );
  const pruned = pruneStaleFallbackLegsForDest({
    stops: withGroup,
    destId: 'tour_1',
    keepGroupId: 'nav_wish_bf_tour_1',
  });
  assert.ok(
    !pruned.some((s) => s.id === 'nav_here_tour_1'),
    'prune drops fallback sibling',
  );
  assert.ok(
    pruned.some((s) => s.groupId === 'nav_wish_bf_tour_1'),
    'prune keeps real journey',
  );
}


console.log('gapFillTravel.smoke.test.ts OK');
