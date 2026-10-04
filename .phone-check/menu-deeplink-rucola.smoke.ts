import { parseWishesFromText } from '../src/module2/pitch/parentBrief';
import { buildPitchActions } from '../src/module2/pitch/pitchActions';

const w = parseWishesFromText('beste Rucola-Pizza heute Abend');
const dish = w.filter((x) => x.kind === 'dish').map((x) => x.text);
if (!dish.some((t) => /rucola/i.test(t))) {
  throw new Error('expected rucola dish wish, got ' + JSON.stringify(w));
}
console.log('OK rucola wish', dish.join(','));

const acts = buildPitchActions({
  kind: 'food',
  name: 'Pizzeria Test',
  lat: 1,
  lng: 2,
  mapsUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJ',
  websiteUrl: 'https://example.com/',
  menuUrl: null,
  role: 'favorite',
  suppressNav: true,
});
if (!acts.some((a) => /Speisekarte/i.test(a.label))) {
  throw new Error('expected Speisekarte fail-open, got ' + acts.map((a) => a.label).join('|'));
}
console.log('OK speisekarte fail-open', acts.map((a) => a.label).join(' | '));
console.log('menu-deeplink-rucola.smoke ok');
