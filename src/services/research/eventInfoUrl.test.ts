/**
 * Run: npx --yes tsx src/services/research/eventInfoUrl.test.ts
 */
import {
  buildEventInfoSearchFallbackUrl,
  buildNamedPlaceMapsUrl,
  canonicalizeEventInfoUrl,
  eventUrlMatchesHints,
  extractHttpUrlsFromText,
  isCoordsOnlyMapsUrl,
  isEstablishedGoogleMapsPlaceUrl,
  isGenericEventListingUrl,
  isJunkEventInfoUrl,
  keepFoundEventUrl,
  looksLikeGooglePlaceId,
  mapsUrlForGooglePlace,
  overlayGroundingEventUrls,
  pickNearbyListedGooglePlace,
  pickGroundingEventUrl,
  resolveEventInfoUrl,
  resolveEventProgramLink,
  rewriteGoogleMapsOpenUrl,
  sanitizeMapsPlaceQuery,
  slugifyRausgegangen,
} from './eventInfoUrl';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(slugifyRausgegangen('Lübeck') === 'lubeck', 'ü → u not ue');
assert(slugifyRausgegangen('Köln') === 'koln', 'ö → o not oe');

assert(
  isGenericEventListingUrl('https://rausgegangen.de/lubeck/'),
  'city landing is listing',
);
assert(
  isGenericEventListingUrl('https://rausgegangen.de/luebeck/'),
  'din city landing is listing',
);
assert(
  !isGenericEventListingUrl(
    'https://rausgegangen.de/events/lubeck-chaos-comedy-club-0/',
  ),
  'event detail is not listing',
);

const found =
  'https://rausgegangen.de/events/lubeck-chaos-comedy-club-0/';
assert(keepFoundEventUrl(found) === found, 'found detail stays 1:1');
assert(
  keepFoundEventUrl(
    'https://www.rausgegangen.de/en/events/lubeck-chaos-comedy-club-0?utm_source=google',
  ) === found,
  'www/en/utm stripped, slug untouched',
);
assert(
  keepFoundEventUrl(
    'https://rausgegangen.de/events/chaos-comedy-club-lubeck-0/',
  ) === 'https://rausgegangen.de/events/chaos-comedy-club-lubeck-0/',
  'do not rewrite a copied slug',
);
assert(
  keepFoundEventUrl('https://rausgegangen.de/lubeck/') === null,
  'listing is not a found event page',
);

assert(
  canonicalizeEventInfoUrl('https://rausgegangen.de/lubeck/', {
    title: 'Chaos Comedy Club | Lübeck',
    city: 'Lübeck',
  }) === null,
  'never invent a slug from city listing + title',
);
assert(
  canonicalizeEventInfoUrl('https://rausgegangen.de/luebeck/', {
    title: 'Chaos Comedy Club',
    city: 'Lübeck',
  }) === null,
  'never invent from din city listing',
);
assert(
  canonicalizeEventInfoUrl(found) === found,
  'correct event url stays',
);
assert(
  canonicalizeEventInfoUrl(
    'https://rausgegangen.de/en/events/lubeck-chaos-comedy-club-0/',
  ) === found,
  'drop /en/ prefix',
);
assert(
  canonicalizeEventInfoUrl('https://theaterschiff.de/programm') ===
    'https://theaterschiff.de/programm',
  'other hosts unchanged',
);
assert(
  canonicalizeEventInfoUrl(
    'https://rausgegangen.de/media/programm.pdf',
  ) === 'https://rausgegangen.de/media/programm.pdf',
  'pdf on rausgegangen stays',
);

const grounding = [
  'https://rausgegangen.de/lubeck/',
  found,
  'https://eventim.de/chaos',
];
assert(
  pickGroundingEventUrl(grounding, {
    title: 'Chaos Comedy Club | Lübeck',
    venue: 'Theaterschiff',
    city: 'Lübeck',
  }) === found,
  'grounding detail beats city listing',
);

