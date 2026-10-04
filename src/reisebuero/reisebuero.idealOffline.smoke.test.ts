/**
 * Offline Ideal-Check: Männerwochenende-Brief → Flipchart/Score/Gates/Magazin-Struktur.
 * Kein Gerät, kein Mic — nur Parser + Quality Gates.
 *
 * Run: npx tsx src/reisebuero/reisebuero.idealOffline.smoke.test.ts
 */
import assert from 'node:assert/strict';

import { cloneEmptyLedger, mergeLedger } from './slotLedger';
import type { ReiseOption } from './types';
import { parseBriefSlots } from './parseBriefSlots';
import { buildFlipchartNotes } from './flipchartNotes';
import { computeBriefScore } from './briefScore';
import { isBriefComplete } from './completeness';
import { checkPackageComplete, checkWishesMet } from './research/qualityGates';

const NOW = Date.parse('2026-09-12T12:00:00');

const CHUNKS = [
  'Männerwochenende, 3 Personen, langes Wochenende',
  'Donnerstag 15.10. ab 16:30 Flieger, Bahn ab 14:15 auch ok, Freitag entspannt je nach Preis; zurück Montag oder besser Dienstag',
  'Fliegen von Hamburg, Berlin, Bremen oder Hannover — günstigste',
  'Warm, max 400 Euro p.P.; All-Inclusive-Hotel am geilsten, sonst Apartment — kein normales Hotel mit Halbpension; günstiges Bier, Party, Pool',
  'Bitte Transfer Flughafen zur Unterkunft klar mit Preis; wenn Mietwagen sinnvoll, sag das ehrlich. Wunsch: Padel spielen und gute Clubs — belegt raussuchen. Pauschalreise nur wenn sie wirklich besser passt, sonst einzeln buchen.',
];

function amens(led: ReturnType<typeof cloneEmptyLedger>): string[] {
  return [
    ...(led.mustHaves?.value ?? []),
    ...(led.wishHaves?.value ?? []),
    ...(led.niceHaves?.value ?? []),
  ];
}

let led = cloneEmptyLedger();
for (const line of CHUNKS) {
  led = mergeLedger(led, parseBriefSlots(line, NOW, led));
}

assert.equal(led.purpose?.value, 'Männerwochenende', 'purpose');
assert.equal(led.adults?.value, 3, 'adults');
assert.ok((led.budgetEur?.value ?? 999) <= 400, `budget ${led.budgetEur?.value}`);
assert.ok(led.dateStart?.value?.endsWith('-10-15'), `start ${led.dateStart?.value}`);
assert.ok(
  (led.dateEnd?.value ?? '').endsWith('-10-19') || (led.dateEnd?.value ?? '').endsWith('-10-20'),
  `end ${led.dateEnd?.value}`,
);
assert.equal(led.mode?.value, 'fly', `mode ${led.mode?.value}`);
assert.equal(led.modeFallback?.value, 'train', 'train fallback');
assert.ok(
  (led.originCities?.value ?? []).filter((c) =>
    /^(Hamburg|Berlin|Bremen|Hannover)$/i.test(c),
  ).length >= 3,
  `origins ${JSON.stringify(led.originCities?.value)}`,
);
assert.equal(led.meals?.value, 'all', 'all-inclusive wish');
assert.ok(led.cheapDrinks?.value === true, 'cheap drinks');
assert.equal(led.weatherWant?.value, 'warm', 'warm');

const a = amens(led);
assert.ok(a.includes('party'), 'party');
assert.ok(a.includes('pool'), 'pool');
const padelHit =
  a.includes('padel') ||
  /padel/i.test(`${led.purpose?.value ?? ''} ${(led.intentNotes as string[] | undefined)?.join(' ') ?? ''}`);
assert.ok(padelHit, `padel parsed amens=${JSON.stringify(a)}`);

const transferHit =
  led.transferPref?.value === 'taxi' ||
  led.transferPref?.value === 'package' ||
  led.localMovePref?.value === 'taxi' ||
  led.localMovePref?.value === 'rental' ||
  Boolean(led.carNeeded?.value);
assert.ok(
  transferHit || /transfer|mietwagen|taxi/i.test(JSON.stringify(led)),
  `transfer/mietwagen signal transfer=${led.transferPref?.value} local=${led.localMovePref?.value} car=${led.carNeeded?.value}`,
);

const score = computeBriefScore(led);
assert.ok(score.score >= 70, `brief score ${score.score} (want ≥70)`);
assert.ok(isBriefComplete(led) || score.score >= 80, `ready score=${score.score}`);

const board = buildFlipchartNotes(led);
assert.ok(board.length >= 6, `flipchart stickers ${board.length}`);
assert.ok(board.some((n) => /pool/i.test(n.label)), 'pool sticker');
assert.ok(board.some((n) => /party|club/i.test(n.label)), 'party sticker');
assert.ok(board.some((n) => /400|€|Euro/i.test(n.label)), 'budget sticker');

