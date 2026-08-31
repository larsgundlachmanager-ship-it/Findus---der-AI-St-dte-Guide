/**
 * Live-Inventar-Weiche — Chat darf Hotel/Auswahl nicht erfinden.
 * Run: npx --yes tsx src/module2/router/liveInventoryGate.smoke.test.ts
 */

import {
  clearLastLiveInventory,
  noteLastLiveInventory,
} from '../context/shortTermContext';
import {
  detectLiveInventoryKind,
  isInventoryFollowUp,
  mustSkipChatLane,
  resolveLiveInventoryUserText,
} from './liveInventoryGate';
import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import { detectPitchKind } from '../pitch/parentBrief';
import { classifyJob } from '../jobs/classifyJob';
import { isParkingThenTour } from './compoundFollowUp';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

clearLastLiveInventory();

const hotelQ =
  'das günstigste Hotel das ist von heute bis morgen in Lübeck gibt';
assert(detectLiveInventoryKind(hotelQ) === 'hotel', 'hotel kind');
assert(mustSkipChatLane(hotelQ), 'hotel skips chat');
assert(shouldHandoffToPitchModule(hotelQ), 'hotel → pitch');
assert(classifyJob(hotelQ).jobId === 'stay_search', 'hotel job stay_search');

const compound =
  'das Spiel aktuelle Turnier hier auf dieser Anlage wo ich gerade bin das günstigste Hotel das ist von heute bis morgen in Lübeck gibt';
assert(mustSkipChatLane(compound), 'compound tournament+hotel skips chat');
assert(classifyJob(compound).jobId === 'stay_search', 'compound not dining');

noteLastLiveInventory({ kind: 'hotel', query: hotelQ });
const ja = resolveLiveInventoryUserText('ja');
assert(ja.inherited, 'ja inherits');
assert(ja.kind === 'hotel', 'ja kind hotel');
assert(/hotel/i.test(ja.text), 'ja expands to hotel query');
assert(mustSkipChatLane('ja'), 'ja skips chat while hotel pending');

const price = resolveLiveInventoryUserText('wie teuer ist das');
assert(price.inherited, 'wie teuer inherits');
assert(mustSkipChatLane('wie teuer ist das'), 'price follow-up skips chat');

assert(isInventoryFollowUp('genau'), 'genau is follow-up');
assert(!isInventoryFollowUp('was geht heute Abend beim Festival'), 'festival is new topic');

clearLastLiveInventory();
assert(!mustSkipChatLane('ja'), 'ja without pending does not skip chat');
assert(
  !mustSkipChatLane('Wann ist die Sonnenfinsternis?'),
  'sky stays chat-eligible',
);

assert(
  mustSkipChatLane('schönes Hotel für heute Nacht', {
    chatLane: 'chat',
    blueprintId: 'hotel/hotel_choice',
  }),
  'blueprint hotel skips chat even if router said chat',
);

assert(detectLiveInventoryKind('was geht heute Abend in Lübeck') === 'events', 'events kind');
assert(mustSkipChatLane('was geht heute Abend in Lübeck'), 'events skip chat');
assert(mustSkipChatLane('Wo kann ich heute Abend feiern / Party?'), 'party skip chat');
assert(
  mustSkipChatLane(
    'Ich möchte jetzt gerne zum Pinneberger Bahnhof. Kannst du ein Taxi dafür rufen?',
  ),
  'taxi ride skips chat',
);
assert(
  mustSkipChatLane(
    'ja wo kann man dann Party machen gibt es irgendwelche Party locations',
  ),
  'party locations skip chat',
);
assert(
  detectLiveInventoryKind(
    'wo ist denn hier der beste Strand in Lübeck wo man hingehen könnte',
  ) === 'pitch_choice',
  'best beach is pitch not chat',
);
assert(
  mustSkipChatLane(
    'gibt es in Lübeck einen Strand an dem man ins Wasser gehen kann',
  ),
  'swim beach skips chat',
);
assert(
  shouldHandoffToPitchModule(
    'gibt es in Lübeck einen Strand an dem man ins Wasser gehen kann',
  ),
  'swim beach → pitch',
);
assert(
  detectLiveInventoryKind('heute Abend essen gehen') === 'pitch_choice',
  'dinner tonight is gastro pitch not events',
);
assert(
  detectLiveInventoryKind(compound) === 'hotel',
  'tournament+hotel stays hotel not events',
);
assert(
  detectLiveInventoryKind('wo ist die nächste Toilette') === 'pitch_choice',
  'toilet amenity is pitch',
);
assert(mustSkipChatLane('wo ist die nächste Apotheke'), 'pharmacy skips chat');

noteLastLiveInventory({ kind: 'events', query: 'was geht heute Abend in Lübeck' });
const jaEvent = resolveLiveInventoryUserText('ja');
assert(jaEvent.inherited && jaEvent.kind === 'events', 'ja inherits events');
assert(mustSkipChatLane('ja'), 'ja skips chat while events pending');

assert(isInventoryFollowUp('wann gehts los'), 'event wann follow-up');
assert(isInventoryFollowUp('erzähl mehr'), 'event erzaehl follow-up');
const wannEv = resolveLiveInventoryUserText('wann gehts los');
assert(wannEv.inherited && wannEv.kind === 'events', 'wann inherits events');

const timesFollow = resolveLiveInventoryUserText('welche zeiten');
assert(timesFollow.inherited && timesFollow.kind === 'events', 'zeiten follow inherits events');
assert(/heute Abend/i.test(timesFollow.text), 'zeiten follow keeps event query');

const openHours = resolveLiveInventoryUserText('öffnungszeiten');
assert(openHours.inherited && openHours.kind === 'events', 'öffnungszeiten inherits (umlaut)');

