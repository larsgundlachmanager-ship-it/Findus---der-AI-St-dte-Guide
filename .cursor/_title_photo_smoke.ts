import { staticMapTitlePhoto } from '../src/reisebuero/research/placePhotoResolve';
import { resolveOptionPhoto } from '../src/reisebuero/research/storyMagazine';
import { deepEnrichMagazineOption } from '../src/reisebuero/research/magazineEnsure';

function assert(c: unknown, m: string) {
  if (!c) throw new Error('FAIL: ' + m);
  console.log('ok:', m);
}

async function main() {
  const map = staticMapTitlePhoto(37.98381, 23.727539, 12);
  console.log(map);
  assert(map && /maps\.wikimedia\.org/.test(map!), 'static map url');

  const bare: any = {
    id: 'athens',
    title: 'Athen',
    placeName: 'Athen',
    lat: 37.98381,
    lng: 23.727539,
    totalEur: null,
    budgetDeltaEur: null,
    pricePerPerson: null,
    priceIncludes: '',
    restBudgetEur: null,
    restBudgetHint: null,
    matchScore: 80,
    fitLine: '',
    whyBlurb: '',
    facts: [],
    softFacts: [],
    whyMatch: ['x'],
    gaps: [],
    photoUrl: null,
    stayName: null,
    stayBookUrl: null,
    stayPriceEur: null,
  };
  assert(resolveOptionPhoto(bare), 'resolveOptionPhoto never empty with GPS');

  const ledger: any = { adults: { value: 2 }, mustHaves: { value: [] }, wishHaves: { value: [] } };
  const enriched = await deepEnrichMagazineOption(bare, ledger);
  console.log('enriched:', enriched.photoUrl);
  assert(enriched.photoUrl, 'deepEnrich always sets photoUrl');
  assert(resolveOptionPhoto(enriched), 'cover photo after enrich');

  // Second option without photoUrl still gets cover via resolve
  const bare2 = { ...bare, id: 'crete', placeName: 'Kreta', lat: 35.24, lng: 24.81, photoUrl: null };
  assert(resolveOptionPhoto(bare2), 'every proposal cover via GPS map');

  console.log('TITLE PHOTO SMOKE OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