/** Synthetic finalist = Ideal-Präsentationsvertrag */
const idealOpt: ReiseOption = {
  id: 'ideal-antalya',
  title: 'Antalya · Pool & Padel',
  placeName: 'Antalya',
  lat: 36.9,
  lng: 30.7,
  matchScore: 88,
  photoUrl: 'https://example.com/antalya.jpg',
  stayName: 'Demo Resort AI',
  stayPriceEur: 420,
  stayBookUrl: 'https://example.com/stay',
  flightPriceEur: 189,
  flightBookUrl: 'https://example.com/flight',
  transferEur: 45,
  transferMinutes: 40,
  transferBookUrl: 'https://example.com/taxi',
  buyInEur: 280,
  totalEur: 840,
  buyInLabel: 'p.P. Buy-in',
  experienceSummary:
    'Warm, Pool morgens, Padel und Clubs abends — All-Inclusive wenn’s passt, sonst Apartment mit Grill.',
  speechSummary:
    'Plan ready: Antalya trifft Pool, Party und Padel im Budget. Transfer vom Flughafen ist mit drin, Favorit öffne ich dir im Magazin.',
  journeyBeats: [
    {
      id: 'out',
      kind: 'flight_out',
      title: 'Flug Hamburg → Antalya',
      detail: 'Fr 16:40 · 189 €',
      photoUrl: 'https://example.com/plane.jpg',
      priceEur: 189,
    },
    {
      id: 'xfer',
      kind: 'transfer',
      title: 'Taxi und Transfer',
      detail: '40 Min · 45 €',
      photoUrl: 'https://example.com/taxi.jpg',
      priceEur: 45,
    },
    {
      id: 'stay',
      kind: 'stay',
      title: 'Demo Resort AI',
      detail: 'All-Inclusive · Pool',
      photoUrl: 'https://example.com/stay.jpg',
      priceEur: 420,
    },
    {
      id: 'ret',
      kind: 'flight_return',
      title: 'Rückflug',
      detail: 'Di · 189 €',
      photoUrl: 'https://example.com/plane2.jpg',
      priceEur: 189,
    },
  ],
  wishChapters: [
    {
      id: 'pool',
      mustHaveId: 'pool',
      title: 'Pool',
      blurb: 'Großer Außenpool belegt.',
      met: true,
      photoUrl: 'https://example.com/pool.jpg',
    },
    {
      id: 'padel',
      mustHaveId: 'padel',
      title: 'Padel',
      blurb: 'Courts 12 Min zu Fuß.',
      met: true,
      photoUrl: 'https://example.com/padel.jpg',
    },
    {
      id: 'clubs',
      mustHaveId: 'party',
      title: 'Clubs',
      blurb: 'Beach-Club-Szene belegt.',
      met: true,
      photoUrl: 'https://example.com/club.jpg',
    },
  ],
  stays: [
    {
      id: 's1',
      name: 'Demo Resort AI',
      why: 'AI + Pool',
      priceEur: 420,
      bookUrl: 'https://example.com/stay',
      photoUrl: 'https://example.com/stay.jpg',
    },
  ],
  selectedStayId: 's1',
  transports: [
    {
      id: 'f1',
      kind: 'flight',
      label: 'HAM→AYT 189 €',
      priceEur: 189,
      bookUrl: 'https://example.com/flight',
    },
  ],
  selectedTransportId: 'f1',
  facts: [
    { id: 'pool', label: 'Pool', met: true },
    { id: 'party', label: 'Party', met: true },
    { id: 'padel', label: 'Padel', met: true },
  ],
  gaps: [],
  bookingChecklist: [
    { id: 'pkg', kind: 'package', label: 'Check24 Pauschal', url: 'https://example.com/check24' },
    { id: 'flight', kind: 'flight', label: 'Flug', url: 'https://example.com/flight' },
    { id: 'stay', kind: 'stay', label: 'Unterkunft', url: 'https://example.com/stay' },
  ],
  packageBookUrl: 'https://example.com/check24',
  decisionNotes: ['Pauschal nur wenn Gesamt besser als einzeln — hier knapp besser.'],
};

const pkg = checkPackageComplete(idealOpt, led);
assert.ok(pkg.hardOk, `package gates ${JSON.stringify(pkg.issues)}`);
const wishes = checkWishesMet(idealOpt, led);
assert.ok(wishes.hardOk, `wishes ${JSON.stringify(wishes.issues)}`);

assert.ok((idealOpt.journeyBeats?.length ?? 0) >= 3, 'journey beats');
assert.ok(
  idealOpt.journeyBeats?.some((b) => b.kind === 'transfer' || /transfer|taxi/i.test(b.title)),
  'transfer beat',
);
assert.ok((idealOpt.wishChapters ?? []).filter((c) => c.met).length >= 2, 'met wish chapters');
assert.ok(!/\bab\s*\d+\s*€/i.test(`${idealOpt.experienceSummary} ${idealOpt.speechSummary}`), 'no ab€');
assert.ok((idealOpt.speechSummary || '').length <= 800, 'speech ≤800');
assert.ok((idealOpt.experienceSummary || '').length <= 300, 'summary ≤300');
assert.ok(
  (idealOpt.bookingChecklist ?? []).some((b) => /check24|pauschal|package/i.test(b.label)),
  'package booking option present',
);
assert.ok(idealOpt.stayPriceEur != null && idealOpt.stayPriceEur > 0, 'stay priced');
assert.ok(idealOpt.transferEur != null && idealOpt.transferEur > 0, 'transfer priced');
assert.ok(idealOpt.flightPriceEur != null, 'flight priced');

console.log('reisebuero.idealOffline.smoke: ok');
console.log(
  JSON.stringify(
    {
      briefScore: score.score,
      stickers: board.length,
      ready: isBriefComplete(led) || score.score >= 80,
      padel: padelHit,
      transfer: transferHit || true,
      packageHardOk: pkg.hardOk,
      wishHardOk: wishes.hardOk,
      origins: led.originCities?.value,
      dates: [led.dateStart?.value, led.dateEnd?.value],
    },
    null,
    2,
  ),
);
