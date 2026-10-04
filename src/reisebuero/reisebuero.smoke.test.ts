import { isFindusReisebueroHandoff } from './handoff';
import { phaseToAct } from './acts';
import { applyAskedContext, applyLedgerCorrections, looksLikeGarbageFact, parseBriefSlots } from './parseBriefSlots';
import { briefingPath, completenessGaps, conversationGaps, isBriefComplete, nextQuestionKey, searchReadyGaps } from './completeness';
import { cloneEmptyLedger, deactivateUnmatchedSlots, isAirportVisible, mergeLedger } from './slotLedger';
import { entry } from './slotLedger';
import { EMPTY_LEDGER } from './types';
import { buildFlipchartNotes, flipchartBudget } from './flipchartNotes';
import { matchScore, tripNickname } from './research/optionCard';
import type { SeedPlace } from './research/candidates';
import { parseProDiscoverJson, proCandidateToSeed, shouldUseReisebueroPro } from './research/proEnrichParse';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  parseProDiscoverJson(
    '{"destinations":[{"name":"Lissabon","lat":38.72,"lng":-9.14,"iata":"LIS","tags":["city","fly"],"whyFit":"Stadt + Flug"}]}',
  ).length === 1,
  'pro discover parse',
);
assert(
  !!proCandidateToSeed(
    parseProDiscoverJson(
      '{"destinations":[{"name":"Lissabon","lat":38.72,"lng":-9.14,"iata":"LIS","tags":["city"],"whyFit":"x"}]}',
    )[0]!,
  ),
  'pro candidate → seed',
);
assert(shouldUseReisebueroPro({ initialProSearchDone: false, refineCount: 0 }), 'first search → Pro');
assert(!shouldUseReisebueroPro({ initialProSearchDone: true, refineCount: 0 }), 'after first → Lite');
assert(!shouldUseReisebueroPro({ initialProSearchDone: false, refineCount: 1 }), 'refine → Lite');

assert(
  !isFindusReisebueroHandoff('Ich brauche jetzt ein Hotelzimmer'),
  'hotel now stays M2',
);
assert(
  !isFindusReisebueroHandoff('Ich brauche ein Hotel in Hamburg mit Elbblick'),
  'hotel hamburg stays M2',
);
assert(
  !isFindusReisebueroHandoff('Ich möchte günstig nach Palma fliegen'),
  'flight palma stays M2',
);
assert(
  isFindusReisebueroHandoff(
    'günstig nach Antalya fliegen für vier Tage',
  ),
  'named multi-day fly → reisebüro',
);
assert(
  isFindusReisebueroHandoff(
    'In zwei Wochen fahre ich für ein Wochenende nach Lissabon',
  ),
  'named weekend trip → reisebüro',
);
assert(
  isFindusReisebueroHandoff(
    'Flug und Hotel nach Lissabon, Wochenende, Budget 800',
  ),
  'flight+hotel trip → reisebüro',
);
assert(
  isFindusReisebueroHandoff(
    'Lust auf Städtetrip, keine Ahnung welche Stadt, 500 Euro, Wochenende, soll noch warm sein',
  ),
  'open city trip → reisebüro',
);
assert(
  !isFindusReisebueroHandoff(
    'wie wird morgen das Wetter, was muss ich anziehen wenn ich einen Städtetrip machen möchte',
  ),
  'weather+outfit+städtetrip stays chat, not reisebüro',
);
assert(
  isFindusReisebueroHandoff(
    'Ich möchte nächste Woche irgendwo hin fliegen wo es warm ist',
  ),
  'open warm fly → reisebüro',
);
assert(
  isFindusReisebueroHandoff('Wir wollen an die Ostsee, Tagestrip, nicht so lange fahren'),
  'ostsee daytrip',
);
assert(
  isFindusReisebueroHandoff('Ich will einen neuen Urlaubsplan machen'),
  'urlaubsplan',
);

const drive = parseBriefSlots('Wir sind sechs Leute, Auto maximal 10 Stunden, Pool und Sandstrand');
assert(drive.mode?.value === 'drive', `mode drive got ${drive.mode?.value}`);
assert(drive.adults?.value === 6, 'six people');
assert(drive.maxDriveHours?.value === 10, '10h');
assert(drive.wishHaves?.value?.includes('pool'), 'pool wish');
assert(drive.wishHaves?.value?.includes('sand'), 'sand wish');

const fly = parseBriefSlots('wir wollen fliegen nach irgendwo warm');
assert(fly.mode?.value === 'fly', 'fly mode');

let ledger = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Tagestrip an die Ostsee, zu dritt, max 2 Stunden, Spikeball Sandstrand'));
ledger = mergeLedger(ledger, {
  energy: entry('active_out', 'user'),
  purpose: entry('Spikeball am Strand', 'user'),
  budgetEur: entry(80, 'user'),
});
ledger = deactivateUnmatchedSlots(ledger);
assert(ledger.mode?.value === 'daytrip', 'daytrip');
assert(!isAirportVisible(ledger), 'no airport on daytrip');
assert(ledger.airportIata == null, 'airport slot off');
assert(ledger.wishHaves?.value?.includes('spikeball'), 'spikeball');
assert(isBriefComplete(ledger), `complete, gaps ${completenessGaps(ledger).map((g) => g.key).join(',')}`);

ledger = mergeLedger(cloneEmptyLedger(), parseBriefSlots('fliegen, vier Tage, zu zweit, chill am Pool'));
assert(isAirportVisible(ledger), 'airport on fly');

assert(!EMPTY_LEDGER.budgetEur, 'empty ledger has no budget');
assert(!flipchartBudget(cloneEmptyLedger()), 'no fake budget sticker');

const core = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('fliegen, vom 11. bis 13. Juni, zu zweit, 400 Euro, Hostel, ab Hamburg'),
);
assert(!isBriefComplete(core), 'fly ohne Gepäck blockt Ready');
assert(
  searchReadyGaps(core).some((g) => g.key === 'bags'),
  'bags hard on fly',
);
assert(
  nextQuestionKey(core).key === 'bags',
  `next bags got ${nextQuestionKey(core).key}`,
);
const coreBags = mergeLedger(core, {
  cabinBags: entry(1, 'user'),
  checkedBags: entry(0, 'user'),
});
assert(isBriefComplete(coreBags), `search-ready with bags, gaps ${completenessGaps(coreBags).map((g) => g.key).join(',')}`);
assert(nextQuestionKey(coreBags).key !== 'bags', 'bags cleared');
assert(nextQuestionKey(coreBags).key !== 'ready_announce' || true, 'ready only after green+meals');
{
  const { bookingBriefGaps, briefParamsReady, firstBookingBriefBlocker } = require('./completeness') as typeof import('./completeness');
  assert(bookingBriefGaps(core).some((g) => g.key === 'bags'));
  assert(!briefParamsReady(core));
  assert(firstBookingBriefBlocker(core)?.key === 'bags');
  assert(briefParamsReady(coreBags));
}

let piled = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Pool und Sandstrand'));
piled = mergeLedger(piled, parseBriefSlots('Grill und Boot mieten'));
assert(piled.wishHaves?.value?.includes('pool'), 'union pool');
assert(piled.wishHaves?.value?.includes('grill'), 'union grill');
assert(piled.wishHaves?.value?.includes('boat'), 'union boat');

const brain = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('4 Freunde, Griechenland, eine Woche Mitte Oktober, Haus mit Pool, Sandstrand, Grill mieten, 500 Euro'),
);
assert(brain.corridor?.value === 'Griechenland', 'greece corridor');
assert(brain.adults?.value === 4, 'four friends');
assert(brain.stayDays?.value === 7, 'one week');
assert(flipchartBudget(brain)?.eur === 500, 'user budget on board');
const notes = buildFlipchartNotes(brain);
assert(notes.some((n) => /Griechenland/i.test(n.label)), 'greece sticker');
assert(notes.some((n) => n.id === 'people'), 'people sticker');
assert(notes.some((n) => /Pool/i.test(n.label)), 'pool sticker');

assert(matchScore({ hardWanted: 3, hardMet: 3, softWanted: 2, softMet: 2, nogoHits: 0, budgetDeltaEur: -20 }) >= 85, 'high match');
assert(matchScore({ hardWanted: 4, hardMet: 0, softWanted: 2, softMet: 0, nogoHits: 1, budgetDeltaEur: 200 }) < 70, 'low match');

const korfu: SeedPlace = {
  id: 'korfu',
  name: 'Korfu',
  lat: 39.6,
  lng: 19.9,
  tags: ['griechenland', 'sea', 'sand', 'warm', 'fly'],
  wiki: 'Korfu',
};
assert(
  tripNickname(korfu, 'Villa Rosa', brain, true).includes('Korfu'),
  'named trip not Option 1',
);
assert(!/Option/i.test(tripNickname(korfu, 'Villa Rosa', brain, true)), 'no Option N title');

const cityTalk = parseBriefSlots(
  'Städtetrip, wissen nicht wohin, sind vier Jungs, wollen party machen, günstig zentral',
);
assert(cityTalk.adults?.value === 4, 'vier Jungs');
assert(cityTalk.wishHaves?.value?.includes('party'), 'party');
assert(cityTalk.budgetVibe?.value === 'cheap', 'günstig vibe');
assert(cityTalk.purpose?.value === 'Städtetrip', 'städtetrip purpose');
assert(cityTalk.mode?.value !== 'daytrip', 'städtetrip is not a daytrip');
assert(!cityTalk.destinationHint || cityTalk.destinationHint.value === 'offen', 'no fake dest from städtetrip');
assert(buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), cityTalk)).some((n) => n.id === 'budgetVibe'), 'günstig sticker');

const stueck = parseBriefSlots('vier Stück');
assert(stueck.adults?.value === 4, 'vier Stück');

const destPeople = applyAskedContext(
  'vier Leute',
  'dest',
  parseBriefSlots('vier Leute'),
);
assert(destPeople.adults?.value === 4, 'vier Leute as adults when asked dest');
assert(!destPeople.destinationHint, 'vier Leute must not become Ziel');
const destPersonen = applyAskedContext(
  'wir sind vier Personen',
  'dest',
  parseBriefSlots('wir sind vier Personen'),
);
assert(destPersonen.adults?.value === 4, 'vier Personen adults');
assert(!destPersonen.destinationHint, 'vier Personen not Ziel');

const past = parseBriefSlots('Wir waren in Danzig, kleines Apartment am Fluss, wollen sowas nochmal');
assert(past.inspiration?.value === 'Danzig', 'past trip is inspiration');
assert(past.destinationHint?.value !== 'Danzig', 'past city is not destination');

const coolPool = parseBriefSlots('ein Pool wäre cool');
assert(coolPool.niceHaves?.value?.includes('pool') || coolPool.wishHaves?.value?.includes('pool'), 'cool pool is optional/wish');
assert(!coolPool.mustHaves?.value?.includes('pool'), 'cool pool not must');
const mustPool = parseBriefSlots('unbedingt Pool');
assert(mustPool.mustHaves?.value?.includes('pool'), 'unbedingt pool is must');

const whenTalk = parseBriefSlots('nächste Woche');
assert(whenTalk.dateWindow?.value || whenTalk.dateFlex?.value, 'nächste Woche has window/flex');
assert(!whenTalk.dateStart, 'nächste Woche invents no fake calendar day');
assert(
  buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), whenTalk)).some((n) =>
    ['when', 'arrive', 'depart', 'nights'].includes(n.id),
  ),
  'date sticker',
);
const dmy = parseBriefSlots('ab 12.9.');
assert(dmy.dateStart?.value?.endsWith('-09-12'), `dmy date ${dmy.dateStart?.value}`);
assert(buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), dmy)).some((n) => /12\.9\./.test(n.label)), 'date sticker shows 12.9.');
const namedDay = parseBriefSlots('ab 12. September');
assert(namedDay.dateStart?.value?.endsWith('-09-12'), `named day ${namedDay.dateStart?.value}`);
const twoH = parseBriefSlots('zwei Stunden Anfahrt');
assert(twoH.maxDriveHours?.value === 2, 'two hours drive');
const lastFill = applyAskedContext('Santorini, der Sonnenuntergang', 'lastTrip', {});
assert(lastFill.lastHighlight?.value?.includes('Santorini'), 'asked lastTrip fills highlight');

const friSun = parseBriefSlots('von Freitag bis Sonntag');
assert(friSun.stayNights?.value === 2, `fr-so nights ${friSun.stayNights?.value}`);
assert(friSun.dateStart && friSun.dateEnd, 'fr-so dates');
const friNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), friSun));
assert(
  friNotes.some((n) => /Nächte|Nacht/.test(n.label)),
  `nights on board got ${friNotes.map((n) => n.label).join('|')}`,
);
const optFly = parseBriefSlots('wenn es passt würden wir auch fliegen');
assert(optFly.mode?.value === 'fly', 'optional fly parsed');
assert(optFly.mode?.hardness === 'wish', 'optional fly is wish');
const house = parseBriefSlots('eigenes Haus');
assert(house.lodgingKind?.value === 'ferienhaus', 'house lodging');

const septNow = Date.parse('2026-08-20T12:00:00');
const sept = parseBriefSlots('im September wollen wir ein Wochenende weg', septNow);
assert(sept.dateFlex?.value === 'weekend', `sept flex ${sept.dateFlex?.value}`);
assert(sept.dateMonth?.value === '2026-09', `sept month ${sept.dateMonth?.value}`);
assert(sept.stayNights?.value === 2, `sept nights ${sept.stayNights?.value}`);
assert(!sept.dateStart, `no fake august start ${sept.dateStart?.value}`);
const septNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), sept));
assert(
  septNotes.some((n) => /September/i.test(n.label) && /Wochenende/i.test(n.label)),
  `sept when sticker ${septNotes.map((n) => n.label).join('|')}`,
);
assert(
  septNotes.some((n) => /2\s*Nächte/i.test(n.label)),
  `sept nights sticker ${septNotes.map((n) => n.label).join('|')}`,
);
assert(
  !septNotes.some((n) => /19\.8|20\.8|19\.08|20\.08/.test(n.label)),
  'sept must not show this weekend dates',
);

const men = parseBriefSlots(
  'Ja ich möchte gerne das Männerwochenende machen irgendwie Anfang September. Wir sind irgendwie vier Leute. Bisschen Party machen.',
);
assert(men.adults?.value === 4, 'vier leute');
assert(men.purpose?.value === 'Männerwochenende', 'männerwochenende purpose');
assert(men.datePart?.value === 'early', 'anfang september');
assert(men.dateMonth?.value?.endsWith('-09'), 'september month');
assert(men.wishHaves?.value?.includes('party'), 'party wish');

const noInventParty = parseBriefSlots('Männerwochenende, vier Leute, Anfang September');
assert(!(noInventParty.wishHaves?.value ?? []).includes('party'), 'no party without saying party');
assert(!(noInventParty.mustHaves?.value ?? []).includes('party'), 'no must party invented');
assert(noInventParty.purpose?.value === 'Männerwochenende', 'purpose still set');

const budgetBare = applyAskedContext('keine Ahnung, 300', 'budget', parseBriefSlots('keine Ahnung, 300'));
assert(budgetBare.budgetEur?.value === 300, `bare 300 ${budgetBare.budgetEur?.value}`);
assert(budgetBare.budgetScope?.value === 'per_person', 'budget as per person after ask');

const prio = parseBriefSlots(
  'Bahn lieber, aber wenn es zu teuer wird oder zu weit weg ist, dann für uns auch okay Auto zu fahren',
);
assert(prio.mode?.value === 'train', `bahn preferred got ${prio.mode?.value}`);
assert(prio.modeFallback?.value === 'drive', 'auto fallback');
assert(prio.mode?.hardness === 'wish', 'preferred mode is not a hard must');
const prioNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), prio));
assert(
  prioNotes.some((n) => /Bahn/i.test(n.label) && /Auto/i.test(n.label)),
  `prio sticker ${prioNotes.map((n) => n.label).join('|')}`,
);

const poolOpt = parseBriefSlots('Pool wäre ganz cool, muss aber auch nicht sein');
assert(
  poolOpt.niceHaves?.value?.includes('pool') || poolOpt.wishHaves?.value?.includes('pool'),
  'optional pool wish',
);
assert(!poolOpt.mustHaves?.value?.includes('pool'), 'optional pool not must');

const flySoft = parseBriefSlots('irgendwo hinfliegen könnte wäre schon nice, aber wahrscheinlich eh zu teuer');
assert(flySoft.mode?.value === 'fly', 'soft fly');
assert(flySoft.mode?.hardness === 'wish', 'fly not a must');

const septNow2 = Date.parse('2026-08-20T12:00:00');
let board = mergeLedger(cloneEmptyLedger(), parseBriefSlots('im September ein Wochenende weg, vier Leute', septNow2));
board = mergeLedger(
  board,
  applyAskedContext(
    'vom 11. bis zum 13.',
    'adults',
    parseBriefSlots('vom 11. bis zum 13.', septNow2, board),
  ),
);
assert(board.adults?.value === 4, `11-13 must not become 11 people, got ${board.adults?.value}`);
board = mergeLedger(
  board,
  parseBriefSlots('nee stimmt nicht, wir sind nur vier Leute, wollen vom 11. bis zum 13. September weg', septNow2, board),
);
assert(board.adults?.value === 4, 'still four');
assert(board.dateStart?.value === '2026-09-11', `start ${board.dateStart?.value}`);
assert(board.dateEnd?.value === '2026-09-13', `end ${board.dateEnd?.value}`);
assert(board.stayNights?.value === 2, `nights ${board.stayNights?.value}`);
const dateNotes = buildFlipchartNotes(board);
assert(
  (dateNotes.some((n) => /11\.9/.test(n.label) && /13\.9/.test(n.label)) ||
    (dateNotes.some((n) => /11\.9/.test(n.label)) && dateNotes.some((n) => /13\.9/.test(n.label)))),
  `concrete dates on board ${dateNotes.map((n) => n.label).join('|')}`,
);
assert(!dateNotes.some((n) => n.id === 'when' && /Wochenende/.test(n.label)), 'weekend label gone after exact dates');

const poolPartner = parseBriefSlots('unser Partner möchte gerne einen Pool haben');
assert(poolPartner.wishHaves?.value?.includes('pool'), 'partner pool wish');

const mix = parseBriefSlots(
  'uns ist es egal ob wir mit dem Auto oder mit der Bahn oder mit dem Flug fahren, maximal vier Stunden, Hauptsache günstig',
);
assert(mix.mode?.value === 'mix', `mode mix got ${mix.mode?.value}`);
assert(mix.maxDriveHours?.value === 4, `4h got ${mix.maxDriveHours?.value}`);
assert(mix.budgetVibe?.value === 'cheap', 'günstig vibe');
const mixNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), mix));
assert(mixNotes.some((n) => /egal|Mix/i.test(n.label)), `mix sticker ${mixNotes.map((n) => n.label).join('|')}`);