assert(detectLiveInventoryKind('und wenn tanzen möchte') === 'events', 'tanzen is events');
assert(mustSkipChatLane('und wenn tanzen möchte'), 'tanzen skips chat');

assert(
  detectLiveInventoryKind(
    'dann kannst du mir ja Zeit empfehlen wenn ich heute bis morgen in Lübeck bleiben möchte',
  ) === 'hotel',
  'overnight stay is hotel not tennis/events',
);
assert(
  mustSkipChatLane(
    'Zeit empfehlen wenn ich heute bis morgen in Lübeck bleiben möchte',
  ),
  'bleiben skips chat',
);

clearLastLiveInventory();
noteLastLiveInventory({ kind: 'hotel', query: hotelQ });
assert(
  resolveLiveInventoryUserText('und wenn tanzen möchte').kind === 'events',
  'tanzen does not inherit hotel',
);
assert(
  !resolveLiveInventoryUserText('und wenn tanzen möchte').inherited,
  'tanzen is new topic',
);

clearLastLiveInventory();
noteLastLiveInventory({ kind: 'hotel', query: hotelQ });
assert(
  !resolveLiveInventoryUserText('Wie wird das Wetter morgen').inherited,
  'wetter does not inherit hotel',
);
assert(
  !resolveLiveInventoryUserText('neues Thema Wetter bitte').inherited,
  'neues Thema does not inherit hotel',
);
assert(
  !resolveLiveInventoryUserText('was geht heute Abend').inherited,
  'was geht does not inherit hotel',
);

assert(
  detectLiveInventoryKind(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus',
  ) === 'pitch_choice',
  'free parking is pitch not save',
);
assert(
  mustSkipChatLane(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus von denen ich die Stadt super erkunden kann',
  ),
  'parking+explore skips chat',
);
assert(
  isParkingThenTour(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus von denen ich die Stadt super erkunden kann',
  ),
  'parking then tour compound',
);
assert(
  shouldHandoffToPitchModule(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus von denen ich die Stadt super erkunden kann',
  ),
  'parking search → pitch before tour',
);
assert(
  detectLiveInventoryKind(
    'suche mir in Lübeck einen kostenlosen Parkplatz raus von denen ich die Stadt super erkunden kann dann eine Tour zusammenstellen',
  ) === 'pitch_choice',
  'parking+tour kind is pitch not hotel',
);

assert(
  detectPitchKind(
    'kostenlosen Parkplatz und von da aus eine Tour zusammenstellen',
  ) === 'generic',
  'parking before tour kind',
);
assert(
  detectPitchKind('das günstigste Hotel von heute bis morgen') === 'hotel',
  'hotel still hotel',
);

assert(
  shouldHandoffToPitchModule('dann lass uns ein Picknick machen'),
  'picknick → pitch',
);
assert(
  detectPitchKind('dann lass uns ein Picknick machen') === 'sight',
  'picknick kind sight',
);
assert(
  detectLiveInventoryKind('lass uns ein Picknick machen') === 'pitch_choice',
  'picknick is live inventory pitch',
);

clearLastLiveInventory();
noteLastLiveInventory({
  kind: 'pitch_choice',
  query: 'Steak in Hamburg essen',
});
assert(isInventoryFollowUp('nee das mag ich nicht'), 'reject is pitch follow-up');
assert(isInventoryFollowUp('was gibt es noch'), 'was noch is pitch follow-up');
assert(isInventoryFollowUp('andere Option bitte'), 'andere option follow-up');
assert(
  isInventoryFollowUp('mag eigentlich kein Steak so gerne'),
  'kein steak follow-up',
);
const reject = resolveLiveInventoryUserText('mag eigentlich kein Steak so gerne');
assert(reject.inherited, 'kein steak inherits pitch query');
assert(reject.kind === 'pitch_choice', 'kein steak kind pitch');
assert(/^in Hamburg essen\b/i.test(reject.text), 'steak stripped from base query');
assert(/Kein Steak/i.test(reject.text), 'kein steak in feedback rewrite');
assert(shouldHandoffToPitchModule('was gibt es noch'), 'was noch → pitch handoff');
assert(mustSkipChatLane('nee das mag ich nicht'), 'reject skips chat');

const clock = resolveLiveInventoryUserText('um 20 Uhr');
assert(isInventoryFollowUp('um 20 Uhr'), 'bare clock is pitch follow-up');
assert(clock.inherited, 'bare clock inherits pitch query');
assert(/Steak in Hamburg essen/i.test(clock.text), 'clock keeps pitch base');
assert(/\bum 20 Uhr\b/i.test(clock.text), 'clock time merged');
assert(shouldHandoffToPitchModule('um 20 Uhr'), 'bare clock → pitch handoff');

clearLastLiveInventory();
assert(!isInventoryFollowUp('um 20 Uhr'), 'bare clock without pending is not follow-up');

// Personen-Alter nach Sport-Events: kein Inventory-Follow-up / kein Merge
clearLastLiveInventory();
noteLastLiveInventory({
  kind: 'events',
  query: 'Wann spielen die Hamburg Towers in der Ballsporthalle?',
});
assert(
  !isInventoryFollowUp('Wie alt ist Manuel Neuer?'),
  'person age is not sports inventory follow-up',
);
const neuerInv = resolveLiveInventoryUserText('Wie alt ist Manuel Neuer?');
assert(!neuerInv.inherited, 'person age does not inherit towers query');
assert(!/Towers/i.test(neuerInv.text), 'person age text stays clean of towers');

console.log('liveInventoryGate.smoke.test.ts OK');
