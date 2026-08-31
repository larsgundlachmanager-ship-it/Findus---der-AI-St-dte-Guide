import { isFindusReisebueroHandoff } from './handoff';
import { applyAskedContext, applyLedgerCorrections, parseBriefSlots } from './parseBriefSlots';
import { briefingPath, completenessGaps, isBriefComplete, nextQuestionKey } from './completeness';
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
assert(isBriefComplete(core), `search-ready without style, gaps ${completenessGaps(core).map((g) => g.key).join(',')}`);

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

assert(matchScore({ gaps: 0, wanted: 3, met: 3, budgetDeltaEur: -20 }) >= 90, 'high match');
assert(matchScore({ gaps: 4, wanted: 4, met: 0, budgetDeltaEur: 200 }) < 80, 'low match');

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

const past = parseBriefSlots('Wir waren in Danzig, kleines Apartment am Fluss, wollen sowas nochmal');
assert(past.inspiration?.value === 'Danzig', 'past trip is inspiration');
assert(past.destinationHint?.value !== 'Danzig', 'past city is not destination');

const coolPool = parseBriefSlots('ein Pool wäre cool');
assert(coolPool.niceHaves?.value?.includes('pool') || coolPool.wishHaves?.value?.includes('pool'), 'cool pool is optional/wish');
assert(!coolPool.mustHaves?.value?.includes('pool'), 'cool pool not must');
const mustPool = parseBriefSlots('unbedingt Pool');
assert(mustPool.mustHaves?.value?.includes('pool'), 'unbedingt pool is must');

const whenTalk = parseBriefSlots('nächste Woche');
assert(whenTalk.dateStart, 'nächste Woche has date');
assert(buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), whenTalk)).some((n) => n.id === 'when'), 'date sticker');
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
  septNotes.some((n) => /September/i.test(n.label) && /Wochenende/i.test(n.label) && /Nächte/.test(n.label)),
  `sept sticker ${septNotes.map((n) => n.label).join('|')}`,
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
  dateNotes.some((n) => /11\.9/.test(n.label) && /13\.9/.test(n.label)),
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
    if (gap.key !== 'keep_talking' && gap.key !== 'wrap_up' && !asked.includes(gap.key)) asked.push(gap.key);
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
assert(conv.next === 'wrap_up' || conv.next === 'keep_talking' || conv.next === 'departWindow' || conv.next === 'lodging', `after core facts wrap, got ${conv.next}`);

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
assert(spaWalk.next === 'spaStyle' || spaWalk.next === 'wrap_up' || spaWalk.next === 'extraWishes', `spa deep ask, got ${spaWalk.next}`);
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
  'wir wollen Familienurlaub mit zwei Kindern, vier Leute, 11. bis 13. September',
  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro, Hotel',
]);
assert(kidsWalk.ledger.children?.value === 2, 'kids on ledger');
assert(kidsWalk.next === 'extraWishes' || kidsWalk.next === 'kidsStyle', `kids setup next, got ${kidsWalk.next}`);

const wineHop = parseBriefSlots('wir wollen Wein und ein bisschen rumreisen, mehrere Städte');
assert(wineHop.wishHaves?.value?.includes('wine') || wineHop.mustHaves?.value?.includes('wine'), 'wine');
assert(wineHop.tripShape?.value === 'hop', `hop ${wineHop.tripShape?.value}`);
const wineWalk = walk([
  'wir wollen Wein und rumreisen, zwei Leute, 11. bis 13. September, ab Hamburg',
  'egal Auto Bahn Flug, max vier Stunden, 400 Euro, Hotel',
]);
assert(wineWalk.next === 'tripShape' || wineWalk.next === 'wrap_up' || wineWalk.next === 'keep_talking', `wine form next, got ${wineWalk.next}`);

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
    if (gap.key !== 'keep_talking' && gap.key !== 'wrap_up' && !asked.includes(gap.key)) asked.push(gap.key);
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
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:keep_talking' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:departWindow' ||
    typedPartyLog[typedPartyLog.length - 1] === 'NEXT:lodging',
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
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:keep_talking' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:departWindow' ||
    typedClubsLog[typedClubsLog.length - 1] === 'NEXT:lodging',
  `after clubs ${typedClubsLog[typedClubsLog.length - 1]}`,
);
assert(
  !/NEXT:(dealbreaker|highlight|lastTrip|spaStyle|rentalCar|lodging)/.test(typedClubsLog[typedClubsLog.length - 1]),
  'no highlight/dealbreaker after cores',
);

