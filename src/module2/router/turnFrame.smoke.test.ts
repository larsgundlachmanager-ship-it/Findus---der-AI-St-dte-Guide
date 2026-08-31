/**
 * Run: npx --yes tsx src/module2/router/turnFrame.smoke.test.ts
 */

import {
  frameHasWorker,
  frameOwnsDayPlan,
  heuristicTurnFrame,
  mergeTurnFrame,
  parseTurnFrameFromLlm,
} from './turnFrame';
import { applyTurnFrameToPlan } from '../planning/applyTurnFrame';
import { buildSkeletonPlanFromUtterance } from '../planning/planUtteranceSlots';
import type { IngestedPlan } from '../planning/planningTypes';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const HAMBURG =
  'Plane mir morgen eine Tour durch Hamburg: 9 Uhr los, Frühstück, Michel, Pannfisch und Sunset.';

const frame = heuristicTurnFrame(HAMBURG, 'Prisdorf');
assert(frame.destCity === 'Hamburg', `destCity=${frame.destCity}`);
assert(frameOwnsDayPlan(frame), 'plan worker');
assert(frameHasWorker(frame, 'transit') || frameHasWorker(frame, 'plan'), 'travel/plan');
assert(
  frame.thinkAhead.some((t) => /GPS|Start|Abfahrt/i.test(t)),
  `thinkAhead=${frame.thinkAhead.join(' | ')}`,
);
assert(
  frame.mustHaves.some((m) => /pannfisch/i.test(m)) ||
    frame.tasks.some((t) => /pannfisch|michel|sunset/i.test(t.brief)),
  'must-haves or briefs carry the named wants',
);

const llm = parseTurnFrameFromLlm(
  {
    destCity: 'Hamburg',
    startIsGps: true,
    mustHaves: ['Michel', 'Pannfisch'],
    work: [
      {
        id: 'plan',
        worker: 'plan',
        brief: 'Hamburg-Tag aus dem Auftrag',
        destCity: 'Hamburg',
        startIsGps: true,
      },
    ],
  },
  'Prisdorf',
);
assert(llm?.destCity === 'Hamburg', 'parse dest');
assert(frameOwnsDayPlan(llm), 'parse plan worker');

const merged = mergeTurnFrame(llm, frame);
assert(merged.destCity === 'Hamburg', 'merge dest');
assert(merged.mustHaves.includes('Michel'), 'merge michel');

const gpsOnly = parseTurnFrameFromLlm({ destCity: 'Prisdorf', work: [] }, 'Prisdorf');
assert(gpsOnly == null || gpsOnly.destCity == null, 'GPS city is not dest');

const skeleton = buildSkeletonPlanFromUtterance({
  utterance: HAMBURG,
  dayKey: '2026-08-23',
  gpsCity: 'Prisdorf',
  destCity: 'Hamburg',
  geoAnchor: {
    name: 'Start (Prisdorf)',
    type: 'CURRENT_GPS',
    needsClarification: false,
    lat: 53.68,
    lng: 9.76,
  },
});
assert(skeleton.destinationCity === 'Hamburg', `skel dest=${skeleton.destinationCity}`);
assert(
  skeleton.openWishesQueue.some((w) => /anreise|bahn|hamburg/i.test(`${w.title} ${w.context}`)) ||
    skeleton.openWishesQueue.length > 0,
  'skeleton has wishes',
);

const empty: IngestedPlan = {
  targetDate: '2026-08-23',
  geoAnchor: skeleton.geoAnchor,
  destinationCity: null,
  fixedNodes: [],
  openWishesQueue: [
    {
      title: 'Aktivität / Start gegen 09:00',
      context: 'Start in den Tag gegen 09:00 Uhr',
      priority: 5,
      completeness: 2,
    },
  ],
  tasks: [],
  lageMode: 'new',
  bridgeSpeech: '',
  openQuestions: [],
  initialVoiceConfirm: '',
};
const applied = applyTurnFrameToPlan(empty, merged, HAMBURG, 'Prisdorf');
assert(applied.destinationCity === 'Hamburg', `applied dest=${applied.destinationCity}`);
assert(
  applied.openWishesQueue.some((w) => /anreise|bahn/i.test(`${w.title} ${w.context}`)),
  `travel wish missing: ${applied.openWishesQueue.map((w) => w.title).join(', ')}`,
);

const weather = heuristicTurnFrame('Wie wird das Wetter heute?', 'Prisdorf', {
  session: 'new',
});
assert(!frameOwnsDayPlan(weather), 'weather is not a day plan');
assert(weather.destCity == null, 'weather has no dest city');

const FLIGHT_LEAVE =
  'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein';
