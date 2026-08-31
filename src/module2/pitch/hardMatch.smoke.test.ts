/**
 * Run: npx --yes tsx src/module2/pitch/hardMatch.smoke.test.ts
 */
import { parseWishesFromText } from './parentBrief';
import { parseHotelAmenityNeeds } from '../../services/concierge/hotelHardMatch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const { resolveVisitAtMs, parseWishesFromText, resolveSearchMode } = require('./parentBrief') as {
    resolveVisitAtMs: (t: string, n?: number) => number;
    parseWishesFromText: (t: string) => Array<{ text: string; kind?: string }>;
    resolveSearchMode: (o: {
      text: string;
      hasActiveNav: boolean;
      hasTimelineNext: boolean;
    }) => string;
  };
  const now = Date.parse('2026-08-16T23:20:00+02:00');
  const visit = resolveVisitAtMs('wo kann ich Morgen frühstücken gehen', now);
  const expect = new Date(now);
  expect.setDate(expect.getDate() + 1);
  expect.setHours(8, 0, 0, 0);
  assert(visit === expect.getTime(), 'morgen frühstück → 8 Uhr Folgetag');
  assert(
    parseWishesFromText('wo kann ich Morgen frühstücken gehen').some(
      (w) => w.kind === 'cuisine' && /frühstück/i.test(w.text),
    ),
    'breakfast is must cuisine',
  );
  assert(
    resolveSearchMode({
      text: 'wo kann ich Morgen frühstücken gehen',
      hasActiveNav: false,
      hasTimelineNext: false,
    }) === 'future_place',
    'morgen breakfast is future_place',
  );
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
  const needs = parseHotelAmenityNeeds(
    'Hotel all-inclusive mit Massage und Pool',
  );
  assert(needs.some((n) => n.id === 'all_inclusive'), 'all-inclusive amenity');
  assert(needs.some((n) => n.id === 'massage'), 'massage amenity');
  assert(needs.some((n) => n.id === 'pool'), 'pool with board');
  assert(
    !parseHotelAmenityNeeds('Hotel inklusive Frühstück').some(
      (n) => n.id === 'all_inclusive',
    ),
    'inklusive Frühstück ≠ all-inclusive',
  );
  assert(
    !parseHotelAmenityNeeds('Hotel mit Spa und Pool').some(
      (n) => n.id === 'massage',
    ),
    'Spa allein ≠ Massage',
  );
}

