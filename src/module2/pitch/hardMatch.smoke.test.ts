/**
 * Run: npx --yes tsx src/module2/pitch/hardMatch.smoke.test.ts
 */
import { parseWishesFromText } from './parentBrief';
import { parseHotelAmenityNeeds } from '../../services/concierge/hotelHardMatch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const w = parseWishesFromText('Ich will Spaghetti-Eis');
  assert(
    w.some((x) => x.kind === 'dish' && /spaghetti/i.test(x.text) && x.hardness === 'must'),
    'spaghetti-eis must dish',
  );
}

{
  const w = parseWishesFromText('Hotel mit Pool, Sauna und Elbblick');
  const texts = w.map((x) => x.text.toLowerCase());
  assert(texts.some((t) => t.includes('pool')), 'pool wish');
  assert(texts.some((t) => t.includes('sauna')), 'sauna wish');
  assert(texts.some((t) => t.includes('blick')), 'blick wish');
}

{
  const needs = parseHotelAmenityNeeds('Hotel mit Pool Sauna und Elbblick');
  assert(needs.some((n) => n.id === 'pool'), 'pool amenity');
  assert(needs.some((n) => n.id === 'sauna'), 'sauna amenity');
  assert(needs.some((n) => n.id.startsWith('view_')), 'view amenity');
}

{
  const w = parseWishesFromText(
    'ich möchte gerne Pizza mitnehmen Take Away zum Strand',
  );
  assert(
    w.some((x) => x.kind === 'cuisine' && /pizza/i.test(x.text)),
    'pizza cuisine must',
  );
  assert(
    w.some((x) => x.kind === 'amenity' && /takeaway/i.test(x.text)),
    'takeaway amenity must',
  );
}

{
  const { isCrediblePizzaVenue, isBeachLeisureWithoutPizza } = require('./pizzaVenueGate') as {
    isCrediblePizzaVenue: (b: string) => boolean;
    isBeachLeisureWithoutPizza: (b: string) => boolean;
  };
  assert(
    isBeachLeisureWithoutPizza('28°GRAD Strandbad Wedel Beach Bar'),
    'strandbad without pizza',
  );
  assert(
    !isCrediblePizzaVenue('28°GRAD Strandbad Wedel'),
    'strandbad not pizza venue',
  );
  assert(
    isCrediblePizzaVenue('Pizzeria Roma Takeaway'),
    'pizzeria ok',
  );
}

console.log('pitch hard-match smoke ok');
