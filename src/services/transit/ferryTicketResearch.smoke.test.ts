/**
 * Smoke: Fähre bleibt raus aus dem Bahn-Advisor; Tickets → Reederei-OPEN_URL.
 * Run: npx --yes tsx src/services/transit/ferryTicketResearch.smoke.test.ts
 */

import {
  isFerryQuery,
  wantsFerryOperatorSite,
  scoreFerryOperatorUrl,
  pickFerryOperatorUrls,
  ferryTicketActionsFromResearch,
} from './ferryTicketResearch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const TICKETS = 'Fährtickets nach Wangerooge';
const NEXT_FERRY = 'Wann fährt die nächste Fähre nach Harlesiel?';
const TRAIN = 'Wann fährt die nächste Bahn nach Hamburg?';

assert(isFerryQuery(TICKETS), 'Fährtickets ist Fähre (Kompositum)');
assert(isFerryQuery(NEXT_FERRY), 'nächste Fähre erkannt');
assert(!isFerryQuery(TRAIN), 'Bahn ist keine Fähre');
assert(wantsFerryOperatorSite(TICKETS), 'Fährtickets will Betreiberseite');
assert(wantsFerryOperatorSite(NEXT_FERRY), 'Fahrplan-Fähre will Betreiberseite');
assert(!wantsFerryOperatorSite(TRAIN), 'Bahn will keine Fährseite');

// Spiegel classifyJob transit_live — Kompositum Fährtickets
assert(
  /\b(fährtickets?|faehrtickets?|fähre|faehre)\b/iu.test(TICKETS),
  'classify-Regex trifft Fährtickets',
);

const query = TICKETS;
const ticketShop = 'https://ticket.siw-wangerooge.de/';
const operatorHome = 'https://www.siw-wangerooge.de/siw-de';
const bahn = 'https://www.bahn.de/';
const wiki = 'https://de.wikipedia.org/wiki/Wangerooge';

assert(
  scoreFerryOperatorUrl(ticketShop, 'Online-Ticket', query) >
    scoreFerryOperatorUrl(bahn, 'DB Navigator', query),
  'Ticket-Shop schlägt bahn.de',
);
assert(
  scoreFerryOperatorUrl(operatorHome, 'SIW Linienverkehr', query) >
    scoreFerryOperatorUrl(wiki, 'Wikipedia', query),
  'SIW schlägt Wikipedia',
);

const picked = pickFerryOperatorUrls({
  query,
  sources: [
    { url: bahn, title: 'Deutsche Bahn' },
    { url: wiki, title: 'Wangerooge' },
    { url: operatorHome, title: 'Schifffahrt und Inselbahn Wangerooge' },
    { url: ticketShop, title: 'Ticket-Buchung' },
  ],
});
assert(picked.length >= 1, 'mindestens eine Fährseite');
assert(
  /siw-wangerooge\.de/i.test(picked[0]!.url),
  `Top-Treffer muss SIW sein, got ${picked[0]!.url}`,
);
assert(
  !picked.some((p) => /bahn\.de/i.test(p.url)),
  'bahn.de nicht als Fährticket-Seite',
);

const acts = ferryTicketActionsFromResearch({
  query,
  sources: picked.map((p) => ({ url: p.url, title: p.title })),
});
assert(acts.length >= 1, 'OPEN_URL aus Research');
assert(acts[0]!.type === 'OPEN_URL', 'Action ist OPEN_URL');
assert(
  /^https:\/\/(ticket\.)?siw-wangerooge\.de/i.test(acts[0]!.payload.url || ''),
  `Fähr-URL, got ${acts[0]!.payload.url}`,
);

const hamburg = pickFerryOperatorUrls({
  query: 'Fährtickets Hafenrundfahrt Hamburg',
  sources: [
    { url: 'https://www.bahn.de/', title: 'Bahn' },
    { url: 'https://www.hadag.de/tickets', title: 'HADAG Tickets' },
  ],
});
assert(
  hamburg[0] && /hadag\.de/i.test(hamburg[0].url),
  'Hamburg: HADAG vor bahn.de (stadt-agnostisch)',
);

console.log('ferryTicketResearch smoke: ok');
console.log(`  top Wangerooge: ${picked[0]!.url} (score ${picked[0]!.score})`);
console.log(`  action: ${acts[0]!.label} → ${acts[0]!.payload.url}`);

void (async () => {
  const live = await Promise.all(
    [ticketShop, operatorHome].map(async (url) => {
      const res = await fetch(url, { redirect: 'follow' });
      return { url, status: res.status, final: res.url };
    }),
  );
  for (const row of live) {
    assert(row.status >= 200 && row.status < 400, `Live ${row.url} → ${row.status}`);
    console.log(`  live ${row.status} ${row.final}`);
  }
  console.log('ferryTicketResearch live SIW: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
