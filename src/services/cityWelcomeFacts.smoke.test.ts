/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityWelcomeFacts.smoke.test.ts
 */

import { buildCityWelcomeFacts } from '../../scripts/cityPack/buildCityWelcomeFacts.mjs';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const pack = {
  city_id: 'demo',
  city_name: 'Demostadt',
  _city_history:
    'Im 12. Jahrhundert entstand an der Furt ein Markt. Später brachte der Handel Reichtum und ein Rathaus, das bis heute steht. Heute prägen Fahrräder und kurze Wege das Bild.',
  spots: [
    {
      id: 'rathaus',
      name: 'Altes Rathaus',
      tier: 'must_have',
      general_info: 'x'.repeat(200),
    },
    {
      id: 'hafen',
      name: 'Hafenquartier',
      tier: 't1',
      story: 1,
      general_info: 'y'.repeat(100),
    },
    { id: 'park', name: 'Stadtpark', tier: 't2', general_info: 'z'.repeat(50) },
    { id: 'shop', name: 'Supermarkt', tier: 'directory' },
  ],
};

const facts = buildCityWelcomeFacts(pack);
assert(facts.cityId === 'demo', 'cityId');
assert(facts.history.length >= 40, 'history');
assert(facts.highlights.length === 3, `3 highlights got ${facts.highlights.length}`);
assert(!facts.highlights.includes('Supermarkt'), 'directory raus');
assert(facts.highlights[0] === 'Altes Rathaus', 'must_have first');
assert(typeof facts.speech === 'string' && facts.speech.length >= 60, 'speech baked');
assert(/Was wollen wir als Erstes entdecken\?/.test(facts.speech), 'CTA');

console.log('cityWelcomeFacts.smoke.test.ts OK');