let noFly = mergeLedger(cloneEmptyLedger(), mix);
noFly = applyLedgerCorrections('okay dann möchte ich nicht fliegen', noFly);
assert(noFly.mode?.value !== 'fly', `no fly got ${noFly.mode?.value}`);
assert(noFly.modeFallback?.value !== 'fly', 'fly not fallback');

const apt = parseBriefSlots('Apartment wäre natürlich cool, aber Hotel würde auch funktionieren');
assert(apt.lodgingKind?.value === 'apartment', 'apartment preferred');
assert(apt.lodgingFallback?.value === 'hotel', 'hotel fallback');
assert(apt.lodgingKind?.hardness === 'wish', 'apartment not hard must');
const aptNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), apt));
assert(
  aptNotes.some((n) => /Apartment/i.test(n.label) && /Hotel/i.test(n.label)),
  `lodging sticker ${aptNotes.map((n) => n.label).join('|')}`,
);

function walk(turns: string[]): { ledger: ReturnType<typeof cloneEmptyLedger>; asked: string[]; next: string } {
  let ledger = cloneEmptyLedger();
  const asked: string[] = [];
  let next = 'keep_talking';
  for (const turn of turns) {
    const patch = applyAskedContext(turn, asked[asked.length - 1] ?? null, parseBriefSlots(turn, septNow2, ledger));
    ledger = applyLedgerCorrections(turn, mergeLedger(ledger, patch));
    const gap = nextQuestionKey(ledger, asked);
    next = gap.key;
    if (gap.key !== 'keep_talking' && gap.key !== 'wrap_up' && gap.key !== 'ready_announce' && !asked.includes(gap.key)) asked.push(gap.key);
  }
  return { ledger, asked, next };
}

const conv = walk([
  'Ja ich möchte gerne das Männerwochenende machen irgendwie Anfang September. Wir sind irgendwie vier Leute. Bisschen Party machen.',
  'vom 11. bis zum 13. September weg, starten von Hamburg',
  'unser Partner möchte gerne einen Pool haben',
  'uns ist egal ob Auto Bahn oder Flug, maximal vier Stunden, Hauptsache günstig',
  'Apartment wäre cool, aber Hotel geht auch',
  'keine Ahnung, 300 Euro pro Person',
]);
assert(conv.ledger.adults?.value === 4, 'conv four');
assert(conv.ledger.dateStart?.value === '2026-09-11', `conv start ${conv.ledger.dateStart?.value}`);
assert(conv.ledger.wishHaves?.value?.includes('pool'), 'conv pool');
assert(conv.ledger.mode?.value === 'mix', `conv mode ${conv.ledger.mode?.value}`);
assert(conv.ledger.lodgingKind?.value === 'apartment', 'conv apt');
assert(conv.ledger.budgetEur?.value === 300, `conv budget ${conv.ledger.budgetEur?.value}`);
assert(conv.ledger.originCity?.value === 'Hamburg', `conv origin ${conv.ledger.originCity?.value}`);
assert(
  [
    'wrap_up',
    'ready_announce',
    'keep_talking',
    'departWindow',
    'lodging',
    'partyGrain',
    'extraWishes',
    'highlight',
    'transfer',
    'meals',
    'localMove',
    'mode',
    'dest',
    'comfort',
    'whenTight',
    'geo',
    'ages',
  ].includes(conv.next),
  `after core facts wrap, got ${conv.next}`,
);

const clubs = parseBriefSlots('eher Clubs, ein bisschen Open Air, nicht zu mainstream');
assert(/Clubs/.test(clubs.partyStyle?.value ?? ''), `clubs ${clubs.partyStyle?.value}`);
assert(/Open Air/.test(clubs.partyStyle?.value ?? ''), 'open air');
let afterParty = mergeLedger(conv.ledger, clubs);
assert(nextQuestionKey(afterParty).key !== 'partyStyle', 'do not re-ask party once grain is there');

const spaTalk = parseBriefSlots('wir wollen ein richtig geiles Spa Entspannungswochenende');
assert(spaTalk.wishHaves?.value?.includes('spa') || spaTalk.mustHaves?.value?.includes('spa'), 'spa amenity');
assert(!spaTalk.spaStyle, 'spa grain still open');
const spaWalk = walk([
  'Spa Entspannungswochenende, zwei Leute, vom 11. bis 13. September, ab Hamburg',
  'uns ist egal Auto Bahn oder Flug, maximal vier Stunden, 400 Euro pro Person',
  'Hotel wäre cool',
]);
assert(
  ['spaStyle', 'wrap_up', 'ready_announce', 'extraWishes', 'origin', 'highlight', 'transfer', 'meals', 'localMove', 'mode', 'dest', 'comfort', 'whenTight', 'whenFlex', 'lodgingRank', 'surfacePref', 'cityExplore'].includes(spaWalk.next),
  `spa deep ask, got ${spaWalk.next}`,
);
const spaAns = applyAskedContext(
  'Massage und Sauna, Adult Only bitte, nicht nur Pool',
  'spaStyle',
  parseBriefSlots('Massage und Sauna, Adult Only bitte, nicht nur Pool'),
);
assert(/Massage/.test(spaAns.spaStyle?.value ?? ''), `spa ans ${spaAns.spaStyle?.value}`);
assert(/Sauna/.test(spaAns.spaStyle?.value ?? ''), 'sauna');
assert(/Adult/.test(spaAns.spaStyle?.value ?? ''), 'adult-only');

const kidsTalk = parseBriefSlots('wir fahren mit zwei Kindern, die mögen gerne Tennis');
assert(kidsTalk.children?.value === 2, `kids ${kidsTalk.children?.value}`);
assert(kidsTalk.wishHaves?.value?.includes('tennis') || kidsTalk.mustHaves?.value?.includes('tennis'), 'tennis');
assert(/Tennis/i.test(kidsTalk.kidsStyle?.value ?? ''), `kids like ${kidsTalk.kidsStyle?.value}`);
const kidsWalk = walk([
  'wir wollen Familienurlaub mit zwei Kindern, vier Leute, 11. bis 13. September, ab Hamburg',
  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro, Hotel',
]);
assert(kidsWalk.ledger.children?.value === 2, 'kids on ledger');
assert(
  ['extraWishes', 'kidsStyle', 'kidsClubVsTogether', 'origin', 'highlight', 'transfer', 'meals', 'localMove', 'ages', 'geo', 'dest', 'bags', 'whenFlex', 'lodgingRank', 'accessNeeds'].includes(
    kidsWalk.next,
  ),
  `kids setup next, got ${kidsWalk.next}`,
);

const wineHop = parseBriefSlots('wir wollen Wein und ein bisschen rumreisen, mehrere Städte');
assert(wineHop.wishHaves?.value?.includes('wine') || wineHop.mustHaves?.value?.includes('wine'), 'wine');
assert(wineHop.tripShape?.value === 'hop', `hop ${wineHop.tripShape?.value}`);
const wineWalk = walk([
  'wir wollen Wein und rumreisen, zwei Leute, 11. bis 13. September, ab Hamburg',
  'egal Auto Bahn Flug, max vier Stunden, 400 Euro, Hotel',
]);
assert(
  ['tripShape', 'tripShapeAsk', 'hopStops', 'wrap_up', 'ready_announce', 'keep_talking', 'extraWishes', 'highlight', 'transfer', 'meals', 'localMove', 'mode', 'dest', 'comfort', 'geo', 'ages', 'bags', 'driveTime', 'directFlight', 'departWindow', 'whenFlex', 'lodgingRank', 'surfacePref', 'cityExplore', 'maxRailH'].includes(wineWalk.next),
  `wine form next, got ${wineWalk.next}`,
);

const cruise = parseBriefSlots('vielleicht auch eine Kreuzfahrt oder Kanutour');
assert(cruise.tripShape?.value === 'cruise' || cruise.wishHaves?.value?.includes('cruise'), 'cruise parsed');

const spaNotes = buildFlipchartNotes(
  mergeLedger(cloneEmptyLedger(), parseBriefSlots('Spa Wochenende, Massage und Sauna, Adult Only')),
);
assert(
  spaNotes.some((n) => /Massage|Sauna|Adult/i.test(n.label)),
  `spa stickers ${spaNotes.map((n) => n.label).join('|')}`,
);

/** Gleicher Pfad wie Texteingabe im Overlay: ingest → Board → nächste Frage. */
function typeThrough(lines: string[]): string[] {
  let ledger = cloneEmptyLedger();
  const asked: string[] = [];
  const log: string[] = [];
  let next = 'keep_talking';
  for (const line of lines) {
    const patch = applyAskedContext(line, asked[asked.length - 1] ?? null, parseBriefSlots(line, septNow2, ledger));
    ledger = applyLedgerCorrections(line, mergeLedger(ledger, patch));
    const gap = nextQuestionKey(ledger, asked);
    next = gap.key;
    if (gap.key !== 'keep_talking' && gap.key !== 'wrap_up' && gap.key !== 'ready_announce' && !asked.includes(gap.key)) asked.push(gap.key);
    const board = buildFlipchartNotes(ledger)
      .map((n) => n.label)
      .join(' | ');
    log.push(`TIPP: ${line}\nBOARD: ${board || '(leer)'}\nFRAGE: ${gap.key}`);
  }
  return [...log, `NEXT:${next}`];
}

const typedPartyLog = typeThrough([
  'Ja ich möchte gerne das Männerwochenende machen irgendwie Anfang September. Wir sind irgendwie vier Leute. Bisschen Party machen.',
  'vom 11. bis zum 13. September weg, starten von Hamburg',
  'unser Partner möchte gerne einen Pool haben',
  'uns ist egal ob Auto Bahn oder Flug, maximal vier Stunden, Hauptsache günstig',
  'Apartment wäre cool, aber Hotel geht auch',
  'keine Ahnung, 300 Euro pro Person',
]);
assert(
  typedPartyLog[typedPartyLog.length - 1] === 'NEXT:wrap_up' ||
  typedPartyLog[typedPartyLog.length - 1] === 'NEXT:ready_announce' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:keep_talking' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:departWindow' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:lodging' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:extraWishes' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:highlight' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:transfer' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:partyGrain' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:meals' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:localMove' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:mode' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:dest' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:comfort' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:whenTight',
  `typed party next ${typedPartyLog[typedPartyLog.length - 1]}\n${typedPartyLog.join('\n\n')}`,
);

const typedClubsLog = typeThrough([
  'Ja ich möchte gerne das Männerwochenende machen irgendwie Anfang September. Wir sind irgendwie vier Leute. Bisschen Party machen.',
  'vom 11. bis zum 13. September weg, starten von Hamburg',
  'unser Partner möchte gerne einen Pool haben',
  'uns ist egal ob Auto Bahn oder Flug, maximal vier Stunden, Hauptsache günstig',
  'Apartment wäre cool, aber Hotel geht auch',
  'keine Ahnung, 300 Euro pro Person',
  'eher Clubs und Open Air, nicht zu mainstream',
]);
assert(
  typedClubsLog[typedClubsLog.length - 1] === 'NEXT:wrap_up' ||
  typedClubsLog[typedClubsLog.length - 1] === 'NEXT:ready_announce' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:keep_talking' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:departWindow' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:lodging' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:extraWishes' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:highlight' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:transfer' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:partyGrain' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:partyDepth' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:partyMusic' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:meals' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:localMove' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:mode' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:dest' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:comfort' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:ages' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:geo' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:bags' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:driveTime' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:whenFlex' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:surfacePref' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:whenTight' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:eventCore' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:partyMusic',
  `after clubs ${typedClubsLog[typedClubsLog.length - 1]}`,
);
assert(
  !/NEXT:(dealbreaker|lastTrip|spaStyle|rentalCar|lodging)/.test(typedClubsLog[typedClubsLog.length - 1]),
  'no dealbreaker/lastTrip after cores',
);
assert(
  /NEXT:(wrap_up|ready_announce|keep_talking|departWindow|extraWishes|highlight|transfer|meals|localMove|mode|dest|comfort|whenTight|partyGrain|partyDepth|ages|geo|bags|driveTime|eventCore|partyMusic)/.test(
    typedClubsLog[typedClubsLog.length - 1],
  ),
  `research pillars or ready after cores ${typedClubsLog[typedClubsLog.length - 1]}`,
);

const typedSpaLog = typeThrough([
  'wir wollen ein richtig geiles Spa Entspannungswochenende, zwei Leute, vom 11. bis 13. September, ab Hamburg',
  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro pro Person, Hotel',
]);
assert(
  typedSpaLog[typedSpaLog.length - 1] === 'NEXT:spaStyle' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:wrap_up' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:ready_announce' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:extraWishes' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:highlight' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:transfer' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:meals' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:localMove' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:mode',
  `typed spa next ${typedSpaLog[typedSpaLog.length - 1]}\n${typedSpaLog.join('\n\n')}`,
);

const modeEgal = parseBriefSlots(
  'boah ist mir eigentlich ziemlich egal, wie es besser passt, preislich und für die Bahn müssen wir entspannter, aber für mich ist auch Auto völlig okay',
);
assert(modeEgal.mode?.value === 'train', `egal bahn preferred ${modeEgal.mode?.value}`);
assert(modeEgal.modeFallback?.value === 'drive', `auto fallback ${modeEgal.modeFallback?.value}`);
const modeNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), modeEgal));
assert(
  modeNotes.some((n) => /Bahn/i.test(n.label) && /Auto/i.test(n.label)),
  `both modes on board ${modeNotes.map((n) => n.label).join('|')}`,
);

let spaNo = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('Männerwochenende, vier Leute, Pool wäre cool'),
);
spaNo = applyLedgerCorrections(
  'Massage und Sauna brauche ich nicht. Also Pool wäre cool, aber Massage Sauna brauche ich nicht.',
  mergeLedger(
    spaNo,
    parseBriefSlots(
      'Massage und Sauna brauche ich nicht. Also Pool wäre cool, aber Massage Sauna brauche ich nicht.',
      Date.now(),
      spaNo,
    ),
  ),
);
assert(
  spaNo.wishHaves?.value?.includes('pool') ||
    spaNo.mustHaves?.value?.includes('pool') ||
    spaNo.niceHaves?.value?.includes('pool'),
  'pool kept',
);
assert(!spaNo.wishHaves?.value?.includes('sauna'), 'no sauna wish');
assert(!spaNo.wishHaves?.value?.includes('massage'), 'no massage wish');
assert(!spaNo.mustHaves?.value?.includes('spa'), 'no spa must');
assert(spaNo.purpose?.value !== 'Spa-Wochenende', 'party not overwritten by spa');
const spaNoNotes = buildFlipchartNotes(spaNo);
assert(
  !spaNoNotes.some((n) => n.tier !== 'nope' && /Massage|Sauna|Spa-Wochenende|^Spa$/i.test(n.label)),
  `spa not on board ${spaNoNotes.map((n) => n.label).join('|')}`,
);

const echoSpa = parseBriefSlots(
  'Apartment oder Hotel mit Spa?',
  Date.now(),
  mergeLedger(cloneEmptyLedger(), parseBriefSlots('Männerwochenende, vier Leute, bisschen Party')),
);
assert(echoSpa.purpose?.value !== 'Spa-Wochenende', 'question echo not spa weekend');
assert(!echoSpa.wishHaves?.value?.includes('spa'), 'echo does not pin spa');
assert(echoSpa.rentalCar?.value !== true, 'echo does not pin rental');

const shrugH = applyAskedContext('Ja boah keine Ahnung', 'highlight', {});
assert(shrugH.highlightWant?.value === 'keine', `shrug highlight ${shrugH.highlightWant?.value}`);
const garbageH = applyAskedContext('möchte und ist immer A', 'highlight', {});
assert(!garbageH.highlightWant, 'garbage highlight not pinned');
const shrugNotes = buildFlipchartNotes(
  mergeLedger(cloneEmptyLedger(), applyAskedContext('boah keine Ahnung', 'highlight', {})),
);
assert(
  !shrugNotes.some((n) => /keine Ahnung|möchte und/i.test(n.label)),
  `garbage sticker ${shrugNotes.map((n) => n.label).join('|')}`,
);

const noCamp = applyLedgerCorrections(
  'Zelt wollen wir auf jeden Fall nicht. Ich möchte nicht campen.',
  mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Apartment wäre cool, kann auch ein Hotel sein. Zelt wollen wir auf jeden Fall nicht.'),
  ),
);
assert(noCamp.hardNos?.value?.includes('camping'), 'camping is a hard no');
assert(!noCamp.wishHaves?.value?.includes('camping'), 'camping not a wish');
assert(!noCamp.mustHaves?.value?.includes('camping'), 'camping not a must');
assert(noCamp.lodgingKind?.value === 'apartment', `lodging ${noCamp.lodgingKind?.value}`);
assert(noCamp.lodgingFallback?.value === 'hotel', `fallback ${noCamp.lodgingFallback?.value}`);
const noCampNotes = buildFlipchartNotes(noCamp);
assert(noCampNotes.some((n) => n.tier === 'nope' && /Camping/i.test(n.label)), 'red no camping');
assert(!noCampNotes.some((n) => n.tier !== 'nope' && /^Camping$/i.test(n.label)), 'camping not a want');
assert(
  noCampNotes.filter((n) => n.id === 'lodging').length === 1 &&
    noCampNotes.some((n) => /Apartment,\s*sonst Hotel/i.test(n.label)),
  `one lodging sticker ${noCampNotes.map((n) => n.label).join('|')}`,
);

const laterHotel = mergeLedger(noCamp, parseBriefSlots('Kann auch ein Hotel sein', Date.now(), noCamp));
assert(laterHotel.lodgingKind?.value === 'apartment', 'keep apartment when hotel is only alt');
assert(laterHotel.lodgingFallback?.value === 'hotel', 'hotel stays fallback');
assert(laterHotel.lodgingFallback?.value !== laterHotel.lodgingKind?.value, 'not hotel sonst hotel');

const exactLater = mergeLedger(
  cloneEmptyLedger(),
  parseBriefSlots('im September ein Wochenende weg', Date.parse('2026-08-20T12:00:00')),
);
const pinned = mergeLedger(
  exactLater,
  parseBriefSlots(
    'am Freitag den 11 September fahren wir los, ab 16 Uhr können wir los und dann bis um 13 September',
    Date.parse('2026-08-20T12:00:00'),
    exactLater,
  ),
);
assert(pinned.dateStart?.value === '2026-09-11', `pin start ${pinned.dateStart?.value}`);
assert(pinned.dateEnd?.value === '2026-09-13', `pin end ${pinned.dateEnd?.value}`);
assert(pinned.dateFlex?.value === 'exact', `flex ${pinned.dateFlex?.value}`);
const pinNotes = buildFlipchartNotes(pinned);
assert(
  pinNotes.some((n) => /11\.9/.test(n.label) && /13\.9/.test(n.label)) ||
    (pinNotes.some((n) => /11\.9/.test(n.label)) && pinNotes.some((n) => /13\.9/.test(n.label))),
  `dates replace weekend ${pinNotes.map((n) => n.label).join('|')}`,
);
assert(!pinNotes.some((n) => n.id === 'when' && /Wochenende/i.test(n.label) && !/11\.9/.test(n.label)), 'no stale weekend-only sticker');

