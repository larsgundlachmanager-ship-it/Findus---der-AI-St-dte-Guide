/**
 * Run: npx --yes tsx src/services/ui/hudTextFit.smoke.test.ts
 */
import {
  fitHudLine,
  fitHudMeta,
  hudCharsForWidth,
} from './hudTextFit';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const weather =
  'Aktuell 22°, sonnig, leichter Wind — später Wolken möglich';

assert(!fitHudMeta(weather).includes('\n'), 'Meta nicht künstlich umbrechen');
assert(
  fitHudMeta(weather).includes('Wind'),
  'Volle Breite: kurzer Wettertext bleibt vollständig',
);

const twoLineBudget = fitHudMeta(weather, { maxLines: 2, charsPerLine: 20 });
assert(
  !twoLineBudget.includes('\n'),
  'Auch bei knappem Budget kein erzwungenes \\n',
);
assert(twoLineBudget.length <= 40, 'Langer Text wird gekürzt, nicht umgebrochen');
assert(!/[:·,;/\-–—]$/u.test(twoLineBudget), 'Kein Schnitt am Doppelpunkt');

assert(
  fitHudLine('Museum am Markt: Sonderausstellung', 22) === 'Museum am Markt',
  'Titel an Wortgrenze, nicht mitten im Wort',
);

assert(
  hudCharsForWidth(328, 12) > 38,
  '12px-Meta auf voller Phone-Breite mehr als die alten 38 Zeichen',
);
assert(
  hudCharsForWidth(328, 16) >= 28,
  'Titel-Budget bleibt nutzbar',
);

console.log('hudTextFit.smoke.test.ts ok');
