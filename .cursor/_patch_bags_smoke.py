from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\reisebuero.smoke.test.ts")
t = p.read_text(encoding="utf-8")

old_imp = "from { briefingPath, completenessGaps, isBriefComplete, nextQuestionKey, searchReadyGaps } from './completeness';"
# fix typo - actual import uses braces
old_imp = "import { briefingPath, completenessGaps, isBriefComplete, nextQuestionKey, searchReadyGaps } from './completeness';"
new_imp = "import { briefingPath, completenessGaps, conversationGaps, isBriefComplete, nextQuestionKey, searchReadyGaps } from './completeness';"
if old_imp not in t:
    raise SystemExit("import missing")
t = t.replace(old_imp, new_imp, 1)

needle = (
    "assert(!directBoard.some((n) => n.id === 'directFlight' && n.label === 'Direktflug'), "
    "'no hard Direktflug-only');\n\n"
    "const flyDorf = parseBriefSlots('wir starten in Prisdorf und wollen fliegen');"
)
block = r"""assert(!directBoard.some((n) => n.id === 'directFlight' && n.label === 'Direktflug'), 'no hard Direktflug-only');

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
});
const bagsGap = conversationGaps(bagsFlyLed, ['directFlight']);
assert(bagsGap.some((g) => g.key === 'bags'), `bags gap ${bagsGap.map((g) => g.key).join(',')}`);
const bagsBoard = buildFlipchartNotes(mergeLedger(bagsFlyLed, bagsAns));
assert(bagsBoard.some((n) => n.id === 'bags' && /2 Hand.*2 Aufgabe/i.test(n.label)), 'bags chip');

const flyDorf = parseBriefSlots('wir starten in Prisdorf und wollen fliegen');"""
if needle not in t:
    raise SystemExit("needle missing")
t = t.replace(needle, block, 1)

tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("ok smoke")