const flightFrame = heuristicTurnFrame(FLIGHT_LEAVE, 'Prisdorf');
assert(frameHasWorker(flightFrame, 'flight'), 'leave-by gets flight worker');
assert(!frameOwnsDayPlan(flightFrame), 'flight leave-by is not a city day plan');
assert(
  flightFrame.thinkAhead.some((t) => /Security|Check-in|rückwärts/i.test(t)),
  `flight thinkAhead=${flightFrame.thinkAhead.join(' | ')}`,
);
assert(
  flightFrame.when.some(
    (w) => w.kind === 'day' && Boolean(w.dateKey) && /^\d{4}-\d{2}-\d{2}$/.test(w.dateKey!),
  ),
  'Call1 flight when carries concrete dateKey',
);
const morgenFrame = heuristicTurnFrame(
  'Ich fliege morgen nach Athen, wann muss ich am Flughafen sein?',
  'Prisdorf',
);
assert(
  morgenFrame.when.some((w) => w.label === 'morgen' && Boolean(w.dateKey)),
  'morgen → dateKey',
);
const stolen = mergeTurnFrame(
  parseTurnFrameFromLlm(
    {
      destCity: 'Athen',
      work: [{ id: 'plan', worker: 'plan', brief: 'Tag in Athen' }],
    },
    'Prisdorf',
  ),
  flightFrame,
);
assert(frameHasWorker(stolen, 'flight'), 'heuristic flight wins over LLM plan steal');
assert(!frameOwnsDayPlan(stolen), 'stolen plan does not own the day');

const PLAN_DAY =
  'Ich möchte gerne am Montag nach Hamburg so gegen 9 Uhr los und frühstücken.';
const planDay = heuristicTurnFrame(PLAN_DAY, 'Prisdorf');
const leftoverFlight = mergeTurnFrame(
  parseTurnFrameFromLlm(
    {
      destCity: 'Athen',
      work: [{ id: 'flight', worker: 'flight', brief: 'Athen Leave-by' }],
    },
    'Prisdorf',
  ),
  planDay,
);
assert(frameOwnsDayPlan(leftoverFlight), 'plan wins over leftover flight');
assert(!frameHasWorker(leftoverFlight, 'flight'), 'flight worker not kept');

const {
  resolveFrameClockHm,
  resolveFrameDateKey,
  formatCall1WhenSlotsForPrompt,
} = require('./turnFrame') as typeof import('./turnFrame');

const leaveBy =
  'Ich fliege morgen um 2:30 nach Wien. Wann muss ich am Flughafen sein?';
const leaveFrame = heuristicTurnFrame(leaveBy, 'Prisdorf');
assert(resolveFrameClockHm(leaveFrame) === '02:30', 'heuristic clock 02:30');
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(resolveFrameDateKey(leaveFrame) || ''),
  'heuristic dateKey',
);
const llmNoClock = parseTurnFrameFromLlm(
  {
    destCity: 'Wien',
    when: [{ kind: 'day', label: 'morgen' }],
    work: [
      {
        id: 'flight',
        worker: 'flight',
        brief: 'Wien Leave-by',
        when: { kind: 'day', label: 'morgen' },
      },
    ],
  },
  'Prisdorf',
);
const mergedClock = mergeTurnFrame(llmNoClock, leaveFrame);
assert(
  resolveFrameClockHm(mergedClock) === '02:30',
  'merge fills clock from heuristic',
);
assert(
  resolveFrameDateKey(mergedClock) != null,
  'merge fills dateKey from heuristic',
);
const whenPrompt = formatCall1WhenSlotsForPrompt(mergedClock);
assert(/clockHm: 02:30/.test(whenPrompt), 'call1 when prompt has clock');
assert(/dateKey: \d{4}-\d{2}-\d{2}/.test(whenPrompt), 'call1 when prompt has date');

// Pitch/Plan: Zeit-SSOT auch ohne Flug-Worker
{
  const { hardenWhenSlots } = require('./turnFrame') as typeof import('./turnFrame');
  const pitchH = heuristicTurnFrame(
    'Morgen Abend essen mit Terrasse',
    'Prisdorf',
  );
  assert(
    pitchH.when.some((w) => w.dateKey && /abend|morgen/i.test(String(w.label || 'morgen'))),
    'pitch heuristic has dateKey for morgen/abend',
  );
  const thinLlm = parseTurnFrameFromLlm(
    { mustHaves: ['Terrasse'], work: [{ id: '1', worker: 'dining', brief: 'Terrasse' }] },
    'Prisdorf',
  );
  const mergedPitch = mergeTurnFrame(thinLlm, pitchH);
  assert(
    resolveFrameDateKey(mergedPitch) != null,
    'pitch merge fills dateKey without flight',
  );
  const hardened = hardenWhenSlots(
    [{ kind: 'clock', at: '19:00', label: '19:00' }],
    pitchH.when,
  );
  assert(
    hardened.some((w) => w.kind === 'clock' && w.at === '19:00' && w.dateKey),
    'clock gets dateKey mirrored',
  );
}

console.log('turnFrame.smoke.test.ts ok');