{
  const {
    filterHotelsByAmenityNeeds,
    stayMatchesAmenity,
  } = require('../../services/concierge/hotelHardMatch') as {
    filterHotelsByAmenityNeeds: (
      stays: Array<{ id: string; name: string; amenities?: string[] }>,
      needs: Array<{ id: string; label: string; evidence: RegExp; trigger: RegExp }>,
    ) => {
      matched: unknown[];
      missingLabels: string[];
    };
    stayMatchesAmenity: (
      stay: { amenities?: string[] },
      need: { evidence: RegExp },
    ) => boolean;
  };
  const needs = parseHotelAmenityNeeds('Hotel all inclusive mit Massage');
  const spaOnly = {
    id: '1',
    name: 'Spa Resort',
    amenities: ['Pool', 'Spa', 'Sauna'],
  };
  const full = {
    id: '2',
    name: 'AI Massage Resort',
    amenities: ['All-inclusive', 'Massage', 'Pool'],
  };
  const filtered = filterHotelsByAmenityNeeds([spaOnly, full] as never, needs);
  assert(filtered.matched.length === 1, 'only full AI+massage match');
  assert(
    !stayMatchesAmenity(spaOnly, needs.find((n) => n.id === 'massage')!),
    'spa hotel fails massage evidence',
  );
  const w = parseWishesFromText('Hotel all-inclusive mit Massage');
  assert(
    w.some((x) => x.kind === 'amenity' && /all-inclusive/i.test(x.text)),
    'all-inclusive wish',
  );
  assert(
    w.some((x) => x.kind === 'amenity' && /massage/i.test(x.text)),
    'massage wish',
  );
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
  const steakW = parseWishesFromText('wo kann man am besten steak essen?');
  assert(
    steakW.some((x) => x.kind === 'dish' && /steak/i.test(x.text)),
    'steak dish must in hardMatch smoke',
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

{
  const w = parseWishesFromText('wo kann man am besten steak essen?');
  assert(
    w.some((x) => x.kind === 'dish' && /steak/i.test(x.text) && x.hardness === 'must'),
    'steak is must dish',
  );
}

{
  const {
    isOppositeDietVenue,
    looksLikeSpokenVeganOrVeg,
  } = require('./specializedFoodMatch') as {
    isOppositeDietVenue: (venue: string, wish: string) => boolean;
    looksLikeSpokenVeganOrVeg: (t: string) => boolean;
  };
  assert(looksLikeSpokenVeganOrVeg('vegan essen'), 'vegan wish detected');
  assert(looksLikeSpokenVeganOrVeg('vegetarisch Abendessen'), 'veg wish detected');
  assert(
    isOppositeDietVenue('Bulls Steakhouse', 'vegan essen'),
    'vegan wish + Bulls Steakhouse → opposite',
  );
  assert(
    isOppositeDietVenue('Vegan Corner', 'steak essen'),
    'steak wish + Vegan Corner → opposite',
  );
  assert(
    !isOppositeDietVenue('Green Bowl vegan', 'vegan essen'),
    'vegan wish + Green Bowl vegan → NOT opposite',
  );
}

{
  const {
    scoreSpecializedFoodWish,
    normalizeFoodStt,
    canonicalCattleBreed,
  } = require('./specializedFoodMatch') as {
    scoreSpecializedFoodWish: (
      blob: string,
      w: { text: string; kind?: string; hardness?: string },
    ) => number;
    normalizeFoodStt: (s: string) => string;
    canonicalCattleBreed: (s: string) => string | null;
  };
  assert(
    normalizeFoodStt('Agno Steak in der Nähe').toLowerCase().includes('angus'),
    'Agno STT → angus',
  );
  assert(canonicalCattleBreed('Agno Steak') === 'angus', 'Agno → angus breed');
  assert(
    parseWishesFromText('Agno Steak bitte').some(
      (x) => x.kind === 'dish' && /angus|steak/i.test(x.text),
    ),
    'Agno Steak wishes include angus/steak',
  );
  assert(
    parseWishesFromText('wo gibt es Döner').some(
      (x) => x.kind === 'dish' && /döner/i.test(x.text) && x.hardness === 'must',
    ),
    'döner is must dish',
  );
  assert(
    scoreSpecializedFoodWish('Bulls Steakhouse Pinneberg', {
      text: 'steak',
      kind: 'dish',
      hardness: 'must',
    }) >= 3,
    'steakhouse hard-matches steak',
  );
  assert(
    scoreSpecializedFoodWish('Döner Haus Pinneberg Imbiss', {
      text: 'steak',
      kind: 'dish',
      hardness: 'must',
    }) === 0,
    'döner does not soft-match steak',
  );
  assert(
    scoreSpecializedFoodWish('Döner Haus Pinneberg Imbiss', {
      text: 'döner',
      kind: 'dish',
      hardness: 'must',
    }) >= 1,
    'döner matches döner family',
  );
  assert(
    scoreSpecializedFoodWish('Café Bistro am Markt', {
      text: 'steak',
      kind: 'dish',
      hardness: 'must',
    }) === 0,
    'generic bistro is not steak family',
  );
}

{
  const { detectPitchKind } = require('./parentBrief') as {
    detectPitchKind: (t: string) => string;
  };
  assert(
    detectPitchKind('was läuft im Kino aktuell') === 'cinema',
    'kino query → cinema kind',
  );
  assert(
    detectPitchKind('wo kann man steak essen') === 'food',
    'steak → food kind',
  );
  assert(
    detectPitchKind('Döner in der Nähe') === 'food',
    'döner → food kind',
  );
}

console.log('pitch hard-match smoke ok');
