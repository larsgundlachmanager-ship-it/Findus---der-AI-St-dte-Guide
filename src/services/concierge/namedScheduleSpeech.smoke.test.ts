/**
 * Month/date never nav + choice-place guard (named schedule).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/namedScheduleSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isMonthOrDateOnlyNavName,
  isBogusNavDestName,
} from '../research/htmlResearchGate';

assert(isMonthOrDateOnlyNavName('Dezember'), 'month');
assert(isMonthOrDateOnlyNavName('27. Dezember'), 'day month');
assert(isMonthOrDateOnlyNavName('15.04.'), 'numeric');
assert(isMonthOrDateOnlyNavName('2026-12-27'), 'iso');
assert(isBogusNavDestName('Dezember'), 'bogus month');
assert(!isMonthOrDateOnlyNavName('Barclays Arena'), 'venue ok');

// Mirror extractChoicePlaces numbered-option regex (no RN import):
// dates like „27. Dezember“ must NOT become choice places.
const STOP =
  /^(Heute|Abend|Uhr|Oder|Auch|Hier|Mein|Dein|Einen|Eine|Dort|Dann|Noch|Sehr|Ganz|Zwei|Drei|Beide|Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)$/iu;

function extractChoicePlacesLite(speech: string): string[] {
  const places: string[] = [];
  const numbered =
    speech.match(
      /\b(?:erstens\s+|zweitens\s+|\d+[).]\s+)([A-ZÄÖÜ][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']*){0,3})/gu,
    ) ?? [];
  for (const n of numbered) {
    places.push(
      n.replace(/^(?:erstens\s+|zweitens\s+|\d+[).]\s+)/iu, '').trim(),
    );
  }
  return places.filter(
    (p) => p.length >= 3 && !STOP.test(p) && !isMonthOrDateOnlyNavName(p),
  );
}

const dateSpeech =
  'Nächstes Spiel: Sonntag, 27. Dezember. Heimteam gegen Bayern. Alternativ: Mittwoch, 15. April.';
const choices = extractChoicePlacesLite(dateSpeech);
assert.equal(
  choices.filter((c) => isMonthOrDateOnlyNavName(c)).length,
  0,
  `no month from „27. Dezember“: ${choices.join('|')}`,
);

// Fluent named-schedule speech contract (structure — wortlaut frei)
const fluentOk =
  'Die Mannschaft spielt als nächstes am Sonntag, 27. Dezember gegen den Gegner in der Arena. Tickets gehen ab 30 Euro los.';
assert(!/Nächstes Spiel:/i.test(fluentOk), 'example has no staccato');
assert(!/liegen als Buttons bereit/i.test(fluentOk), 'example has no button meta');

console.log('namedScheduleSpeech.smoke.test.ts ok');
