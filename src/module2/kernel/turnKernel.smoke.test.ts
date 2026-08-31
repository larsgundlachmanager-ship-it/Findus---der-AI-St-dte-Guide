/**
 * Invarianten-Batterie — Turn-Kernel.
 * Run: npx --yes tsx src/module2/kernel/turnKernel.smoke.test.ts
 */

import {
  decideTopicCut,
  hasMultipleIntents,
  isShowtimeReachable,
  looksLikeExplicitNavOrAddress,
  looksLikeFollowUpLite,
  looksLikeNamedTriviaSubject,
  looksLikeSlowResearch,
  looksLikeWhereAmIQuery,
  resolveTurnBridgePace,
  shouldAbortTurnForEarlyJustDoIt,
  shouldScrubDeadThread,
  speechLooksWoven,
  splitTurnIntents,
  stripListLead,
  tokenAllowedInBridge,
  looksLikeDietSelfId,
  walkEtaMinFromMeters,
  looksLikeOpenDestinationCommit,
  looksLikeCurrentFlightUtterance,
} from './turnKernel';
import { classifyUtteranceFamily } from './utteranceFamily';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Nav nach totem Wien-Flug
{
  const mode = decideTopicCut({
    userText: 'Navigiere mich zum Heisterberg 12',
    foregroundLabel: 'Flug Wien',
    lastClosedTopic: 'Flug Wien',
  });
  assert(mode === 'new' || mode === 'closed_new', 'nav after wien is new');
  assert(shouldScrubDeadThread(mode), 'scrub dead wien thread');
  assert(
    !tokenAllowedInBridge({
      userText: 'Navigiere mich zum Heisterberg 12',
      token: 'Wien',
      topicMode: mode,
    }),
    'wien forbidden in heisterberg bridge',
  );
  assert(looksLikeExplicitNavOrAddress('Navigiere mich zum Heisterberg 12'), 'nav detect');
}

// Straße+Hausnummer nach totem Wien-Flug — auch ohne „navigier“
{
  const mode = decideTopicCut({
    userText: 'Ulmenallee 23 in Pinneberg',
    foregroundLabel: 'Flug Wien',
    lastClosedTopic: 'Flug Wien',
    openLoop: 'Flug Wien',
  });
  assert(mode === 'new' || mode === 'closed_new', 'address after wien is new');
  assert(shouldScrubDeadThread(mode), 'scrub wien on street address');
  assert(
    looksLikeExplicitNavOrAddress('Ulmenallee 23 in Pinneberg'),
    'bare street+city is nav',
  );
  assert(
    !tokenAllowedInBridge({
      userText: 'Ulmenallee 23 in Pinneberg',
      token: 'Wien',
      topicMode: mode,
    }),
    'wien forbidden on ulmenallee',
  );
}

// Stadt-Korrektur nach tot em Wien-Flug — auch unter 36 Zeichen
{
  const mode = decideTopicCut({
    userText: 'Nein, Pinneberg',
    foregroundLabel: 'Flug Wien',
    lastClosedTopic: 'Flug Wien',
    openLoop: 'Flug Wien',
  });
  assert(mode === 'new' || mode === 'closed_new', 'city corr after wien is new');
  assert(shouldScrubDeadThread(mode), 'scrub wien on city corr');
  assert(looksLikeExplicitNavOrAddress('Nein, Pinneberg'), 'nein city is nav');
}

// Aktueller Amsterdam-Flug DARF Amsterdam
{
  const mode = decideTopicCut({
    userText: 'Ich möchte morgen nach Amsterdam fliegen, was sind die günstigsten Flüge?',
  });
  assert(
    tokenAllowedInBridge({
      userText: 'Ich möchte morgen nach Amsterdam fliegen, was sind die günstigsten Flüge?',
      token: 'Amsterdam',
      topicMode: mode,
    }),
    'amsterdam allowed in current flight bridge',
  );
  assert(looksLikeSlowResearch('günstigste Flüge nach Amsterdam'), 'slow flights');
  const pace = resolveTurnBridgePace(
    'Ich möchte morgen nach Amsterdam fliegen, was sind die günstigsten Flüge?',
  );
  assert(pace.pace === 'cover' && pace.bridgeMaxWords >= 16, 'slow bridge covers wait');
}

