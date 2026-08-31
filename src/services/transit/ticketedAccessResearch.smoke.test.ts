/**
 * Smoke: ticketed access scores operator/ticket URLs, not wiki.
 * Run: npx --yes tsx src/services/transit/ticketedAccessResearch.smoke.test.ts
 */

import {
  scoreTicketedAccessOperatorUrl,
  pickTicketedAccessOperatorUrls,
  ticketedAccessActionsFromResearch,
} from './ticketedAccessResearch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const query = 'auf den Berg rauffahren Sierra Nevada';
const shop = 'https://tickets.sierranevada.es/booking';
const wiki = 'https://de.wikipedia.org/wiki/Sierra_Nevada';
const trip = 'https://www.tripadvisor.com/Attraction';

assert(
  scoreTicketedAccessOperatorUrl(shop, 'Tickets Sierra Nevada', query) >
    scoreTicketedAccessOperatorUrl(wiki, 'Sierra Nevada', query),
  'ticket shop beats wikipedia',
);
assert(
  scoreTicketedAccessOperatorUrl(trip, 'Tripadvisor', query) < 4,
  'tripadvisor penalized',
);

const picks = pickTicketedAccessOperatorUrls({
  query,
  sources: [
    { url: wiki, title: 'Wiki' },
    { url: shop, title: 'Tickets' },
  ],
});
assert(picks[0]?.url === shop, 'pick shop first');

const acts = ticketedAccessActionsFromResearch({
  query,
  sources: [{ url: shop, title: 'Tickets Sierra Nevada' }],
});
assert(acts.length >= 1, 'has OPEN_URL');
assert(acts[0]?.type === 'OPEN_URL', 'OPEN_URL type');
assert(/ticket/i.test(acts[0]?.label ?? ''), 'generic ticket label');

console.log('ticketedAccessResearch.smoke.test.ts OK');
