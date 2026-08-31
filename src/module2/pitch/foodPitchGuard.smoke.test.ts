/**
 * Run: npm exec --yes --package tsx -- tsx src/module2/pitch/foodPitchGuard.smoke.test.ts
 */
import { parseWishesFromText, detectPitchKind, mergeProfileDietIntoWishes, dietLabelsFromProfile } from './parentBrief';
import { extractMenuAndPdfUrls } from '../../services/research/webFetch';
import { isMenuAssetUrl, isBareSiteUrl } from '../planning/offerActionUtils';
import { inferGastroFacetTags } from './gastroFacetTags';
import { scoreSpecializedFoodWish } from './specializedFoodMatch';
import { isParkingOrForestLotVenue } from './nonFoodVenueGate';
import { isParkingSearchIntent } from '../../services/concierge/timeCareIntent';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const w = parseWishesFromText('wo kann man am besten steak essen?');
  assert(
    w.some((x) => x.kind === 'dish' && /steak/i.test(x.text) && x.hardness === 'must'),
    'steak is must dish',
  );
  assert(detectPitchKind('wo kann man am besten steak essen?') === 'food', 'steak → food');
  assert(
    detectPitchKind('Michel raufgehen, wie teuer ist das Ticket') === 'sight',
    'michel + ticket stays sight, not food/tour',
  );
}

{
  const w = parseWishesFromText('wo gibt es gutes veganes Essen');
  assert(
    w.some((x) => x.kind === 'cuisine' && /vegan/i.test(x.text)),
    'vegan cuisine must',
  );
}

{
  const w = parseWishesFromText('asiatisch essen in der Nähe');
  assert(
    w.some((x) => x.kind === 'cuisine' && /asiatisch/i.test(x.text)),
    'asiatisch cuisine must',
  );
}

{
  const html = `
    <a href="/gallery/1">Foto</a>
    <script>{"url":"https://cdn.example.com/_files/ugd/abc123_menu.pdf"}</script>
    <div>Speisekarte</div>
    /_files/ugd/abc123_menu.pdf
  `;
  const urls = extractMenuAndPdfUrls(html, 'https://venue.example/');
  assert(
    urls.some((u) => /abc123_menu\.pdf/i.test(u)),
    `menu pdf harvested: ${urls.join(' | ')}`,
  );
}

{
  assert(
    isParkingOrForestLotVenue('Waldparkplatz am Forst'),
    'compound parkplatz is infra, not gastro',
  );
  assert(
    !isParkingOrForestLotVenue('Landgasthof am See'),
    'gasthof is not parking',
  );
}

{
  assert(
    isBareSiteUrl('https://venue.example/'),
    'domain root is homepage',
  );
  assert(
    !isMenuAssetUrl('https://venue.example/'),
    'homepage is not a Speisekarte',
  );
  assert(
    isMenuAssetUrl(
      'https://venue.example/_files/ugd/abc123_99ff00ee.pdf',
    ),
    'wix ugd pdf is Speisekarte',
  );
  assert(
    isMenuAssetUrl('https://venue.example/tageskarte.pdf'),
    'tageskarte pdf is Speisekarte',
  );
}

{
  const tags = inferGastroFacetTags('Steakhouse Grill', 'restaurant');
  assert(tags.includes('steak'), 'steakhouse name → steak facet');
}

{
  const tags = inferGastroFacetTags(
    'Landgasthof am See',
    'Leckeres Steak, Filet gegrillt, super Sättigungsbeilage.',
  );
  assert(tags.includes('steak'), 'review snippet steak → steak facet');
  assert(
    scoreSpecializedFoodWish(
      'landgasthof leckeres steak filet gegrillt',
      { text: 'steak', hardness: 'must', kind: 'dish' },
    ) >= 3,
    'review blob scores as steak evidence',
  );
  assert(
    !inferGastroFacetTags('Bistro', 'Leider nichts veganes auf der Karte.').includes(
      'vegan',
    ),
    'negated vegan review does not tag vegan',
  );
  assert(
    inferGastroFacetTags('Café', 'Schöne Terrasse zum Abendessen.').includes(
      'terrasse',
    ),
    'terrasse from reviews',
  );
}

{
  const q = 'wir wollen essen gehen, steak essen';
  const w = parseWishesFromText(q);
  assert(
    w.some((x) => x.kind === 'dish' && /steak/i.test(x.text) && x.hardness === 'must'),
    'essen gehen + steak → must dish steak',
  );
  assert(detectPitchKind(q) === 'food', 'essen gehen + steak → food');
  assert(
    !isParkingSearchIntent(q),
    'essen gehen + steak is not a parking search',
  );
}

{
  const q = 'wir wollen essen gehen, steak essen, ein parkplatz';
  assert(detectPitchKind(q) === 'food', 'steak + parkplatz stays food');
  assert(
    !isParkingSearchIntent(q),
    'steak + parkplatz is not a parking-lot search',
  );
  assert(
    parseWishesFromText(q).some(
      (x) => x.kind === 'dish' && /steak/i.test(x.text),
    ),
    'compound still keeps steak dish',
  );
}