const overlaid = overlayGroundingEventUrls(
  [
    {
      title: 'Chaos Comedy Club',
      venue: 'Theaterschiff Lübeck',
      infoUrl: 'https://rausgegangen.de/lubeck/',
      ticketUrl: null,
    },
  ],
  grounding,
  'Lübeck',
);
assert(overlaid[0]?.infoUrl === found, 'overlay puts found page on event');

assert(
  extractHttpUrlsFromText(`siehe ${found} extra.`).includes(found),
  'urls from model text',
);


assert(
  isGenericEventListingUrl('https://www.hamburg.de/veranstaltungen/'),
  'hamburg.de veranstaltungen is listing',
);
assert(
  isGenericEventListingUrl('https://www.hamburg.de/'),
  'hamburg.de root is listing',
);
assert(
  keepFoundEventUrl('https://www.hamburg.de/veranstaltungen/') === null,
  'hamburg listing not kept as Programm',
);
assert(
  !isGenericEventListingUrl(
    'https://www.hamburg.de/contentblob/123456/data/weinfest-flyer.pdf',
  ),
  'deep hamburg path not treated as shallow listing',
);


assert(
  isJunkEventInfoUrl(
    'https://bildungsserver.hamburg.de/themenschwerpunkte/suchtpraevention/alkohol/759230-759230',
  ),
  'bildungsserver alcohol page is junk',
);
assert(
  keepFoundEventUrl(
    'https://bildungsserver.hamburg.de/themenschwerpunkte/suchtpraevention/alkohol/759230-759230',
  ) === null,
  'junk not kept',
);
assert(
  !eventUrlMatchesHints(
    'https://bildungsserver.hamburg.de/themenschwerpunkte/suchtpraevention/alkohol/759230-759230',
    { title: 'Eppendorfer Weinfest', venue: 'Eppendorf', city: 'Hamburg' },
  ),
  'weinfest does not match suchtpraevention',
);
assert(
  resolveEventInfoUrl({
    candidate:
      'https://bildungsserver.hamburg.de/themenschwerpunkte/suchtpraevention/alkohol/759230-759230',
    hints: { title: 'Eppendorfer Weinfest', venue: 'Eppendorf' },
  }) === null,
  'resolve drops junk candidate',
);
assert(
  isCoordsOnlyMapsUrl(
    'https://www.google.com/maps/search/?api=1&query=53.59,9.99',
  ),
  'bare coords maps',
);
assert(
  !looksLikeGooglePlaceId('pack:prisdorf_heimatverein'),
  'pack ids are not google places',
);
assert(
  looksLikeGooglePlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4'),
  'classic ChIJ place id',
);
assert(
  !isEstablishedGoogleMapsPlaceUrl(
    'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent('Heimatverein für Dorfgemeinschaft Prisdorf von 1967'),
  ),
  'name search is not a listed place',
);
assert(
  isEstablishedGoogleMapsPlaceUrl(
    'https://www.google.com/maps/search/?api=1&query=Bäcker%20Schlüter&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
  ),
  'place_id search is listed',
);
assert(
  !isEstablishedGoogleMapsPlaceUrl(
    'https://www.google.com/maps/place/' +
      encodeURIComponent('Eisenbahnbrücke am Hudenbarg'),
  ),
  '/maps/place/ without place id is name search',
);
assert(
  pickNearbyListedGooglePlace({
    queryName: 'Eisenbahnbrücke am Hudenbarg',
    hits: [
      {
        placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        name: 'Eisenbahnhochbrücke Hochdonn',
        distanceM: 62_000,
      },
    ],
  }) === null,
  'famous namesake far away is not this pin',
);
assert(
  pickNearbyListedGooglePlace({
    queryName: 'Bäcker Schlüter',
    hits: [
      {
        placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        name: 'Bäckerei Schlüter',
        distanceM: 18,
      },
    ],
  })?.placeId === 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  'nearby listed bakery keeps maps',
);
assert(
  pickNearbyListedGooglePlace({
    queryName: 'DHL Packstation 123',
    hits: [
      {
        placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        name: 'DHL',
        distanceM: 18,
      },
    ],
  }) === null,
  'nearby DHL office is not the packstation',
);
assert(
  pickNearbyListedGooglePlace({
    queryName: 'DHL Packstation 123',
    hits: [
      {
        placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        name: 'DHL Packstation 123',
        distanceM: 40,
      },
    ],
  })?.name === 'DHL Packstation 123',
  'listed locker at the pin keeps maps',
);
assert(
  buildNamedPlaceMapsUrl({ placeName: 'Walters Reben', city: 'Hamburg' }) ===
    null,
  'no maps without google place id',
);
assert(
  mapsUrlForGooglePlace({
    placeName: 'Walters Reben',
    city: 'Hamburg',
    placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  })?.includes('query_place_id=') === true,
  'maps url with place id',
);
assert(
  buildNamedPlaceMapsUrl({ placeName: '53.5,10.0' }) === null,
  'no maps for coord string',
);
assert(
  sanitizeMapsPlaceQuery(
    'Eppendorfer Achtel ist super und ich würde dir empfehlen dahin zu gehen',
  ) === 'Eppendorfer Achtel',
  'prose → place name only',
);
assert(
  rewriteGoogleMapsOpenUrl({
    url:
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(
        'Hier ist ein langer Text über das Weinfest und warum du hingehen sollst',
      ),
    destName: 'Eppendorfer Achtel',
  }).replace(/\+/g, '%20') ===
    'https://www.google.com/maps/search/?api=1&query=Eppendorfer%20Achtel',
  'rewrite maps url to destName',
);
assert(
  rewriteGoogleMapsOpenUrl({
    url:
      'https://www.google.com/maps/place/B%C3%A4cker+Schl%C3%BCter/@53.5,9.9,17z',
    destName: 'Heimatverein für Dorfgemeinschaft Prisdorf von 1967',
  }).includes('/maps/place/'),
  'rewrite keeps listed /maps/place/ urls',
);