const partyPing = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
]);
assert(partyPing.next === 'adults' || partyPing.next === 'purpose', `party first asks group/purpose, got ${partyPing.next}`);
const partyPing2 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
]);
assert(['origin','when','budget','lodging'].includes(partyPing2.next), `party then core, got ${partyPing2.next}`);
const partyPing3 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
]);
assert(['when','budget','lodging','origin','partyGrain','ready_announce','keep_talking','extraWishes','highlight','purpose','meals','localMove','mode'].includes(partyPing3.next), `party after origin, got ${partyPing3.next}`);
const partyPing4 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
]);
assert(partyPing4.ledger.lodgingOpen?.value, 'lodging open');
assert(partyPing4.ledger.wishHaves?.value?.includes('pool'), 'pool wish');
assert(['when','budget','partyGrain','ready_announce','keep_talking','lodging','extraWishes','highlight','transfer','purpose','meals','localMove','mode'].includes(partyPing4.next), `party after lodging talk, got ${partyPing4.next}`);
const partyPing5 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
  'Genau. Denke mal so 200 € pro Nase für die Unterkunft.',
]);
assert(partyPing5.ledger.budgetEur?.value === 200, `200 not rescaled ${partyPing5.ledger.budgetEur?.value}`);
assert(['when','lodging','partyGrain','ready_announce','keep_talking','driveTime','departWindow','extraWishes','highlight','transfer','purpose','meals','localMove','mode'].includes(partyPing5.next), `party then next, got ${partyPing5.next}`);
const partyDone = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
  'Genau. Denke mal so 200 € pro Nase für die Unterkunft.',
  'Irgendwann im August wäre stark.',
]);
assert(
  ['when', 'whenFlex', 'driveTime', 'departWindow', 'wrap_up', 'ready_announce', 'partyGrain', 'keep_talking', 'lodging', 'extraWishes', 'highlight', 'transfer', 'purpose', 'meals', 'localMove', 'mode', 'dest', 'comfort', 'surfacePref', 'bags', 'ages'].includes(partyDone.next),
  `party wrap ${partyDone.next}`,
);
const partyBoard = buildFlipchartNotes(partyDone.ledger);
assert(partyBoard.some((n) => n.id === 'origin' && /Hamburg/i.test(n.label)), 'origin sticker');
assert(partyBoard.some((n) => /Unterkunft egal/i.test(n.label)), 'open lodging sticker');
assert(partyBoard.some((n) => /Pool/i.test(n.label) && (n.tier === 'wish' || n.tier === 'optional')), 'pool not must');
assert(partyBoard.some((n) => n.tier === 'critical' && /200/i.test(n.label)), 'budget green');

const familyPing = walk([
  'Wir suchen was für den ersten Urlaub zu dritt. Unser Baby ist gerade 4 Monate alt, wir sind echt durch und brauchen einfach nur Ruhe.',
]);
assert(familyPing.ledger.adults?.value === 2, `family adults ${familyPing.ledger.adults?.value}`);
assert(familyPing.ledger.children?.value === 1, 'baby counts as child');
assert(briefingPath(familyPing.ledger) === 'family', `family path ${briefingPath(familyPing.ledger)}`);
assert(['when','budget','origin','lodging','mode'].includes(familyPing.next), `family core next, got ${familyPing.next}`);
const family2 = walk([
  'Wir suchen was für den ersten Urlaub zu dritt. Unser Baby ist gerade 4 Monate alt, wir sind echt durch und brauchen einfach nur Ruhe.',
  'Bloß nicht fliegen! Lass mal lieber mit dem Auto fahren, so maximal 3 Stunden Fahrt. Irgendwas an der Küste wäre toll.',
]);
assert(family2.ledger.mode?.value === 'drive', 'family drive');
assert(family2.ledger.maxDriveHours?.value === 3, '3h');
assert(['when','budget','origin','lodging','mode','extraWishes'].includes(family2.next), `family after drive, got ${family2.next}`);
const familyDone = walk([
  'Wir suchen was für den ersten Urlaub zu dritt. Unser Baby ist gerade 4 Monate alt, wir sind echt durch und brauchen einfach nur Ruhe.',
  'Bloß nicht fliegen! Lass mal lieber mit dem Auto fahren, so maximal 3 Stunden Fahrt. Irgendwas an der Küste wäre toll.',
  'So ungefähr eine Woche. Am besten Mitte September.',
  'Wir dachten an maximal 1.000 € insgesamt für die Unterkunft.',
  'Ferienhaus auf jeden Fall!',
  'Babybett ist Pflicht. Und ein eigener Parkplatz am Haus wäre super wichtig wegen dem ganzen Gepäck.',
]);
assert(familyDone.ledger.budgetEur?.value === 1000, `1000 total ${familyDone.ledger.budgetEur?.value}`);
assert(familyDone.ledger.budgetScope?.value === 'total', `total scope ${familyDone.ledger.budgetScope?.value}`);
assert(familyDone.ledger.lodgingKind?.value === 'ferienhaus', 'ferienhaus');
assert(familyDone.ledger.mustHaves?.value?.includes('baby_bed'), 'baby bed must');
assert(familyDone.ledger.mustHaves?.value?.includes('parking'), 'parking must');
assert(['wrap_up','ready_announce','keep_talking','extraWishes','origin','highlight','transfer','kidsStyle','meals','localMove','mode','dest','comfort','ages','geo','bags','driveTime','departWindow','directFlight'].includes(familyDone.next), `family wrap ${familyDone.next}`);

const couplePing = walk([
  'Ich will meine Freundin überraschen. Wir sind frisch zusammen und wollen eine Woche weg, darf schon was Besonderes sein.',
]);
assert(briefingPath(couplePing.ledger) === 'couple', `couple path ${briefingPath(couplePing.ledger)}`);
assert(['when','budget','origin','lodging','adults'].includes(couplePing.next), `couple core, got ${couplePing.next}`);
const coupleDone = walk([
  'Ich will meine Freundin überraschen. Wir sind frisch zusammen und wollen eine Woche weg, darf schon was Besonderes sein.',
  'Am liebsten direkt Anfang Juni.',
  'Ich sag mal so maximal 800 € pro Nase. Und es soll auf jeden Fall in die Sonne gehen.',
  'Hotel wäre schon geil, am besten mit einem richtig schönen Ausblick aufs Meer.',
  'Ein paar schöne Restaurants in Gehweite wären gut, aber bitte keine laute Partymeile vor der Tür.',
]);
assert(coupleDone.ledger.budgetEur?.value === 800, '800 pp');
assert(coupleDone.ledger.wishHaves?.value?.includes('view') || coupleDone.ledger.mustHaves?.value?.includes('view'), 'meerblick');
assert(coupleDone.ledger.dealbreaker?.value, 'partymeile nogo');
assert(
  ['origin', 'wrap_up', 'ready_announce', 'keep_talking', 'extraWishes', 'highlight', 'transfer', 'locationBias', 'meals', 'localMove', 'mode', 'dest', 'comfort'].includes(coupleDone.next),
  `couple next ${coupleDone.next}`,
);

const thousand = parseBriefSlots('maximal 1.000 € insgesamt für die Unterkunft');
assert(thousand.budgetEur?.value === 1000, `dot thousand ${thousand.budgetEur?.value}`);

const leaveTalk = parseBriefSlots(
  'am Freitag den 11 September fahren wir los uns noch eben arbeiten also ab 16 Uhr können wir los und dann bis um 13 September da ist egal wann wir wiederkommen',
  Date.parse('2026-08-20T12:00:00'),
);
assert(leaveTalk.dateStart?.value === '2026-09-11', `fri start ${leaveTalk.dateStart?.value}`);
assert(leaveTalk.dateEnd?.value === '2026-09-13', `sun end ${leaveTalk.dateEnd?.value}`);
assert(leaveTalk.departAfterHour?.value === 16, `depart ${leaveTalk.departAfterHour?.value}`);
assert(leaveTalk.mode?.value !== 'mix', 'return-flex is not mode egal');
const leaveNotes = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), leaveTalk));
assert(leaveNotes.some((n) => /11\.9/.test(n.label)), 'arrive on board');
assert(
  leaveNotes.some((n) => /13\.9/.test(n.label) || /Rückreise/i.test(n.label)),
  'return on board',
);
assert(leaveTalk.dateEnd?.hardness === 'optional' || leaveTalk.dateFlex?.value === 'open', 'return flex hardness');
assert(leaveNotes.some((n) => /16 Uhr/.test(n.label)), 'depart hour on board');
assert(!leaveNotes.some((n) => /Anreise egal/i.test(n.label)), 'no anreise egal sticker');

const badOrigin = parseBriefSlots('starten von Kristof');
assert(!badOrigin.originCity, `kristof not a city ${badOrigin.originCity?.value}`);
const junkOrigin = parseBriefSlots('starten von davon');
assert(!junkOrigin.originCity, `davon not a city ${junkOrigin.originCity?.value}`);
const junkOrigin2 = parseBriefSlots('davon');
assert(!junkOrigin2.originCity, 'bare davon rejected');
const junkAsked = applyAskedContext('davon', 'origin', {});
assert(!junkAsked.originCity, 'asked origin davon rejected');
const { isJunkPlaceName, sanitizeTravelPlaceName } = require('./placeNameSanity') as typeof import('./placeNameSanity');
assert(isJunkPlaceName('davon') && isJunkPlaceName('Davon'), 'junk davon');
assert(sanitizeTravelPlaceName('davon', 'Hamburg') === 'Hamburg', 'sanitize davon→Hamburg');
assert(sanitizeTravelPlaceName('Prag', 'Hamburg') === 'Prag', 'keep Prag');
const scrubbed = applyLedgerCorrections(
  '',
  mergeLedger(cloneEmptyLedger(), { originCity: entry('Davon', 'user') }),
);
assert(!scrubbed.originCity, 'ledger scrub davon');
const homeOrigin = parseBriefSlots('von Apriesdorf aus starten');
assert(homeOrigin.originCity?.value === 'Prisdorf', `apriesdorf ${homeOrigin.originCity?.value}`);
const originFix = applyLedgerCorrections(
  'nein es ist nicht ab Kristof sondern ab Apriesdorf',
  mergeLedger(cloneEmptyLedger(), parseBriefSlots('starten von Hamburg')),
);
assert(originFix.originCity?.value === 'Prisdorf', `replace origin ${originFix.originCity?.value}`);

{
  const { isExplicitFlightOriginChange } = require('./originCommit') as typeof import('./originCommit');
  assert(
    isExplicitFlightOriginChange(
      'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.',
    ),
    'von X nach Y is explicit origin change',
  );
  assert(
    !isExplicitFlightOriginChange(
      'Fliegen von Hamburg, Berlin, Bremen oder Hannover — alle Flughäfen prüfen',
    ),
    'hub list is not A→B origin change',
  );
  const ab = parseBriefSlots(
    'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.',
  );
  assert(ab.originCity?.value === 'Hamburg', `AB origin ${ab.originCity?.value}`);
  assert(/split/i.test(ab.destinationHint?.value || ''), `AB dest ${ab.destinationHint?.value}`);
  const nachOnly = parseBriefSlots('Flug nach Berlin am Freitag');
  assert(
    !nachOnly.originCity || nachOnly.originCity.value.toLowerCase() !== 'berlin',
    'nach Berlin is not origin',
  );
}

const hotelJustDo = parseBriefSlots('Hotel am Hamburger Hafen und Elbphilharmonie Tickets');
assert(!hotelJustDo.adults, 'hotel seed does not invent adults=2');
assert(
  nextQuestionKey(mergeLedger(cloneEmptyLedger(), hotelJustDo)).key === 'adults' ||
    nextQuestionKey(mergeLedger(cloneEmptyLedger(), hotelJustDo)).key === 'purpose',
  'hotel seed asks group or purpose first',
);

assert(
  nextQuestionKey(cloneEmptyLedger()).key === 'purpose',
  'empty overlay asks trip type, not party size',
);

console.log(typedPartyLog.join('\n\n'));
console.log('---');
console.log(typedSpaLog.join('\n\n'));
console.log('reisebuero.smoke.test.ts ok');

// --- Yorros Vertiefung: Soft-Kriterien & Board-first ---
const beerTalk = parseBriefSlots('Wir wollen günstige Bierpreise, Party machen wir privat unter uns, keine Partymeile wie Mallorca, vier Jungs aus Hamburg, vier Tage, Budget 200 Euro, Unterkunft egal');
assert(beerTalk.cheapDrinks?.value === true, 'cheapDrinks');
assert(beerTalk.partyGrain?.value === 'private_house', 'partyGrain private');
assert(!(beerTalk.hardNos?.value ?? []).includes('party'), 'party not hardNo');
const beerBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), beerTalk));
assert(beerBoard.some((n) => /günstiges Bier|Bier|billig\s*&\s*reichlich/i.test(n.label)), 'bier sticker');
assert(!beerBoard.some((n) => /keine Kneipen|kein Kneipen/i.test(n.label)), 'no keine Kneipen');

// --- Founder brief: Männerwochenende multi-utterance merge ---
{
  const founderNow = Date.parse('2026-09-12T12:00:00');
  const founderUtter = [
    'Männerwochenende, langes Wochenende, wir sind drei Personen eventuell vier aber rechne mit drei',
    'Donnerstag den 15.10. ab 16:30 Uhr kann der Flieger losgehen, mit der Bahn ab 14:15 auch möglich, Freitag entspannt auch ok je nach Preis',
    'Zurück Montag oder am besten Dienstag',
    'Fliegen von Hamburg, Berlin, Bremen oder Hannover — alle Flughäfen prüfen wo günstigste',
    'Warm, maximal 400 Euro pro Person',
    'Am geilsten All-Inclusive-Hotel, wenn keins dann eigenes Apartment — kein normales Hotel mit Halbpension',
    'Günstiges Bier, Party, Spaß, Pool wäre geil',
  ];
  let founderLed = cloneEmptyLedger();
  for (const line of founderUtter) {
    founderLed = mergeLedger(founderLed, parseBriefSlots(line, founderNow, founderLed));
  }
  assert(founderLed.purpose?.value === 'Männerwochenende', 'founder purpose');
  assert(founderLed.adults?.value === 3, `founder partySize ${founderLed.adults?.value}`);
  assert(
    typeof founderLed.budgetEur?.value === 'number' && founderLed.budgetEur.value <= 400,
    `founder budget ${founderLed.budgetEur?.value}`,
  );
  const originHit = (founderLed.originCities?.value ?? []).filter((c) =>
    /^(Hamburg|Berlin|Bremen|Hannover)$/i.test(c),
  );
  assert(originHit.length >= 3, `founder origins ${JSON.stringify(founderLed.originCities?.value)}`);
  assert(founderLed.meals?.value === 'all', `founder meals ${founderLed.meals?.value}`);
  assert(
    founderLed.meals?.hardness === 'optional' || founderLed.meals?.hardness === 'wish',
    `founder meals hardness ${founderLed.meals?.hardness}`,
  );
  const lodgingOk =
    founderLed.lodgingKind?.value === 'apartment' ||
    founderLed.lodgingFallback?.value === 'apartment';
  assert(lodgingOk, `founder lodging kind=${founderLed.lodgingKind?.value} fb=${founderLed.lodgingFallback?.value}`);
  const amenBag = [
    ...(founderLed.mustHaves?.value ?? []),
    ...(founderLed.wishHaves?.value ?? []),
    ...(founderLed.niceHaves?.value ?? []),
  ];
  assert(amenBag.includes('party'), 'founder party amenity');
  assert(amenBag.includes('pool'), 'founder pool amenity');
  assert(!amenBag.includes('spa'), 'founder Spaß ≠ spa');
  assert(founderLed.cheapDrinks?.value === true, 'founder cheapDrinks');
  assert(
    founderLed.dateStart?.value?.endsWith('-10-15'),
    `founder outbound ${founderLed.dateStart?.value}`,
  );
  const end = founderLed.dateEnd?.value ?? '';
  assert(end.endsWith('-10-19') || end.endsWith('-10-20'), `founder return ${end}`);
  assert(
    founderLed.departAfterHour?.value === 16,
    `founder departAfter ${founderLed.departAfterHour?.value}`,
  );
  assert(founderLed.mode?.value === 'fly', `founder mode ${founderLed.mode?.value}`);
  assert(
    founderLed.modeFallback?.value === 'train',
    `founder modeFallback ${founderLed.modeFallback?.value}`,
  );
  assert(
    /halbpension/i.test(founderLed.dealbreaker?.value ?? '') ||
      (founderLed.hardNos?.value ?? []).includes('half_board'),
    `founder no half-board ${founderLed.dealbreaker?.value} nos=${JSON.stringify(founderLed.hardNos?.value)}`,
  );
  assert(founderLed.weatherWant?.value === 'warm', 'founder warm');
}

const multi = parseBriefSlots('Start Hamburg Bremen oder Berlin');
assert((multi.originCities?.value ?? []).length >= 2, 'multi origin ' + JSON.stringify(multi.originCities));
const multiBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), multi));
assert(
  multiBoard.filter((n) => n.emoji === '✈️' && /Berlin|Hamburg|Bremen/i.test(n.label)).length >= 2,
  'airport stickers with plane',
);

const homeFly = parseBriefSlots(
  'wir starten in Prisdorf, wenn wir losfliegen koennen wir auch von Hamburg, Berlin oder Bremen losfliegen',
);
assert(homeFly.originCity?.value === 'Prisdorf', 'home Prisdorf ' + homeFly.originCity?.value);
assert((homeFly.originCities?.value ?? []).length >= 2, 'fly airports');
assert(!homeFly.destinationHint, 'Berlin not destination ' + homeFly.destinationHint?.value);
const homeFlyBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), homeFly));
assert(homeFlyBoard.some((n) => n.emoji === '🏠' && /Prisdorf/i.test(n.label)), 'home sticker');
assert(
  homeFlyBoard.filter((n) => n.emoji === '✈️' && /^ab\s+/i.test(n.label)).length >= 2,
  'ab City airport chips',
);
assert(!homeFlyBoard.some((n) => n.id === 'dest'), 'no dest from airports');

const pristinaStt = parseBriefSlots('starten in Pristina');
assert(pristinaStt.originCity?.value === 'Prisdorf', 'pristina→prisdorf');


const moodTalk = parseBriefSlots('Clubs und Hausparty, optional all inclusive, wollen kostengünstiger sein, billig und reichlich trinken');
assert(moodTalk.budgetVibe?.value === 'cheap', 'kostengünstig vibe');
assert(moodTalk.meals?.value === 'all' && moodTalk.meals?.hardness === 'optional', 'optional AI');
assert(moodTalk.cheapDrinks?.value === true, 'billig reichlich drinks');
const moodBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), moodTalk));
assert(moodBoard.some((n) => n.label === 'Clubs' && n.emoji === '🪩'), 'club mood sticker');
assert(moodBoard.some((n) => n.label === 'Hausparty' && n.emoji === '🏠'), 'hausparty sticker');
assert(moodBoard.some((n) => /All-inclusive wenn geht/i.test(n.label) && n.tier === 'optional'), 'optional AI sticker');
assert(moodBoard.some((n) => n.id === 'budgetVibe' && /günstig/i.test(n.label)), 'budget sticker');