{
  const ice =
    'Oh ich hätte jetzt voll Lust auf Spaghetti-Eis, wo kann ich denn jetzt hier lecker Spaghetti-Eis essen?';
  assert(looksLikeSlowResearch(ice), 'slow ice research');
  const icePace = resolveTurnBridgePace(ice);
  assert(
    icePace.pace === 'cover' && icePace.bridgeMaxWords >= 30,
    'ice cover bridge long enough',
  );
}

// Nav-Bridge kurz
{
  const pace = resolveTurnBridgePace('Navigiere mich zum Heisterberg 12');
  assert(pace.pace === 'instant' && pace.bridgeMaxWords <= 10, 'nav bridge short');
}

// Wo bin ich = neu
{
  assert(looksLikeWhereAmIQuery('Wo bin ich hier gerade?'), 'where am i');
  const mode = decideTopicCut({
    userText: 'Wo bin ich hier gerade?',
    openLoop: 'Heisterberg 12',
  });
  assert(mode === 'new', 'where-am-i new even mid-nav');
}

// Kirche offen + Eis = weave
{
  const mode = decideTopicCut({
    userText: 'ein Eis wäre noch cool',
    openLoop: 'Kirche Marien',
  });
  assert(mode === 'weave', `church open + ice weaves, got ${mode}`);
}

// Kirche tot + Eis = closed_new
{
  const mode = decideTopicCut({
    userText: 'ich möchte gerne ein Eis essen',
    lastClosedTopic: 'Kirchturm Stufen',
  });
  assert(mode === 'closed_new' || mode === 'new', `church closed + ice new, got ${mode}`);
}

// M1 follow-up continue
{
  const mode = decideTopicCut({
    userText: 'Wie viele Stufen hat der Turm?',
    openLoop: 'Marienkirche Glockenturm',
  });
  assert(mode === 'continue', `stufen follow-up continue, got ${mode}`);
}

// Multi-intent Wecker + Spot
{
  const parts = splitTurnIntents(
    'Stell mir einen Wecker um 8:00 Uhr und such mir einen tollen Spot für einen Fischzug',
  );
  assert(parts.length >= 2, `wecker+spot split, got ${parts.length}`);
  assert(!shouldAbortTurnForEarlyJustDoIt(parts[0] ? 'Stell mir einen Wecker um 8:00 Uhr und such mir einen tollen Spot für einen Fischzug' : ''), 'compound not abort');
  assert(
    hasMultipleIntents(
      'Stell mir einen Wecker um 8:00 Uhr und such mir einen tollen Spot für einen Fischzug',
    ),
    'compound intents',
  );
}

// Wetter + was machen
{
  const parts = splitTurnIntents('Wie wird das Wetter morgen und was kann man morgen machen?');
  assert(parts.length >= 2, `weather+do split ${parts.length}`);
}

// Woven speech
{
  assert(
    speechLooksWoven(
      'Wecker ist auf 8. Danach super zum Café — bei 20 Grad können wir uns draußen setzen.',
    ),
    'woven ok',
  );
  assert(
    !speechLooksWoven('Erstens Wecker um 8. Zweitens Café. Drittens Wetter.'),
    'list lead forbidden',
  );
  assert(
    speechLooksWoven(stripListLead('Erstens der Wecker ist auf 8 und danach Café.')),
    'strip list lead',
  );
  assert(
    speechLooksWoven(
      'Entweder Eisdiele Nord — Spaghetti-Eis für 3,80, fünf Minuten zu Fuß. Oder Café Hafen — Becher mit Meerblick, etwas weiter.',
    ),
    'dual option woven',
  );
}

// Kino ETA: 17:00 + 60 min walk → 17:30 unreachable, 18:00 ok
{
  const now = new Date(2026, 7, 18, 17, 0, 0);
  const walk = walkEtaMinFromMeters(4800);
  assert(walk >= 50, `walk eta ${walk}`);
  assert(
    !isShowtimeReachable({
      whenLabel: 'heute 17:30',
      now,
      walkEtaMin: 60,
    }),
    '17:30 not reachable',
  );
  assert(
    isShowtimeReachable({
      whenLabel: 'heute 18:05',
      now,
      walkEtaMin: 60,
    }),
    '18:05 reachable',
  );
}