{
  assert(
    isParkingSearchIntent('wo ist ein Parkplatz?'),
    'plain parkplatz search stays parking',
  );
}

{
  const vegan = mergeProfileDietIntoWishes([], { diet: ['vegan'] }, 'food');
  assert(
    vegan.some((x) => x.kind === 'cuisine' && x.text === 'vegan' && x.hardness === 'must'),
    'setup vegan → must cuisine',
  );
  const steakFirst = mergeProfileDietIntoWishes(
    [{ text: 'steak', hardness: 'must', kind: 'dish' }],
    { diet: ['vegan'] },
    'food',
  );
  assert(
    !steakFirst.some((x) => x.kind === 'cuisine' && /vegan/i.test(x.text)),
    'spoken steak wins over setup vegan',
  );
  const pann = mergeProfileDietIntoWishes(
    [{ text: 'pannfisch', hardness: 'must', kind: 'dish' }],
    { diet: ['vegan'] },
    'food',
    'Ich möchte Hamburger Pannenfisch essen',
  );
  assert(
    !pann.some((x) => x.kind === 'cuisine' && /vegan/i.test(x.text)),
    'spoken pannfisch wins over setup vegan',
  );
  assert(
    parseWishesFromText('Ich möchte Hamburger Pannenfisch essen').some(
      (x) => x.kind === 'dish' && x.text === 'pannfisch',
    ),
    'Pannenfisch canonicalizes to pannfisch',
  );
  assert(
    parseWishesFromText('Hamburger Pannfisch bitte').some(
      (x) => x.kind === 'dish' && x.text === 'pannfisch',
    ),
    'Hamburger Pannfisch is dish not burger',
  );
  assert(
    !inferGastroFacetTags(
      'Alt Helgoländer Fischerstube',
      'Spezialität: hamburger pannfisch',
    ).includes('burger'),
    'hamburger pannfisch is not a burger facet',
  );
  assert(
    inferGastroFacetTags(
      'Alt Helgoländer Fischerstube',
      'Spezialität: hamburger pannfisch',
    ).includes('pannfisch'),
    'hamburger pannfisch tags pannfisch',
  );
  assert(
    dietLabelsFromProfile({ dietaryTags: ['vegan'] }).includes('vegan'),
    'onboarding dietaryTags vegan',
  );
  assert(
    dietLabelsFromProfile({
      experiencePrefs: { vegan: 'yes' },
    }).includes('vegan'),
    'experiencePrefs vegan',
  );
}

{
  assert(
    detectPitchKind('dann lass uns ein Picknick machen') === 'sight',
    'picknick → sight not generic',
  );
  const { isPicnicUnsuitableVenue } = require('./picnicIntent') as {
    isPicnicUnsuitableVenue: (n: string, e?: string | null) => boolean;
  };
  assert(
    isPicnicUnsuitableVenue('Kriegerehrenmal an der Bilsbekbrücke'),
    'memorial is not a picnic spot',
  );
  assert(
    isPicnicUnsuitableVenue('Heimatverein Prisdorf'),
    'heimatverein is not a picnic spot',
  );
  assert(
    !isPicnicUnsuitableVenue('Feuerlöschteich'),
    'pond/park is picnic-ok',
  );
}

{
  const q = 'Empfehlung für das Herzstück';
  assert(detectPitchKind(q) === 'food', 'named venue → food');
  assert(
    parseWishesFromText(q).some(
      (x) => x.kind === 'venue' && /herzstück/i.test(x.text) && x.hardness === 'must',
    ),
    'Empfehlung für X is must venue',
  );
  assert(
    parseWishesFromText('ich möchte ein Herzstück haben').some(
      (x) => x.kind === 'venue' && /herzstück/i.test(x.text),
    ),
    'möchte X haben is must venue',
  );
  assert(
    !parseWishesFromText('Ofenkartoffeln um die neun Euro').some((x) => x.kind === 'venue'),
    'potato price is not a named venue',
  );
  assert(
    !parseWishesFromText('wo kann man am besten steak essen?').some((x) => x.kind === 'venue'),
    'steak dish is not a venue name',
  );
  const veganNamed = mergeProfileDietIntoWishes(
    parseWishesFromText(q),
    { diet: ['vegan'] },
    'food',
    q,
  );
  assert(
    !veganNamed.some((x) => x.kind === 'cuisine' && /vegan/i.test(x.text)),
    'named venue does not inject profile vegan',
  );
}

{
  const w = parseWishesFromText(
    'in Hamburg typisch hamburgerisch frühstücken',
  );
  assert(
    w.some((x) => x.kind === 'cuisine' && /hamburgerisch/i.test(x.text) && x.hardness === 'must'),
    'typical hamburg breakfast is must cuisine',
  );
}

console.log('foodPitchGuard.smoke.test.ts ok');
