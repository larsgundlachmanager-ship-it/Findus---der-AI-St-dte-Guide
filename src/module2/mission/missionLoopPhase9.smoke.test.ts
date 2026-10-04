/**
 * Phase 9 — Mission-Loop Abschluss-Suite (offline).
 * Canonical: Ambiguity · Ask-Back · Familien · Chat-Leak · UI.
 *
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionLoopPhase9.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMissionChecklist } from './buildMissionChecklist';
import {
  looksLikeAmbiguityAskBack,
  resolveMissionAskBack,
} from './resolveMissionAskBack';
import {
  missionFamilyToExecution,
  resolveMissionExecutionSoft,
} from './missionFamilyRouting';
import { isAmenityPlaceFindQuery } from './amenityPlaceFind';
import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import { finalizeCall1Execution } from '../router/call1Dispatch';
import {
  resolvePitchUiLayout,
  isAmenitySinglePlacePitch,
} from '../pitch/pitchAmenityUi';
import { detectPitchKind } from '../pitch/parentBrief';
import { shouldEmitAskBack } from './missionContract';

function baseAnalysis(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

// ─── 1) Ambiguity: still rewrite, never ask ───
{
  const gondel = buildMissionChecklist({
    userText: 'In Venedig mit der Nusschale fahren — wie teuer ist das?',
  });
  assert.equal(gondel.askBack, null, 'gondel no ask');
  assert.ok(
    /gondel/i.test(gondel.normalizedQuery) ||
      gondel.rewrites.some((r) => /gondel/i.test(r)),
    'nusschale→gondel',
  );
  assert.equal(
    resolveMissionAskBack({
      userText: gondel.userText,
      mission: gondel,
      llmAskBack: 'Was meinst du mit Nusschale?',
    }).askBack,
    null,
    'strip gondel ambiguity ask',
  );

  const papst = buildMissionChecklist({ userText: 'Wie alt ist der Papst?' });
  assert.equal(papst.family, 'fact');
  assert.equal(papst.askBack, null);
  assert.ok(!shouldEmitAskBack(papst));
  assert.equal(
    looksLikeAmbiguityAskBack('Welchen Papst meinst du?'),
    true,
  );

  const grachten = buildMissionChecklist({
    userText:
      'Ich möchte in die Hauptstadt der Niederlande und dort mit dem Boot fahren',
  });
  assert.equal(grachten.askBack, null, 'grachten/NL no city ask');
  assert.ok(
    /amsterdam/i.test(grachten.normalizedQuery) ||
      /amsterdam/i.test(grachten.anchor.label || '') ||
      grachten.rewrites.some((r) => /Amsterdam/i.test(r)),
    'Amsterdam inferred',
  );
}

// ─── 2) Ask-Back nur Blocker ───
{
  const flight = buildMissionChecklist({
    userText: 'Wann muss ich am Flughafen sein?',
  });
  assert.equal(flight.family, 'flight');
  assert.ok(flight.askBack, 'airport ETA needs flight info');
  assert.equal(
    resolveMissionExecutionSoft('Wann muss ich am Flughafen sein?').execution,
    null,
    'no fake flight exec',
  );

  const hotel = buildMissionChecklist({
    userText: 'Hotel in Amsterdam unter 200 € mit Pool',
  });
  assert.equal(hotel.askBack, null, 'hotel clear → no ask');
}

// ─── 3) Canonical families → right execution (no inventing chat) ───
{
  // Basketball
  assert.equal(isAmenityPlaceFindQuery('Wo kann ich Basketball spielen?'), true);
  assert.equal(shouldHandoffToPitchModule('Wo kann ich Basketball spielen?'), true);
  assert.equal(detectPitchKind('Wo kann ich Basketball spielen?'), 'generic');
  assert.equal(
    finalizeCall1Execution(baseAnalysis(), 'Wo kann ich Basketball spielen?'),
    'pitch_module',
  );
  assert.equal(
    resolvePitchUiLayout({
      kind: 'generic',
      text: 'Wo kann ich Basketball spielen?',
      orderOpenTimeline: true,
    }),
    'live_split',
    'basketball no timeline duty',
  );
  assert.ok(
    isAmenitySinglePlacePitch({ text: 'Wo kann ich Basketball spielen?' }),
  );

  // Spaghetti-Eis → place/food pitch, not inventing chat
  const eis = buildMissionChecklist({
    userText: 'Spaghetti-Eis in der Nähe',
  });
  assert.ok(
    eis.family === 'place' || eis.family === 'amenity',
    `eis family ${eis.family}`,
  );
  assert.equal(
    finalizeCall1Execution(baseAnalysis(), 'Spaghetti-Eis in der Nähe') !==
      'chat_lane' ||
      shouldHandoffToPitchModule('Spaghetti-Eis in der Nähe'),
    true,
    'spaghetti-eis not inventing chat-only',
  );
  // Soft: pitch handoff preferred
  assert.equal(
    shouldHandoffToPitchModule('Spaghetti-Eis in der Nähe') ||
      finalizeCall1Execution(baseAnalysis(), 'Spaghetti-Eis in der Nähe') ===
        'pitch_module',
    true,
    'spaghetti-eis → pitch path',
  );

  // Hotel ≤200 + Pool
  const hotel = buildMissionChecklist({
    userText: 'Hotel in Amsterdam Nähe Hauptbahnhof unter 200 € mit Pool',
  });
  assert.equal(hotel.family, 'hotel');
  assert.ok(hotel.factsToProve.some((f) => f.id === 'budget_max'));
  assert.ok(hotel.factsToProve.some((f) => f.id === 'amenity_pool'));
  assert.equal(missionFamilyToExecution('hotel'), 'pitch_module');
  assert.equal(
    finalizeCall1Execution(
      baseAnalysis(),
      'Hotel Amsterdam Hauptbahnhof unter 200 Euro mit Pool',
    ),
    'pitch_module',
  );

  // Towers schedule
  assert.equal(
    resolveMissionExecutionSoft(
      'Wann spielen die Hamburg Towers in der Barclaycard Arena?',
    ).execution,
    'events_research',
  );
  assert.equal(
    finalizeCall1Execution(
      baseAnalysis(),
      'Wann spielen die Hamburg Towers wieder?',
    ),
    'events_research',
  );

  // Bahn ≤18 Uhr
  const train = buildMissionChecklist({
    userText: 'Morgen nach Berlin, spätestens 18 Uhr',
  });
  assert.equal(train.family, 'transit');
  assert.equal(missionFamilyToExecution('transit'), 'nav_execute');
  assert.equal(
    resolveMissionExecutionSoft('Morgen nach Berlin, spätestens 18 Uhr')
      .execution,
    'nav_execute',
  );

  // SUP → fanout (not pitch, not inventing chat)
  assert.equal(
    resolveMissionExecutionSoft('Wo kann ich SUP auf der Alster ausleihen?')
      .execution,
    'task_fanout',
  );
  assert.equal(shouldHandoffToPitchModule('Wo kann ich SUP ausleihen?'), false);
  assert.equal(
    finalizeCall1Execution(
      baseAnalysis({ execution: 'chat_lane' }),
      'Wo kann ich SUP auf der Alster ausleihen?',
    ),
    'task_fanout',
    'SUP never inventing chat',
  );
}

// ─── 4) Chat-Leak: Find wishes never stay inventing chat_lane ───
{
  const finds = [
    'Wo kann ich Basketball spielen?',
    'Hotel in Amsterdam unter 200 € mit Pool',
    'All you can eat kein Asiatisch',
    'Wo gibt es Trinkwasser?',
    'Wann spielen die Hamburg Towers?',
    'Spaghetti-Eis in der Nähe',
    'Wo kann ich baden gehen?',
    'Wo kann ich SUP auf der Alster ausleihen?',
  ];
  for (const q of finds) {
    const exec = finalizeCall1Execution(
      baseAnalysis({ execution: 'chat_lane' }),
      q,
    );
    assert.notEqual(
      exec,
      'chat_lane',
      `chat-leak: "${q}" → ${exec}`,
    );
  }
  // Fact may stay chat
  assert.equal(
    finalizeCall1Execution(baseAnalysis(), 'Wie alt ist der Papst?'),
    'chat_lane',
  );
  // Explicit Call-1 chat on specialty still forced to pitch
  assert.equal(
    finalizeCall1Execution(
      baseAnalysis({ execution: 'chat_lane' }),
      'Spaghetti-Eis in der Nähe',
    ),
    'pitch_module',
  );
}

// ─── 5) Wiring locks (Phases 1–8 still present) ───
{
  const dir = __dirname;
  const files = [
    'buildMissionChecklist.ts',
    'resolveMissionAskBack.ts',
    'runMissionStages.ts',
    'verifyMissionPass.ts',
    'missionFamilyRouting.ts',
    'promotedMissionSlots.ts',
    'amenityPlaceFind.ts',
  ];
  for (const f of files) {
    assert.ok(
      fs.existsSync(path.join(dir, f)),
      `mission file ${f}`,
    );
  }
  const prefetch = path.join(
    dir,
    '../../services/research/activityPrefetch.ts',
  );
  assert.ok(fs.existsSync(prefetch), 'phase6 prefetch');
  const amenityUi = path.join(dir, '../pitch/pitchAmenityUi.ts');
  assert.ok(fs.existsSync(amenityUi), 'phase8 amenity ui');
  const persist = fs.readFileSync(
    path.join(dir, '../../services/research/persistLiveResearch.ts'),
    'utf8',
  );
  assert.ok(
    !/if \(req\.kind === 'hotel'\) return 0/.test(persist),
    'phase7 hotel persist',
  );
}

console.log('missionLoopPhase9.smoke.test.ts ok');
