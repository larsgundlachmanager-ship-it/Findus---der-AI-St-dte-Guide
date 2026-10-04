/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionAskBack.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { buildMissionChecklist } from './buildMissionChecklist';
import {
  looksLikeAmbiguityAskBack,
  looksLikePermissionAskBack,
  resolveMissionAskBack,
} from './resolveMissionAskBack';
import { buildCall1TaskBrief } from '../router/call1TaskBrief';
import type { ManagerAnalysis } from '../router/types';

assert.equal(
  looksLikeAmbiguityAskBack('Welches Boot meinst du?'),
  true,
  'boot ambiguity',
);
assert.equal(
  looksLikeAmbiguityAskBack('Welchen Papst meinst du genau?'),
  true,
  'papst ambiguity',
);
assert.equal(
  looksLikeAmbiguityAskBack('Was meinst du mit Nusschale?'),
  true,
  'nusschale ambiguity',
);
assert.equal(
  looksLikeAmbiguityAskBack('Was meinst du genau?'),
  true,
  'was meinst du genau = ambiguity',
);
assert.equal(
  looksLikePermissionAskBack('Soll ich die Orte heraussuchen?'),
  true,
  'permission',
);
assert.equal(
  looksLikeAmbiguityAskBack(
    'Wann fliegst du — dann sag ich dir, wann du am Flughafen sein musst?',
  ),
  false,
  'real blocker not ambiguity',
);

function mission(text: string) {
  return buildMissionChecklist({ userText: text });
}

// Nusschale: LLM fragt Ambiguity → gestrichen
{
  const m = mission(
    'In Venedig mit der Nusschale fahren — wie teuer ist das?',
  );
  const r = resolveMissionAskBack({
    userText: 'In Venedig mit der Nusschale fahren — wie teuer ist das?',
    mission: m,
    llmAskBack: 'Was meinst du mit Nusschale?',
  });
  assert.equal(r.askBack, null, 'nusschale no ask');
  assert.ok(
    r.reason === 'stripped_ambiguity' || r.reason === 'stripped_just_do_it',
    `reason ${r.reason}`,
  );
}

// Papst
{
  const m = mission('Wie alt ist der Papst?');
  const r = resolveMissionAskBack({
    userText: 'Wie alt ist der Papst?',
    mission: m,
    llmAskBack: 'Welchen Papst meinst du?',
  });
  assert.equal(r.askBack, null, 'papst no ask');
}

// NL Boot
{
  const m = mission(
    'Ich möchte in die Hauptstadt der Niederlande und dort mit dem Boot fahren',
  );
  const r = resolveMissionAskBack({
    userText:
      'Ich möchte in die Hauptstadt der Niederlande und dort mit dem Boot fahren',
    mission: m,
    llmAskBack: 'Welche Stadt und welches Boot meinst du?',
  });
  assert.equal(r.askBack, null, 'nl boot no ask');
}

// Basketball — Just-Do-It
{
  const m = mission('Wo kann ich Basketball spielen?');
  const r = resolveMissionAskBack({
    userText: 'Wo kann ich Basketball spielen?',
    mission: m,
    llmAskBack: 'Kannst du präziser sagen, was du suchst?',
  });
  assert.equal(r.askBack, null, 'basketball just-do-it');
}

// Flughafen ohne Flug → critical
{
  const m = mission('Wann muss ich am Flughafen sein?');
  const r = resolveMissionAskBack({
    userText: 'Wann muss ich am Flughafen sein?',
    mission: m,
    llmAskBack: null,
  });
  assert.ok(r.askBack, 'airport askBack');
  assert.equal(r.reason, 'mission_critical');
  assert.ok(/flug/i.test(r.askBack!), 'mentions flight');
}

// Taxi Flughafen ohne Flug
{
  const m = mission('Bestell mir bitte ein Taxi zum Flughafen');
  const r = resolveMissionAskBack({
    userText: 'Bestell mir bitte ein Taxi zum Flughafen',
    mission: m,
    taxiBlocked: true,
    taxiAskBack:
      'Welcher Flug bzw. welche Abflugzeit — dann rechne ich Leave-by und das Taxi.',
    llmAskBack: 'Welche Stadt meinst du?',
  });
  assert.equal(r.reason, 'taxi_airport');
  assert.ok(r.askBack && /flug/i.test(r.askBack), 'taxi ask wins over ambiguity');
}

// TaskBrief: Ambiguity-LLM wird gestrichen
{
  const analysis = {
    bridge: 'Alles klar.',
    session: 'new',
    authorIntent: 'Gondel Preis',
    intentSummary: 'Gondel',
    askBack: 'Was meinst du mit Nusschale?',
    frame: {
      tasks: [{ id: 'p1', worker: 'place', brief: 'Gondel suchen' }],
      mustHaves: [],
      referents: [],
      thinkAhead: [],
    },
  } as unknown as ManagerAnalysis;
  const brief = buildCall1TaskBrief({
    analysis,
    userText: 'In Venedig mit der Nusschale fahren, wie teuer?',
  });
  assert.equal(brief.askBack, null, 'brief strips nusschale ask');
}

// TaskBrief: Flughafen blocker bleibt
{
  const analysis = {
    bridge: 'Ok.',
    session: 'new',
    authorIntent: 'Flughafen Leave-by',
    intentSummary: 'Flughafen',
    askBack: null,
    frame: {
      tasks: [{ id: 'f1', worker: 'flight', brief: 'Leave-by' }],
      mustHaves: [],
      referents: [],
      thinkAhead: [],
    },
  } as unknown as ManagerAnalysis;
  const brief = buildCall1TaskBrief({
    analysis,
    userText: 'Wann muss ich am Flughafen sein?',
  });
  assert.ok(brief.askBack, 'brief keeps airport ask');
  assert.ok(brief.openWorld.mission.askBack, 'mission synced');
}

console.log('missionAskBack.smoke.test.ts ok');
