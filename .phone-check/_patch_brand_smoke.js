const fs = require('fs');

const brandFiles = [
  'src/screens/SettingsScreen.tsx',
  'src/module2/router/runConciergeTurn.ts',
  'src/constants/helpCatalog.ts',
  'src/reisebuero/research/proEnrich.ts',
];
for (const p of brandFiles) {
  let s = fs.readFileSync(p, 'utf8');
  const n = (s.match(/Yorro Reisebüro/g) || []).length;
  s = s.replace(/Yorro Reisebüro/g, 'Yorros Reisebüro');
  fs.writeFileSync(p + '.tmp', s);
  fs.renameSync(p + '.tmp', p);
  console.log('brand', p, n);
}

let smoke = fs.readFileSync('src/reisebuero/reisebuero.smoke.test.ts', 'utf8');
smoke = smoke.replace(
  /assert\(matchScore\(\{ gaps: 0, wanted: 3, met: 3, budgetDeltaEur: -20 \}\) >= 90, 'high match'\);\r?\nassert\(matchScore\(\{ gaps: 4, wanted: 4, met: 0, budgetDeltaEur: 200 \}\) < 80, 'low match'\);/,
  "assert(matchScore({ hardWanted: 3, hardMet: 3, softWanted: 2, softMet: 2, nogoHits: 0, budgetDeltaEur: -20 }) >= 85, 'high match');\nassert(matchScore({ hardWanted: 4, hardMet: 0, softWanted: 2, softMet: 0, nogoHits: 1, budgetDeltaEur: 200 }) < 70, 'low match');",
);

if (!smoke.includes('searchReadyGaps')) {
  smoke = smoke.replace(
    "import { briefingPath, completenessGaps, isBriefComplete, nextQuestionKey } from './completeness';",
    "import { briefingPath, completenessGaps, isBriefComplete, nextQuestionKey, searchReadyGaps } from './completeness';",
  );
}

if (!smoke.includes('cheapDrinks')) {
  const extra = `
// --- Yorros Vertiefung: Soft-Kriterien & Board-first ---
const beerTalk = parseBriefSlots('Wir wollen günstige Bierpreise, Party machen wir privat unter uns, keine Partymeile wie Mallorca, vier Jungs aus Hamburg, vier Tage, Budget 200 Euro, Unterkunft egal');
assert(beerTalk.cheapDrinks?.value === true, 'cheapDrinks');
assert(beerTalk.partyGrain?.value === 'private_house', 'partyGrain private');
assert(!(beerTalk.hardNos?.value ?? []).includes('party'), 'party not hardNo');
const beerBoard = buildFlipchartNotes(mergeLedger(cloneEmptyLedger(), beerTalk));
assert(beerBoard.some((n) => /günstiges Bier|Bier/i.test(n.label)), 'bier sticker');
assert(!beerBoard.some((n) => /keine Kneipen|kein Kneipen/i.test(n.label)), 'no keine Kneipen');

const multi = parseBriefSlots('Start Hamburg Bremen oder Berlin');
assert((multi.originCities?.value ?? []).length >= 2, 'multi origin ' + JSON.stringify(multi.originCities));

const dur = parseBriefSlots('vier Tage ab Hamburg, 250 Euro, wir sind fünf, Apartment egal');
const durLed = mergeLedger(cloneEmptyLedger(), dur);
assert(!searchReadyGaps(durLed).some((g) => g.key === 'when'), 'duration fills when');
`;
  if (smoke.includes("console.log('reisebuero.smoke ok')")) {
    smoke = smoke.replace("console.log('reisebuero.smoke ok')", extra + "\nconsole.log('reisebuero.smoke ok')");
  } else if (smoke.includes('console.log(')) {
    smoke += extra;
  } else {
    smoke += extra + "\nconsole.log('reisebuero.smoke ok');\n";
  }
}

fs.writeFileSync('src/reisebuero/reisebuero.smoke.test.ts.tmp', smoke);
fs.renameSync('src/reisebuero/reisebuero.smoke.test.ts.tmp', 'src/reisebuero/reisebuero.smoke.test.ts');
console.log('smoke done');
