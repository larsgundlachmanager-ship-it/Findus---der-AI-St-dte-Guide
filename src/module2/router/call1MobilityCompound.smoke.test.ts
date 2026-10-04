/**
 * Mobility compound smokes — Kette vs Prioritätsfrage + volle Taxi-Slots.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1MobilityCompound.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyDiningTaxiCompoundToAnalysis,
  detectMobilityCompoundKind,
  hasClearDiningTaxiOrder,
  heuristicMobilityWorkTasks,
  looksLikeDiningPlusTaxi,
  looksLikeTaxiBeforeVenue,
  looksLikeTaxiWithFlight,
  planDiningTaxiCompound,
} from './call1MobilityCompound';
import { wantsTaxiRide } from '../../services/mobility/taxiRideIntent';
import { heuristicTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';

function base(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 't',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Verstanden.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    ...partial,
  };
}

// 1) reines Taxi
{
  const u = 'Kannst du mir ein Taxi bestellen?';
  assert.equal(detectMobilityCompoundKind(u), 'taxi_only');
  assert.equal(wantsTaxiRide(u), true);
  assert.equal(heuristicMobilityWorkTasks(u).length, 0, 'taxi only → no chain');
  assert.equal(planDiningTaxiCompound(u), null);
}

// 2) Taxi + Flug → zwei Tasks: erst Flug/Leave-by, dann Taxi
{
  const u = 'Kannst du mir ein Taxi bestellen, dass ich pünktlich zum Flug nach Athen komme?';
  assert.equal(looksLikeTaxiWithFlight(u), true);
  assert.equal(detectMobilityCompoundKind(u), 'taxi_leave_by_flight');
  assert.equal(wantsTaxiRide(u), false, 'flight+dest → not hail');
  const plan = planDiningTaxiCompound(u)!;
  assert.equal(plan.mode, 'work_chain');
  const flight = plan.work.find((w) => w.id === 'flight')!;
  const taxi = plan.work.find((w) => w.id === 'taxi')!;
  assert.equal(flight.worker, 'flight');
  assert.equal(flight.dependsOn ?? null, null, 'flight is task 1 — no dependsOn');
  assert.match(flight.brief, /Task 1|Leave-by|Terminal/i);
  assert.doesNotMatch(flight.brief, /inkl\.?\s*Taxi|Taxi\/Uber-Präferenz/i);
  assert.ok(flight.mustHaves?.includes('leave_by'));
  assert.equal(taxi.worker, 'transit');
  assert.equal(taxi.dependsOn, 'flight');
  assert.match(taxi.brief, /Task 2|Deep-Link|Leave-by|prefilled/i);
  assert.ok(
    plan.openLoops.includes('taxi_after_leave_by'),
    'Task 2 sticky openLoop',
  );
  assert.ok(
    plan.thinkAhead.some((t) => /Task 1|Erkennung|Timeline|Deep-Link/i.test(t)),
    'thinkAhead names recognition + sequential tasks',
  );

  const mixed = applyDiningTaxiCompoundToAnalysis(
    base({
      frame: {
        session: 'new',
        threadId: null,
        subject: null,
        destCity: null,
        startIsGps: true,
        when: [],
        mustHaves: [],
        thinkAhead: [],
        tasks: [
          {
            id: 'flight',
            worker: 'flight',
            brief: 'Flug Leave-by inkl. Taxi/Uber-Präferenz',
          },
          { id: 'taxi', worker: 'transit', brief: 'Taxi' },
        ],
        bridge: null,
        referents: [],
      },
    }),
    u,
  );
  const fixedFlight = mixed.frame?.tasks.find((t) => t.id === 'flight')!;
  assert.doesNotMatch(fixedFlight.brief, /inkl\.?\s*Taxi/i);
  assert.match(fixedFlight.brief, /Task 1|Leave-by/i);
  const fixedTaxi = mixed.frame?.tasks.find((t) => t.id === 'taxi')!;
  assert.equal(fixedTaxi.dependsOn, 'flight');
  assert.match(fixedTaxi.brief, /ETA|Vorbestell|Preis|Task 2/i);
}

// 3) Taxi vor Restaurant — klare Reihenfolge → Kette
{
  const u =
    'Kannst du mir ein Taxi bestellen, bevor ich zu diesem Restaurant komme?';
  assert.equal(looksLikeTaxiBeforeVenue(u), true);
  assert.equal(hasClearDiningTaxiOrder(u), true);
  const plan = planDiningTaxiCompound(u)!;
  assert.equal(plan.mode, 'work_chain');
  assert.ok(plan.work.some((w) => w.id === 'venue' && w.worker === 'dining'));
  assert.ok(plan.work.some((w) => w.id === 'taxi' && w.dependsOn === 'venue'));
  assert.match(plan.work.find((w) => w.id === 'taxi')!.brief, /Vorbestell|ETA/i);

  const frame = heuristicTurnFrame(u, 'Hamburg');
  assert.ok(
    frame.tasks.some((t) => t.dependsOn === 'venue' || t.id === 'taxi'),
    'frame has taxi chain',
  );
}

// 4) AYCE + Taxi ohne Reihenfolge → Prioritätsfrage
{
  const u =
    'All you can eat ohne Asiatisch und kannst du mir auch ein Taxi zum Theater bestellen?';
  assert.equal(looksLikeDiningPlusTaxi(u), true);
  assert.equal(hasClearDiningTaxiOrder(u), false);
  const plan = planDiningTaxiCompound(u)!;
  assert.equal(plan.mode, 'priority_ask');
  assert.deepEqual(plan.work, []);
  assert.ok(plan.openLoops.includes('dining_track'));
  assert.ok(plan.openLoops.includes('taxi_track'));

  const applied = applyDiningTaxiCompoundToAnalysis(
    base({
      execution: 'pitch_module',
      bridge: 'Beides geht.',
      frame: heuristicTurnFrame(u, 'Hamburg'),
    }),
    u,
  );
  assert.equal(applied.needsBlockingChoice, true);
  assert.equal(applied.bridgeComplete, true);
  assert.equal(applied.call2Brief, null);
  assert.ok(applied.intents?.some((i) => i.id === 'dining_track'));
  assert.ok(applied.intents?.some((i) => i.id === 'taxi_track'));
}

// 5) AYCE + danach Taxi → Kette mit AYCE must
{
  const u =
    'All you can eat ohne Asiatisch und danach ein Taxi zum Theater';
  assert.equal(hasClearDiningTaxiOrder(u), true);
  const plan = planDiningTaxiCompound(u)!;
  assert.equal(plan.mode, 'work_chain');
  const venue = plan.work.find((w) => w.id === 'venue')!;
  assert.ok(venue.mustHaves?.includes('all_you_can_eat'));
  assert.ok(venue.mustHaves?.includes('avoid_cuisine_asian'));
  assert.ok(plan.work.some((w) => w.id === 'taxi' && w.dependsOn));
}

// 6) Dünnen Transit-Brief anreichern
{
  const u = 'Taxi bestellen bevor ich zum Restaurant komme';
  const thin = applyDiningTaxiCompoundToAnalysis(
    base({
      frame: {
        session: 'new',
        threadId: null,
        subject: null,
        destCity: null,
        startIsGps: true,
        when: [],
        mustHaves: [],
        thinkAhead: [],
        tasks: [
          { id: 'taxi', worker: 'transit', brief: 'Taxi' },
        ],
        bridge: null,
        referents: [],
      },
    }),
    u,
  );
  const taxi = thin.frame?.tasks.find((t) => t.id === 'taxi');
  assert.ok(taxi && taxi.brief.length > 40, 'thin taxi brief enriched');
  assert.match(taxi!.brief, /ETA|Vorbestell|Preis/i);
}

console.log('call1MobilityCompound.smoke.test.ts ok');