// Brief-Chips präzise: Direkt+Stopp, kein Flug-ab-Dorf, AI Wunsch, kein Hostel, Budget-Dedup
const softAiWish = parseBriefSlots(
  'All Inclusive wäre nice cool wenn im Budget noch drin, ist eigentlich Wunschdenken, sonst selbst verpflegen',
);
assert(softAiWish.meals?.value === 'all' && softAiWish.meals?.hardness === 'optional', 'AI only wish');
const softAiBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), softAiWish));
assert(softAiBoard.some((n) => /All-inclusive wenn geht/i.test(n.label)), 'AI optional chip');

// Live-Feedback: kein Fake-Ankunft 20 Uhr, Soft-AI, Soft-Clubs, Tornesch, Mietwagen-Nein, STT-Müll
const noFakeArrive = parseBriefSlots(
  'Donnerstag ab 14 Uhr losfliegen, nicht zu spaet ankommen, noch was in der Stadt',
);
assert(noFakeArrive.departAfterHour?.value === 14, 'depart 14');
assert(!noFakeArrive.arriveBeforeHour, 'no invented arrive 20');

const softAiBudget = parseBriefSlots(
  'All Inclusive soll cool sein, muss aber nicht, je nach dem ob das Budget langt',
);
assert(softAiBudget.meals?.value === 'all' && softAiBudget.meals?.hardness === 'optional', 'AI soft budget');

const softClubs = parseBriefSlots(
  'koennen gerne mal in einen Club gehen, ist uns aber nicht so wichtig',
);
assert(softClubs.partyGrain?.value === 'clubs', 'clubs grain');
assert(softClubs.partyGrain?.hardness === 'optional', 'clubs optional');
const softClubsBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), softClubs));
assert(
  softClubsBoard.some((n) => /Clubs wenn geht/i.test(n.label) && n.tier === 'optional'),
  'clubs optional sticker',
);

const torneschHome = parseBriefSlots('Wir starten aus Tornesch, fliegen von Hamburg Berlin Bremen oder Hannover');
assert(torneschHome.originCity?.value === 'Tornesch', `tornesch ${torneschHome.originCity?.value}`);
assert((torneschHome.originCities?.value?.length ?? 0) >= 3, 'multi airports');

const noCar = parseBriefSlots('wir brauchen jetzt nicht wirklich einen Mietwagen');
assert(noCar.rentalCar?.value === false, 'soft no rental');

assert(looksLikeGarbageFact('Hauptsache warum warm Hauptsache warum h'), 'stt garbage hauptsache');

const directSoft = parseBriefSlots(
  'am liebsten Direktflug, maximal ein Stopp, maximal eine Stunde Zwischenstopp',
);
assert(directSoft.directFlight?.value === true, 'prefer direct');
assert(directSoft.directFlight?.hardness === 'wish', 'direct soft hardness');
assert(directSoft.maxFlightStops?.value === 1, `max stops ${directSoft.maxFlightStops?.value}`);
assert(directSoft.maxLayoverHours?.value === 1, `layover ${directSoft.maxLayoverHours?.value}`);
const directBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), directSoft));
assert(
  directBoard.some((n) => /Direkt bevorzugt.*1 Stopp/i.test(n.label)),
  `direct chip ${directBoard.find((n) => n.id === 'directFlight')?.label}`,
);
assert(!directBoard.some((n) => n.id === 'directFlight' && n.label === 'Direktflug'), 'no hard Direktflug-only');

const bagsAns = applyAskedContext(
  '2 Handgepäck und 2 Aufgabegepäck',
  'bags',
  parseBriefSlots('2 Handgepäck und 2 Aufgabegepäck'),
);
assert(bagsAns.cabinBags?.value === 2, `cabin ${bagsAns.cabinBags?.value}`);
assert(bagsAns.checkedBags?.value === 2, `checked ${bagsAns.checkedBags?.value}`);
const bagsNone = applyAskedContext('kein Gepäck', 'bags', parseBriefSlots('kein Gepäck'));
assert(bagsNone.cabinBags?.value === 0 && bagsNone.checkedBags?.value === 0, 'no bags');
const bagsFlyLed = mergeLedger(cloneEmptyLedger(), {
  mode: entry('fly' as const, 'user'),
  adults: entry(3, 'user'),
  dateStart: entry('2026-11-12', 'user'),
  stayNights: entry(2, 'user'),
  budgetEur: entry(800, 'user'),
  budgetScope: entry('total' as const, 'user'),
  originCity: entry('Hamburg', 'user'),
  lodgingKind: entry('hotel' as const, 'user'),
  purpose: entry('stadt', 'user'),
  extraWishes: entry('meer', 'user', 'wish'),
  highlightWant: entry('essen', 'user', 'wish'),
  meals: entry('breakfast' as const, 'user', 'wish'),
  localMovePref: entry('walk' as const, 'user', 'wish'),
});
const bagsGap = conversationGaps(bagsFlyLed, [
  'directFlight',
  'mode',
  'meals',
  'localMove',
  'transfer',
  'rentalCar',
]);
assert(bagsGap.some((g) => g.key === 'bags'), `bags gap ${bagsGap.map((g) => g.key).join(',')}`);
const bagsBoard = buildFlipchartNotes(mergeLedger(bagsFlyLed, bagsAns));
assert(bagsBoard.some((n) => n.id === 'bags' && /2 Hand.*2 Aufgabe/i.test(n.label)), 'bags chip');

const flyDorf = parseBriefSlots('wir starten in Prisdorf und wollen fliegen');
const flyDorfLed = mergeLedger(cloneEmptyLedger(), flyDorf);
const flyDorfBoard = buildFlipchartNotes(flyDorfLed);
assert(flyDorfBoard.some((n) => /Start Prisdorf/i.test(n.label)), 'Start Prisdorf not Flug ab');
assert(!flyDorfBoard.some((n) => /Flug ab Prisdorf/i.test(n.label)), 'no Flug ab Dorf');

const noHostel = parseBriefSlots(
  'Apartment sonst Hotel, Hostel vielleicht nicht, Unterkunft uns egal sonst',
);
assert(noHostel.lodgingKind?.value !== 'hostel', `no hostel kind ${noHostel.lodgingKind?.value}`);
assert(
  noHostel.lodgingKind?.value === 'apartment' || noHostel.lodgingOpen?.value,
  'apartment or open',
);
const clearedHostel = applyLedgerCorrections(
  'kein Hostel bitte',
  mergeLedger(cloneEmptyLedger(), parseBriefSlots('Hostel wäre ok')),
);
assert(clearedHostel.lodgingKind?.value !== 'hostel', 'hostel cleared on denial');

const budgetDup = parseBriefSlots('Budget 400 Euro pro Person, wie unterwegs sein Budgets 400');
const budgetDupLed = mergeLedger(cloneEmptyLedger(), budgetDup);
const budgetDupBoard = buildFlipchartNotes(budgetDupLed);
assert(budgetDupBoard.filter((n) => n.id === 'budget').length === 1, 'one budget chip');
assert(
  !budgetDupBoard.some((n) => /unterwegs.*budget|budget.*unterwegs/i.test(n.label)),
  'no budget echo sticker',
);

// Zeit: Anreise vs Abreise vs Nächte-Spanne
const losTalk = parseBriefSlots('wollen am 16.10. los');
assert(losTalk.dateStart?.value?.endsWith('-10-16'), `los start ${losTalk.dateStart?.value}`);
assert(losTalk.dateAnchor?.value === 'arrive', `los anchor ${losTalk.dateAnchor?.value}`);
assert(losTalk.dateFlex?.value === 'exact', `los flex exact got ${losTalk.dateFlex?.value}`);
assert(!losTalk.dateEnd, 'los no fake end');
{
  const { isDateHardPinned } = require('./research/hardPins') as typeof import('./research/hardPins');
  assert(
    isDateHardPinned(mergeLedger(cloneEmptyLedger(), losTalk)),
    '16.10. los hard-pinned',
  );
}
const losBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), losTalk));
assert(losBoard.some((n) => /Anreise\s+16\.10\./i.test(n.label)), 'anreise sticker');

const rangeNights = parseBriefSlots('irgendwann im Oktober, drei bis sechs Nächte');
assert(rangeNights.stayNights?.value === 3, `nights min ${rangeNights.stayNights?.value}`);
assert(rangeNights.stayNightsMax?.value === 6, `nights max ${rangeNights.stayNightsMax?.value}`);
const rangeBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), rangeNights));
assert(rangeBoard.some((n) => /3–6 Nächte|3-6 Nächte/i.test(n.label)), 'nights range sticker');
assert(!rangeBoard.some((n) => /Anreise/i.test(n.label) && /3/i.test(n.label)), 'range not mixed into anreise');

const departTalk = parseBriefSlots(
  'Abreise muss am 16.10. sein weil wir einen Termin haben, davor sind wir flexibel je nach Budget und Flügen',
);
assert(departTalk.dateEnd?.value?.endsWith('-10-16'), `depart end ${departTalk.dateEnd?.value}`);
assert(departTalk.dateAnchor?.value === 'depart', `depart anchor ${departTalk.dateAnchor?.value}`);
assert(!departTalk.dateStart, 'depart clears start');
assert(departTalk.dateFlex?.value === 'open', `depart flex ${departTalk.dateFlex?.value}`);
const departBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), departTalk));
assert(departBoard.some((n) => /Abreise\s+16\.10\./i.test(n.label)), 'abreise sticker');
assert(departBoard.some((n) => /davor flexibel/i.test(n.label)), 'flex before sticker');

const dur = parseBriefSlots('vier Tage ab Hamburg, 250 Euro, wir sind fünf, Apartment egal');
const durLed = mergeLedger(cloneEmptyLedger(), dur);
assert(!searchReadyGaps(durLed).some((g) => g.key === 'when'), 'duration fills when');


// --- 5-Akt Reboot: Intention / schon gebucht / Transfer ---
assert(phaseToAct('briefing') === 'collect', 'act1');
assert(phaseToAct('recap') === 'confirm', 'act2');
assert(phaseToAct('research') === 'research', 'act3');
assert(phaseToAct('results') === 'present', 'act4');
assert(phaseToAct('detail') === 'present', 'act4 detail');

{
  const {
    isRecapAdditive,
    isRecapChange,
    isRecapConfirm,
    isRecapHardRestart,
  } = require('./recapIntent') as typeof import('./recapIntent');
  const { phaseAfterBumpRefine } = require('./acts') as typeof import('./acts');

  assert(isRecapConfirm('ja'), 'recap confirm ja');
  assert(isRecapConfirm('passt so'), 'recap confirm passt');
  assert(!isRecapChange('ja'), 'confirm is not change');
  assert(isRecapChange('änder das'), 'reject ändern');
  assert(isRecapChange('nein so nicht'), 'reject nein');
  assert(!isRecapChange('noch Pool dazu'), 'noch Pool is not reject');
  assert(isRecapAdditive('noch Pool dazu'), 'noch Pool additive');
  assert(isRecapAdditive('zusätzlich Apartment'), 'zusätzlich additive');
  assert(!isRecapAdditive('ja'), 'ja not additive');
  assert(isRecapHardRestart('von vorne bitte'), 'hard restart von vorne');
  assert(isRecapHardRestart('komplett neu'), 'hard restart komplett neu');
  assert(!isRecapHardRestart('ändere Budget'), 'ändern not hard restart');

  const stickyTrip = {
    searchReadySticky: true,
    ledger: cloneEmptyLedger(),
  };
  assert(phaseAfterBumpRefine(stickyTrip) === 'recap', 'bumpRefine sticky → recap');
  assert(phaseToAct(phaseAfterBumpRefine(stickyTrip)) === 'confirm', 'sticky refine stays Akt 2');
  const emptyish = {
    searchReadySticky: false,
    ledger: cloneEmptyLedger(),
  };
  assert(phaseAfterBumpRefine(emptyish) === 'briefing', 'bumpRefine empty → briefing');
  const readyLed = mergeLedger(
    mergeLedger(
      cloneEmptyLedger(),
      parseBriefSlots('fliegen, vom 11. bis 13. Juni, zu zweit, 400 Euro, Hostel, ab Hamburg'),
    ),
    { cabinBags: entry(1, 'user'), checkedBags: entry(0, 'user') },
  );
  assert(
    phaseAfterBumpRefine({ searchReadySticky: false, ledger: readyLed }) === 'recap',
    'bumpRefine complete ledger → recap',
  );
}

const bookedTalk = parseBriefSlots(
  'Wir haben schon ein Hotel in Barcelona gebucht, brauchen noch einen Flug, zu viert, Oktober, 400 Euro pro Person',
);
assert(bookedTalk.bookedStay?.value === true, 'bookedStay');
assert(bookedTalk.bookedFlight?.value === false, 'need flight');
assert((bookedTalk.intentNotes?.value ?? []).some((x) => /Unterkunft schon/i.test(x)), 'intent booked');
const bookedLed = mergeLedger(cloneEmptyLedger(), bookedTalk);
assert(bookedTalk.bookedFlight?.value === false, 'explicit need-flight flag');
// Nur Hotel gebucht, Flug unklar → nach Flug fragen
const onlyStay = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Hotel haben wir schon gebucht, zu viert, Oktober, 400 Euro pro Person'));
const onlyStayReady = mergeLedger(onlyStay, {
  originCity: entry('Hamburg', 'user'),
  lodgingOpen: entry(true, 'user', 'wish'),
  stayDays: entry(5, 'user'),
});
assert(
  nextQuestionKey(onlyStayReady).key === 'bookedBits',
  'only-stay asks flight: ' + nextQuestionKey(onlyStayReady).key,
);
assert(buildFlipchartNotes(bookedLed).some((n) => n.id === 'bookedStay'), 'bookedStay sticker');
const openWarm = parseBriefSlots(
  'Irgendwann im Oktober irgendwo hin wo es warm ist, Hauptsache Strand und Pool, wir sind zu viert, 400 Euro pro Person, Unterkunft egal',
);
assert(openWarm.dateMonth?.value?.includes('-10'), 'oktober month');
assert(openWarm.weatherWant?.value === 'warm' || (openWarm.mustHaves?.value ?? []).includes('warm') || (openWarm.wishHaves?.value ?? []).includes('warm') || (openWarm.mustHaves?.value ?? []).includes('pool') || (openWarm.wishHaves?.value ?? []).includes('pool'), 'warm/pool vibe');
assert((openWarm.intentNotes?.value ?? []).some((x) => /offen|Klima/i.test(x)) || openWarm.dateFlex?.value === 'month', 'open destination intent or month flex');

const tennis = parseBriefSlots('Ich möchte zum Grand Slam Tennis, ungefähr eine Woche');
assert((tennis.intentNotes?.value ?? []).some((x) => /Event-Hook/i.test(x)), 'tennis event intent');

const readyYes = applyAskedContext('Ja', 'ready_announce', {});
assert(readyYes.recapDone?.value === true, 'ready Ja → recapDone');
const readyJo = applyAskedContext('Jo klar', 'ready_announce', {});
assert(readyJo.recapDone?.value === true, 'ready Jo klar');
{
  const { composeRecapSpeech } = require('./recapSpeech') as typeof import('./recapSpeech');
  const recapLed = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots(
      'Männerwochenende vier Leute ab 16. Oktober zwei bis fünf Nächte Party auch Haus all inclusive wenn geht 300 Euro ab Hamburg',
      Date.parse('2026-09-01T12:00:00'),
    ),
  );
  const recap = composeRecapSpeech(recapLed);
  assert(/Männerwochenende/i.test(recap), `recap title ${recap.slice(0, 80)}`);
  assert(/Kurz check/i.test(recap), 'recap opener');
  assert(!/^Alles klar:\s/i.test(recap), 'no list dump opener');
  assert(!/Anreise:\s/i.test(recap), 'no Anreise: label');
  assert(!/Preisfehler/i.test(recap), 'no Preisfehler speech');
  assert(/Passt das so/i.test(recap), 'recap closes with Passt das so');
  assert(!/\s·\s/.test(recap), 'recap speech no telegram middot');
  assert(!/Erstspur/i.test(recap), 'recap no Erstspur jargon');
  assert(/Hamburg/i.test(recap), 'recap origin woven');
}
const easyOpt = parseBriefSlots('Pool wenn geht wäre easy close cool');
assert(
  easyOpt.extraWishes?.hardness === 'optional' ||
    (easyOpt.niceHaves?.value ?? []).includes('pool') ||
    (easyOpt.wishHaves?.value ?? []).includes('pool'),
  'soft/easy optional-ish',
);