// Diet self-id
{
  assert(looksLikeDietSelfId('Ich bin Vegetarier').diet === 'vegetarisch', 'veg');
  assert(looksLikeDietSelfId('Ich bin vegan').diet === 'vegan', 'vegan');
}

assert(
  looksLikeOpenDestinationCommit('gehen wir zur Kirche'),
  'open dest commit',
);
assert(
  looksLikeCurrentFlightUtterance('Ich fliege von Hamburg aus am Freitag'),
  'fliege hamburg is flight',
);
assert(
  looksLikeCurrentFlightUtterance('Ich fliege am Freitag um 10:45 Uhr'),
  'fliege 10:45 is flight',
);
assert(
  looksLikeCurrentFlightUtterance('günstigste Flüge nach Amsterdam'),
  'current flight utterance',
);
assert(
  !looksLikeCurrentFlightUtterance('Navigiere mich zum Heisterberg 12'),
  'nav is not flight',
);

const ELB =
  'Ich muss morgen um 15:00 Uhr an der Hamburger Elbphilharmonie sein. Kannst du mir das einplanen?';

{
  const { classifyUtteranceFamily, looksLikeArriveByAppointment, stickyFlightAllowedForUtterance } =
    require('./utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
      looksLikeArriveByAppointment: (s: string) => boolean;
      stickyFlightAllowedForUtterance: (s: string) => boolean;
    };
  assert(looksLikeArriveByAppointment(ELB), 'elb is arrive-by');
  assert(classifyUtteranceFamily(ELB).family === 'plan', 'elb family is plan');
  assert(!stickyFlightAllowedForUtterance(ELB), 'elb not sticky flight');
  assert(
    stickyFlightAllowedForUtterance(
      'Kannst du das durchrechnen und ins Timetable eintragen?',
    ),
    'timetable follow-up stays on flight',
  );
  assert(
    classifyUtteranceFamily('Ich möchte morgen nach Antalya fliegen, am Flughafen sein').family ===
      'flight',
    'antalya is flight',
  );
  assert(
    classifyUtteranceFamily('Ich hab Lust auf Spaghettieis, wo kann ich hin?').family === 'pitch',
    'spaghetti is pitch',
  );
  assert(
    classifyUtteranceFamily('Wie ist das Wetter morgen?').family === 'weather',
    'wetter is weather',
  );
}

