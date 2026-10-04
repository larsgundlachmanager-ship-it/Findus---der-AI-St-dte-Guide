/**
 * P4: ±1 scan, rank, provision links, woven speech.
 * Run: npx tsx src/services/flights/flightWishTools.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { scanCheapWindow } from './tools/scanCheapWindow';
import { rankFlightOptions } from './tools/rankFlightOptions';
import { buildProvisionLinks } from './tools/buildProvisionLinks';
import { weaveFlightBookingSpeech } from './tools/weaveFlightBookingSpeech';
import { runFlightWishTools } from './tools/runFlightWishTools';

async function main() {
  {
    const cands = await scanCheapWindow({
      originIata: 'HAM',
      destIata: 'SPU',
      outboundDateKey: '2026-03-27',
      returnDateKey: '2026-04-10',
    });
    assert.ok(cands.length >= 3, `±1 outbound window ${cands.length}`);
    assert.ok(
      cands.some((c) => c.outboundDateKey === '2026-03-26') &&
        cands.some((c) => c.outboundDateKey === '2026-03-28'),
      'neighbor days scanned',
    );
  }

  {
    const ranked = rankFlightOptions([
      {
        id: 'a',
        outboundDateKey: '2026-03-27',
        originIata: 'HAM',
        destIata: 'SPU',
        priceEur: 220,
        transfers: 0,
        source: 'synthetic',
      },
      {
        id: 'b',
        outboundDateKey: '2026-03-26',
        originIata: 'HAM',
        destIata: 'SPU',
        priceEur: 90,
        transfers: 3,
        durationMin: 20 * 60,
        source: 'synthetic',
      },
    ]);
    assert.equal(ranked[0]?.id, 'a', 'junk 3-stop loses');
  }

  {
    const links = buildProvisionLinks({
      originIata: 'HAM',
      destIata: 'SPU',
      outboundDateKey: '2026-03-27',
      returnDateKey: '2026-04-10',
      userText: 'günstig nach Split',
    });
    assert.ok(
      links.some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /kiwi|travelpayouts|aviasales/i.test(a.payload.url || ''),
      ),
      'kiwi/aviasales links',
    );
  }

  {
    const { speech, bullets } = weaveFlightBookingSpeech({
      fromLabel: 'Hamburg',
      toLabel: 'Split',
      whenLabel: '27. März bis 10. April',
      ranked: [
        {
          id: '1',
          outboundDateKey: '2026-03-27',
          originIata: 'HAM',
          destIata: 'SPU',
          priceEur: 180,
          transfers: 0,
          departAt: '10:15',
          source: 'calendar',
        },
      ],
    });
    assert.ok(!/ · /u.test(speech), 'speech not telegram');
    assert.ok(/Kiwi|Vergleich/i.test(speech), 'mentions links');
    assert.ok(bullets.length >= 2, 'bullets');
  }

  {
    const out = await runFlightWishTools({
      originIata: 'HAM',
      destIata: 'SPU',
      outboundDateKey: '2026-03-27',
      returnDateKey: '2026-04-10',
      fromLabel: 'Hamburg',
      toLabel: 'Split',
      whenLabel: '27. März bis 10. April',
      userText: 'günstige Flüge Hamburg Split',
    });
    assert.ok(
      out?.provisionActions.some((a) => a.type === 'OPEN_URL'),
      'pipeline links',
    );
  }

  console.log('flightWishTools.smoke.test.ts: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
