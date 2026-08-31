/**
 * Run: npx --yes tsx src/services/homeMap/homeMapPlaceFilter.smoke.test.ts
 */

import type { Poi } from '../../db/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isAlwaysOnMapAmenity,
  isKeepDotMapPoi,
  isStreetPointAmenity,
  homeMapTypeFilterId,
  isMapShelterBuildingPoi,
  isMapCrossingKeepDotPoi,
  isNatureLandscapeNotPin,
  placeMapIcon,
} from './homeMapPlaceType';
import { isTransitMapPoi } from './homeMapTransit';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function poi(
  partial: Partial<Poi> & Pick<Poi, 'id' | 'name' | 'lat' | 'lng'>,
): Poi {
  return {
    radius_meters: 40,
    spot_key: `spot_${partial.id}`,
    parent_poi_id: null,
    kind: 'area',
    category: null,
    tags_json: null,
    polygon_json: null,
    teaser_text: null,
    condition_rule: 'always',
    special_radius_m: null,
    ...partial,
  };
}

const halt = poi({
  id: 1,
  name: 'Haltepunkt Priestewitz',
  lat: 51.25,
  lng: 13.63,
  category: 'haltepunkt',
  tags_json: JSON.stringify(['story']),
});
const bus = poi({
  id: 2,
  name: 'Bushaltestelle Markt',
  lat: 51.25,
  lng: 13.64,
});
const resto = poi({
  id: 3,
  name: 'Gasthof Löwe',
  lat: 51.25,
  lng: 13.65,
  category: 'restaurant',
});
const museum = poi({
  id: 4,
  name: 'Heimatmuseum',
  lat: 51.25,
  lng: 13.66,
  category: 'museum',
});

assert(isTransitMapPoi(halt), 'Haltepunkt ist ÖPNV');
assert(isTransitMapPoi(bus), 'Bushaltestelle ist ÖPNV');
assert(!isTransitMapPoi(resto), 'Restaurant ist kein ÖPNV');
assert(
  !isTransitMapPoi(
    poi({
      id: 77,
      name: 'Zahnarztpraxis Heilmann',
      lat: 53.67,
      lng: 9.76,
      category: 'gesundheit',
      tags_json: JSON.stringify(['bahnhof', 'gesundheit']),
    }),
  ),
  'Zahnarzt mit District-Tag bahnhof ≠ ÖPNV',
);
{
  const bulletsSrc = readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapPlaceBullets.ts'),
    'utf8',
  );
  assert(
    bulletsSrc.includes('Berufe/Orte vor Straßen-/Viertel-Tags'),
    'categoryFromName: Beruf vor bahnhof-Tag',
  );
  assert(
    bulletsSrc.includes('Nur echter Halt im Namen'),
    'categoryFromName: kein Bahnhofstraße-False-Positive',
  );
}
assert(isKeepDotMapPoi(halt), 'Haltepunkt bleibt Karten-Punkt');
assert(isKeepDotMapPoi(bus), 'Bushaltestelle bleibt Karten-Punkt');
assert(isKeepDotMapPoi(resto), 'Restaurant = Gabel-Messer-Icon');
assert(isStreetPointAmenity(halt), 'Halt = Punkt-Amenity');
assert(isStreetPointAmenity(poi({ id: 99, name: 'Briefkasten', lat: 53.67, lng: 9.76 })), 'Briefkasten = Punkt');
assert(!isStreetPointAmenity(resto), 'Restaurant ist kein Street-Punkt');
assert(!isStreetPointAmenity(museum), 'Museum ist kein Street-Punkt — Story darf Fill');

assert(placeMapIcon(resto) === 'restaurant', 'Gasthof = Restaurant-Icon');

