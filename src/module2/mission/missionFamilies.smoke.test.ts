/**
 * Phase 5 — Mission-Familien Routing.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionFamilies.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  amenityPlaceMustLabels,
  isAmenityPlaceFindQuery,
} from './amenityPlaceFind';
import {
  missionFamilyToExecution,
  resolveMissionExecutionSoft,
} from './missionFamilyRouting';
import { buildMissionChecklist } from './buildMissionChecklist';
import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import { finalizeCall1Execution } from '../router/call1Dispatch';
import { detectPitchKind } from '../pitch/parentBrief';

assert.equal(
  isAmenityPlaceFindQuery('Wo kann ich Basketball spielen?'),
  true,
  'basketball amenity',
);
assert.equal(
  isAmenityPlaceFindQuery('Wo gibt es eine Tischtennisplatte?'),
  true,
  'tt amenity',
);
assert.equal(
  isAmenityPlaceFindQuery('Wo kann ich Trinkwasser zapfen?'),
  true,
  'water amenity',
);
assert.equal(
  isAmenityPlaceFindQuery('Wo kann ich SUP auf der Alster ausleihen?'),
  false,
  'SUP rental not amenity-place',
);
assert.ok(
  amenityPlaceMustLabels('Basketball spielen').includes('basketballplatz'),
  'must label',
);

assert.equal(missionFamilyToExecution('amenity'), 'pitch_module');
assert.equal(missionFamilyToExecution('hotel'), 'pitch_module');
assert.equal(
  missionFamilyToExecution('rental'),
  'task_fanout',
  'rental → fanout/knowledge',
);
assert.equal(
  missionFamilyToExecution('activity'),
  'task_fanout',
  'activity → fanout/knowledge',
);
assert.equal(missionFamilyToExecution('schedule'), 'events_research');
assert.equal(missionFamilyToExecution('transit'), 'nav_execute');
assert.equal(missionFamilyToExecution('flight'), 'flight_advisor');
assert.equal(missionFamilyToExecution('fact'), 'chat_lane');

assert.equal(
  resolveMissionExecutionSoft('Wo kann ich Basketball spielen?').execution,
  'pitch_module',
);
assert.equal(
  resolveMissionExecutionSoft(
    'Wann spielen die Hamburg Towers in der Barclaycard Arena?',
  ).execution,
  'events_research',
);
assert.equal(
  resolveMissionExecutionSoft('Hotel in Amsterdam unter 200 € mit Pool')
    .execution,
  'pitch_module',
);
assert.equal(
  resolveMissionExecutionSoft('Morgen nach Berlin, spätestens 18 Uhr')
    .execution,
  'nav_execute',
);
assert.equal(
  resolveMissionExecutionSoft('Wann muss ich am Flughafen sein?').execution,
  null,
  'airport askBack → no force exec',
);

assert.equal(
  shouldHandoffToPitchModule('Wo kann ich Basketball spielen?'),
  true,
  'handoff basketball',
);
assert.equal(
  shouldHandoffToPitchModule('Wo ist die nächste Trinkwasserstelle?'),
  true,
  'handoff water',
);
assert.equal(
  shouldHandoffToPitchModule('Wo ist das nächste Fitnessstudio?'),
  true,
  'open-find handoff (dynamic type, not whitelist)',
);
assert.equal(
  shouldHandoffToPitchModule('Wo kann ich SUP ausleihen?'),
  false,
  'SUP stays activity path',
);

assert.equal(
  detectPitchKind('Wo kann ich Basketball spielen?'),
  'generic',
  'kind generic for court',
);
assert.equal(
  detectPitchKind('Hotel in Amsterdam unter 200 € mit Pool'),
  'hotel',
  'kind hotel',
);

{
  // 5b — Hotel-Constraints in Checkliste (Budget + Pool + Stadt)
  const hotel = buildMissionChecklist({
    userText: 'Hotel in Amsterdam unter 200 € mit Pool Nähe Hauptbahnhof',
  });
  assert.equal(hotel.family, 'hotel');
  assert.ok(hotel.must.some((m) => /pool/i.test(m)), 'must pool');
  assert.ok(hotel.must.some((m) => /200/i.test(m)), 'must budget');
  assert.ok(
    hotel.factsToProve.some((f) => f.id === 'amenity_pool'),
    'fact pool',
  );
  assert.ok(
    hotel.factsToProve.some((f) => f.id === 'budget_max'),
    'fact budget',
  );
  assert.equal(hotel.askBack, null, 'hotel no askBack when city+budget clear');
}

{
  // 5c — Schedule → events, kein Ask-Back
  const towers = buildMissionChecklist({
    userText: 'Wann spielen die Hamburg Towers in der Barclaycard Arena?',
  });
  assert.equal(towers.family, 'schedule');
  assert.equal(missionFamilyToExecution(towers.family), 'events_research');
}

{
  // 5d/5e — Transit + Flight-Shell
  const train = buildMissionChecklist({
    userText: 'Morgen nach Berlin, spätestens 18 Uhr',
  });
  assert.equal(train.family, 'transit');
  assert.equal(missionFamilyToExecution(train.family), 'nav_execute');

  const flightAsk = buildMissionChecklist({
    userText: 'Wann muss ich am Flughafen sein?',
  });
  assert.equal(flightAsk.family, 'flight');
  assert.ok(flightAsk.askBack, 'flight ETA needs flight info');
  assert.equal(
    resolveMissionExecutionSoft(flightAsk.userText || 'Wann muss ich am Flughafen sein?')
      .execution,
    null,
  );
}

{
  const base = {
    intentSummary: 'test',
    route: 'blueprint' as const,
    blueprintId: null,
    blueprintStage: null,
    session: 'new' as const,
    threadMatchId: null,
    subject: null,
    bridge: 'Ok.',
    lanePlan: 'fast_only' as const,
    pace: 'standard' as const,
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'chat' as const,
  };
  assert.equal(
    finalizeCall1Execution({ ...base }, 'Wo kann ich Basketball spielen?'),
    'pitch_module',
  );
  assert.equal(
    finalizeCall1Execution(
      { ...base },
      'Wann spielen die Hamburg Towers wieder?',
    ),
    'events_research',
  );
  assert.equal(
    finalizeCall1Execution(
      { ...base },
      'Hotel Amsterdam Hauptbahnhof unter 200 Euro mit Pool',
    ),
    'pitch_module',
  );
}

console.log('missionFamilies.smoke.test.ts ok');
