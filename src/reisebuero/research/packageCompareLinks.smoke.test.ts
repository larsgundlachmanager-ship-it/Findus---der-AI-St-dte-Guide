/**
 * Pauschal-Partner: Lidl + Magic Life∥CHECK24 (Node, ohne RN/Affiliate).
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/packageCompareLinks.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';
import {
  listPackageComparePartnerIds,
  wantsMagicLifeCompare,
} from './packageCompareLinks';
import { isPackagePartnerStay } from './packagePartner';
import { isHollowPartnerUrl } from '../../services/affiliate/hollowPartnerUrl';
import {
  getLidlReisenLandingUrl,
  isLidlReisenUrl,
  LIDL_REISEN_AWIN_MID,
} from '../../services/affiliate/lidlReisenAffiliate';

const baseLed = mergeLedger(cloneEmptyLedger(), {
  adults: entry(2, 'user', 'must'),
  airportIata: entry('HAM', 'user', 'nice'),
});

{
  const landing = getLidlReisenLandingUrl('Antalya');
  assert.ok(isLidlReisenUrl(landing), 'lidl landing tagged');
  assert.match(landing, /lidl-reisen\.de/i);
  assert.match(landing, /q=Antalya/);
  assert.equal(LIDL_REISEN_AWIN_MID, '11773');
  assert.equal(isHollowPartnerUrl(landing), false, 'lidl with q not hollow');
  assert.equal(isHollowPartnerUrl('https://www.lidl-reisen.de/'), true, 'lidl home hollow');
  assert.equal(
    isHollowPartnerUrl('https://www.lidl-reisen.de/?dateFrom=2026-10-16'),
    true,
    'lidl date-only hollow',
  );
}

{
  assert.ok(
    isPackagePartnerStay({
      name: 'Pauschal Lidl Reisen',
      bookUrl: 'https://www.lidl-reisen.de/?q=Rhodos',
    }),
    'detect lidl package',
  );
  assert.ok(
    isPackagePartnerStay({
      name: 'TUI Magic Life',
      bookUrl: 'https://www.magiclife.com/?q=Club',
    }),
    'detect magic life package',
  );
}

{
  assert.equal(wantsMagicLifeCompare(baseLed, 'Mallorca'), false);
  assert.deepEqual(listPackageComparePartnerIds(baseLed, 'Antalya'), []);
  const aiLed = mergeLedger(baseLed, { meals: entry('all', 'user', 'must') });
  assert.equal(wantsMagicLifeCompare(aiLed, 'Antalya'), true);
  const clubLed = mergeLedger(baseLed, {
    purpose: entry('Cluburlaub Magic Life', 'user', 'nice'),
  });
  assert.equal(wantsMagicLifeCompare(clubLed, null), true);
}

{
  // DIY-Wochenende: kein CHECK24-Leerlink
  const ids = listPackageComparePartnerIds(baseLed, 'Antalya');
  assert.deepEqual(ids, []);
}

{
  const aiLed = mergeLedger(baseLed, { meals: entry('all', 'user', 'must') });
  const ids = listPackageComparePartnerIds(aiLed, 'Side');
  assert.deepEqual(ids, ['pkg-magiclife']);
}

{
  const pauschalLed = mergeLedger(baseLed, {
    purpose: entry('Pauschalreise Toskana', 'user', 'nice'),
  });
  assert.deepEqual(listPackageComparePartnerIds(pauschalLed, 'Florenz'), ['pkg-check24']);
}

console.log('packageCompareLinks.smoke.test.ts: ok');