const cabin = poi({
  id: 8,
  name: 'Historisches Bahnwartehäuschen',
  lat: 53.6756,
  lng: 9.76006,
  kind: 'sub',
  tags_json: JSON.stringify(['denkmal', 'architecture']),
});
const combinedHalt = poi({
  id: 9,
  name: 'Bahnhof Prisdorf und historisches Bahnwartehäuschen',
  lat: 53.67529,
  lng: 9.7602,
  category: 'bahnhof',
  tags_json: JSON.stringify(['story', 'wartehaeuschen']),
});
assert(isMapShelterBuildingPoi(cabin), 'Wartehäuschen-Sub ist Gebäude');
assert(!isKeepDotMapPoi(cabin), 'Wartehäuschen nicht als ÖPNV-Punkt');
assert(!isMapShelterBuildingPoi(combinedHalt), 'Halt-Parent bleibt Stopp, nicht Shelter');
assert(isKeepDotMapPoi(combinedHalt), 'Halt bleibt Punkt, auch wenn Wartehäuschen im Namen steht');

const bridge = poi({
  id: 10,
  name: 'Eisenbahnbrücke am Hudenbarg',
  lat: 53.67706,
  lng: 9.75621,
  category: 'aussicht',
  tags_json: JSON.stringify(['story', 'sourced_osm']),
});
assert(isMapCrossingKeepDotPoi(bridge), 'Eisenbahnbrücke ist Kreuzungs-Punkt');
assert(isKeepDotMapPoi(bridge), 'Eisenbahnbrücke bleibt Punkt auf den Gleisen');
assert(placeMapIcon(bridge) == null, 'Eisenbahnbrücke ohne Brücken-Icon');
assert(
  placeMapIcon(
    poi({
      id: 11,
      name: 'Kriegerehrenmal an der Bilsbekbrücke',
      lat: 53.68,
      lng: 9.757,
    }),
  ) === 'attraction',
  'Ehrenmal an einer Brücke = Kamera, nicht Brücke',
);

assert(homeMapTypeFilterId(halt) === 'transit', 'Typ ÖPNV');
assert(homeMapTypeFilterId(resto) === 'restaurant', 'Typ Restaurant');
assert(homeMapTypeFilterId(museum) === 'museum', 'Typ Museum');
assert(homeMapTypeFilterId(poi({
  id: 5,
  name: 'Wasserskischule',
  lat: 51.25,
  lng: 13.67,
  category: 'aktivität',
})) === 'aktivitaet', 'Typ Aktivitäten');
assert(
  placeMapIcon(
    poi({
      id: 5,
      name: 'Wasserskischule',
      lat: 51.25,
      lng: 13.67,
      category: 'aktivität',
    }),
  ) === 'activity',
  'Wasserski = Aktivitäts-Piktogramm, kein Text',
);
assert(
  placeMapIcon(
    poi({
      id: 6,
      name: 'Kindergarten Sonnenschein',
      lat: 51.25,
      lng: 13.68,
      tags_json: JSON.stringify(['directory']),
    }),
  ) == null,
  'Kita ohne Map-Icon',
);
assert(homeMapTypeFilterId(poi({
  id: 6,
  name: 'Kindergarten Sonnenschein',
  lat: 51.25,
  lng: 13.68,
  tags_json: JSON.stringify(['directory']),
})) === 'alltag', 'Kita ist Alltag');

assert(homeMapTypeFilterId(poi({
  id: 7,
  name: 'team Tankstelle Peiner Hag 1a',
  lat: 53.67295,
  lng: 9.7723,
  category: 'service',
  tags_json: JSON.stringify(['directory', 'tier4', 'map_outline']),
})) === 'alltag', 'Tankstelle ist Alltag');

