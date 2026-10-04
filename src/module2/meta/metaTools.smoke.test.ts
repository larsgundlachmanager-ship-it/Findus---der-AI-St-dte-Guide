/**
 * Run: npx --yes tsx src/module2/meta/metaTools.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isHollowPartnerUrl,
  buildHollowSafeOpenUrlAction,
  filterHollowOpenUrlActions,
} from './metaHollowLink';
import { metaWeatherLaneHint } from './metaWeather';
import { readMetaNavDestination } from './metaNav';
import { runMetaFactLookupLoop } from './metaExecutor';
import { refineDeepWebQuery } from './metaDeepWeb';

assert.equal(isHollowPartnerUrl('https://www.lidl-reisen.de/'), true);
const good = buildHollowSafeOpenUrlAction({
  url: 'https://example.com/ticket/123',
  label: 'Ticket',
});
assert.ok(good && good.type === 'OPEN_URL');

const hollowBook = buildHollowSafeOpenUrlAction({
  url: 'https://www.lidl-reisen.de/',
  label: 'Jetzt buchen',
});
assert.equal(hollowBook, null);

assert.equal(metaWeatherLaneHint('Was soll ich anziehen morgen?'), 'weather_outfit');
assert.equal(metaWeatherLaneHint('Regnet es heute?'), 'weather_rain');

const nav = readMetaNavDestination();
assert.ok(typeof nav.navigating === 'boolean');

assert.ok(refineDeepWebQuery('Fähre Ticket', 1, { wantBookingLink: true }).length > 8);

async function main() {
  const loop = await runMetaFactLookupLoop({
    userText: 'Wann fährt die letzte Fähre?',
    cityHint: 'Hamburg',
    wantBookingLink: false,
  });
  assert.ok(loop.steps.length <= 5, 'bounded steps');
  assert.ok(loop.steps.length >= 1);
  const deepSteps = loop.steps.filter((s) => s.tool === 'deep_web');
  assert.ok(deepSteps.length <= 3, 'max 3 deep_web passes');
}

main()
  .then(() => {
    const filtered = filterHollowOpenUrlActions([
      {
        type: 'OPEN_URL',
        label: 'Jetzt buchen',
        payload: { url: 'https://www.lidl-reisen.de/' },
      },
    ]);
    assert.ok(filtered.length <= 1);
    console.log('metaTools.smoke.test.ts ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
