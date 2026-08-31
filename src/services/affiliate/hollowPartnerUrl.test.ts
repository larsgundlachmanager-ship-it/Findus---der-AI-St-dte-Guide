/**
 * Hollow-Partner-URL Guard — alle Affiliate-Portale.
 * Run: npx --yes tsx src/services/affiliate/hollowPartnerUrl.test.ts
 */

import {
  isHollowPartnerUrl,
  looksLikePartnerBookClaim,
  mayShowAsPartnerBookAction,
} from './hollowPartnerUrl';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(isHollowPartnerUrl('https://www.tiqets.com/de/'), 'tiqets home');
assert(isHollowPartnerUrl('https://www.getyourguide.com/'), 'gyg home');
assert(isHollowPartnerUrl('https://www.musement.com/'), 'musement home');
assert(isHollowPartnerUrl('https://www.viator.com/'), 'viator home');
assert(isHollowPartnerUrl('https://www.klook.com/'), 'klook home');
assert(isHollowPartnerUrl('https://www.expedia.de/'), 'expedia home');
assert(isHollowPartnerUrl('https://www.stay22.com/'), 'stay22 home');
assert(isHollowPartnerUrl('https://www.solmar.de/'), 'solmar home');
assert(isHollowPartnerUrl('https://www.travelsecure.de/'), 'travelsecure home');
assert(isHollowPartnerUrl('https://urlaub.check24.de/'), 'check24 home');
assert(isHollowPartnerUrl('https://www.weg.de/'), 'weg.de home');
assert(
  isHollowPartnerUrl('https://www.ab-in-den-urlaub.de/'),
  'ab-in-den-urlaub home',
);

assert(
  !isHollowPartnerUrl(
    'https://www.check24.net/pauschalreisen-vergleich/?c24pp_departure_date=2026-08-29&c24pp_airport=BRE',
  ),
  'check24 package search',
);
assert(
  !isHollowPartnerUrl('https://www.check24.net/mietwagen-preisvergleich/'),
  'check24 car compare',
);

assert(
  isHollowPartnerUrl('https://www.tiqets.com/de/search/?q=Hamburg%20Party'),
  'tiqets search',
);
assert(
  isHollowPartnerUrl(
    'https://www.getyourguide.com/s/?q=hamburg&partner_id=ZVQGONB',
  ),
  'gyg search',
);
assert(
  isHollowPartnerUrl('https://www.stay22.com/allez/findus?address=Germany'),
  'stay22 germany-only',
);
assert(
  isHollowPartnerUrl(
    'https://www.expedia.de/Hotel-Search?destination=Germany',
  ),
  'expedia germany-only',
);

assert(
  !isHollowPartnerUrl(
    'https://www.tiqets.com/de/hamburg-attractions-l123/miniatur-wunderland-p987/',
  ),
  'tiqets product',
);
assert(
  !isHollowPartnerUrl(
    'https://www.stay22.com/allez/findus?address=Hotel%20Atlantic%20Hamburg',
  ),
  'stay22 hotel',
);
assert(
  isHollowPartnerUrl(
    'https://www.expedia.de/Hotel-Search?destination=Hotel%20Atlantic%20Hamburg&chkin=2026-08-20',
  ),
  'expedia hotel-search still search (no room select)',
);
assert(
  !isHollowPartnerUrl(
    'https://www.expedia.de/go/hotel/info/12345678/2026-08-20/2026-08-21',
  ),
  'expedia property deep link',
);
assert(
  !isHollowPartnerUrl(
    'https://www.expedia.de/Hotel-Search?destination=Hotel%20Atlantic&selected=12345678&chkin=2026-08-20',
  ),
  'expedia search with selected property',
);

assert(
  isHollowPartnerUrl('https://www.gokonfetti.com/de-de/'),
  'konfetti home',
);
assert(
  isHollowPartnerUrl('https://www.gokonfetti.com/de-de/search/?q=Hamburg'),
  'konfetti search',
);
assert(
  !isHollowPartnerUrl(
    'https://gokonfetti.com/de-de/e/graffiti-workshop-in-hamburg-perfekt-fuer-gruppen-xqgk9w/',
  ),
  'konfetti event',
);
assert(
  isHollowPartnerUrl(
    'https://www.economybookings.com/de/referral/16yupj/l0j2ln',
  ),
  'economy referral',
);

const awin =
  'https://www.awin1.com/cread.php?awinmid=12428&awinaffid=1&ued=' +
  encodeURIComponent('https://www.tiqets.com/de/');
assert(isHollowPartnerUrl(awin), 'awin → hollow landing');

assert(looksLikePartnerBookClaim('🎫 Jetzt buchen'), 'book claim');
assert(!looksLikePartnerBookClaim('🎟️ Touren suchen'), 'search label');
assert(
  !mayShowAsPartnerBookAction({
    label: '🎫 Jetzt buchen',
    url: 'https://www.tiqets.com/de/',
  }),
  'block hollow book',
);
assert(
  mayShowAsPartnerBookAction({
    label: '🎟️ Touren suchen',
    url: 'https://www.getyourguide.com/s/?q=hamburg',
  }),
  'allow honest search',
);

console.log('hollowPartnerUrl.test.ts OK');