assert(placeMapIcon(halt) === 'rail', 'Haltepunkt = Bahn-Icon');
assert(
  placeMapIcon(
    poi({
      id: 20,
      name: 'Bahnhof Prisdorf',
      lat: 53.67,
      lng: 9.76,
      category: 'bahnhof',
    }),
  ) === 'rail',
  'Bahnhof = Bahn-Icon',
);
assert(placeMapIcon(bus) === 'bus', 'Bushaltestelle = Bus-Icon');
assert(
  placeMapIcon(
    poi({
      id: 22,
      name: 'Briefkasten Deutsche Post',
      lat: 53.67,
      lng: 9.76,
      category: 'briefkasten',
      tags_json: JSON.stringify(['post_box', 'directory']),
    }),
  ) === 'post',
  'Briefkasten = Post-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 21,
      name: 'Parkplatz Bahnhof',
      lat: 53.67,
      lng: 9.76,
      category: 'parkplatz',
    }),
  ) === 'parking',
  'Parkplatz = P-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 40,
      name: 'Stadtpark',
      lat: 53.67,
      lng: 9.76,
      category: 'park',
    }),
  ) === 'park',
  'Stadtpark = Bank-und-Baum-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 50,
      name: 'Stadtwald',
      lat: 53.67,
      lng: 9.76,
      category: 'natur',
    }),
  ) === 'nature',
  'Stadtwald = Bäume, keine Parkbank',
);
assert(
  placeMapIcon(
    poi({
      id: 41,
      name: 'Campingplatz Pinnau',
      lat: 53.67,
      lng: 9.76,
      category: 'camping',
    }),
  ) === 'camping',
  'Campingplatz = Zelt-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 42,
      name: 'Hotel am Park',
      lat: 53.67,
      lng: 9.76,
      category: 'hotel',
    }),
  ) === 'hotel',
  'Hotel am Park = Bett-Icon, kein Park',
);
assert(
  placeMapIcon(
    poi({
      id: 43,
      name: 'Pension Elbblick',
      lat: 53.67,
      lng: 9.76,
      category: 'pension',
    }),
  ) === 'hotel',
  'Pension = Hotel-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 44,
      name: 'Jugendherberge Elbe',
      lat: 53.67,
      lng: 9.76,
      category: 'hostel',
    }),
  ) === 'hostel',
  'Jugendherberge = Stockbett, kein Hotel',
);
assert(
  placeMapIcon(
    poi({
      id: 45,
      name: 'Kriegerdenkmal',
      lat: 53.67,
      lng: 9.76,
      category: 'denkmal',
    }),
  ) === 'attraction',
  'Denkmal = Kamera-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 51,
      name: 'Historisches Rathaus',
      lat: 53.67,
      lng: 9.76,
      category: 'historisch',
    }),
  ) === 'historic',
  'Historisches Rathaus = Rolle und Feder',
);
assert(
  placeMapIcon(
    poi({
      id: 46,
      name: 'Sehenswürdigkeit Hafenkran',
      lat: 53.67,
      lng: 9.76,
      category: 'attraction',
    }),
  ) === 'attraction',
  'Sehenswürdigkeit = Kamera-Icon',
);
assert(
  placeMapIcon(museum) === 'museum',
  'Heimatmuseum = Tempel-Icon, keine Kamera',
);
assert(
  placeMapIcon(
    poi({
      id: 47,
      name: 'Kino Capitol',
      lat: 53.67,
      lng: 9.76,
      category: 'kino',
    }),
  ) === 'cinema',
  'Kino = Filmklappe',
);
assert(
  placeMapIcon(
    poi({
      id: 48,
      name: 'Stadttheater',
      lat: 53.67,
      lng: 9.76,
      category: 'theater',
    }),
  ) === 'theater',
  'Theater = Masken, keine Filmklappe',
);
assert(
  placeMapIcon(
    poi({
      id: 49,
      name: 'Café am Markt',
      lat: 53.67,
      lng: 9.76,
      category: 'cafe',
    }),
  ) === 'cafe',
  'Café = Tasse, kein Restaurant',
);
assert(
  isKeepDotMapPoi(
    poi({
      id: 21,
      name: 'Parkplatz Bahnhof',
      lat: 53.67,
      lng: 9.76,
      category: 'parkplatz',
    }),
  ),
  'Parkplatz bleibt Punkt unter dem P',
);

assert(
  placeMapIcon(
    poi({
      id: 23,
      name: 'Toilette am Bahnhof',
      lat: 53.67,
      lng: 9.76,
      category: 'toilette',
    }),
  ) === 'toilet',
  'Toilette = WC-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 24,
      name: 'Aussichtspunkt Elbe',
      lat: 53.67,
      lng: 9.76,
      category: 'aussicht',
    }),
  ) === 'viewpoint',
  'Aussicht = Berg-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 34,
      name: 'Wasserspender Marktplatz',
      lat: 53.67,
      lng: 9.76,
      category: 'drinking_water',
    }),
  ) === 'water',
  'Wasserspender = Glas-Icon',
);
assert(
  isAlwaysOnMapAmenity(
    poi({
      id: 35,
      name: 'Trinkbrunnen',
      lat: 53.67,
      lng: 9.76,
    }),
  ),
  'Trinkbrunnen immer auf der Karte',
);
assert(
  isAlwaysOnMapAmenity(
    poi({
      id: 25,
      name: 'Tourist-Info',
      lat: 53.67,
      lng: 9.76,
      category: 'tourist_info',
    }),
  ),
  'Tourist-Info immer auf der Karte',
);