assert(
  resolveEventInfoUrl({
    candidate:
      'https://rausgegangen.de/events/hamburg-eppendorfer-weinfest-2025/',
    hints: { title: 'Eppendorfer Weinfest', venue: 'Eppendorf', city: 'Hamburg' },
  }) ===
    'https://rausgegangen.de/events/hamburg-eppendorfer-weinfest-2025/',
  'weinfest detail kept with event title',
);
assert(
  resolveEventInfoUrl({
    candidate:
      'https://rausgegangen.de/events/hamburg-eppendorfer-weinfest-2025/',
    hints: { title: 'Rathausmarkt', venue: 'Rathausmarkt' },
  }) === null,
  'venue-as-title must NOT keep weinfest URL (Programm-Filter-Regression)',
);
assert(
  resolveEventInfoUrl({
    candidate:
      'https://rausgegangen.de/events/hamburg-eppendorfer-weinfest-2025/',
    hints: { title: '🌐 Programm', venue: 'Rathausmarkt' },
  }) === null,
  'button label must NOT act as title hint',
);

const always = resolveEventProgramLink({
  candidate: null,
  hints: {
    title: 'Eppendorfer Achte',
    venue: 'Eppendorf',
    city: 'Hamburg',
  },
});
assert(always.kind === 'search', 'fallback is search');
assert(/^https:\/\/www\.google\.com\/search\?q=/i.test(always.url), 'google search url');
assert(/Infos|Programm/i.test(always.label), 'fallback label');
assert(
  decodeURIComponent(always.url).includes('Eppendorfer'),
  'search contains title',
);

const pageLink = resolveEventProgramLink({
  candidate:
    'https://rausgegangen.de/events/hamburg-eppendorfer-weinfest-2025/',
  hints: { title: 'Eppendorfer Weinfest', venue: 'Eppendorf', city: 'Hamburg' },
});
assert(pageLink.kind === 'page', 'real page preferred');
assert(/Programm/i.test(pageLink.label), 'page label');

assert(
  buildEventInfoSearchFallbackUrl({
    title: 'Testfest',
    city: 'Hamburg',
  }).includes('Testfest'),
  'search builder',
);

console.log('eventInfoUrl.test.ts OK');
