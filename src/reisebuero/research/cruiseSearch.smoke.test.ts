/**
 * Kreuzfahrt-Affiliate: Lidl /kreuzfahrten + AIDA + CHECK24.
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/cruiseSearch.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';
import {
  buildAidaSearchUrl,
  buildCheck24CruiseSearchUrl,
  buildCruiseSearchBrief,
  buildLidlCruiseSearchUrl,
  cruisePartnerSearchLinks,
} from './cruiseSearch';
import { isPackagePartnerStay } from './packagePartner';
import { isHollowPartnerUrl } from '../../services/affiliate/hollowPartnerUrl';
import {
  AIDA_AWIN_MID,
  getAidaUrl,
  isAidaUrl,
} from '../../services/affiliate/aidaAffiliate';
import {
  getLidlReisenCruiseLandingUrl,
  getLidlReisenCruiseUrl,
  LIDL_REISEN_AWIN_MID,
} from '../../services/affiliate/lidlReisenAffiliate';

{
  assert.equal(AIDA_AWIN_MID, '9144');
  assert.equal(LIDL_REISEN_AWIN_MID, '11773');
}

{
  const cruiseLanding = getLidlReisenCruiseLandingUrl(null);
  assert.match(cruiseLanding, /lidl-reisen\.de\/kreuzfahrten/i);
  assert.equal(isHollowPartnerUrl(cruiseLanding), false, 'cruise path not hollow');
  const tracked = getLidlReisenCruiseUrl('Oktober Party');
  assert.match(tracked, /awin1\.com\/cread\.php/i);
  assert.match(tracked, /awinmid=11773/);
  assert.match(tracked, /kreuzfahrten/i);
  assert.match(tracked, /Oktober|Party/i);
}

{
  const aida = getAidaUrl(null, null);
  assert.ok(isAidaUrl(aida));
  assert.match(aida, /awin1\.com\/cread\.php/i);
  assert.match(aida, /awinmid=9144/);
  assert.equal(isHollowPartnerUrl('https://www.aida.de/'), true);
}

{
  assert.ok(
    isPackagePartnerStay({
      name: 'AIDA Kreuzfahrt',
      bookUrl: 'https://www.aida.de/',
    }),
    'detect aida package',
  );
  assert.ok(
    isPackagePartnerStay({
      name: 'Lidl Kreuzfahrt',
      bookUrl: 'https://www.lidl-reisen.de/kreuzfahrten',
    }),
    'detect lidl cruise package',
  );
}

{
  const led = mergeLedger(cloneEmptyLedger(), {
    tripShape: entry('cruise', 'user', 'must'),
    adults: entry(2, 'user', 'must'),
  });
  const brief = buildCruiseSearchBrief(led);
  assert.ok(brief.query.length > 3);

  const lidl = buildLidlCruiseSearchUrl(brief);
  assert.match(lidl, /awinmid=11773/);
  assert.match(lidl, /kreuzfahrten/i);

  const aida = buildAidaSearchUrl(brief);
  assert.match(aida, /awinmid=9144/);

  const c24 = buildCheck24CruiseSearchUrl(brief);
  assert.match(c24, /awinmid=9364/);
  assert.match(c24, /kreuzfahrt\.check24/i);

  const links = cruisePartnerSearchLinks(led);
  const ids = links.map((l) => l.id);
  assert.ok(ids.includes('lidl_cruise'), 'lidl cruise link');
  assert.ok(ids.includes('aida'), 'aida link');
  assert.ok(ids.includes('meinschiff'), 'mein schiff link');
  assert.ok(ids.includes('c24'), 'check24 cruise link');
  assert.ok(!ids.includes('google'), 'no bare google primary');
  assert.ok(!ids.includes('cruise24'), 'no untracked cruise24 primary');
}

{
  const river = mergeLedger(cloneEmptyLedger(), {
    tripShape: entry('cruise', 'user', 'must'),
    cruiseKind: entry('river', 'user', 'must'),
  });
  const ids = cruisePartnerSearchLinks(river).map((l) => l.id);
  assert.ok(ids.includes('lidl_cruise'));
  assert.ok(ids.includes('c24'));
  assert.ok(!ids.includes('aida'), 'no AIDA on river');
}

console.log('cruiseSearch.smoke.test.ts OK');
