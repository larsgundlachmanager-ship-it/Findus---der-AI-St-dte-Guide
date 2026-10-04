/**
 * Hollow-Partner-URL Guard — alle Affiliate-Portale.
 * Run: npx --yes tsx src/services/affiliate/hollowPartnerUrl.test.ts
 */

import {
  isHollowPartnerUrl,
  looksLikePartnerBookClaim,
  mayShowAsPartnerBookAction,
  unwrapPartnerLandingUrl,
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
assert(isHollowPartnerUrl('https://www.airbnb.de/'), 'airbnb home');
assert(isHollowPartnerUrl('https://www.airbnb.com/'), 'airbnb.com home');
assert(
  !isHollowPartnerUrl('https://www.airbnb.de/s/Berlin/homes?checkin=2026-08-01'),
  'airbnb search',
);
assert(
  !isHollowPartnerUrl('https://www.airbnb.de/rooms/12345'),
  'airbnb rooms',
);
assert(isHollowPartnerUrl('https://www.solmar.de/'), 'solmar home');
assert(isHollowPartnerUrl('https://www.travelsecure.de/'), 'travelsecure home');
assert(isHollowPartnerUrl('https://urlaub.check24.de/'), 'check24 home');
assert(isHollowPartnerUrl('https://www.lidl-reisen.de/'), 'lidl home hollow');
assert(
  !isHollowPartnerUrl('https://www.lidl-reisen.de/?q=Antalya'),
  'lidl search not hollow',
);
assert(
  isHollowPartnerUrl('https://www.lidl-reisen.de/?dateFrom=2026-10-16'),
  'lidl date-only hollow',
);
assert(
  !isHollowPartnerUrl('https://www.lidl-reisen.de/kreuzfahrten'),
  'lidl cruise path not hollow',
);
assert(isHollowPartnerUrl('https://www.aida.de/'), 'aida home hollow');
assert(
  !isHollowPartnerUrl('https://www.aida.de/aida-cruises'),
  'aida path not hollow',
);
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
    'https://www.expedia.de/Athens-Hotels-X.h106254548.Hotel-Beschreibung?chkin=2026-09-30&chkout=2026-10-01',
  ),
  'expedia Hotel-Beschreibung',
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

{
  const { softenHollowPartnerBookAction } = require('./hollowPartnerUrl') as {
    softenHollowPartnerBookAction: (a: {
      type: string;
      label: string;
      payload?: { url?: string };
    }) => { label: string };
  };
  const soft = softenHollowPartnerBookAction({
    type: 'OPEN_URL',
    label: '🏨 Zimmer buchen',
    payload: {
      url: 'https://www.expedia.de/Hotel-Search?destination=Athen',
    },
  });
  assert(/suchen/i.test(soft.label), 'soften hotel search label');
  assert(
    !looksLikePartnerBookClaim(soft.label) || /suchen/i.test(soft.label),
    'softened not book claim',
  );
}


{
  const kiwiTracked =
    'https://c111.travelpayouts.com/click?shmarker=760293.cheapflight&promo_id=3791&source_type=customlink&type=click&custom_url=' +
    encodeURIComponent(
      'https://www.kiwi.com/deep?from=HAM&to=ATH&departure=2026-11-12&return=anytime&adults=2&children=0&infants=0&bags=0.1_0.1-&stopNumber=0~true&lang=de',
    );
  const unwrappedKiwi = unwrapPartnerLandingUrl(kiwiTracked);
  assert(
    /stopNumber=0(~|%7E)true/.test(unwrappedKiwi),
    `custom_url keeps stopNumber: ${unwrappedKiwi}`,
  );
  assert(
    /adults=2/.test(unwrappedKiwi) && /bags=0\.1_0\.1/.test(unwrappedKiwi),
    `custom_url keeps pax/bags: ${unwrappedKiwi}`,
  );
}

console.log('hollowPartnerUrl.test.ts OK');
