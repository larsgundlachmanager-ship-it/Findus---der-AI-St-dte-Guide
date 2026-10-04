/**
 * Follow-Through + Kontrolldistanz.
 * Run: npx --yes tsx src/module2/router/missionFollowThrough.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  clearFollowThroughGoal,
  syncFollowThroughGoal,
  getFollowThroughGoal,
  getFollowThroughGoals,
  inventFollowThroughWork,
  followThroughAuthorIntent,
  controlDistanceAuthorIntent,
  openWorldAgentAuthorIntent,
  looksLikeOpenQuest,
  looksLikeSituationProblem,
  isDeepWebTooThin,
  onTopicBoundaryPreserveFollowThrough,
  snapshotFollowThrough,
  applyFollowThroughSnapshot,
  clearFollowThroughRamOnly,
} from './missionFollowThrough';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';

function analysis(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'continue',
    threadMatchId: null,
    subject: null,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    frame: emptyTurnFrame(),
    ...partial,
  };
}

clearFollowThroughGoal();

// Taxi → Flughafen sticky start
const g1 = syncFollowThroughGoal(
  'Bestell wieder Taxi bitte, dass ich pünktlich am Flughafen bin',
);
assert.equal(g1?.kind, 'taxi_airport');
assert.ok(
  inventFollowThroughWork(
    'Bestell wieder Taxi bitte, dass ich pünktlich am Flughafen bin',
    'here_now',
  ).some((w) => w.worker === 'flight'),
);
{
  const pending = inventFollowThroughWork(
    'Bestell wieder Taxi bitte, dass ich pünktlich am Flughafen bin',
    'here_now',
  );
  const taxiQ = pending.find((w) => w.worker === 'taxi');
  assert.ok(taxiQ, 'Task 2 taxi queued even before flight time');
  assert.equal(taxiQ!.dependsOn, 'ft_taxi_flight');
  assert.equal(taxiQ!.executeWhen, 'later');
  assert.ok(taxiQ!.wantBookingLink);
}

// Slot: Flugzeit — Root bleibt
onTopicBoundaryPreserveFollowThrough('Ich fliege um 12:30 Uhr nach London');
const g2 = getFollowThroughGoal();
assert.equal(g2?.kind, 'taxi_airport', 'topic-new darf Taxi-Root nicht droppen');
assert.ok(g2?.slots.flightTime && /12:30/i.test(g2.slots.flightTime));

const afterFlight = inventFollowThroughWork(
  'Ich fliege um 12:30 Uhr nach London',
  'here_now',
);
assert.ok(afterFlight.some((w) => w.worker === 'taxi' && w.wantBookingLink));
assert.ok(
  /ROOT behalten|Taxi|Leave-by|Transfer|Task 2|Deep-Link/i.test(
    followThroughAuthorIntent(getFollowThroughGoal()),
  ),
);

{
  const { markTaxiAirportFlightResolved, markTaxiAirportDeepLinkReady } =
    require('./missionFollowThrough') as typeof import('./missionFollowThrough');
  markTaxiAirportFlightResolved({ flightTimeLabel: '18:05' });
  const g3 = getFollowThroughGoal();
  assert.ok(g3?.slots.flightTime && /18:05/.test(g3.slots.flightTime));
  assert.equal(g3?.needBookingLink, true);
  markTaxiAirportDeepLinkReady();
  assert.equal(getFollowThroughGoal()?.needBookingLink, false);
}

// Gepäck-Slot
syncFollowThroughGoal('Nur Handgepäck');
assert.equal(getFollowThroughGoal()?.slots.luggage, 'hand');

clearFollowThroughGoal();

// Taxi überall — Terminal/Fähre/Zwischenstopp, kein Flug-Worker
{
  const gTerm = syncFollowThroughGoal('Taxi zum Kreuzfahrtterminal bitte vorbestellen');
  assert.equal(gTerm?.kind, 'taxi_airport');
  assert.ok(/terminal/i.test(gTerm?.rootLabel || ''));
  const termWork = inventFollowThroughWork(
    'Taxi zum Kreuzfahrtterminal bitte vorbestellen',
    'here_now',
  );
  assert.ok(termWork.some((w) => w.worker === 'taxi' && w.wantBookingLink));
  assert.ok(!termWork.some((w) => w.worker === 'flight'));
  clearFollowThroughGoal();
  const gStop = syncFollowThroughGoal('Uber Zwischenstopp bitte einfügen');
  assert.ok(/Zwischenstopp/i.test(gStop?.rootLabel || ''));
  const stopWork = inventFollowThroughWork('Uber Zwischenstopp bitte einfügen', 'here_now');
  assert.ok(stopWork.some((w) => w.worker === 'taxi' && w.wantBookingLink));
}

clearFollowThroughGoal();

// Tisch reservieren sticky über Klärung
syncFollowThroughGoal('Hey ich würde gerne Tisch für heute Abend reservieren');
assert.equal(getFollowThroughGoal()?.kind, 'table_reserve');
onTopicBoundaryPreserveFollowThrough('Vielleicht irgendwie lecker Steak');
assert.equal(getFollowThroughGoal()?.kind, 'table_reserve');
assert.equal(getFollowThroughGoal()?.slots.cuisineOrVenue, 'steak');
const reserveWork = inventFollowThroughWork('Vielleicht irgendwie lecker Steak', 'here_now');
assert.ok(reserveWork.some((w) => w.worker === 'dining'));

syncFollowThroughGoal('Das nehme ich, bitte reservieren');
assert.ok(
  inventFollowThroughWork('Das nehme ich, bitte reservieren', 'here_now').some(
    (w) => w.worker === 'deep_web' && w.wantBookingLink,
  ),
);

clearFollowThroughGoal();

// Offener Sport
syncFollowThroughGoal('Ich habe irgendwo Bock auf Sport, was kann ich hier machen?');
assert.equal(getFollowThroughGoal()?.kind, 'open_sport');
assert.ok(
  inventFollowThroughWork(
    'Ich habe irgendwo Bock auf Sport, was kann ich hier machen?',
    'here_now',
  ).some((w) => w.worker === 'pitch' && w.must?.some((m) => m.key === 'sport')),
);

// Kontrolldistanz / thin deep_web
assert.equal(
  isDeepWebTooThin({ ok: true, buttonCount: 0, wantBookingLink: true }),
  true,
);
assert.equal(
  isDeepWebTooThin({ ok: true, buttonCount: 1, wantBookingLink: true }),
  false,
);
assert.ok(/nicht|fertig|Lücke/i.test(controlDistanceAuthorIntent({ needBookingLink: true })));

// Brief: Taxi-Ask hält Root in authorIntent
clearFollowThroughGoal();
const taxiBrief = buildCall1TaskBrief({
  userText: 'Bestell Taxi zum Flughafen, bitte pünktlich',
  analysis: analysis({
    session: 'new',
    intentSummary: 'Taxi Flughafen',
    askBack: null,
  }),
});
assert.ok(
  /ROOT|Taxi|Kontrolldistanz|Leave-by|Transfer/i.test(taxiBrief.authorIntent),
  'authorIntent follow-through',
);
assert.ok(
  taxiBrief.work.some((w) => w.worker === 'flight' || w.worker === 'taxi'),
);

clearFollowThroughGoal();

// Open-Quest sticky über Zwischenfrage (auch ohne Floskel-Liste)
assert.ok(
  looksLikeOpenQuest(
    'Was kann man hier heute machen, irgendwie Lust auf was Schönes?',
  ),
);
// Dialekt / Geschwafel / Insider — ohne „zeig mir / organisiere“
assert.ok(looksLikeOpenQuest('Ey digga Reifen is platt wa'));
assert.ok(looksLikeOpenQuest('Boah Alter Auto springt ned an'));
assert.ok(looksLikeOpenQuest('Isch brauch was zum Essen hier ne'));
assert.ok(looksLikeOpenQuest('Hä wo kann ma hier padeln gell'));
assert.ok(
  looksLikeOpenQuest(
    'Also ey wir stehen hier voll doof und der Schlüssel liegt in der Tiefgarage alter',
  ),
);
assert.equal(looksLikeOpenQuest('Zum Hauptbahnhof'), false);
assert.equal(looksLikeOpenQuest('Wie alt ist Thomas Müller?'), false);
assert.equal(looksLikeOpenQuest('hi'), false);

syncFollowThroughGoal(
  'Was kann man hier heute machen, irgendwie Lust auf was Schönes?',
);
assert.equal(getFollowThroughGoal()?.kind, 'open_quest');
onTopicBoundaryPreserveFollowThrough('Eher draußen und nicht zu teuer');
assert.equal(getFollowThroughGoal()?.kind, 'open_quest');
assert.ok(
  /draußen|draussen|günstig|guenstig/i.test(
    String(getFollowThroughGoal()?.slots.questHints || ''),
  ),
);
assert.ok(
  inventFollowThroughWork('Eher draußen und nicht zu teuer', 'here_now').some(
    (w) => w.worker === 'pitch',
  ),
);
assert.ok(/Open-World|ROOT|Soft-Fill|was meinst/i.test(openWorldAgentAuthorIntent()));

clearFollowThroughGoal();

// Alltagsproblem ohne Wunsch-Floskel
assert.ok(looksLikeSituationProblem('Reifen platt'));
assert.ok(looksLikeOpenQuest('Reifen platt'));
assert.ok(looksLikeSituationProblem('Schlüssel in der Tiefgarage'));
assert.ok(looksLikeOpenQuest('Schlüssel in der Tiefgarage'));
assert.ok(looksLikeOpenQuest('Auto springt nicht an'));
assert.ok(looksLikeSituationProblem('Akku ist leer'));
assert.ok(
  looksLikeSituationProblem('Akku fast leer und Termin in 20 Minuten — brauch Powerbank oder Taxi'),
);
assert.equal(looksLikeOpenQuest('Zum Hauptbahnhof'), false);
assert.equal(looksLikeSituationProblem('Museum in der Stadt'), false);
assert.equal(looksLikeOpenQuest('Wie alt ist Thomas Müller?'), false);

syncFollowThroughGoal('Reifen platt');
assert.equal(getFollowThroughGoal()?.kind, 'open_quest');
const tireWork = inventFollowThroughWork('Reifen platt', 'here_now');
assert.ok(tireWork.some((w) => w.worker === 'pitch'));
assert.ok(
  tireWork.some(
    (w) => w.worker === 'pitch' && w.must?.some((m) => /reifen/i.test(m.key)),
  ),
);
assert.ok(tireWork.some((w) => w.worker === 'deep_web'));

onTopicBoundaryPreserveFollowThrough('In der Nähe bitte');
assert.equal(getFollowThroughGoal()?.kind, 'open_quest', 'Reifen-Root sticky');

clearFollowThroughGoal();
const keyBrief = buildCall1TaskBrief({
  userText: 'Schlüssel in der Tiefgarage',
  analysis: analysis({
    session: 'new',
    intentSummary: 'Schlüssel Tiefgarage',
    askBack: null,
  }),
});
assert.ok(
  /Open-World|ROOT|Tiefgarage|Schlüssel/i.test(keyBrief.authorIntent),
  'situation authorIntent',
);
assert.ok(
  keyBrief.work.some((w) => w.worker === 'pitch' || w.worker === 'deep_web'),
);

clearFollowThroughGoal();

// Compound: Tisch + Taxi — beide Roots, kein Strang-Verlust
syncFollowThroughGoal(
  'Tisch für heute Abend reservieren und Taxi zum Flughafen vorbestellen',
);
{
  const kinds = getFollowThroughGoals().map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['table_reserve', 'taxi_airport']);
  const compoundWork = inventFollowThroughWork(
    'Tisch für heute Abend reservieren und Taxi zum Flughafen vorbestellen',
    'here_now',
  );
  assert.ok(compoundWork.some((w) => w.worker === 'dining'));
  assert.ok(
    compoundWork.some((w) => w.worker === 'flight' || w.worker === 'taxi'),
  );
  assert.ok(
    /Mehrere offene Roots|table_reserve|taxi_airport/i.test(
      followThroughAuthorIntent(getFollowThroughGoal()),
    ),
  );
  // Slot nur Tisch — Taxi bleibt
  onTopicBoundaryPreserveFollowThrough('Vielleicht irgendwie lecker Steak');
  assert.ok(
    getFollowThroughGoals().some((g) => g.kind === 'taxi_airport'),
    'Taxi-Root bleibt bei Tisch-Klärung',
  );
  assert.equal(
    getFollowThroughGoals().find((g) => g.kind === 'table_reserve')?.slots
      .cuisineOrVenue,
    'steak',
  );
}

clearFollowThroughGoal();

// Persist / App-Kill: „Bestell wieder Taxi“ ohne Flughafen-Wort
syncFollowThroughGoal(
  'Bestell Taxi zum Flughafen, bitte pünktlich, Flug um 14:00 Uhr',
);
assert.equal(getFollowThroughGoal()?.kind, 'taxi_airport');
assert.ok(getFollowThroughGoal()?.slots.flightTime);
const killSnap = snapshotFollowThrough();
assert.ok(killSnap?.roots?.length);
clearFollowThroughRamOnly();
assert.equal(getFollowThroughGoal(), null, 'RAM nach Kill leer');
applyFollowThroughSnapshot(killSnap);
assert.equal(getFollowThroughGoal()?.kind, 'taxi_airport');
const resume = syncFollowThroughGoal('Bestell wieder Taxi');
assert.equal(resume?.kind, 'taxi_airport');
assert.ok(
  /flughafen|airport/i.test(resume?.rootLabel || ''),
  'Root-Label aus Persist',
);
assert.ok(
  resume?.slots.flightTime && /14:00/i.test(resume.slots.flightTime),
  'Flugzeit-Slot überlebt Kill',
);
const resumeWork = inventFollowThroughWork('Bestell wieder Taxi', 'here_now');
assert.ok(resumeWork.some((w) => w.worker === 'taxi' || w.worker === 'flight'));

clearFollowThroughGoal();
console.log('missionFollowThrough.smoke: ok');


