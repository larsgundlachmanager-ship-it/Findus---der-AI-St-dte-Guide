/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/visualBullets.smoke.test.ts
 */
import { clampVisualBullets } from './visualBullets';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const speech =
    'Fairway Hotel mit Pool und Sauna, 1,3 km, live ab 189 Euro. Die Kaffeerei Rösterei liegt 1,7 km.';
  const b = clampVisualBullets(
    [
      'Fairway Hotel Peiner Hof: 1,3 km',
      'Die Kaffeerei Rösterei: 1,7 km',
      'Fairway Hotel Peiner Hof: 4.6 Sterne bei 226 Bewertungen',
      'Pool und Sauna',
      '189 € live',
    ],
    { speechText: speech, surface: 'pitch' },
  );
  assert(
    !b.some((x) => /sterne|bewertung/i.test(x)),
    `keine Sterne: ${b.join(' | ')}`,
  );
  const distHits = b.filter((x) => /\d+[.,]?\d*\s*km\b/i.test(x));
  assert(distHits.length <= 1, `max 1× km, got ${distHits.join(' | ')}`);
  assert(
    b.some((x) => /pool|sauna|189|€/i.test(x)),
    `Wunsch/Preis vor Distanz: ${b.join(' | ')}`,
  );
}

{
  const b = clampVisualBullets(
    ['1,3 km', 'Hotel: 1,3 km', 'Pool'],
    {
      speechText: 'Das Hotel mit Pool liegt 1,3 km entfernt.',
    },
  );
  assert(
    b.filter((x) => /1[,.]3\s*km/i.test(x)).length <= 1,
    `km dedupe: ${b.join(' | ')}`,
  );
  assert(b.some((x) => /pool/i.test(x)), 'Pool bleibt');
}

console.log('visualBullets.smoke.test.ts ok');