{
  const mode = decideTopicCut({
    userText: ELB,
    foregroundLabel: 'Flug Wien',
    lastClosedTopic: 'Flug Wien',
    openLoop: 'Flug Wien',
  });
  assert(mode === 'new' || mode === 'closed_new', `elb after flight is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub dead flight on elb appointment');
  assert(
    !tokenAllowedInBridge({
      userText: ELB,
      token: 'Wien',
      topicMode: mode,
    }),
    'wien forbidden on elb appointment',
  );
}

{
  const { isFlightTripFollowUp, isFlightTripQuery } = require('../../services/flights/flightTripIntent') as {
    isFlightTripFollowUp: (s: string, has: boolean) => boolean;
    isFlightTripQuery: (s: string) => boolean;
  };
  assert(!isFlightTripQuery(ELB), 'elb is not flight query');
  assert(!isFlightTripFollowUp(ELB, true), 'elb is not sticky flight follow-up');
  assert(
    !isFlightTripQuery('um 15 Uhr'),
    'bare clock is not a flight query — manager decides',
  );
}

{
  const mode = decideTopicCut({
    userText:
      'ich fliege morgen nach Athen, man muss am Flughafen sein',
    openLoop: 'Wer war der Papst mit dem kürzesten Pontifikat?',
    foregroundLabel: 'Papst Trivia',
  });
  assert(mode === 'new' || mode === 'closed_new', `flight after knowledge is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub dead knowledge on flight');
}

{
  const mode = decideTopicCut({
    userText: 'Ich fliege morgen nach Athen',
    openLoop: 'Steak in Hamburg essen',
    foregroundLabel: 'Essen in Hamburg',
  });
  assert(mode === 'new' || mode === 'closed_new', `flight after dining is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub dining on flight');
}

{
  const mode = decideTopicCut({
    userText: 'Flug nach Athen um 20 Uhr',
    openLoop: 'Mittag Hamburg lecker vorbereiten',
    foregroundLabel: 'Wetter in Hamburg',
  });
  assert(mode === 'new' || mode === 'closed_new', `flight after weather/lunch unknown open is new, got ${mode}`);
}


{
  const { noteLastLiveInventory, clearLastLiveInventory } = require('../../module2/context/shortTermContext') as {
    noteLastLiveInventory: (o: { kind: 'pitch_choice'; query: string }) => void;
    clearLastLiveInventory: () => void;
  };
  clearLastLiveInventory();
  noteLastLiveInventory({ kind: 'pitch_choice', query: 'Steak in Hamburg essen' });
  const rejectCut = decideTopicCut({
    userText: 'mag eigentlich kein Steak so gerne',
    openLoop: 'Steak Restaurant Hamburg',
    foregroundLabel: 'Pitch Steak',
  });
  assert(rejectCut === 'continue', `pitch reject continues, got ${rejectCut}`);
  const moreCut = decideTopicCut({
    userText: 'was gibt es noch',
    openLoop: 'Steak Restaurant Hamburg',
    foregroundLabel: 'Pitch Steak',
  });
  assert(moreCut === 'continue', `was noch continues, got ${moreCut}`);
  const clockCut = decideTopicCut({
    userText: 'um 20 Uhr',
    openLoop: 'Steak Restaurant Hamburg',
    foregroundLabel: 'Pitch Steak',
  });
  assert(clockCut === 'continue', `pitch clock continues, got ${clockCut}`);
  clearLastLiveInventory();
}


{
  const mode = decideTopicCut({
    userText: 'um 20 Uhr',
    openLoop: 'Wer war der Papst mit dem kürzesten Pontifikat?',
    foregroundLabel: 'Papst Trivia',
  });
  // Ohne offene Flug-Session: Knowledge→Clock ist Cut (kein Papst-Weave).
  assert(mode === 'new' || mode === 'closed_new', `clock after knowledge is new, got ${mode}`);
}

{
  const { exclusiveFamilyCut, classifyUtteranceFamily } = require('./utteranceFamily') as {
    exclusiveFamilyCut: (a: string, b: string) => boolean;
    classifyUtteranceFamily: (s: string) => { family: string };
  };
  assert(
    classifyUtteranceFamily('um 20 Uhr').family === 'clock',
    'bare clock is clock family',
  );
  assert(
    exclusiveFamilyCut('knowledge', 'flight'),
    'knowledge→flight exclusive cut',
  );
  assert(
    exclusiveFamilyCut('knowledge', 'clock'),
    'knowledge→clock exclusive cut',
  );
  assert(
    !exclusiveFamilyCut('flight', 'clock'),
    'flight↔clock can continue',
  );
}


// Wetter nach Pizza — nicht weben
{
  const mode = decideTopicCut({
    userText: 'Wie wird das Wetter morgen?',
    openLoop: 'Pizza essen Prisdorf',
    foregroundLabel: 'Pizza',
  });
  assert(shouldScrubDeadThread(mode), `wetter after pizza is new, got ${mode}`);
}

{
  const mode = decideTopicCut({
    userText: 'Wie wird das Wetter morgen?',
    openLoop: 'Wann fliegst du? HAM → HAM',
    foregroundLabel: 'Flug Hamburg',
  });
  assert(mode === 'new' || mode === 'closed_new', `wetter after flight is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub dead flight on weather');
}

// Events nach Nav — nicht Bahnhof weben
{
  const mode = decideTopicCut({
    userText: 'was geht heute Abend?',
    openLoop: 'Bahnhof Prisdorf',
    foregroundLabel: 'Nav Bahnhof',
  });
  assert(shouldScrubDeadThread(mode), `was geht after nav is new, got ${mode}`);
}

// Hotel nach Essen — Pitch-Kind-Schnitt
{
  const mode = decideTopicCut({
    userText: 'Ich möchte ein Hotel in Hamburg',
    openLoop: 'Pizza essen',
    foregroundLabel: 'Restaurant',
  });
  assert(shouldScrubDeadThread(mode), `hotel after food is new, got ${mode}`);
}

// Explizites neues Thema
{
  const mode = decideTopicCut({
    userText: 'neues Thema: Wetter bitte',
    openLoop: 'fuer 2 dining_menus Speisekarten Hamburg',
    foregroundLabel: 'Speisekarten',
  });
  assert(shouldScrubDeadThread(mode), `neues Thema after dining leak is new, got ${mode}`);
}

// Follow-up bleibt am offenen Ziel
{
  const mode = decideTopicCut({
    userText: 'wie weit ist das?',
    openLoop: 'Bahnhof Prisdorf',
    foregroundLabel: 'Nav Bahnhof',
  });
  assert(mode === 'continue' || mode === 'weave', `wie weit stays on nav, got ${mode}`);
}

{
  const mode = decideTopicCut({
    userText: 'Ich möchte Hamburger Pannfisch essen',
    openLoop: 'Taxi Elmshorn Uber rufen',
    foregroundLabel: 'Taxi',
  });
  assert(shouldScrubDeadThread(mode), `pannfisch after taxi is new, got ${mode}`);
}

{
  const mode = decideTopicCut({
    userText: 'Ich möchte Hamburger Pannenfisch essen',
    openLoop: 'Steak essen Rindocks',
    foregroundLabel: 'Steak',
  });
  assert(shouldScrubDeadThread(mode), `pannfisch after steak is new, got ${mode}`);
}

{
  const pace = resolveTurnBridgePace('Wie wird das Wetter heute?');
  assert(pace.bridgeMaxWords === 14, `weather has short lookup bridge, got ${pace.bridgeMaxWords}`);
  assert(
    classifyUtteranceFamily('Wie wird das Wetter heute?').family === 'weather',
    'wetter family',
  );
  assert(
    classifyUtteranceFamily('dann lass uns ein Picknick machen').family === 'pitch',
    'picknick is pitch family',
  );
}

// Genannter Spielplan → Cover-Pace (frühe Bridge), kein Instant
{
  const towers = resolveTurnBridgePace(
    'Wann spielen die Hamburg Towers in der Ballsporthalle?',
  );
  assert(
    towers.pace === 'cover' && towers.bridgeMaxWords >= 20,
    `named schedule cover, got ${towers.pace}/${towers.bridgeMaxWords}`,
  );
}

{
  const mode = decideTopicCut({
    userText: 'dann lass uns ein Picknick machen',
    openLoop: 'Flug nach Athen Hotel? Mietwagen?',
    foregroundLabel: 'Flug Athen',
  });
  assert(shouldScrubDeadThread(mode), `picnic after flight is new, got ${mode}`);
}

// Trivia nach totem Pitch-Thema — kein Gurkenzeit-Weave, Bridge darf kommen
{
  const mode = decideTopicCut({
    userText: 'Wie alt ist der Papst?',
    openLoop: 'saure Gurkenzeit',
    foregroundLabel: 'saure Gurkenzeit',
    lastClosedTopic: 'saure Gurkenzeit',
  });
  assert(mode === 'new' || mode === 'closed_new', `papst after gurkenzeit is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub gurkenzeit on papst trivia');
  assert(
    classifyUtteranceFamily('Wie alt ist der Papst?').family === 'knowledge',
    'papst is knowledge family',
  );
}

// Personen-Alter nach Sport-Spielplan — Topic-Cut, kein Towers-Sticky
{
  const neuer = 'Wie alt ist Manuel Neuer?';
  const mode = decideTopicCut({
    userText: neuer,
    openLoop: 'Wann spielen die Hamburg Towers in der Ballsporthalle?',
    foregroundLabel: 'Hamburg Towers Spielplan',
  });
  assert(mode === 'new' || mode === 'closed_new', `neuer after towers is new, got ${mode}`);
  assert(shouldScrubDeadThread(mode), 'scrub towers on person-age trivia');
  assert(
    classifyUtteranceFamily(neuer).family === 'knowledge',
    'manuel neuer age is knowledge',
  );
  assert(
    looksLikeNamedTriviaSubject(neuer),
    'manuel neuer is named trivia subject',
  );
  assert(
    !looksLikeFollowUpLite(neuer),
    'named person age is not follow-up lite',
  );
  const pace = resolveTurnBridgePace(neuer);
  assert(
    pace.pace === 'cover',
    `person-age must be cover pace for early bridge, got ${pace.pace}`,
  );
}

console.log('TURN KERNEL GATE GRÜN');
