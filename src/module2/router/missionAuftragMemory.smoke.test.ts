/**
 * Smoke: Sticky Auftrag-Gedächtnis (Wunsch + Tasks + Kontext) pro Root.
 */
import assert from 'node:assert/strict';
import {
  buildAuftragMemory,
  formatAuftragStickyBlock,
  appendAuftragKnownBit,
} from './missionAuftragMemory';
import {
  clearFollowThroughGoal,
  syncFollowThroughGoal,
  inventFollowThroughWork,
  getFollowThroughGoal,
  followThroughAuthorIntent,
  getAllAuftragStickyBlocks,
} from './missionFollowThrough';
import { getSessionRootGoal } from '../context/shortTermContext';

clearFollowThroughGoal();

const mem0 = buildAuftragMemory({
  kind: 'taxi_airport',
  rootLabel: 'Taxi zum Flughafen vorbestellen (pünktlich)',
  slots: { flightTime: null, luggage: 'unknown' },
  work: [
    {
      id: 'ft_taxi_flight',
      brief: 'Task 1: Flug klären',
      executeWhen: 'now',
    },
    {
      id: 'ft_taxi_transfer',
      brief: 'Task 2: Taxi Deep-Link',
      executeWhen: 'later',
      dependsOn: 'ft_taxi_flight',
    },
  ],
  needBookingLink: true,
});

assert.match(mem0.wish, /Taxi|Flughafen/i);
assert.ok(mem0.openTasks.length >= 2, 'two open tasks');
assert.ok(
  mem0.stillNeed.some((s) => /Abflugzeit|Flugnummer/i.test(s)),
  'blocker Abflugzeit',
);
assert.ok(
  mem0.deriveFirst.some((s) => /Startflughafen|herleiten/i.test(s)),
  'derive first',
);

const block = formatAuftragStickyBlock('taxi_airport', mem0);
assert.match(block, /Sticky-Auftrag\[taxi_airport\]/);
assert.match(block, /Wunsch=/);
assert.match(block, /OffeneTasks=/);
assert.match(block, /NochBlocker=/);
assert.match(block, /HerleitenZuerst=/);

const withClock = appendAuftragKnownBit(mem0, 'um 18 Uhr');
assert.ok(withClock?.known.some((k) => /um 18/i.test(k)));

syncFollowThroughGoal(
  'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
);
inventFollowThroughWork(
  'Ich fliege morgen nach London, bestell mir ein Taxi zum Flughafen pünktlich',
  'here_now',
);

const g1 = getFollowThroughGoal();
assert.equal(g1?.kind, 'taxi_airport');
assert.ok(g1?.auftrag?.wish, 'auftrag wish set');
assert.ok(g1?.auftrag?.openTasks?.length, 'auftrag openTasks');
assert.match(
  followThroughAuthorIntent(g1),
  /Sticky-Auftrag|Wunsch=|OffeneTasks=/,
  'authorIntent carries sticky block',
);
assert.match(getAllAuftragStickyBlocks(), /Sticky-Auftrag/);
assert.ok(getSessionRootGoal(), 'session root mirrored from wish');

inventFollowThroughWork('um 18 Uhr', 'here_now');
const g2 = getFollowThroughGoal();
assert.ok(
  g2?.auftrag?.known?.some((k) => /18|Abflugzeit/i.test(k)) ||
    g2?.slots.flightTime,
  'clock follow-up lands in auftrag/slots',
);
assert.ok(
  !g2?.auftrag?.stillNeed?.some((s) => /Abflugzeit/i.test(s)) ||
    g2?.slots.flightTime,
  'Abflugzeit blocker clears when time known',
);

clearFollowThroughGoal();
console.log('missionAuftragMemory.smoke.test.ts OK');