const typedSpaLog = typeThrough([
  'wir wollen ein richtig geiles Spa Entspannungswochenende, zwei Leute, vom 11. bis 13. September, ab Hamburg',
  'egal Auto Bahn Flug, maximal vier Stunden, 400 Euro pro Person, Hotel',
]);
assert(
  typedSpaLog[typedSpaLog.length - 1] === 'NEXT:spaStyle' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:wrap_up' ||
    typedSpaLog[typedSpaLog.length - 1] === 'NEXT:extraWishes',
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
assert(pinNotes.some((n) => /11\.9/.test(n.label) && /13\.9/.test(n.label)), `dates replace weekend ${pinNotes.map((n) => n.label).join('|')}`);
assert(!pinNotes.some((n) => n.id === 'when' && /Wochenende/i.test(n.label) && !/11\.9/.test(n.label)), 'no stale weekend-only sticker');

const partyPing = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
]);
assert(partyPing.next === 'adults', `party first asks group, got ${partyPing.next}`);
const partyPing2 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
]);
assert(partyPing2.next === 'origin', `party then start, got ${partyPing2.next}`);
const partyPing3 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
]);
assert(partyPing3.next === 'when', `party then dates, got ${partyPing3.next}`);
const partyPing4 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
]);
assert(partyPing4.ledger.lodgingOpen?.value, 'lodging open');
assert(partyPing4.ledger.wishHaves?.value?.includes('pool'), 'pool wish');
assert(partyPing4.next === 'when' || partyPing4.next === 'budget', `party after lodging talk, got ${partyPing4.next}`);
const partyPing5 = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
  'Genau. Denke mal so 200 € pro Nase für die Unterkunft.',
]);
assert(partyPing5.ledger.budgetEur?.value === 200, `200 not rescaled ${partyPing5.ledger.budgetEur?.value}`);
assert(partyPing5.next === 'when' || partyPing5.next === 'driveTime' || partyPing5.next === 'departWindow', `party then window, got ${partyPing5.next}`);
const partyDone = walk([
  'Wir wollen mit den Jungs übers Wochenende weg, bisschen Party, bisschen trinken, bisschen Strand.',
  'Wir sind vier Jungs.',
  'Ja, wir würden von Hamburg aus starten.',
  'Keine Ahnung, sind da ziemlich frei. Hauptsache günstig und geil. Vielleicht wäre ein Pool schön.',
  'Genau. Denke mal so 200 € pro Nase für die Unterkunft.',
  'Irgendwann im August wäre stark.',
]);
assert(
  partyDone.next === 'when' || partyDone.next === 'driveTime' || partyDone.next === 'departWindow' || partyDone.next === 'wrap_up',
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
assert(familyPing.next === 'mode', `family asks travel, got ${familyPing.next}`);
const family2 = walk([
  'Wir suchen was für den ersten Urlaub zu dritt. Unser Baby ist gerade 4 Monate alt, wir sind echt durch und brauchen einfach nur Ruhe.',
  'Bloß nicht fliegen! Lass mal lieber mit dem Auto fahren, so maximal 3 Stunden Fahrt. Irgendwas an der Küste wäre toll.',
]);
assert(family2.ledger.mode?.value === 'drive', 'family drive');
assert(family2.ledger.maxDriveHours?.value === 3, '3h');
assert(family2.next === 'when', `family duration, got ${family2.next}`);
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
assert(familyDone.next === 'wrap_up' || familyDone.next === 'keep_talking' || familyDone.next === 'extraWishes', `family wrap ${familyDone.next}`);

const couplePing = walk([
  'Ich will meine Freundin überraschen. Wir sind frisch zusammen und wollen eine Woche weg, darf schon was Besonderes sein.',
]);
assert(briefingPath(couplePing.ledger) === 'couple', `couple path ${briefingPath(couplePing.ledger)}`);
assert(couplePing.next === 'when', `couple month, got ${couplePing.next}`);
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
assert(coupleDone.next === 'origin' || coupleDone.next === 'wrap_up' || coupleDone.next === 'keep_talking', `couple next ${coupleDone.next}`);

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
assert(leaveNotes.some((n) => /11\.9/.test(n.label) && /13\.9/.test(n.label)), 'exact dates on board');
assert(leaveNotes.some((n) => /16 Uhr/.test(n.label)), 'depart hour on board');
assert(!leaveNotes.some((n) => /Anreise egal/i.test(n.label)), 'no anreise egal sticker');

const badOrigin = parseBriefSlots('starten von Kristof');
assert(!badOrigin.originCity, `kristof not a city ${badOrigin.originCity?.value}`);
const homeOrigin = parseBriefSlots('von Apriesdorf aus starten');
assert(homeOrigin.originCity?.value === 'Prisdorf', `apriesdorf ${homeOrigin.originCity?.value}`);
const originFix = applyLedgerCorrections(
  'nein es ist nicht ab Kristof sondern ab Apriesdorf',
  mergeLedger(cloneEmptyLedger(), parseBriefSlots('starten von Hamburg')),
);
assert(originFix.originCity?.value === 'Prisdorf', `replace origin ${originFix.originCity?.value}`);

const hotelJustDo = parseBriefSlots('Hotel am Hamburger Hafen und Elbphilharmonie Tickets');
assert(hotelJustDo.adults?.value === 2, `hotel seed adults ${hotelJustDo.adults?.value}`);
assert(
  nextQuestionKey(mergeLedger(cloneEmptyLedger(), hotelJustDo)).key !== 'adults',
  'do not ask allein oder zu mehreren when hotel+tickets already in seed',
);

assert(
  nextQuestionKey(cloneEmptyLedger()).key === 'purpose',
  'empty overlay asks trip type, not party size',
);

console.log(typedPartyLog.join('\n\n'));
console.log('---');
console.log(typedSpaLog.join('\n\n'));
console.log('reisebuero.smoke.test.ts ok');