assert(
  placeMapIcon(
    poi({
      id: 26,
      name: 'Hausarztpraxis am Markt',
      lat: 53.67,
      lng: 9.76,
      category: 'praxis',
    }),
  ) === 'doctor',
  'Arztpraxis = Arzt-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 36,
      name: 'REWE Prisdorf',
      lat: 53.67,
      lng: 9.76,
      category: 'supermarkt',
    }),
  ) === 'supermarket',
  'REWE = Supermarkt-Icon',
);
assert(
  isAlwaysOnMapAmenity(
    poi({
      id: 37,
      name: 'Aldi Nord',
      lat: 53.67,
      lng: 9.76,
    }),
  ),
  'Aldi immer auf der Karte',
);
assert(
  placeMapIcon(
    poi({
      id: 38,
      name: 'Kiosk am Bahnhof',
      lat: 53.67,
      lng: 9.76,
      category: 'kiosk',
    }),
  ) === 'kiosk',
  'Kiosk = Stand-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 39,
      name: 'Kneipe Zur Linde',
      lat: 53.67,
      lng: 9.76,
      category: 'bar',
    }),
  ) === 'bar',
  'Kneipe = Bar-Icon',
);
assert(
  isAlwaysOnMapAmenity(
    poi({
      id: 27,
      name: 'Apotheke am Bahnhof',
      lat: 53.67,
      lng: 9.76,
      category: 'apotheke',
    }),
  ),
  'Apotheke immer auf der Karte',
);
assert(
  isNatureLandscapeNotPin(
    poi({
      id: 28,
      name: 'Pinnau-Niederung an der südlichen Gemeindegrenze',
      lat: 53.67,
      lng: 9.76,
      category: 'aussicht',
    }),
  ),
  'Niederung kein Zählplatz-Pin',
);
assert(
  placeMapIcon(
    poi({
      id: 28,
      name: 'Pinnau-Niederung an der südlichen Gemeindegrenze',
      lat: 53.67,
      lng: 9.76,
      category: 'aussicht',
    }),
  ) !== 'viewpoint',
  'Niederung kein Aussicht-Dreieck',
);

assert(
  placeMapIcon(
    poi({
      id: 90,
      name: 'Sparkasse Südholstein Geldautomat Meyers Frischecenter',
      lat: 53.672,
      lng: 9.773,
      category: 'bank',
      tags_json: JSON.stringify(['directory', 'atm', 'bank']),
    }),
  ) === 'atm',
  'Bank/Geldautomat = ATM-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 91,
      name: 'Sparkasse Filiale',
      lat: 53.67,
      lng: 9.77,
      category: 'bank',
    }),
  ) === 'atm',
  'Bankfiliale = ATM-Icon',
);

assert(
  placeMapIcon(
    poi({
      id: 92,
      name: 'Bilsbekraum Bürgerservice',
      lat: 53.677,
      lng: 9.757,
      category: 'verwaltung',
      tags_json: JSON.stringify(['verwaltung', 'natur']),
    }),
  ) === 'info',
  'Bürgerservice = Info, kein Berg/Natur',
);
assert(
  placeMapIcon(
    poi({
      id: 93,
      name: 'nick-knives - Barf-Shop-Pinneberg',
      lat: 53.67,
      lng: 9.76,
      category: 'souvenir',
      tags_json: JSON.stringify(['souvenir', 'touristic']),
    }),
  ) == null,
  'Barf/Knives kein Souvenir-Icon',
);
assert(
  placeMapIcon(
    poi({
      id: 94,
      name: 'Souvenirshop Am Hafen',
      lat: 53.67,
      lng: 9.76,
      category: 'souvenir',
    }),
  ) === 'souvenir',
  'Echter Souvenirshop behält Icon',
);

console.log('homeMapPlaceFilter.smoke.test.ts OK');

