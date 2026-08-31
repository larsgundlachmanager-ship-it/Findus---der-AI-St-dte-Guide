/**
 * Ziel-Paket: Strand/Hingehen ist kein Trivia-Chat.
 * Run: npx --yes tsx src/module2/router/placeGoQuery.smoke.test.ts
 */

import {
  isAmenityFrictionQuery,
  isBeachDestQuery,
  isDistanceEtaQuery,
  isHoursQuery,
  isPlaceGoQuery,
  shouldForbidQuickChat,
  travelHintFromMeters,
} from './placeGoQuery';
import { isQuickLookupQuery } from '../../services/concierge/celestialSkyQuery';
import { stripPermissionLookupAsks } from '../../services/concierge/justDoItPolicy';
import { detectLiveInventoryKind, mustSkipChatLane } from './liveInventoryGate';
import { sanitizeRouterDecision } from './routeAllowlist';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isPlaceGoQuery('wo ist denn hier der beste Strand in Lübeck wo man hingehen könnte'),
  'best beach is place-go',
);
assert(
  isBeachDestQuery('gibt es in Lübeck einen Strand an dem man ins Wasser gehen kann'),
  'swim query is beach',
);
assert(
  !isQuickLookupQuery('wo ist denn hier der beste Strand'),
  'beach not quick lookup',
);
assert(isQuickLookupQuery('Wie alt ist Mark Forster?'), 'trivia still quick');

assert(
  detectLiveInventoryKind(
    'ja wo kann man dann Party machen gibt es irgendwelche Party locations',
  ) === 'events',
  'party locations are events',
);

const hint = travelHintFromMeters(18_000, { declaredCar: true });
assert(hint.mode === 'drive', '18 km is drive');
assert(hint.minutes >= 20, '18 km at least ~20 min');

const nearbyNoCar = travelHintFromMeters(3_800, { declaredCar: false });
assert(nearbyNoCar.distLabel.includes('3,8'), '3.8 km label');
assert(nearbyNoCar.minutes >= 8, 'honest drive ~9 min not 5');
assert(
  !/\b5\s*Min/.test(nearbyNoCar.speech) && !/\b5\s*Min/.test(nearbyNoCar.etaLabel),
  'no fake 5-min hop without a car',
);
assert(/3,\s*8\s*km/i.test(nearbyNoCar.speech), 'speech leads with km');

const stripped = stripPermissionLookupAsks(
  'Ja, in Travemünde gibt es den Kurstrand. Soll ich dir die passenden Fährverbindungen oder Buslinien dorthin raussuchen?',
);
assert(!/soll ich/i.test(stripped), 'permission lookup stripped');
assert(/Travemünde|Kurstrand/i.test(stripped), 'answer kept');

assert(isAmenityFrictionQuery('wo ist die nächste Toilette'), 'toilet amenity');
assert(isPlaceGoQuery('wo ist die nächste Toilette'), 'toilet is place-go');
assert(mustSkipChatLane('wo ist die nächste Toilette'), 'toilet skips 2-satz chat');
assert(
  !isPlaceGoQuery('in der nächsten Stunde kommt der Bus'),
  'nächste Stunde is not place-go',
);
assert(isDistanceEtaQuery('wie weit ist Travemünde'), 'distance query');
assert(shouldForbidQuickChat('wie weit ist Travemünde'), 'distance forbids quick');
assert(
  !mustSkipChatLane('wie weit ist Travemünde'),
  'pure distance stays chat-eligible (pack, not pitch)',
);
assert(
  !isQuickLookupQuery('wie weit ist Travemünde'),
  'distance is not trivia quick',
);
assert(
  shouldForbidQuickChat(
    'Ich möchte jetzt gerne zum Pinneberger Bahnhof. Kannst du ein Taxi dafür rufen?',
  ),
  'taxi forbids quick chat',
);
assert(
  sanitizeRouterDecision({ lane: 'chat' }).needsResearch === 'pack',
  'chat default is pack not quick',
);

const altAsk = stripPermissionLookupAsks(
  'Die Bäckerei ist zu. Soll ich eine offene Alternative in der Nähe suchen?',
);
assert(!/soll ich/i.test(altAsk), 'alternative-search ask stripped');

assert(isPlaceGoQuery('wo ist das Café Frauchen'), 'named cafe wo-ist');
assert(isPlaceGoQuery('wo ist Frauchen'), 'named place wo-ist');
assert(!isPlaceGoQuery('wo ist Mark Forster geboren'), 'geboren is trivia not place-go');
assert(isHoursQuery('welche zeiten hat das Café'), 'welche zeiten is hours');
assert(shouldForbidQuickChat('welche zeiten hat das Café'), 'hours forbids quick');

console.log('placeGoQuery.smoke.test.ts OK');
