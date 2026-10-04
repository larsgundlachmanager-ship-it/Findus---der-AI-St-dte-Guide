/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/composeTripTitle.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { composeTripShelfTitle } from './composeTripTitle';
import { entry } from './slotLedger';
import { EMPTY_LEDGER, type ReiseTrip } from './types';

function trip(partial: Partial<ReiseTrip['ledger']> & { placeName?: string }): ReiseTrip {
  const { placeName, ...ledgerBits } = partial as any;
  return {
    id: 't1',
    name: 'Neue Reise',
    createdAtMs: 1,
    updatedAtMs: 1,
    ledger: { ...EMPTY_LEDGER, ...ledgerBits },
    askedSlotKeys: [],
    frozen: false,
    refineCount: 0,
    initialProSearchDone: false,
    chat: [],
    options: placeName
      ? [
          {
            id: 'o1',
            placeName,
            title: placeName,
            matchScore: 80,
            gaps: [],
            facts: [],
            whyBlurb: '',
          } as any,
        ]
      : [],
    funnelLog: [],
    researchSteps: [],
    researchSparks: [],
    decisionJournal: [],
    phase: 'results',
    searchReadySticky: true,
    searchReadyAnnounced: true,
    searching: false,
    thinking: false,
    verifyProgress: null,
    researchEtaMin: null,
    searchError: null,
    selectedOptionId: placeName ? 'o1' : null,
    questionHint: '',
    llmFlipchartNotes: null,
    catalogExtras: [],
    recapSpokenOnce: false,
    recapText: null,
    timelinePushedOptionId: null,
  };
}

const men = composeTripShelfTitle(
  trip({
    purpose: entry('Männerwochenende', 'user'),
    destinationHint: entry('Budapest', 'user'),
    adults: entry(4, 'user'),
    mustHaves: entry(['party', 'pool'] as any, 'user', 'must'),
  }),
);
assert.match(men, /Männerwochenende/i);
assert.match(men, /Budapest/i);
assert.ok(!/pool/i.test(men) || men.includes('·'), men);

const spa = composeTripShelfTitle(
  trip({
    adults: entry(2, 'user'),
    mustHaves: entry(['spa'] as any, 'user', 'must'),
    placeName: 'Budapest, Hungary',
  }),
);
assert.match(spa, /Spa zu zweit/i);
assert.match(spa, /Budapest/i);

const dump = composeTripShelfTitle(
  trip({
    purpose: entry('ein Pool bitte haben', 'user'),
    destinationHint: entry('Palma', 'user'),
    mustHaves: entry(['pool'] as any, 'user', 'must'),
    meals: entry('all', 'user', 'wish'),
  }),
);
assert.ok(!/Pool bitte/i.test(dump), dump);
assert.match(dump, /Palma/i);

const tour = composeTripShelfTitle(
  trip({
    tripShape: entry('hop', 'user'),
    destinationHint: entry('Mailand, Verona, Venedig', 'user'),
  }),
);
assert.match(tour, /Tour/i);
assert.match(tour, /Mailand/i);

console.log('composeTripTitle.smoke.test.ts: ok');
