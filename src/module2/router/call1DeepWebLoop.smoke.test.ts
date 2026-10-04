/**
 * Deep-Web Kontrolldistanz-Loop (ohne Netz — mock searchFn).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1DeepWebLoop.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  refineDeepWebQuery,
  deepWebNeedsAnotherPass,
  researchDeepWebBooking,
  deepWebTaskBudgetMs,
  looksLikeDeepWebManagerTask,
} from './call1DeepWebWorker';

assert.ok(
  refineDeepWebQuery('Hop-on Ticket Hamburg', 1, { wantBookingLink: true }).includes(
    'Buchungs',
  ),
);
assert.equal(
  deepWebNeedsAnotherPass({
    wantBookingLink: true,
    optionCount: 2,
    buttonCount: 0,
  }),
  true,
);
assert.equal(
  deepWebNeedsAnotherPass({
    wantBookingLink: true,
    optionCount: 1,
    buttonCount: 1,
  }),
  false,
);
assert.ok(deepWebTaskBudgetMs() >= 40_000);
assert.ok(
  looksLikeDeepWebManagerTask({
    id: 'ow_deep_web',
    brief: 'deep_web wantBookingLink',
  }),
);
assert.equal(
  looksLikeDeepWebManagerTask({ id: 'weather', brief: 'Wetter heute' }),
  false,
);

async function main() {
  let calls = 0;
  const looped = await researchDeepWebBooking({
    userText: 'Hop-on Tickets buchen',
    wantBookingLink: true,
    budgetMs: 30_000,
    maxPasses: 3,
    searchFn: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          facts: [{ label: 'Hop', value: 'Bus', sourceUrl: null }],
          sources: [],
          formPrefill: null,
          researchNotes: 'thin',
          speechHint: null,
        };
      }
      return {
        facts: [
          {
            label: 'Hop Ticket',
            value: 'kaufen',
            sourceUrl: 'https://example.com/book',
          },
        ],
        sources: [{ url: 'https://example.com/book', title: 'Book' }],
        formPrefill: {
          actionUrl: 'https://example.com/book',
          purpose: 'book',
        },
        researchNotes: 'ok',
        speechHint: null,
      };
    },
  });
  assert.ok(calls >= 2, `expected second pass, got ${calls}`);
  assert.equal(looped.ok, true);
  assert.ok(looped.buttons.length >= 1);
  assert.ok((looped.passes ?? 0) >= 2);
  assert.ok(/Kontrolldistanz|Beleg/i.test(looped.spokenDraft));
  console.log('call1DeepWebLoop.smoke: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
