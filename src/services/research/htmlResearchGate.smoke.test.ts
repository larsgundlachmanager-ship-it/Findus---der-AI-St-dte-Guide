/**
 * Run: npx --yes tsx src/services/research/htmlResearchGate.smoke.test.ts
 */
import {
  isBogusNavDestName,
  isHtmlScrapeFailureSpeech,
  shouldSkipHtmlWebResearch,
} from './htmlResearchGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  shouldSkipHtmlWebResearch('Wie alt ist der Papst?'),
  'pope trivia is not HTML scrape',
);
assert(
  shouldSkipHtmlWebResearch('Navigiere mich zur Ulmenallee 23'),
  'street nav is not HTML scrape',
);
assert(
  shouldSkipHtmlWebResearch('Wie wird morgen das Wetter?'),
  'weather is not HTML scrape',
);
assert(
  shouldSkipHtmlWebResearch(
    'Ich möchte morgen gerne frühstücken gehen hier in Prisdorf. Was kannst du mir empfehlen?',
  ),
  'breakfast recommend is not HTML scrape',
);
assert(
  shouldSkipHtmlWebResearch('wo kann man am besten steak essen?'),
  'best-steak search is places not HTML scrape',
);
assert(
  !shouldSkipHtmlWebResearch('Zeig mir die Speisekarte vom Hotel zur Post'),
  'named menu still may scrape',
);
assert(
  isHtmlScrapeFailureSpeech(
    'Dazu komme ich online nicht an alle Details ran: Seiten leer oder JS-only.',
  ),
  'js-only is scrape failure speech',
);
assert(isBogusNavDestName('Seiten leer'), 'hud pin seiten leer');
assert(isBogusNavDestName('📍 Seiten leer oder JS-only'), 'pin with emoji bogus');
assert(isBogusNavDestName('Hochhäuser'), 'category hochhaeuser');
assert(isBogusNavDestName('Hochhäuser, Museen'), 'category list');
assert(isBogusNavDestName('Museen in Hamburg'), 'category in city');
assert(!isBogusNavDestName('Tele-Michel'), 'concrete landmark ok');
assert(!isBogusNavDestName('Heinrich-Hertz-Turm'), 'named tower ok');
assert(
  isBogusNavDestName(
    'fuer 2 [TASK dining_menus] Speisekarten-URLs wenn möglich, Hamburg',
  ),
  'manager TASK leak is not a nav dest',
);
assert(
  isBogusNavDestName('fuer 2 dining_menus Speisekarten-URLs Hamburg'),
  'dining_menus leak without brackets is not a nav dest',
);
assert(!isBogusNavDestName('Ulmenallee 23'), 'street dest is real');
assert(isBogusNavDestName('Dezember'), 'month alone is bogus nav');
assert(isBogusNavDestName('27. Dezember'), 'day+month is bogus nav');
{
  const { isMonthOrDateOnlyNavName } = require('./htmlResearchGate') as {
    isMonthOrDateOnlyNavName: (n: string) => boolean;
  };
  assert(isMonthOrDateOnlyNavName('Dezember'), 'dezember month-only');
  assert(isMonthOrDateOnlyNavName('15.04.'), 'numeric date-only');
  assert(!isMonthOrDateOnlyNavName('Barclays Arena'), 'venue not date');
}

console.log('htmlResearchGate.smoke.test.ts ok');
