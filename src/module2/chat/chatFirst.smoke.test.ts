/**
 * Regression smoke — Chat-first Router / Allowlist / Alias / AutoLearn / Bridge.
 * Run: npx --yes tsx src/module2/chat/chatFirst.smoke.test.ts
 */

import { sanitizeRouterDecision, laneFromLegacyRoute } from '../router/routeAllowlist';
import { resolveBlueprintForText } from '../blueprints/aliases';
import { composeBlueprintOnMiss } from '../blueprints/registry';
import {
  detectMissingSlotFromFollowUp,
  machineGateSlot,
} from '../blueprints/autoLearn';
import { sanitizeBridgeText } from './bridgeGlue';
import {
  isCelestialOrSkyQuery,
  isQuickLookupQuery,
} from '../../services/concierge/celestialSkyQuery';
import { PACE_TABLE } from '../router/paceBudget';
import {
  seedIntentQueue,
  completeActiveIntent,
  hasPendingIntents,
  parkAndInsertInterrupt,
  clearIntentQueue,
} from '../router/intentQueue';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function shouldUseChatLaneLite(opts: {
  lane: string;
  userText: string;
  route?: string | null;
}): boolean {
  if (opts.lane === 'chat') return true;
  if (
    opts.lane === 'nav' ||
    opts.lane === 'm1' ||
    opts.lane === 'plan' ||
    opts.lane === 'pitch'
  ) {
    return false;
  }
  if (isCelestialOrSkyQuery(opts.userText) || isQuickLookupQuery(opts.userText)) {
    return true;
  }
  const r = opts.route || '';
  return r === 'blueprint' || r === 'smalltalk' || r === 'memory' || !r;
}

// --- Anti-Nightlife + Sky-Blaupause / Quick ---
assert(
  isCelestialOrSkyQuery('Was sind denn die Sternstunden heute Abend?'),
  'sternstunden anti-nightlife',
);
assert(
  resolveBlueprintForText({ userText: 'Wann ist die Sonnenfinsternis?' })
    .blueprintId === 'sky_phenomenon',
  'sky_phenomenon blueprint',
);
assert(
  isQuickLookupQuery('wann ist die Sonnenfinsternis'),
  'eclipse quick lookup',
);
assert(
  shouldUseChatLaneLite({
    lane: 'chat',
    userText: 'Sonnenfinsternis wann',
    route: 'blueprint',
  }),
  'eclipse uses chat lane',
);

// --- Allowlist ---
const bad = sanitizeRouterDecision({
  lane: 'disco_xyz',
  blueprintId: 'not_real',
  route: 'blueprint',
});
assert(bad.lane === 'chat', 'unknown lane → chat');
assert(bad.blueprintId === null, 'unknown blueprint → null');

const nav = sanitizeRouterDecision({ lane: 'nav', route: 'm3_nav_start' });
assert(nav.lane === 'nav', 'nav lane kept');
assert(laneFromLegacyRoute('m5_plan') === 'plan', 'legacy plan');

// --- Alias Theater → cinema, miss ≠ research_choice ---
const th = resolveBlueprintForText({ userText: 'Welches Theater spielt heute?' });
assert(th.blueprintId === 'cinema' || th.blueprintId === 'theater', 'theater alias');

const miss = composeBlueprintOnMiss({ userText: 'Was bedeutet Quantenphysik?' });
assert(miss == null, 'compose miss → null (not research_choice)');

const grill = composeBlueprintOnMiss({ userText: 'Wir wollen grillen im Park' });
assert(grill?.id === 'compound_evening_goal', 'grill blueprint');

const hotel = resolveBlueprintForText({ userText: 'schönes Hotel für heute Nacht' });
assert(hotel.blueprintId === 'hotel', 'hotel blueprint');

const flightAsk =
  'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein';
assert(
  composeBlueprintOnMiss({ userText: flightAsk }) == null,
  'flight leave-by is not dining blueprint',
);
assert(
  resolveBlueprintForText({ userText: flightAsk }).blueprintId == null,
  'flight leave-by has no dining alias',
);

// --- Auto-learn slot detect ---
assert(
  detectMissingSlotFromFollowUp('Wie teuer ist das Popcorn eigentlich?') ===
    'popcorn_price',
  'popcorn slot',
);
assert(
  machineGateSlot('popcorn_price', 'Popcornpreise recherchieren wenn belegt.'),
  'gate ok',
);
assert(!machineGateSlot('x', 'kurz'), 'gate reject short');

// --- Bridge sanitize ---
assert(sanitizeBridgeText('ich schau mal') == null, 'wait bridge killed');
assert(sanitizeBridgeText('ich check das kurz') == null, 'check bridge killed');
assert(sanitizeBridgeText('Moment ich bin dran') == null, 'dran bridge killed');
assert(
  Boolean(sanitizeBridgeText('Wir wollen nicht, dass du frierst.')),
  'content bridge kept',
);
assert(
  Boolean(sanitizeBridgeText('Bei dem Wetter ist Spaghetti-Eis genau die richtige Wahl.')),
  'ice intro kept',
);
assert(
  Boolean(
    sanitizeBridgeText(
      'Alles klar, ich organisiere dir die Fahrt zum Pinneberger Bahnhof.',
    ),
  ),
  'taxi commit bridge kept',
);
assert(
  sanitizeBridgeText('nach Antalya muss klingt richtig gut') == null,
  'glued dest+muss killed',
);
assert(
  sanitizeBridgeText('Antalya wann muss klingt richtig gut — ich mach dir den Flieger klar.') ==
    null,
  'glued klingt-richtig-gut killed',
);
assert(
  Boolean(
    sanitizeBridgeText(
      'Genau das setz ich jetzt um — die konkreten Zahlen kommen direkt hinterher.',
    ),
  ),
  'complete emergency sentence kept',
);

// --- Pace 1.5s ---
assert(PACE_TABLE.standard.fastDeadlineMs === 1500, 'standard bridge deadline 1.5s');
assert(PACE_TABLE.cover.bridgeMaxWords >= 30, 'cover bridge long enough for research');

// --- Intent queue ---
clearIntentQueue();
seedIntentQueue([
  { id: '1', lane: 'chat', blueprintId: null, brief: 'Wetter' },
  { id: '2', lane: 'pitch', blueprintId: 'dining', brief: 'Outdoor' },
]);
assert(hasPendingIntents(), 'queue has intents');
completeActiveIntent();
assert(hasPendingIntents(), 'second still pending');
parkAndInsertInterrupt({
  id: 'math',
  lane: 'chat',
  blueprintId: null,
  brief: '3+5',
});
assert(hasPendingIntents(), 'interrupt parked');
clearIntentQueue();

console.log('chatFirst.smoke.test.ts OK');
