from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\reisebuero.smoke.test.ts")
t = p.read_text(encoding="utf-8")

old = """const bagsFlyLed = mergeLedger(cloneEmptyLedger(), {
  mode: entry('fly' as const, 'user'),
  adults: entry(3, 'user'),
});
const bagsGap = conversationGaps(bagsFlyLed, ['directFlight']);
"""

new = """const bagsFlyLed = mergeLedger(cloneEmptyLedger(), {
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
"""

if old not in t:
    raise SystemExit("old block missing")
t = t.replace(old, new, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("ok")