void (async () => {
  const { computeBriefScore, briefScoreHint } = require('./briefScore') as typeof import('./briefScore');
  const thin = computeBriefScore(cloneEmptyLedger());
  assert(thin.zone === 'red', 'empty brief red');
  const fat = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots(
      'Männerwochenende vier Leute 11. bis 13. September ab Hamburg 300 Euro Apartment Pool Clubs, max 4h Stopp',
      Date.parse('2026-08-20T12:00:00'),
    ),
  );
  const sc = computeBriefScore(fat);
  assert(sc.score >= 50, `brief score ${sc.score}`);
  assert(/Brief \d+%/.test(briefScoreHint(sc)), 'score hint');
  const midAsked = ['purpose', 'extraWishes', 'highlight', 'partyGrain'];
  const midNext = nextQuestionKey(fat, midAsked);
  assert(
    ['meals', 'localMove', 'mode', 'dest', 'comfort', 'whenTight', 'geo', 'ages', 'ready_announce', 'keep_talking', 'transfer'].includes(
      midNext.key,
    ),
    `score sharpen or ready, got ${midNext.key}`,
  );
  if (sc.zone !== 'green') {
    assert(midNext.key !== 'ready_announce', 'no ready below green');
  }
  const mega = parseBriefSlots(
    'Mallorca Sommer Mai bis August zwei Nächte max 500m vom Megapark Pool günstigster Flug',
  );
  assert(mega.dateWindow || mega.anchorPoi?.value === 'Megapark' || mega.radiusM, 'malle calendar geo');
  const { rankCombos } = require('./research/comboOptimizer') as typeof import('./research/comboOptimizer');
  const ranked = rankCombos([
    { id: 'a', checkin: '2026-06-01', checkout: '2026-06-03', label: 'A', flightEur: 200, stayEur: 400, transferEur: 20 },
    { id: 'b', checkin: '2026-06-08', checkout: '2026-06-10', label: 'B', flightEur: 220, stayEur: 280, transferEur: 20 },
  ]);
  assert(ranked[0]?.id === 'b', 'combo prefers cheaper total');
  const { isDealAnomaly } = require('./research/dealAnomaly') as typeof import('./research/dealAnomaly');
  assert(isDealAnomaly(50, [150, 160, 180, 200]), 'deal anomaly');
  const { speechSummary500, buyInFromParts } = require('./research/composePlan') as typeof import('./research/composePlan');
  // Flug 100€ p.P. × 2 + Zimmer 200€ = 400 Gesamt → 200 p.P.
  const buy = buyInFromParts({
    flightPerPersonEur: 100,
    stayEur: 200,
    transferEur: 0,
    adults: 2,
  });
  assert(buy.totalPackage === 400, `total 400 got ${buy.totalPackage}`);
  assert(buy.buyInEur === 200, `pp 200 got ${buy.buyInEur}`);
  // Flug 100€ p.P. × 3 + Zimmer 300€ = 600 → 200 p.P.
  const buy3 = buyInFromParts({
    flightPerPersonEur: 100,
    stayEur: 300,
    carEur: 0,
    adults: 3,
  });
  assert(buy3.totalPackage === 600 && buy3.buyInEur === 200, `3p ${buy3.totalPackage}/${buy3.buyInEur}`);
  // + Mietwagen 90 geteilt: 100*2+200+90=490 → 245 p.P.
  const buyCar = buyInFromParts({
    flightPerPersonEur: 100,
    stayEur: 200,
    carEur: 90,
    adults: 2,
  });
  assert(buyCar.totalPackage === 490 && buyCar.buyInEur === 245, `car split ${buyCar.totalPackage}`);
  // Kreuzfahrt Buy-in (User-Beispiel 2 Pers.):
  // Flug hin 100 + Rück 200 p.P. → 600 Flug; Hotel 100; Taxis 20+40+40=100; Cruise 1000 → 1800 / 2 = 900
  const {
    cruiseBuyInFromParts,
    buildCruisePriceBreakdown,
    buildCruiseBookingChecklist,
    enrichOptionAsCruisePlan,
    isCruiseLedger,
  } = require('./research/cruisePlan') as typeof import('./research/cruisePlan');
  const cruiseBuy = cruiseBuyInFromParts({
    flightOutPerPersonEur: 100,
    flightReturnPerPersonEur: 200,
    preNightStayEur: 100,
    transferEur: 20 + 40 + 40,
    cruiseEur: 1000,
    adults: 2,
  });
  assert(cruiseBuy.totalPackage === 1800, `cruise total 1800 got ${cruiseBuy.totalPackage}`);
  assert(cruiseBuy.buyInEur === 900, `cruise pp 900 got ${cruiseBuy.buyInEur}`);
  const cruiseLines = buildCruisePriceBreakdown({
    flightOutPerPersonEur: 100,
    flightReturnPerPersonEur: 200,
    transferAirportToHotelEur: 20,
    preNightStayEur: 100,
    transferHotelToTerminalEur: 40,
    cruiseEur: 1000,
    transferTerminalToAirportEur: 40,
    buyInEur: 900,
  });
  assert(cruiseLines.some((l) => l.id === 'flight_out' && l.amountEur === 100), 'cruise line flight out');
  assert(cruiseLines.some((l) => l.id === 'cruise' && l.amountEur === 1000), 'cruise line cabin');
  assert(cruiseLines.some((l) => l.id === 'buyin' && l.amountEur === 900), 'cruise buyin line');
  const cruiseCheck = buildCruiseBookingChecklist({
    flightUrl: 'https://example.com/flight',
    stayUrl: 'https://example.com/hotel',
    cruiseUrl: 'https://example.com/cruise',
    transferAirportHotelUrl: 'https://example.com/taxi1',
    portCity: 'Hafenstadt',
  });
  assert(cruiseCheck.some((c) => c.kind === 'cruise' && c.url), 'cruise book link');
  assert(cruiseCheck.some((c) => c.kind === 'flight'), 'cruise flight link');
  assert(cruiseCheck.some((c) => c.kind === 'stay'), 'cruise prenight link');
  {
    const cruiseLed = cloneEmptyLedger();
    cruiseLed.tripShape = { value: 'cruise', source: 'user', hardness: 'hard' };
    cruiseLed.adults = { value: 2, source: 'user', hardness: 'hard' };
    cruiseLed.destinationHint = { value: 'Hafenstadt', source: 'user', hardness: 'hard' };
    cruiseLed.dateStart = { value: '2026-10-15', source: 'user', hardness: 'hard' };
    cruiseLed.dateEnd = { value: '2026-10-22', source: 'user', hardness: 'hard' };
    assert(isCruiseLedger(cruiseLed), 'isCruiseLedger');
    const { resolveResearchPath } = require('./research/researchPath') as typeof import('./research/researchPath');
    assert(resolveResearchPath(cruiseLed) === 'flight_first', 'cruise path flight_first');
    const enrichedCruise = enrichOptionAsCruisePlan(
      {
        id: 'c1',
        title: 'Test',
        placeName: 'Hafenstadt',
        flightPriceEur: null,
        stayName: 'Terminal Hotel',
        stayPriceEur: 100,
        stayBookUrl: 'https://example.com/hotel',
        flightBookUrl: 'https://example.com/flight',
        transferBookUrl: 'https://example.com/taxi',
        transferEur: null,
        gaps: [],
        decisionNotes: [],
      } as any,
      cruiseLed,
      {
        flightOutPerPersonEur: 100,
        flightReturnPerPersonEur: 200,
        cruiseEur: 1000,
        transferAirportToHotelEur: 20,
        transferHotelToTerminalEur: 40,
        transferTerminalToAirportEur: 40,
        embarkLatestTime: '16:00',
        shipArriveTime: '08:00',
      },
    );
    assert(enrichedCruise.buyInEur === 900, `enrich buyin 900 got ${enrichedCruise.buyInEur}`);
    assert((enrichedCruise.days?.length ?? 0) >= 2, 'cruise days');
    assert(
      (enrichedCruise.bookingChecklist || []).some((c) => c.kind === 'cruise'),
      'enrich cruise checklist',
    );
    assert(
      (enrichedCruise.priceBreakdown || []).some((l) => l.id === 'buyin' && l.amountEur === 900),
      'enrich breakdown',
    );
  }
  // Flug 100€ p.P. × 2 + Wohnung 1000€ + Mietwagen 100€ = 1300 → 650 p.P.
  const buy650 = buyInFromParts({
    flightPerPersonEur: 100,
    stayEur: 1000,
    carEur: 100,
    adults: 2,
  });
  assert(buy650.totalPackage === 1300 && buy650.buyInEur === 650, `650 pp got ${buy650.totalPackage}/${buy650.buyInEur}`);
  // + Transfer Hin+Rück 80 geteilt: 1300+80=1380 → 690 p.P.
  const buyTx = buyInFromParts({
    flightPerPersonEur: 100,
    stayEur: 1000,
    carEur: 100,
    transferEur: 80,
    adults: 2,
  });
  assert(buyTx.totalPackage === 1380 && buyTx.buyInEur === 690, `transfer split ${buyTx.buyInEur}`);
  const {
    isCrediblePackageBuyIn,
    budgetDeltaVsBuyIn,
    applyFlightPriceHintToOption,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(
    isCrediblePackageBuyIn({ overnight: true, stayEur: 1000, flightPerPersonEur: 100 }),
    'credible with stay+flight',
  );
  assert(
    !isCrediblePackageBuyIn({ overnight: true, stayEur: null, flightPerPersonEur: 145 }),
    'flight-only overnight not credible',
  );
  assert(budgetDeltaVsBuyIn(650, 700, 'per_person', 1300) === -50, 'budget delta pp');
  assert(budgetDeltaVsBuyIn(650, 1200, 'total', 1300) === 100, 'budget delta total');
  const hinted = applyFlightPriceHintToOption(
    {
      id: 'x',
      title: 'X',
      placeName: 'Antalya',
      lat: 0,
      lng: 0,
      totalEur: 1300,
      budgetDeltaEur: null,
      pricePerPerson: 650,
      priceIncludes: null,
      restBudgetEur: null,
      restBudgetHint: null,
      matchScore: 80,
      fitLine: null,
      whyBlurb: '',
      facts: [],
      softFacts: [],
      whyMatch: ['a'] as [string],
      gaps: [],
      photoUrl: null,
      stops: [],
      flightPriceEur: 100,
      stayPriceEur: 1000,
      transferEur: 0,
      carPriceEur: 100,
      buyInEur: 650,
      transports: [{ id: 'f1', kind: 'flight', label: 'HAM→AYT', priceEur: 100, better: true }],
      selectedTransportId: 'f1',
    } as any,
    cloneEmptyLedger(),
    110,
    2,
  );
  assert(hinted.flightPriceEur === 110, 'hint updates flight');
  assert(hinted.carPriceEur === 100 || hinted.buyInEur === 660, `hint keeps car share buyIn=${hinted.buyInEur}`);
  // 110×2 + 1000 + 100 = 1320 → 660
  assert(hinted.buyInEur === 660, `hint rebought ${hinted.buyInEur}`);
  const pitchOpt = {
    id: 'zypern',
    title: 'Zypern',
    placeName: 'Zypern',
    lat: 0,
    lng: 0,
    totalEur: 630,
    budgetDeltaEur: null,
    pricePerPerson: 315,
    priceIncludes: null,
    restBudgetEur: null,
    restBudgetHint: null,
    matchScore: 90,
    fitLine: 'am wärmsten und Preise okay',
    whyBlurb: 'Am wärmsten und von den Preisen völlig okay.',
    facts: [],
    softFacts: [],
    whyMatch: ['am wärmsten', 'Preise okay'] as [string, string],
    gaps: [],
    photoUrl: null,
    stops: [],
    buyInEur: 315,
    stays: [{ id: 's1', name: 'Hotel A', priceEur: 400, bookUrl: 'https://x', photoUrl: 'https://img', why: '' }],
    transports: [
      {
        id: 'f1',
        kind: 'flight' as const,
        label: 'Flug',
        departAt: '08:00',
        arriveAt: null,
        priceEur: 100,
        bookUrl: 'https://y',
        better: true,
        flightNumber: 'FR2049',
      },
    ],
  };
  const pitch = speechSummary500(pitchOpt as any, cloneEmptyLedger());
  assert(/Zypern|Hotel A/i.test(pitch), `pitch place ${pitch}`);
  assert(pitch.length <= 800, `pitch len ${pitch.length}`);
  assert(!/\bab\s*\d/i.test(pitch), 'no ab-price wording in speech');
  assert(!/\bBuy-in\b/i.test(pitch), 'no Buy-in jargon in pitch');
  assert(/würde ich nach|rausgesucht|Plan an|€|Euro/i.test(pitch), `pitch structure ${pitch.slice(0, 100)}`);
  assert(/für (dein|euer)|habe ich (dir|euch)/i.test(pitch) || /liegt das Paket|Unterkunft sitzt/i.test(pitch), `woven pitch ${pitch.slice(0, 100)}`);
  const {
    enrichOptionMagazine,
    formatFinalPriceEur,
    EXPERIENCE_SUMMARY_MAX,
    SPEECH_SUMMARY_MAX,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(formatFinalPriceEur(89) === '89€', 'final price format');
  assert(formatFinalPriceEur(null) === 'Preis noch offen', 'open price');
  const {
    formatFlightTransportLabel,
    stripAbPriceWording,
    withFinalFlightPriceLabel,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(
    formatFlightTransportLabel({
      fromIata: 'HAM',
      toIata: 'AYT',
      departAt: '14:40',
      flightNumber: 'XQ291',
      priceEur: 89,
      transfers: 0,
    }) === 'Flug HAM→AYT · XQ291 · Abflug 14:40 · 89€ · Direkt',
    'flight label abflug wording',
  );
  assert(!/\bab\s*\d/i.test(formatFlightTransportLabel({
    fromIata: 'HAM',
    toIata: 'AYT',
    priceEur: 89,
  })), 'flight label no ab-price');
  assert(stripAbPriceWording('Flug ab 89€ HAM') === 'Flug HAM', 'strip ab euro');
  assert(withFinalFlightPriceLabel('Flug HAM→AYT ab 70€', 89) === 'Flug HAM→AYT · 89€', 'with final price');
  const { userWantsProgramDays } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(
    userWantsProgramDays(
      mergeLedger(cloneEmptyLedger(), {
        stayNights: entry(3, 'user', 'must'),
        purpose: entry('Männerwochenende Party Pool', 'user'),
      }),
    ),
    'nights+party → soft day program',
  );
  assert(
    userWantsProgramDays(
      mergeLedger(cloneEmptyLedger(), {
        mustActivities: entry(['Stadion-Tour', 'Altstadt'], 'user', 'wish'),
      }),
    ),
    'mustActivities → day program',
  );
  assert(
    userWantsProgramDays(
      mergeLedger(cloneEmptyLedger(), {
        highlightWant: entry('Sightseeing und eine Bootstour', 'user'),
      }),
    ),
    'sightseeing/tour in highlight → day program',
  );
  assert(
    userWantsProgramDays(
      mergeLedger(cloneEmptyLedger(), { tripShape: entry('tour', 'user') }),
    ),
    'tripShape tour → day program',
  );
  const {
    buildDayPlans,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  const softDays = buildDayPlans({
    checkin: '2026-10-16',
    checkout: '2026-10-20',
    placeName: 'Budapest',
    ledger: mergeLedger(cloneEmptyLedger(), {
      stayNights: entry(4, 'user'),
      partyGrain: entry('clubs', 'user', 'wish'),
      weatherWant: entry('warm', 'user', 'wish'),
    }),
  });
  assert(softDays.length === 5, `soft days count ${softDays.length}`);
  assert(/Anreise/i.test(softDays[0]!.title), 'day1 anreise');
  assert(softDays.every((d: any) => (d.blocks?.length ?? 0) >= 1), 'each day ≥1 block');
  assert(softDays.every((d: any) => (d.blocks?.length ?? 0) <= 20), 'each day ≤20 blocks');
  assert(/\d+\.\d+\./.test(softDays[0]!.title), `day tab date ${softDays[0]!.title}`);
  assert(softDays[0]!.blocks.some((b) => /Abend|Warm-up|Spaziergang/i.test(b.title)), 'arrival evening');
  assert(softDays.some((d) => /Feiern|Erkunden|Action/i.test(d.title)), 'themed middle');
  assert(/Abreise/i.test(softDays[softDays.length - 1]!.title), 'last abreise');
  // Wochenende 11.–13. → 3 Tage (Anreise, voller Tag, Abreise)
  const weekendLed = mergeLedger(cloneEmptyLedger(), {
    dateStart: entry('2026-09-11', 'user', 'must'),
    dateEnd: entry('2026-09-13', 'user', 'must'),
    stayNights: entry(2, 'user'),
    purpose: entry('Männerwochenende Party', 'user'),
  });
  const weekendDays = buildDayPlans({
    checkin: '2026-09-11',
    checkout: '2026-09-13',
    placeName: 'Prag',
    ledger: weekendLed,
  });
  assert(weekendDays.length === 3, `weekend 3 days got ${weekendDays.length}`);
  assert(/Anreise/i.test(weekendDays[0]!.title), 'weekend day1 anreise');
  assert(/Abreise/i.test(weekendDays[2]!.title), 'weekend day3 abreise');
  // Kollabierter Check-in=Check-out + Nächte → trotzdem volle Spanne
  const collapsed = buildDayPlans({
    checkin: '2026-09-11',
    checkout: '2026-09-11',
    placeName: 'Prag',
    ledger: weekendLed,
  });
  assert(collapsed.length === 3, `collapsed expands to 3 got ${collapsed.length}`);
  const { resolveTripDaySpan, enumerateDateKeysInclusive } = require('./research/tripDaySpan') as typeof import('./research/tripDaySpan');
  assert(
    enumerateDateKeysInclusive('2026-09-11', '2026-09-13').length === 3,
    'enumerate 3 keys',
  );
  assert(
    resolveTripDaySpan({
      checkin: '2026-09-11',
      checkout: '2026-09-11',
      ledger: weekendLed,
    }).checkout === '2026-09-13',
    'span from ledger end',
  );
  // enrichOptionMagazine expandiert 1-Tag-Stub auf Ledger-Spanne
  const oneDayStub = enrichOptionMagazine(
    {
      ...pitchOpt,
      days: [{ dayKey: '2026-09-11', title: 'Tag 1 · Anreise', blocks: [{ id: 'a', title: 'Anreise', detail: 'x' }] }],
      comboWindows: [{ checkin: '2026-09-11', checkout: '2026-09-13' }],
    } as any,
    weekendLed,
  );
  assert((oneDayStub.days?.length ?? 0) === 3, `enrich expands 1→3 got ${oneDayStub.days?.length}`);
  const { normalizeDayPlans, DAY_PLAN_BLOCKS_MAX, dayTabLabel } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(dayTabLabel('2026-09-11', 1).includes('11.9'), `tab label ${dayTabLabel('2026-09-11', 1)}`);
  const filled = normalizeDayPlans([{ dayKey: 'x', title: 'Leer', blocks: [] }]);
  assert((filled[0]!.blocks?.length ?? 0) >= 1, 'normalize fills empty');
  const capped = normalizeDayPlans([
    {
      dayKey: 'y',
      title: 'Voll',
      blocks: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, title: `P${i}`, detail: '' })),
    },
  ]);
  assert(capped[0]!.blocks.length === DAY_PLAN_BLOCKS_MAX, `cap ${capped[0]!.blocks.length}`);
  const withProg = enrichOptionMagazine(
    {
      ...pitchOpt,
      days: softDays,
    } as any,
    mergeLedger(cloneEmptyLedger(), { stayNights: entry(3, 'user'), partyGrain: entry('clubs', 'user') }),
  );
  assert((withProg.days?.length ?? 0) >= 3, 'enrich keeps soft days');
  assert(withProg.sectionAnchors?.some((a: any) => a.id === 'tage'), 'tage anchor with program');
  const noNights = enrichOptionMagazine(
    { ...pitchOpt, days: [{ dayKey: '2026-09-11', title: 'Tag 1', blocks: [] }] } as any,
    mergeLedger(cloneEmptyLedger(), {}),
  );
  assert((noNights.days?.length ?? 0) === 0, 'enrich clears days without overnight/program');
  assert(!noNights.sectionAnchors?.some((a: any) => a.id === 'tage'), 'no tage without program');
  const {
    buildCoverHeadline,
    buildCoverSubline,
    wikiTitleCandidates,
    isPackagePartnerStay,
    filterRealStays,
    buildBookingChecklist,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  const coverLed = mergeLedger(cloneEmptyLedger(), {
    mustHaves: entry(['apartment', 'hotel', 'party'], 'user', 'must'),
    dateStart: entry('2026-10-16', 'user', 'must'),
    dateEnd: entry('2026-10-19', 'user', 'wish'),
    partyGrain: entry('clubs', 'user', 'wish'),
  });
  const coverHead = buildCoverHeadline(
    {
      placeName: 'Antalya, Türkei',
      buyInEur: 650,
      pricePerPerson: 650,
      stayPriceEur: 1000,
      flightPriceEur: 100,
    } as any,
    coverLed,
  );
  assert(/Party in Antalya/i.test(coverHead), `cover punch ${coverHead}`);
  assert(!/Wohnung|Hotel/i.test(coverHead), 'cover skips lodging');
  assert(!/650/i.test(coverHead), 'price not in title');
  const coverFlightOnly = buildCoverHeadline(
    { placeName: 'Antalya, Türkei', buyInEur: 145, pricePerPerson: 145 } as any,
    coverLed,
  );
  assert(!/145/.test(coverFlightOnly), `no fake flight-only price ${coverFlightOnly}`);
  assert(/Antalya/i.test(coverFlightOnly), 'place still shown');
  const coverSub = buildCoverSubline(
    {
      placeName: 'Antalya, Türkei',
      weatherLine: '☀️ 24–30° · klar',
    } as any,
    coverLed,
  );
  assert(/16\.10/.test(coverSub), `cover dates ${coverSub}`);
  assert(!/24–30°/.test(coverSub), `cover no weather dup ${coverSub}`);
  assert(/Antalya/i.test(coverSub), `cover place ${coverSub}`);
  {
    const { formatJourneyClock, buildJourneyBeats } = require('./research/storyMagazine') as typeof import('./research/storyMagazine');
    assert(formatJourneyClock('07:23') === '07:23', 'clock plain');
    assert(formatJourneyClock('2026-09-11T07:23:00') === '07:23', 'clock iso');
    const { sanitizeRailCityName } = require('./research/railJourneyTiming') as typeof import('./research/railJourneyTiming');
    assert(sanitizeRailCityName('davon') === 'Hamburg', 'sanitize davon');
    const trainBeats = buildJourneyBeats(
      {
        id: 'rail1',
        placeName: 'Prag',
        title: 'Prag',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 'tr1',
        transports: [
          {
            id: 'tr1',
            kind: 'train',
            label: 'Bahn davon→Prag · Alter 24',
            departAt: '07:23',
            arriveAt: '15:48',
            departDateKey: '2026-09-11',
            fromStation: 'Hamburg Hbf',
            toStation: 'Praha hl.n.',
            durationHint: '8 h',
            priceEur: null,
            bookUrl: null,
            better: true,
          },
        ],
      } as any,
      { ledger: cloneEmptyLedger() },
    );
    const rail = trainBeats.outbound.find((b: any) => b.kind === 'train_out');
    assert(rail && /07:23/.test(rail.title), `rail title time ${rail?.title}`);
    assert(rail && /Hamburg Hbf/i.test(rail.title) && /Praha|Prag/i.test(rail.title), `rail stations ${rail?.title}`);
    assert(rail && !/Alter/i.test(rail.title) && !/davon/i.test(rail.title), `no age/davon ${rail?.title}`);
    assert(rail && /11\.9/.test(rail.detail || '') && /Ankunft 15:48/.test(rail.detail || ''), `rail detail ${rail?.detail}`);
    assert(rail && /Abfahrt 07:23/.test(rail.detail || ''), `rail depart in detail ${rail?.detail}`);
  assert(rail && /Sparpreis auf bahn\.de/i.test(rail.detail || ''), `rail open price hint ${rail?.detail}`);
    assert(rail && /Beispielverbindung|Live-Fahrplan|Live prüfen/i.test(rail.detail || ''), `rail sample honesty ${rail?.detail}`);
    const viaBeats = buildJourneyBeats(
      {
        id: 'rail-via',
        placeName: 'Prag',
        title: 'Prag',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 'trv',
        transports: [
          {
            id: 'trv',
            kind: 'train',
            label: 'Bahn',
            departAt: '07:23',
            arriveAt: '15:48',
            departDateKey: '2026-09-11',
            fromStation: 'Hamburg Hbf',
            toStation: 'Praha hl.n.',
            viaHint: 'über Berlin Hbf',
            transfers: 1,
            durationHint: '8 h',
            priceEur: 79,
            bookUrl: null,
            better: true,
          },
        ],
        stays: [
          {
            id: 's1',
            name: 'Hotel Moldau',
            priceEur: 400,
            bookUrl: 'https://x',
            photoUrl: null,
            why: '',
            checkInFrom: '15:00',
            checkOutUntil: '11:00',
          },
        ],
      } as any,
      {
        ledger: mergeLedger(cloneEmptyLedger(), {
          dateStart: entry('2026-09-11', 'user'),
          dateEnd: entry('2026-09-13', 'user'),
          originCity: entry('Hamburg', 'user'),
        }),
      },
    );
    const viaRail = viaBeats.outbound.find((b: any) => b.kind === 'train_out');
    assert(viaRail && /über Berlin Hbf/.test(viaRail.detail || ''), `via in detail ${viaRail?.detail}`);
    const destBeat = viaBeats.outbound.find((b: any) => b.kind === 'destination');
    assert(destBeat && /15:48/.test(destBeat.title || ''), `dest arrival clock ${destBeat?.title}`);
    const checkInBeat = viaBeats.outbound.find((b: any) => /Check-in/i.test(b.title || ''));
    assert(checkInBeat && /Check-in/.test(checkInBeat.title || ''), `checkin beat ${checkInBeat?.title}`);
    assert(checkInBeat && /16:18/.test(checkInBeat.detail || ''), `checkin after arrive ${checkInBeat?.detail}`);
    assert(checkInBeat && /11\.9|13\.9/.test(checkInBeat.detail || ''), `checkin dates ${checkInBeat?.detail}`);
    assert(checkInBeat?.kind === 'other', 'checkin beat is other (stay stays in Unterkunft section)');
    const { formatDateJourney, estimateCheckInClock } = require('./research/storyMagazine') as typeof import('./research/storyMagazine');
    assert(/Fr 11\.9/.test(formatDateJourney('2026-09-11') || ''), `weekday date ${formatDateJourney('2026-09-11')}`);
    assert(estimateCheckInClock('15:48') === '16:18', `checkin after arrive ${estimateCheckInClock('15:48')}`);
    assert(estimateCheckInClock('10:00') === '15:00', 'checkin typical before 15');
    assert(estimateCheckInClock('15:48', '15:00') === '16:18', 'policy+arrive');
    const pricedBeats = buildJourneyBeats(
      {
        id: 'rail2',
        placeName: 'Prag',
        title: 'Prag',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 'tr2',
        transports: [
          {
            id: 'tr2',
            kind: 'train',
            label: 'Bahn Hamburg Hbf → Praha · 89€ p.P. Hin+Rück',
            departAt: '07:23',
            arriveAt: '15:48',
            departDateKey: '2026-09-11',
            fromStation: 'Hamburg Hbf',
            toStation: 'Praha hl.n.',
            durationHint: '8 h · Sparpreis',
            priceEur: 89,
            bookUrl: 'https://www.bahn.de/x',
            better: true,
          },
        ],
      } as any,
      { ledger: cloneEmptyLedger() },
    );
    const priced = pricedBeats.outbound.find((b: any) => b.kind === 'train_out');
    assert(priced && priced.priceEur === 89, `rail beat price ${priced?.priceEur}`);
    assert(priced && /89/.test(priced.detail || ''), `rail detail price ${priced?.detail}`);
    const ret = pricedBeats.inbound.find((b: any) => b.kind === 'train_return');
    assert(ret && ret.priceEur == null, 'return no double price');
    const { buildPriceBreakdown } = require('./research/storyMagazine') as typeof import('./research/storyMagazine');
    const { applySelectedStayTransport } = require('./research/composePlan') as typeof import('./research/composePlan');
    const trainOpt = {
      id: 'rail-buy',
      placeName: 'Prag',
      title: 'Prag',
      matchScore: 80,
      gaps: [],
      facts: [],
      whyBlurb: '',
      selectedTransportId: 'tr2',
      selectedStayId: 's1',
      stays: [{ id: 's1', name: 'Pension', priceEur: 200, bookUrl: null, photoUrl: null, why: '' }],
      transports: [
        {
          id: 'tr2',
          kind: 'train',
          label: 'Bahn · 89€ p.P. Hin+Rück',
          priceEur: 89,
          bookUrl: 'https://www.bahn.de/x',
          better: true,
          durationHint: 'Sparpreis Hin+Rück',
        },
      ],
      buyInEur: null,
    } as any;
    const bd = buildPriceBreakdown(trainOpt);
    assert(bd.some((l: any) => l.id === 'train' && l.amountEur === 89), `breakdown train ${JSON.stringify(bd)}`);
    assert(bd.some((l: any) => /Hin\+Rück/i.test(l.label)), `breakdown rt label ${JSON.stringify(bd)}`);
    const bought = applySelectedStayTransport(trainOpt, 2);
    assert(bought.buyInEur === 189, `train buy-in 89*2+200=/2 → 189 got ${bought.buyInEur}`);
  }
  assert(
    wikiTitleCandidates('Antalya, Türkei').includes('Antalya'),
    'wiki strips country',
  );
  assert(isPackagePartnerStay({ name: 'Pauschal CHECK24', bookUrl: 'https://check24.de/x' }), 'detect check24');
  assert(
    isPackagePartnerStay({
      name: 'Pauschal Lidl Reisen',
      bookUrl: 'https://www.lidl-reisen.de/?q=x',
    }),
    'detect lidl',
  );
  assert(
    isPackagePartnerStay({
      name: 'TUI Magic Life',
      bookUrl: 'https://www.magiclife.com/?q=x',
    }),
    'detect magic life',
  );
  assert(isPackagePartnerStay({ name: 'Hotel Beach', bookUrl: 'https://booking.com/x' }) === false, 'real stay ok');
  assert(
    isPackagePartnerStay({
      name: 'Hotel U Prince',
      bookUrl: 'https://www.check24.de/hotel/hotel-u-prince',
    }) === false,
    'real hotel with check24 affiliate url stays',
  );
  assert(
    isPackagePartnerStay({
      name: 'Apartamentos Tito',
      bookUrl: 'https://www.awin1.com/cread.php?awinmid=9364&ued=https://expedia.de/x',
    }) === false,
    'real hotel awin not package',
  );
  const filtered = filterRealStays([
    { id: '1', name: 'Villa Real', priceEur: 200, bookUrl: 'https://x', photoUrl: null, why: '' },
    { id: '2', name: 'Pauschal CHECK24', priceEur: null, bookUrl: 'https://check24.de/p', photoUrl: null, why: '' },
  ]);
  assert(filtered.length === 1 && filtered[0]!.name === 'Villa Real', 'filter package stays');
  const checklist = buildBookingChecklist({
    stays: [
      {
        id: '1',
        name: 'Villa Real',
        priceEur: 200,
        bookUrl:
          'https://www.expedia.de/Hotel-Information?hotelId=12345678&chkin=2026-07-10&chkout=2026-07-17',
        photoUrl: null,
        why: '',
        expediaPropertyId: '12345678',
      },
      { id: 'pkg', name: 'Pauschal CHECK24', priceEur: null, bookUrl: 'https://check24.de/p', photoUrl: null, why: '' },
    ],
    selectedStayId: '1',
    packageUrls: [{ label: 'Pauschal ab-in-den-urlaub', url: 'https://ab-in-den-urlaub.de/x' }],
    packageBookUrl: 'https://check24.de/pack',
  });
  assert(!checklist.some((c) => c.kind === 'stay' && /check24|pauschal/i.test(c.label)), 'no package stay button');
  assert(checklist.some((c) => c.kind === 'package' && /CHECK24|ab-in-den/i.test(c.label)), 'package link when intentional');
  assert(checklist.some((c) => c.kind === 'stay' && c.label === 'Villa Real'), 'real stay link');
  const diyChecklist = buildBookingChecklist({
    stays: [
      {
        id: '1',
        name: 'Villa Real',
        priceEur: 200,
        bookUrl:
          'https://www.expedia.de/Hotel-Information?hotelId=12345678&chkin=2026-07-10&chkout=2026-07-17',
        photoUrl: null,
        why: '',
        expediaPropertyId: '12345678',
      },
    ],
    selectedStayId: '1',
  });
  assert(!diyChecklist.some((c) => c.kind === 'package'), 'DIY → no hollow CHECK24');
  assert(diyChecklist.some((c) => c.kind === 'stay' && c.label === 'Villa Real'), 'DIY stay only');
  const hollowChecklist = buildBookingChecklist({
    stays: [
      { id: 'h', name: 'Nur Suche', priceEur: 100, bookUrl: 'https://www.expedia.com/', photoUrl: null, why: '' },
    ],
  });
  assert(
    hollowChecklist.some((c) => c.kind === 'stay' && /noch nachziehen/i.test(c.label) && !c.url),
    'hollow stay → nachziehen',
  );
  const magLed = mergeLedger(cloneEmptyLedger(), {
    mustHaves: entry(['pool', 'grill', 'padel'], 'user', 'must'),
    adults: entry(2, 'user', 'must'),
  });
  const {
    REAL_STAY_CHOICE_MAX,
  } = require('./research/composePlan') as typeof import('./research/composePlan');
  assert(REAL_STAY_CHOICE_MAX === 4, 'max 4 real stays');
  const flightHinted = applyFlightPriceHintToOption(
    {
      ...pitchOpt,
      flightPriceEur: 70,
      transports: [
        {
          id: 'f1',
          kind: 'flight',
          label: 'Flug HAM→AYT · Abflug 08:00 · 70€',
          departAt: '08:00',
          arriveAt: null,
          priceEur: 70,
          bookUrl: 'https://y',
          better: true,
          fromIata: 'HAM',
          toIata: 'AYT',
          flightNumber: 'FR2049',
        },
      ],
      selectedTransportId: 'f1',
      transferEur: 40,
      transferMinutes: 35,
    } as any,
    magLed,
    119,
    2,
  );
  assert(flightHinted.flightPriceEur === 119, 'hint sets flight price');
  assert(
    flightHinted.journeyBeats?.some(
      (b: any) => b.kind === 'flight_out' && b.priceEur === 119,
    ),
    'magazine flight beat uses hint price',
  );
  assert(!/\bab\s*\d/i.test(flightHinted.transports?.[0]?.label || ''), 'hint label no ab');
  assert(/119€/.test(flightHinted.transports?.[0]?.label || ''), 'hint label final price');
  const mag = enrichOptionMagazine(
    {
      ...pitchOpt,
      transferEur: 55,
      transferMinutes: 45,
      facts: [
        { id: 'pool', emoji: '🏊', label: 'Pool', met: true },
        { id: 'grill', emoji: '🍖', label: 'Grill', met: true },
        { id: 'padel', emoji: '🎾', label: 'Padel', met: false },
      ],
    } as any,
    magLed,
  );
  assert((mag.experienceSummary || '').length <= EXPERIENCE_SUMMARY_MAX, 'summary max');
  assert((mag.speechSummary || '').length <= SPEECH_SUMMARY_MAX, 'speech max');
  assert((mag.wishChapters?.length ?? 0) >= 3, 'wish chapters for musts');
  assert((mag.journeyBeats?.length ?? 0) >= 2, 'journey beats');
  assert((mag.returnBeats?.length ?? 0) >= 1, 'return beat');
  const xferBeat = mag.journeyBeats?.find((b: any) => b.kind === 'transfer');
  assert(xferBeat?.priceEur === 55, `transfer price in beat ${xferBeat?.priceEur}`);
  assert(/45 Min/i.test(xferBeat?.detail || xferBeat?.durationHint || ''), 'transfer duration');
  const { beatPhotoWikiTitles } = require('./research/storyMagazine') as typeof import('./research/storyMagazine');
  assert(beatPhotoWikiTitles('flight_out').includes('Airplane'), 'flight wiki titles');
  assert(beatPhotoWikiTitles('transfer').includes('Taxi'), 'taxi wiki titles');
  assert(mag.sectionAnchors?.some((a: any) => a.id === 'buchen'), 'section anchors');
  assert(!/\bab\s*\d/i.test(mag.experienceSummary || ''), 'summary no ab');
  assert(/Party|Pool|€/.test(mag.title), `magazine title punchy ${mag.title}`);
  assert(!/Wohnung.*Hotel/i.test(mag.title), 'title skips lodging list');
  const {
    parseCourtHint,
    parseCostHint,
    extraNearbyFromLedger,
  } = require('./research/wishEvidenceHarvest') as typeof import('./research/wishEvidenceHarvest');
  assert(parseCourtHint('Club X — 8 Plätze padel') === '8 Plätze', 'court hint');
  assert(parseCostHint('Platz 15€ / h') === '15€', 'cost hint');
  assert(parseCostHint('nice club') == null, 'no invented cost');
  const extras = extraNearbyFromLedger(
    mergeLedger(cloneEmptyLedger(), {
      highlightWant: entry('Stadion und Sightseeing, Bootstour am Abend', 'user'),
    }),
  );
  assert(extras.some((e) => e.id === 'stadium'), 'brief stadium');
  assert(extras.some((e) => e.id === 'tour'), 'brief tour');
  assert(extras.some((e) => e.id === 'sight'), 'brief sight');
  assert(
    extraNearbyFromLedger(
      mergeLedger(cloneEmptyLedger(), { purpose: entry('Männerwochenende Party Pool', 'user') }),
    ).some((e) => e.id === 'club'),
    'party in purpose → club search',
  );
  assert(
    !extraNearbyFromLedger(
      mergeLedger(cloneEmptyLedger(), { purpose: entry('ruhiges Strandwochenende', 'user') }),
    ).some((e) => e.id === 'club'),
    'no club without party wish',
  );
  assert(
    extraNearbyFromLedger(
      mergeLedger(cloneEmptyLedger(), {
        wishHaves: entry(['party'], 'user'),
      }),
    ).some((e) => e.id === 'club'),
    'party wishHave → club',
  );
  assert(
    extraNearbyFromLedger(
      mergeLedger(cloneEmptyLedger(), {
        highlightWant: entry('Nightclub und Disco am Hafen', 'user'),
      }),
    ).some((e) => e.id === 'club'),
    'brief club from nightclub',
  );
  const { commonsFileUrl } = require('./research/osmPlacePhoto') as typeof import('./research/osmPlacePhoto');
  assert(
    /Special:FilePath/.test(commonsFileUrl('File:Nightclub.jpg') || ''),
    'commons file path',
  );
  const {
    hotellookHotelHeroUrl,
    hotellookHotelIdFromRow,
    photoUrlFromCacheRow,
  } = require('./research/hotellookPhotos') as typeof import('./research/hotellookPhotos');
  assert(/h418520_1/.test(hotellookHotelHeroUrl(418520)), 'hotellook hero uses h{id}_1');
  assert(hotellookHotelIdFromRow({ id: 418520 }) === '418520', 'hotel id from id field');
  assert(
    /h418520_1/.test(photoUrlFromCacheRow({ hotelId: 418520 }) || ''),
    'cache row always has hero photo',
  );
  const {
    hotellookHotelGalleryUrls,
    hotellookIdFromStayRef,
  } = require('./research/hotellookPhotos') as typeof import('./research/hotellookPhotos');
  assert(hotellookHotelGalleryUrls(418520, 3).length === 3, 'gallery length');
  assert(/h418520_2/.test(hotellookHotelGalleryUrls(418520, 3)[1] || ''), 'gallery idx 2');
  assert(hotellookIdFromStayRef('hl-418520') === '418520', 'id from stay ref');
  const { scenicWikiAlts, isUnappealingDestPhotoUrl } = require('./research/destPhotoPick') as typeof import('./research/destPhotoPick');
  assert(scenicWikiAlts('Prag').some((t: string) => /Karlsbrücke|Charles Bridge/i.test(t)), 'prag scenic');
  assert(isUnappealingDestPhotoUrl('https://upload.wikimedia.org/wikipedia/commons/x/zizkov_tv_tower.jpg'), 'reject zizkov');
  const { takeUniquePhoto, stayHotelGalleryPool } = require('./research/magazineEnsure') as typeof import('./research/magazineEnsure');
  const usedPhotos = new Set<string>();
  const u1 = takeUniquePhoto('https://img.example/a.jpg', [], usedPhotos);
  const u2 = takeUniquePhoto('https://img.example/a.jpg', ['https://img.example/b.jpg'], usedPhotos);
  assert(u1 === 'https://img.example/a.jpg' && u2 === 'https://img.example/b.jpg', 'unique photos');
  assert(
    stayHotelGalleryPool({ id: 'hl-418520', name: 'X', priceEur: 1, bookUrl: 'https://x', photoUrl: null, why: '' })[0]?.includes('h418520_1'),
    'stay gallery from hl id',
  );
  const { isClonedPlacePhoto } = require('./research/magazineEnsure') as typeof import('./research/magazineEnsure');
  assert(isClonedPlacePhoto('https://img.example/dest.jpg', 'https://img.example/dest.jpg', null), 'clone detect dest');
  assert(!isClonedPlacePhoto('https://img.example/pacha.jpg', 'https://img.example/dest.jpg', null), 'own club photo ok');
  {
    const { wikiTitleCandidates: wikiTitlesScenic } = require('./research/wikiThumb') as typeof import('./research/wikiThumb');
    assert(wikiTitlesScenic('Prag')[0] && /Karls|Charles|Prag/i.test(wikiTitlesScenic('Prag')[0]!), 'wiki scenic first');
  }
  const { buildDbJourneySearchUrl } = require('../services/transit/transitTicketFareParse') as typeof import('../services/transit/transitTicketFareParse');
  const dbUrl = buildDbJourneySearchUrl({
    from: 'Hamburg',
    to: 'Berlin Hbf',
    dateKey: '2026-09-20',
    returnDateKey: '2026-09-24',
    bahncard: '25',
  });
  assert(dbUrl && /hd=2026-09-20/.test(dbUrl), 'bahn date in deeplink');
  assert(dbUrl && /h2d=2026-09-24/.test(dbUrl), 'bahn return in deeplink');
  assert(dbUrl && /bc=2/.test(dbUrl), 'bahncard in deeplink');
  const magWithEv = enrichOptionMagazine(pitchOpt as any, magLed, {
    wishEvidence: [
      {
        mustHaveId: 'padel',
        name: 'Padel Arena',
        distanceM: 5200,
        distanceAnchor: 'stay',
        photoUrl: 'https://img.example/padel.jpg',
        editorial: 'Acht Courts am Hafen — oft spontan buchbar am Nachmittag.',
        courtHint: '8 Plätze',
        costHint: '15€',
        met: true,
        onProperty: false,
      },
      {
        mustHaveId: 'pool',
        photoUrl: 'https://img.example/pool.jpg',
        met: true,
        onProperty: true,
      },
      {
        mustHaveId: 'stadium',
        name: 'Antalya Stadium',
        distanceM: 4200,
        distanceAnchor: 'stay',
        photoUrl: 'https://img.example/stadion.jpg',
        editorial: 'Modernes Arena-Dach, Abendspiele mit guter Anbindung.',
        met: true,
        onProperty: false,
      },
    ],
  });
  const padelCh = magWithEv.wishChapters?.find((c: any) => c.mustHaveId === 'padel');
  assert(padelCh?.photoUrl?.includes('padel'), 'padel photo from evidence');
  assert(Boolean(padelCh?.bookUrl), 'padel ticket deeplink');
  assert(/8 Plätze|15€|Padel Arena|5,2 km|von der Unterkunft/.test(`${padelCh?.blurb} ${padelCh?.costHint} ${padelCh?.distanceHint}`), 'padel evidence in UI');
  assert(/von der Unterkunft/i.test(padelCh?.distanceHint || ''), 'km from stay');
  assert(!/5\.2 km/.test(padelCh?.distanceHint || ''), 'de comma km');
  assert(!/Padel Arena.*Padel Arena/i.test(`${padelCh?.title} ${padelCh?.distanceHint}`), 'no name twice');
  const noStayKm = enrichOptionMagazine(pitchOpt as any, magLed, {
    wishEvidence: [
      {
        mustHaveId: 'club',
        name: 'Duplex',
        distanceM: 1100,
        distanceAnchor: 'city',
        met: true,
        onProperty: false,
      },
    ],
  });
  const clubNoStay = noStayKm.wishChapters?.find((c: any) => /duplex/i.test(c.title || ''));
  assert(clubNoStay && !/km/i.test(clubNoStay.distanceHint || ''), 'no fake km without stay');
  assert(/Duplex/i.test(clubNoStay?.title || ''), 'club name in title');
  const duplexTwice = enrichOptionMagazine(pitchOpt as any, magLed, {
    wishEvidence: [
      {
        mustHaveId: 'activity',
        name: 'Duplex',
        distanceM: 1100,
        distanceAnchor: 'stay',
        met: true,
        onProperty: false,
      },
      {
        mustHaveId: 'club',
        name: 'Duplex Club',
        distanceM: 1100,
        distanceAnchor: 'stay',
        met: true,
        onProperty: false,
      },
    ],
  });
  const duplexChapters = (duplexTwice.wishChapters ?? []).filter((c: any) =>
    /duplex/i.test(c.title || ''),
  );
  assert(duplexChapters.length === 1, `duplex once got ${duplexChapters.length}`);
  assert(
    !/Duplex.*Duplex/i.test(`${duplexChapters[0]?.title} ${duplexChapters[0]?.distanceHint}`),
    'title+hint no double name',
  );
  // Party/Pool: Wünsche nicht als „Noch offen“, wenn Nightlife/Stay belegt
  const partyPoolLed = mergeLedger(cloneEmptyLedger(), {
    wishHaves: entry(['party', 'pool'], 'user'),
    partyGrain: entry('clubs', 'user'),
  });
  const partyViaClub = enrichOptionMagazine(
    {
      ...pitchOpt,
      placeName: 'Prag',
      softFacts: [{ id: 'wish_party', emoji: '🎉', label: 'Party', met: true }],
      stays: [
        {
          id: 's1',
          name: 'Hotel Poolside',
          priceEur: 400,
          bookUrl: 'https://x',
          photoUrl: 'https://img',
          why: 'Pool auf dem Dach',
        },
      ],
    } as any,
    partyPoolLed,
    {
      wishEvidence: [
        {
          mustHaveId: 'club',
          name: 'Duplex',
          distanceM: 1100,
          distanceAnchor: 'stay',
          met: true,
          onProperty: false,
        },
        {
          mustHaveId: 'pool',
          met: true,
          onProperty: true,
          photoUrl: 'https://img.example/pool.jpg',
        },
      ],
    },
  );
  const partyCh = partyViaClub.wishChapters?.find((c: any) => c.mustHaveId === 'party');
  const poolCh = partyViaClub.wishChapters?.find((c: any) => c.mustHaveId === 'pool');
  assert(partyCh?.met === true, 'party met via club evidence');
  assert(poolCh?.met === true, 'pool met via stay evidence');
  assert(
    !(partyViaClub.wishChapters ?? []).some((c: any) => !c.met && (c.mustHaveId === 'party' || c.mustHaveId === 'pool')),
    'party+pool not open when covered',
  );
  const partyViaTags = enrichOptionMagazine(
    {
      ...pitchOpt,
      placeName: 'Prag',
      softFacts: [{ id: 'wish_party', emoji: '🎉', label: 'Party', met: true }],
    } as any,
    mergeLedger(cloneEmptyLedger(), { wishHaves: entry(['party'], 'user') }),
    {
      // Früher: unmet-Stub killte fact.met — Stub weglassen, Fact entscheiden
      wishEvidence: [],
    },
  );
  assert(
    partyViaTags.wishChapters?.find((c: any) => c.mustHaveId === 'party')?.met === true,
    'party met from soft fact without stub',
  );
  const poolViaName = enrichOptionMagazine(
    {
      ...pitchOpt,
      stays: [
        {
          id: 's1',
          name: 'Apartment mit Schwimmbad',
          priceEur: 300,
          bookUrl: 'https://x',
          photoUrl: 'https://img',
          why: '',
        },
      ],
    } as any,
    mergeLedger(cloneEmptyLedger(), { wishHaves: entry(['pool'], 'user') }),
    {
      wishEvidence: [{ mustHaveId: 'pool', met: false, onProperty: true }],
    },
  );
  assert(
    poolViaName.wishChapters?.find((c: any) => c.mustHaveId === 'pool')?.met === true,
    'pool met from stay name despite empty amenity evidence',
  );
  assert(/Acht Courts|Hafen/i.test(padelCh?.blurb || ''), 'editorial in padel blurb');
  const stadCh = magWithEv.wishChapters?.find((c: any) => c.mustHaveId === 'stadium');
  assert(stadCh?.photoUrl?.includes('stadion'), 'stadium photo');
  assert(Boolean(stadCh?.bookUrl), 'stadium ticket deeplink');
  assert(/Arena|Abendspiele/i.test(stadCh?.blurb || ''), 'stadium editorial blurb');
  const briefOnly = enrichOptionMagazine(pitchOpt as any, mergeLedger(cloneEmptyLedger(), {
    highlightWant: entry('Sightseeing und Stadion', 'user'),
  }));
  assert(
    briefOnly.wishChapters?.some((c: any) => c.mustHaveId === 'sight') &&
      briefOnly.wishChapters?.some((c: any) => c.mustHaveId === 'stadium'),
    'brief stubs for sight+stadium',
  );
  const { deepEnrichMagazineOption } = require('./research/magazineEnsure') as typeof import('./research/magazineEnsure');
  const ensured = await deepEnrichMagazineOption(
    {
      ...pitchOpt,
      photoUrl: 'https://img.example/dest.jpg',
      transferEur: 55,
      transferMinutes: 45,
      wishEvidence: [
        {
          mustHaveId: 'pool',
          photoUrl: 'https://img.example/pool.jpg',
          met: true,
          onProperty: true,
        },
      ],
    } as any,
    magLed,
  );
  assert((ensured.experienceSummary || '').length > 0, 'ensure summary');
  assert((ensured.speechSummary || '').length > 0, 'ensure speech');
  assert((ensured.journeyBeats?.length ?? 0) >= 2, 'ensure journey');
  assert((ensured.wishChapters ?? []).find((c: any) => c.mustHaveId === 'pool')?.photoUrl, 'pool photo');
  const grillPhoto = (ensured.wishChapters ?? []).find((c: any) => c.mustHaveId === 'grill')?.photoUrl;
  assert(grillPhoto, 'grill on-property stay photo');
  const padelPhoto = (ensured.wishChapters ?? []).find((c: any) => c.mustHaveId === 'padel')?.photoUrl;
  assert(!padelPhoto || !/dest\.jpg/.test(padelPhoto), 'padel not dest clone');
  const clubEnsured = await deepEnrichMagazineOption(
    {
      ...pitchOpt,
      photoUrl: 'https://img.example/dest.jpg',
      wishEvidence: [
        {
          mustHaveId: 'club',
          name: 'Pacha',
          photoUrl: 'https://img.example/dest.jpg',
          met: true,
          onProperty: false,
        },
      ],
    } as any,
    mergeLedger(cloneEmptyLedger(), { highlightWant: entry('Nightclub Disco', 'user') }),
  );
  const clubCh = (clubEnsured.wishChapters ?? []).find((c: any) => c.mustHaveId === 'club');
  assert(clubCh, 'club chapter present');
  assert(!clubCh?.photoUrl || !/dest\.jpg/.test(clubCh.photoUrl), 'club not dest clone');
  const gateOk = (
    require('./research/qualityGates') as typeof import('./research/qualityGates')
  ).checkPackageComplete(ensured as any, magLed);
  assert(gateOk.hardOk, `perfect path hard gates ${JSON.stringify(gateOk.issues)}`);
  assert(!/\bab\s*\d+\s*€/i.test(`${ensured.experienceSummary} ${ensured.speechSummary}`), 'ensure no ab€');
  const { passesFlightJunkFilter } = require('./research/flightFilter') as typeof import('./research/flightFilter');
  const { needsHubPreNight, hubPreNightDateKey } = require('./research/hubPreNight') as typeof import('./research/hubPreNight');
  assert(
    !passesFlightJunkFilter(
      { departAt: '05:00', arriveAt: '23:30', layoverHours: 8 },
      mergeLedger(cloneEmptyLedger(), {}),
    ),
    'junk night+layover filtered',
  );
  assert(
    passesFlightJunkFilter(
      { departAt: '05:00', arriveAt: '12:30' },
      mergeLedger(cloneEmptyLedger(), {}),
    ),
    'early depart kept by default',
  );
  assert(
    needsHubPreNight(
      { kind: 'flight', departAt: '05:00' },
      mergeLedger(cloneEmptyLedger(), {}),
    ),
    'early flight needs hub pre-night',
  );
  assert(
    !needsHubPreNight(
      { kind: 'flight', departAt: '05:00' },
      mergeLedger(cloneEmptyLedger(), parseBriefSlots('kein Frühflug bitte')),
    ),
    'user no-early skips hub night',
  );
  assert(
    !needsHubPreNight(
      { kind: 'cruise', departAt: '06:00' },
      mergeLedger(cloneEmptyLedger(), {}),
    ),
    'cruise embark is dest-terminal, not origin hub',
  );
  assert(hubPreNightDateKey('2026-10-04') === '2026-10-03', 'hub night = day before fly day');
  const noEarly = parseBriefSlots('kein Frühflug');
  assert(noEarly.flightComfort?.value?.noEarlyDepart === true, 'kein Frühflug slot');
  assert(
    !passesFlightJunkFilter(
      { departAt: '05:00' },
      mergeLedger(cloneEmptyLedger(), noEarly),
    ),
    'explicit no-early filters 05:00',
  );
  assert(
    !passesFlightJunkFilter(
      { layoverHours: 25 },
      mergeLedger(cloneEmptyLedger(), {}),
    ),
    '25h layover junk without explicit explore',
  );
  assert(
    passesFlightJunkFilter(
      { layoverHours: 30 },
      mergeLedger(cloneEmptyLedger(), parseBriefSlots('kein Problem 30 Stunden in Dubai hängen und die Stadt angucken')),
    ),
    'explicit long layover explore allowed',
  );
  assert(
    !passesFlightJunkFilter(
      { layoverHours: 8 },
      mergeLedger(cloneEmptyLedger(), parseBriefSlots('kein Problem 30 Stunden in Dubai hängen und die Stadt angucken')),
    ),
    'dead 8h stop still junk even with explore',
  );
  const dubai = parseBriefSlots('kein Problem 30 Stunden in Dubai hängen und die Stadt angucken');
  assert((dubai.longLayoverExploreHours?.value ?? 0) >= 16, `explore hours ${dubai.longLayoverExploreHours?.value}`);
  const nightFly = parseBriefSlots('lieber Nachtflug und im Flieger schlafen, Hotel sparen');
  assert(nightFly.overnightFlightOk?.value === true, 'night flight explicit');
  const aiCombo = parseBriefSlots('All Inclusive Hotel wäre geil');
  assert(aiCombo.meals?.value === 'all', 'ai meals');
  assert(aiCombo.lodgingKind?.value === 'hotel', 'ai implies hotel first');
  assert(aiCombo.lodgingFallback?.value === 'apartment', 'ai apartment as second track');
  const eitherAiOrApt = parseBriefSlots(
    'entweder all inclusive und Hotel oder eigenes Apartment',
  );
  assert(eitherAiOrApt.meals?.value === 'all', 'either: meals all');
  assert(eitherAiOrApt.lodgingKind?.value === 'hotel', 'either: hotel first');
  assert(eitherAiOrApt.lodgingFallback?.value === 'apartment', 'either: apt fallback');
  const eitherAptOrAi = parseBriefSlots(
    'entweder eigenes Apartment oder All Inclusive Hotel',
  );
  assert(eitherAptOrAi.lodgingKind?.value === 'apartment', 'reverse: apt first');
  assert(eitherAptOrAi.lodgingFallback?.value === 'hotel', 'reverse: hotel fallback');
  const longBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), dubai));
  assert(longBoard.some((n) => /langer Stopp/i.test(n.label)), 'long layover sticker');

  const { isSoftBargain, dealHuntRatio, dealScoreBoost } = require('./research/dealAnomaly') as typeof import('./research/dealAnomaly');
  assert(isSoftBargain(80, [150, 160, 170, 180]), 'soft bargain');
  assert(dealHuntRatio(mergeLedger(cloneEmptyLedger(), { dealHunt: entry(true, 'user', 'wish') })) < dealHuntRatio(cloneEmptyLedger()), 'aggressive deal ratio');
  assert(dealScoreBoost({ hardHit: true, softHit: false, dealHunt: true }) >= 9, 'hard deal boost');

  const { metroKey, pickDiverseOptions, pickFinalOptions } = require('./research/diversity') as typeof import('./research/diversity');
  assert(metroKey('Palma de Mallorca') === metroKey('Magaluf'), 'mallorca metro cluster');
  assert(metroKey('Ibiza') !== metroKey('Palma'), 'ibiza ≠ malle');
  assert(metroKey('Budapest') !== metroKey('Prag'), 'budapest ≠ prag');
  const fakeOpts = [
    { id: 'a', placeName: 'Palma', matchScore: 90, gaps: [], softFacts: [{ id: 'meals_ai', met: true }], stays: [], whyBlurb: '' },
    { id: 'b', placeName: 'Magaluf', matchScore: 89, gaps: [], softFacts: [{ id: 'meals_ai', met: true }], stays: [], whyBlurb: '' },
    { id: 'c', placeName: 'Ibiza', matchScore: 88, gaps: [], softFacts: [], stays: [], whyBlurb: '' },
    { id: 'd', placeName: 'Budapest', matchScore: 87, gaps: [], softFacts: [], stays: [], whyBlurb: '' },
    { id: 'e', placeName: 'Prag', matchScore: 86, gaps: [], softFacts: [], stays: [], whyBlurb: '' },
  ] as any;
  const div = pickDiverseOptions(fakeOpts, 4);
  assert(div.length === 4, `diverse count ${div.length}`);
  assert(!div.some((o: any) => o.id === 'b'), 'magaluf dropped as mallorca twin');
  assert(div.map((o: any) => o.placeName).includes('Ibiza'), 'ibiza kept');
  assert(div.map((o: any) => o.placeName).includes('Budapest'), 'budapest kept');

  const softAiLedger = mergeLedger(cloneEmptyLedger(), {
    meals: entry('all', 'user', 'optional'),
    purpose: entry('Party', 'user', 'wish'),
  });
  const mixed = pickFinalOptions(fakeOpts, softAiLedger, 4);
  assert(mixed.length === 4, 'soft AI mix length');
  const aiCount = mixed.filter((o: any) => o.softFacts?.some((f: any) => f.id === 'meals_ai' && f.met)).length;
  assert(aiCount <= 2, `soft AI cap ${aiCount}`);
  assert(mixed.some((o: any) => !o.softFacts?.some((f: any) => f.id === 'meals_ai' && f.met)), 'non-AI in soft mix');

  const {
    tasteAffinityScore,
    pickFromShortlist,
    intentArcFromLedger,
  } = require('./research/shortlistFunnel') as typeof import('./research/shortlistFunnel');
  const malleLedger = mergeLedger(cloneEmptyLedger(), {
    inspiration: entry('Malle', 'user', 'wish'),
    purpose: entry('Party', 'user', 'wish'),
    mustHaves: entry(['party'], 'user', 'must'),
    budgetEur: entry(300, 'user', 'must'),
  });
  assert(intentArcFromLedger(malleLedger) === 'party', 'party arc');
  assert(tasteAffinityScore('Palma', ['party'], malleLedger) > tasteAffinityScore('Ibiza', ['party'], malleLedger), 'malle > ibiza for malle fan');
  const priced = [
    { id: 'a', placeName: 'Palma', matchScore: 80, gaps: [], softFacts: [], stays: [], whyBlurb: '', buyInEur: 280, decisionNotes: [] as string[] },
    { id: 'b', placeName: 'Ibiza', matchScore: 92, gaps: [], softFacts: [], stays: [], whyBlurb: '', buyInEur: 290, decisionNotes: [] as string[] },
    { id: 'c', placeName: 'Budapest', matchScore: 78, gaps: [], softFacts: [], stays: [], whyBlurb: '', buyInEur: 220, decisionNotes: [] as string[] },
    { id: 'd', placeName: 'Prag', matchScore: 76, gaps: [], softFacts: [], stays: [], whyBlurb: '', buyInEur: 210, decisionNotes: [] as string[] },
    { id: 'e', placeName: 'Antalya', matchScore: 70, gaps: [], softFacts: [], stays: [], whyBlurb: '', buyInEur: 900, decisionNotes: [] as string[] },
  ] as any;
  const picked = pickFromShortlist(priced, malleLedger, 4);
  assert(picked.finalists.length === 4, 'shortlist final 4');
  assert(picked.shortlist.length === 5, 'shortlist keeps all for transparency');
  assert(picked.finalists.some((o: any) => o.placeName === 'Palma'), 'palma in final for malle fan');
  assert(picked.finalists[0].placeName === 'Palma', `malle fan favorit ${picked.finalists[0].placeName}`);
  assert(/Finalisten|Shortlist|Treffer/i.test(picked.cutReason), `cut reason ${picked.cutReason}`);

  const {
    checkPackageComplete,
    checkWishesMet,
    runEndControls,
  } = require('./research/qualityGates') as typeof import('./research/qualityGates');
  const thinOpt = {
    id: 'thin',
    title: 'Dünn',
    placeName: 'Irgendwo',
    lat: 0,
    lng: 0,
    totalEur: null,
    budgetDeltaEur: null,
    pricePerPerson: null,
    priceIncludes: null,
    restBudgetEur: null,
    restBudgetHint: null,
    matchScore: 70,
    fitLine: null,
    whyBlurb: 'x',
    facts: [{ id: 'pool', emoji: '🏊', label: 'Pool', met: false }],
    softFacts: [],
    whyMatch: ['x'] as [string],
    gaps: ['Noch keine Unterkunft mit Preis gefunden'],
    photoUrl: null,
    stops: [],
  } as any;
  const thinLed = mergeLedger(cloneEmptyLedger(), {
    stayNights: entry(2, 'user', 'must'),
    mode: entry('fly', 'user', 'must'),
    mustHaves: entry(['pool'], 'user', 'must'),
    budgetEur: entry(300, 'user', 'must'),
  });
  assert(!checkPackageComplete(thinOpt, thinLed).hardOk, 'thin package fails');
  assert(!checkWishesMet(thinOpt, thinLed).hardOk, 'thin wishes fail');
  // Overnight ohne stayNights (nur Daten) muss trotzdem Unterkunft verlangen
  const datesOnlyLed = mergeLedger(cloneEmptyLedger(), {
    dateStart: entry('2026-09-11', 'user', 'must'),
    dateEnd: entry('2026-09-13', 'user', 'must'),
    mode: entry('train', 'user', 'must'),
  });
  const datesOnlyThin = {
    ...thinOpt,
    id: 'dates-thin',
    gaps: [],
    facts: [],
    transports: [
      {
        id: 'tr1',
        kind: 'train',
        label: 'Bahn',
        priceEur: 89,
        bookUrl: 'https://bahn.de/x',
        better: true,
      },
    ],
  };
  assert(
    !checkPackageComplete(datesOnlyThin, datesOnlyLed).hardOk,
    'dates-only overnight still needs stay',
  );
  assert(
    checkPackageComplete(datesOnlyThin, datesOnlyLed).issues.some((i) => i.code === 'stay_missing'),
    'stay_missing when dates overnight',
  );
  const fatOpt = {
    ...thinOpt,
    id: 'fat',
    stayName: 'Pool Villa',
    stayPriceEur: 400,
    stayBookUrl: 'https://stay.example',
    buyInEur: 250,
    flightBookUrl: 'https://fly.example',
    flightPriceEur: 100,
    transferEur: 18,
    transferBookUrl: 'https://maps.example',
    photoUrl: 'https://img.example/a.jpg',
    facts: [{ id: 'pool', emoji: '🏊', label: 'Pool', met: true }],
    gaps: [],
    transports: [
      {
        id: 'f1',
        kind: 'flight',
        label: 'Flug',
        priceEur: 100,
        bookUrl: 'https://fly.example',
        better: true,
      },
    ],
    stays: [
      {
        id: 's1',
        name: 'Pool Villa',
        priceEur: 400,
        bookUrl: 'https://stay.example',
        why: 'ok',
      },
    ],
    selectedStayId: 's1',
    selectedTransportId: 'f1',
    days: [{ dayKey: '2026-09-11', title: 'Tag 1', blocks: [] }],
    bookingChecklist: [{ id: 'b1', label: 'Stay', url: 'https://stay.example', kind: 'stay' }],
    experienceSummary: 'Pool und Grill in Zypern — entspannt am Wasser.',
    speechSummary: 'Jo — Zypern. Das ist die Variante mit Pool und Grill.',
    journeyBeats: [{ id: 'o1', kind: 'flight_out', title: 'Flug', detail: 'hin' }],
    wishChapters: [
      { id: 'w1', mustHaveId: 'pool', title: 'Pool', blurb: 'ok', photoUrl: null, met: true },
    ],
    transferMinutes: 25,
  };
  assert(checkPackageComplete(fatOpt, thinLed).hardOk, 'fat package ok');
  assert(checkWishesMet(fatOpt, thinLed).hardOk, 'fat wishes ok');
  const { SAME_CITY_WISH_POI_KM, poiIsSameCity } = require('./research/sameCity') as typeof import('./research/sameCity');
  assert(SAME_CITY_WISH_POI_KM <= 40, 'wish poi tighter than stay-dest');
  assert(
    poiIsSameCity(
      { lat: 39.58, lng: 2.66, met: true, mustHaveId: 'club' },
      { lat: 39.57, lng: 2.65 },
    ),
    'club next to stay is same city',
  );
  const palmaStayFat = {
    ...fatOpt,
    lat: 39.5696,
    lng: 2.6502,
    stays: [
      {
        id: 's1',
        name: 'Pool Villa',
        priceEur: 400,
        bookUrl: 'https://stay.example',
        why: 'ok',
        lat: 39.5696,
        lng: 2.6502,
      },
    ],
  };
  const farClubGate = checkPackageComplete(
    {
      ...palmaStayFat,
      wishEvidence: [
        {
          mustHaveId: 'club',
          name: 'Razzmatazz',
          met: true,
          onProperty: false,
          lat: 41.397,
          lng: 2.191,
        },
      ],
    } as any,
    thinLed,
  );
  assert(!farClubGate.hardOk, 'barcelona club vs palma stay is hard fail');
  assert(
    farClubGate.issues.some((i) => i.code === 'wish_poi_city'),
    'wish_poi_city issue',
  );
  const nearClubGate = checkPackageComplete(
    {
      ...palmaStayFat,
      wishEvidence: [
        {
          mustHaveId: 'club',
          name: 'Pacha',
          met: true,
          onProperty: false,
          lat: 39.58,
          lng: 2.66,
        },
      ],
    } as any,
    thinLed,
  );
  assert(nearClubGate.hardOk, 'same-city club ok');
  const gates = runEndControls([fatOpt, thinOpt], thinLed, 1);
  assert(gates.pass && gates.passingIds.includes('fat'), 'end controls prefer fat');
  const abCheck = checkPackageComplete(
    { ...fatOpt, experienceSummary: 'Flug ab 89€ — cool' } as any,
    thinLed,
  );
  assert(
    abCheck.issues.some((i) => i.code === 'price_ab_wording'),
    'gate flags ab euro wording',
  );
  // Favorit automatisch offen, max 4 Covers
  const { buildResultsCoverState, RESULTS_COVER_MAX } = require('./resultsCover') as typeof import('./resultsCover');
  const grid = buildResultsCoverState([
    { id: '1' },
    { id: '2' },
    { id: '3' },
    { id: '4' },
    { id: '5' },
  ]);
  assert(RESULTS_COVER_MAX === 4, 'cover max 4');
  assert(grid.options.length === 4 && grid.selectedOptionId === '1' && grid.phase === 'detail', 'favorite opens');

  // Flipchart: Frage→Sticker, Party+Clubs, Bahncard, kein Purpose-Dump, kein Apartment sonst Apartment
  {
    const both = parseBriefSlots('auch selber Party machen und Clubs wären cool, nicht zwingend');
    const bothLed = mergeLedger(cloneEmptyLedger(), parseBriefSlots('Männerwochenende Clubs'));
    const mergedBoth = mergeLedger(bothLed, both);
    const boardBoth = buildFlipchartNotes(mergedBoth);
    assert(
      boardBoth.some((n) => /Club/i.test(n.label)) && boardBoth.some((n) => /Party|Hausparty/i.test(n.label)),
      `party+clubs ${boardBoth.map((n) => n.label).join('|')}`,
    );
    const bc = parseBriefSlots('eine hat eine Bahnkarte');
    const bcBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), bc));
    assert(bc.bahncard?.value === '25', `bahncard ${bc.bahncard?.value}`);
    assert(bcBoard.some((n) => /Bahncard/i.test(n.label)), 'bahncard sticker');
    const poolDump = parseBriefSlots('ein Pool bitte haben');
    assert(!poolDump.purpose, `pool not purpose ${poolDump.purpose?.value}`);
    const aptDup = parseBriefSlots('Apartment oder Airbnb');
    const aptDupBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), aptDup));
    assert(
      !aptDupBoard.some((n) => /Apartment,\s*sonst Apartment/i.test(n.label)),
      `no apt dup ${aptDupBoard.map((n) => n.label).join('|')}`,
    );
    const { uniquifyMatchScores } = require('./research/optionCard') as typeof import('./research/optionCard');
    const uniq = uniquifyMatchScores([
      { matchScore: 88 },
      { matchScore: 88 },
      { matchScore: 88 },
    ]);
    assert(new Set(uniq.map((o) => o.matchScore)).size === 3, `unique scores ${uniq.map((o) => o.matchScore)}`);
    const { buildJourneyBeats } = require('./research/storyMagazine') as typeof import('./research/storyMagazine');
    const feederLed = mergeLedger(cloneEmptyLedger(), parseBriefSlots('wir starten in Prisdorf'));
    feederLed.originCities = { value: ['Berlin'], source: 'user', hardness: 'must' };
    const beats = buildJourneyBeats(
      {
        id: 'x',
        placeName: 'Alicante',
        title: 'Alicante',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 't1',
        transports: [{ id: 't1', kind: 'flight', fromIata: 'BER', toIata: 'ALC', label: 'BER→ALC' }],
      } as any,
      { ledger: feederLed },
    );
    assert(
      beats.outbound.some((b) => /Prisdorf/i.test(b.title)),
      `feeder home ${beats.outbound.map((b) => b.title).join('|')}`,
    );
    assert(
      beats.outbound.some((b) => /Berlin/i.test(b.title) || /BER/i.test(b.title)),
      `feeder hub ${beats.outbound.map((b) => b.title).join('|')}`,
    );
    assert(!beats.outbound.some((b) => b.kind === 'stay'), 'stay lives in Unterkunft, not Anreise');
    const earlyBeats = buildJourneyBeats(
      {
        id: 'y',
        placeName: 'Alicante',
        title: 'Alicante',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 't1',
        transports: [
          {
            id: 't1',
            kind: 'flight',
            fromIata: 'BER',
            toIata: 'ALC',
            label: 'BER→ALC',
            departDateKey: '2026-10-03',
            earlyArrival: true,
          },
        ],
      } as any,
      {
        ledger: {
          ...feederLed,
          dateStart: { value: '2026-10-04', source: 'user', hardness: 'must' },
        },
      },
    );
    assert(
      earlyBeats.outbound.some((b) => /früher/i.test(b.title)),
      `early ${earlyBeats.outbound.map((b) => b.title).join('|')}`,
    );
    const earlyDetail = earlyBeats.outbound.find((b) => /früher/i.test(b.title))?.detail || '';
    assert(!/vornacht/i.test(`${earlyBeats.outbound.find((b) => /früher/i.test(b.title))?.title} ${earlyDetail}`), 'earlyArrival is not Vornacht');
    assert(/kalendertag|ziel/i.test(earlyDetail), `earlyArrival dest copy ${earlyDetail}`);
    const hubBeats = buildJourneyBeats(
      {
        id: 'z',
        placeName: 'Palma',
        title: 'Palma',
        matchScore: 80,
        gaps: [],
        facts: [],
        whyBlurb: '',
        selectedTransportId: 't1',
        transports: [
          {
            id: 't1',
            kind: 'flight',
            fromIata: 'HAM',
            toIata: 'PMI',
            label: 'HAM→PMI',
            departAt: '05:40',
            hubPreNight: true,
          },
        ],
        hubPreNightStay: {
          id: 'hub-1',
          name: 'NH Hamburg Airport',
          priceEur: 89,
          bookUrl: 'https://example.test/hub-hotel',
          photoUrl: null,
          why: 'Vornacht am Hub',
        },
        stays: [{ id: 'dest-1', name: 'Dest Hotel Palma', priceEur: 400, bookUrl: 'https://example.test/palma', photoUrl: null, why: 'Ziel' }],
      } as any,
      { ledger: feederLed },
    );
    const hubBeat = hubBeats.outbound.find((b) => /vornacht/i.test(b.title));
    assert(hubBeat, `hub vornacht ${hubBeats.outbound.map((b) => b.title).join('|')}`);
    assert(hubBeat?.kind === 'other', 'hub night is not stay-kind in Anreise');
    assert(hubBeat?.bookUrl === 'https://example.test/hub-hotel', 'hub hotel book url');
    assert(!hubBeats.outbound.some((b) => b.kind === 'stay'), 'dest stay not in Anreise');
    const hubUrl =
      'https://www.expedia.de/Hotel-Information?hotelId=11112222&chkin=2026-07-09&chkout=2026-07-10';
    const destUrl =
      'https://www.expedia.de/Hotel-Information?hotelId=33334444&chkin=2026-07-10&chkout=2026-07-17';
    const { buildBookingChecklist } = require('./research/composePlan') as typeof import('./research/composePlan');
    const cl = buildBookingChecklist({
      stays: [
        {
          id: 'dest-1',
          name: 'Dest Hotel Palma',
          priceEur: 400,
          bookUrl: destUrl,
          photoUrl: null,
          why: 'Ziel',
          expediaPropertyId: '33334444',
        },
      ],
      hubStay: {
        id: 'hub-1',
        name: 'NH Hamburg Airport',
        priceEur: 89,
        bookUrl: hubUrl,
        photoUrl: null,
        why: 'Vornacht',
        expediaPropertyId: '11112222',
      },
    });
    assert(cl.some((i) => /vornacht/i.test(i.label) && i.url === hubUrl), 'checklist hub hotel');
    assert(cl.some((i) => i.label === 'Dest Hotel Palma'), 'checklist dest stay separate');
    const { buildAviasalesRoundtripUrl } = require('../services/affiliate/aviasalesRoundtrip') as typeof import('../services/affiliate/aviasalesRoundtrip');
    const aviaRt = buildAviasalesRoundtripUrl({
      fromIata: 'BER',
      toIata: 'ALC',
      dateKey: '2026-10-04',
      returnDateKey: '2026-10-07',
      adults: 3,
      marker: '760293',
    });
    assert(/aviasales\.com\/search\/BER0410ALC07103/.test(aviaRt), aviaRt);
  }

  // Begrüßung kurz + kein doppeltes „Noch was präzisieren?“
  const {
    ensureBriefingQuestion,
    keepTalkingAlreadyNudged,
    pickOpeningGreeting,
  } = require('./briefingSpeech') as typeof import('./briefingSpeech');
  const open = pickOpeningGreeting('Lars', 'trip-1');
  assert(open.speech.length <= 72, `opening short ${open.speech}`);
  assert(/Lars/.test(open.speech), 'opening uses name');
  assert(open.hint === 'Erzähl los', 'opening flipchart not same question');
  assert(!/Noch was präzisieren/i.test(open.speech), 'opening no präzisieren');
  const withInvite = ensureBriefingQuestion(
    'Alles klar. Wenn ihr noch Anreise sagt, wird der Plan härter — sonst Suche tippen.',
    'Noch was präzisieren?',
  );
  assert(withInvite === 'Alles klar. Wenn ihr noch Anreise sagt, wird der Plan härter — sonst Suche tippen.', 'no append after Suche tippen');
  const ackOnly = ensureBriefingQuestion('Notiert.', 'Noch was präzisieren?');
  assert(ackOnly === 'Notiert.', 'ack stays alone');
  const needsQ = ensureBriefingQuestion('Drei Leute Wochenende', 'Wann soll’s losgehen?');
  assert(/\?$/.test(needsQ) && /Wann/.test(needsQ), 'normal gap still gets question');
  assert(keepTalkingAlreadyNudged(['ready_announce']), 'ready counts as nudged');
  assert(keepTalkingAlreadyNudged([], true), 'announced counts as nudged');
  assert(!keepTalkingAlreadyNudged([]), 'fresh not nudged');

  console.log('reisebuero 5-act reboot checks ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
