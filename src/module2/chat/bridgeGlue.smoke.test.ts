/**
 * Bridge darf nicht aus Parser-Slots geklebt sein.
 * Call-1-Inhalt nie wegen Wait-Floskel verwerfen.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/chat/bridgeGlue.smoke.test.ts
 */
import {
  ensureBridgeAnchoredToAsk,
  looksLikeSlotGluedBridge,
  looksLikeSoleVagueFillerBridge,
  sanitizeBridgeText,
  scrubBridgeCityLeak,
  extractBridgeUserPlace,
} from './bridgeGlue';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeSlotGluedBridge('nach Antalya muss klingt richtig gut') === true,
  'dest+muss+klingt',
);
assert(
  looksLikeSlotGluedBridge(
    'Antalya wann muss klingt richtig gut — ich mach dir den Flieger klar.',
  ) === true,
  'klingt richtig gut',
);
assert(
  looksLikeSlotGluedBridge(
    'Genau das setz ich jetzt um — die konkreten Zahlen kommen direkt hinterher.',
  ) === false,
  'emergency complete sentence',
);
assert(
  looksLikeSlotGluedBridge(
    'Bei dem Wetter ist Spaghetti-Eis genau die richtige Wahl.',
  ) === false,
  'conceived ice intro',
);


assert(
  sanitizeBridgeText('Ich schau mal kurz') != null,
  'Call-1 wait bridge kept — no filler Notbremse',
);
assert(
  looksLikeSoleVagueFillerBridge('Wissen kommt gleich') === true,
  'wissen kommt gleich is vague (detect only, no kill)',
);
assert(
  ensureBridgeAnchoredToAsk('Wissen kommt gleich', 'Morgen All you can eat kein asiatisch') ===
    'Wissen kommt gleich',
  'no re-anchor Notbremse — Call-1 text unchanged',
);
assert(
  sanitizeBridgeText('Klar, ich guck kurz nach dem Wetter.') != null,
  'job-anchored weather bridge kept',
);
assert(
  sanitizeBridgeText('Bei dem Wetter ist Spaghetti-Eis genau die richtige Wahl.')
    != null,
  'content sentence kept',
);
assert(
  sanitizeBridgeText('nach Antalya muss klingt richtig gut') === null,
  'glued bridge killed',
);

assert(
  extractBridgeUserPlace('Wie viele Einwohner hat Pilleberg?') === 'Pilleberg',
  'extract place from einwohner question',
);
assert(
  scrubBridgeCityLeak({
    bridge: 'Ich schaue nach, wie viele Einwohner Prisdorf hat.',
    userText: 'Wie viele Einwohner hat Pilleberg?',
    gpsCities: ['Prisdorf'],
  }) === 'Ich schaue nach, wie viele Einwohner Pilleberg hat.',
  'gps city leak replaced with user place',
);

assert(
  sanitizeBridgeText('ZIELZUSTAND: User will AYCE. work[] dining suchen.') ===
    null,
  'internal call1 think never spoken as bridge',
);

{
  const { scrubTriviaClarifyBridge, scrubPrematureTriviaFacts } = require('./bridgeGlue') as {
    scrubTriviaClarifyBridge: (o: {
      bridge: string;
      userText: string;
    }) => string | null;
    scrubPrematureTriviaFacts: (o: {
      bridge: string;
      userText: string;
    }) => string | null;
  };
  assert(
    scrubTriviaClarifyBridge({
      bridge: 'Wen genau meinst du denn?',
      userText: 'Wie heißt der Papst?',
    }) === null,
    'trivia clarify scrubbed',
  );
  assert(
    scrubTriviaClarifyBridge({
      bridge: 'Ich schau direkt nach dem aktuellen Papst.',
      userText: 'Wie heißt der Papst?',
    }) != null,
    'good trivia bridge kept',
  );
  assert(
    scrubPrematureTriviaFacts({
      bridge: 'Der Papst ist ungefähr 88 Jahre alt.',
      userText: 'Wie alt ist der Papst?',
    }) === null,
    'premature age scrubbed',
  );
  assert(
    scrubPrematureTriviaFacts({
      bridge: 'Zum Alter vom aktuellen Papst —',
      userText: 'Wie alt ist der Papst?',
    }) != null,
    'intro without age kept',
  );
  assert(
    scrubPrematureTriviaFacts({
      bridge: 'Klar, ich guck kurz nach dem Wetter.',
      userText: 'Wie ist das Wetter?',
    }) != null,
    'non-trivia untouched',
  );
  assert(
    scrubPrematureTriviaFacts({
      bridge: 'Pilleberg hat rund 2300 Einwohner.',
      userText: 'Wie viele Einwohner hat Pilleberg?',
    }) === null,
    'premature einwohner scrubbed',
  );
}

{
  const { scrubAffiliateMonetizationSpeech } = require('./bridgeGlue') as {
    scrubAffiliateMonetizationSpeech: (t: string) => string;
  };
  const cleaned = scrubAffiliateMonetizationSpeech(
    'Hier ist ein Affiliate Link, dafür bekommen wir Geld. Zimmer buchen geht so.',
  );
  assert(!/affiliate/i.test(cleaned), 'affiliate scrubbed');
  assert(!/bekommen wir geld/i.test(cleaned), 'money pitch scrubbed');
  assert(/zimmer buchen/i.test(cleaned), 'content kept');
}

console.log('bridgeGlue.smoke.test.ts OK');
