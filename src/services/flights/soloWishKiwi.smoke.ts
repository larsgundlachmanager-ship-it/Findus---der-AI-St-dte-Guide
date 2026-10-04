/**
 * Solo wish → Kiwi buttons, keine Live-Board-Sackgasse.
 * Run: npx tsx src/services/flights/soloWishKiwi.smoke.ts
 */
import assert from 'node:assert/strict';

const { resetFlightTripSessionForTests } = require('./flightTripSession') as typeof import('./flightTripSession');
resetFlightTripSessionForTests();

const { prepareFlightTripFollowUp } = require('./flightTripAdvisor') as typeof import('./flightTripAdvisor');
const { parseFlightTripSlots, isSoloFlightAbSearch } = require('./flightTripIntent') as typeof import('./flightTripIntent');
const { buildCheapFlightBookActions } = require('./cheapFlightBook') as typeof import('./cheapFlightBook');
const { parseEventDateWindow } = require('../concierge/eventDateWindow') as typeof import('../concierge/eventDateWindow');

const Q =
  'Such mir guenstige Fluege von Hamburg nach Split vom 27.3.2026 bis 10.4.2026 raus.';

assert.equal(isSoloFlightAbSearch(Q), true, 'solo');
const slots = parseFlightTripSlots(Q);
assert.equal(slots.originHint, 'Hamburg', `origin ${slots.originHint}`);
assert.equal(slots.destHint, 'Split', `dest ${slots.destHint}`);
assert.equal(slots.flightCode, null, 'no fake code');

const win = parseEventDateWindow(Q);
assert.ok(win?.fromIso === '2026-03-27', `from ${win?.fromIso}`);
assert.ok(win?.toIso === '2026-04-10', `to ${win?.toIso}`);

const book = buildCheapFlightBookActions({
  originIata: 'HAM',
  destIata: 'SPU',
  dateKey: win!.fromIso,
  returnDateKey: win!.toIso,
  userText: Q,
});
assert.ok(book.some((a) => a.type === 'OPEN_URL' && /kiwi|tpx|travelpayouts/i.test(a.payload.url || '')), 'kiwi url');
assert.ok(book.filter((a) => a.type === 'OPEN_URL').length >= 2, 'two promo links');

async function main() {
  const r = await prepareFlightTripFollowUp(Q, { dateKey: win!.fromIso });
  assert.ok(r, 'followup');
  console.log(
    JSON.stringify(
      {
        title: r!.cardTitle,
        speech: (r!.speech || '').slice(0, 180),
        bullets: r!.bullets,
        actions: (r!.quickActions || []).map((a) => ({
          t: a.type,
          l: a.label,
          u: String(a.payload?.url || '').slice(0, 70),
        })),
      },
      null,
      2,
    ),
  );
  assert.ok(
    (r!.quickActions || []).some((a) => a.type === 'OPEN_URL'),
    'must have OPEN_URL kiwi',
  );
  assert.ok(!/Live-Daten fehlen/i.test(r!.speech || ''), 'no live-data dead end');
  assert.ok(
    /Günstige Flieger|Kiwi|günstig|Verbindungen|Preis/i.test(
      `${r!.cardTitle} ${r!.speech}`,
    ),
    'wish pitch tone',
  );
  console.log('soloWishKiwi.smoke.ts: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
