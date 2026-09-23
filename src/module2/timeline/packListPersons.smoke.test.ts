/**
 * Pack-Personen: Parse, soft/optional Alter, Mama-für-Papa Edge.
 */
import assert from 'node:assert/strict';
import {
  ageAtDateMs,
  creatorShouldBeOnList,
  formatTravelerAgeHint,
  guessTripAtMsFromText,
  looksLikeMultiPersonPack,
  parsePackPersonsFromText,
  toPersonRefs,
} from './packListPersons';
import { buildPackListItems, expandPackListByPersons } from './packListBuilder';

const now = Date.UTC(2026, 8, 21, 12, 0, 0); // 21.09.2026

assert.ok(
  looksLikeMultiPersonPack(
    'Packliste für Papa und beide Kinder, Kind ist heute 11',
  ),
);

// Mama erstellt für Papa+Kids → Mama nicht auf der Liste
assert.equal(
  creatorShouldBeOnList('Packliste für Papa und beide Kinder'),
  false,
);
assert.equal(
  creatorShouldBeOnList('Packliste für uns — Mama, Papa und die Kinder'),
  true,
);

const parsed = parsePackPersonsFromText(
  'Packliste für Papa und beide Kinder — Kind ist heute 11 Jahre',
  { nowMs: now },
);
assert.ok(parsed.some((p) => p.role === 'partner' && /papa/i.test(p.name)));
assert.equal(
  parsed.some((p) => p.role === 'self'),
  false,
  'Mama/Ich nicht auf Liste bei „für Papa…“',
);
const kids = parsed.filter((p) => p.role === 'child');
assert.ok(kids.length >= 2, `expected ≥2 kids, got ${kids.length}`);
const aged = kids.find((k) => k.ageYears === 11);
assert.ok(aged, '11-year-old stored');
assert.equal(aged!.ageAsOfMs, now);

const nextSummer = guessTripAtMsFromText('nächsten Sommerurlaub', now);
assert.ok(nextSummer != null && nextSummer > now, 'next summer ms');
const atTrip = ageAtDateMs(aged!, nextSummer!);
assert.ok(
  atTrip != null && atTrip >= 12,
  `age at next summer should be ≥12, got ${atTrip}`,
);

// Optional nur Monat + Jahr — kein Tag
const withBirth = parsePackPersonsFromText(
  'Packliste für Papa und Kind — Leo ist 11, geboren im März 2015',
  { nowMs: now },
);
const leo = withBirth.find((p) => /leo/i.test(p.name));
assert.ok(leo, 'Leo parsed');
assert.equal(leo!.birthMonth, 3);
assert.equal(leo!.birthYear, 2015);
const leoAt = ageAtDateMs(leo!, nextSummer!);
assert.ok(leoAt != null && leoAt >= 11, `leo age ${leoAt}`);
assert.match(formatTravelerAgeHint(leo!, nextSummer), /Mär|2015|≈/);

// Soft ohne Geburtstag bleibt ok
assert.ok(!/geburtstag.*pflicht|muss.*geburtstag/i.test(formatTravelerAgeHint(aged!)));

const refs = toPersonRefs(parsed, nextSummer);
assert.ok(
  refs.some((r) => r.role === 'child' && (r.ageAtTrip ?? 0) >= 12),
  'person ref aged to ≥12',
);

const multi = buildPackListItems({
  userText:
    'Packliste für Papa und beide Kinder — Kind ist heute 11, nächsten Sommer, 7 Tage Strand',
  tripDays: 7,
  tempC: 26,
  sunnyOrWarm: true,
  persons: refs,
});
assert.ok(multi.items.length > 5, 'multi list has items');
const papa = refs.find((r) => /papa/i.test(r.name));
assert.ok(papa);
assert.ok(
  multi.items.some((i) => i.personId === papa!.id && i.category === 'clothes'),
  'papa clothes',
);
const kidWithAge = refs.find(
  (r) => r.role === 'child' && (r.ageAtTrip ?? 0) >= 12,
);
assert.ok(kidWithAge);
assert.ok(
  multi.items.some(
    (i) => i.personId === kidWithAge!.id && i.category === 'kids',
  ),
  'teen/child items on aged kid',
);
assert.ok(
  multi.items.some((i) => i.personId === kidWithAge!.id && /teen|kopfhörer/i.test(i.label)),
  'teen band at ≥12',
);

const expanded = expandPackListByPersons(
  [
    {
      id: 'a',
      label: 'Reisepass',
      reason: 'Flug',
      done: false,
      category: 'docs',
    },
    {
      id: 'b',
      label: 'T-Shirt',
      reason: 'Basis',
      done: false,
      category: 'clothes',
      qty: 3,
    },
  ],
  [
    { id: 'p1', name: 'Papa', role: 'partner', ageAtTrip: null },
    { id: 'p2', name: 'Mama', role: 'self', ageAtTrip: null },
  ],
);
assert.equal(
  expanded.filter((i) => i.category === 'docs' && !i.personId).length,
  1,
);
assert.equal(
  expanded.filter((i) => i.category === 'clothes').length,
  2,
);

console.log('packListPersons.smoke.test.ts OK');
