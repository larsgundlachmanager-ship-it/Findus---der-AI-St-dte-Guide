import type { Poi } from '../../db/types';
import { isTransitMapPoi } from './homeMapTransit';

function blobOf(poi: Poi): string {
  return `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
}

function hasOsmOrDirectoryTag(poi: Poi): boolean {
  const raw = poi.tags_json ?? '';
  return (
    /directory|tier4|offline_lookup|osm_map|touristic/i.test(raw) ||
    /\b(briefkasten|packstation|postfiliale|kiosk|tankstelle|apotheke|kindergarten|kita)\b/i.test(
      blobOf(poi),
    )
  );
}

const STREET_AMENITY_RE =
  /\b(briefkasten|packstation|postfiliale|post_box|mailbox|dhl|paketautomat|parcel.?locker)\b/i;
const PARKING_RE = /\b(parkplatz|parkhaus|parking|p\+\s*r)\b/i;
const RAIL_STOP_RE = /\b(bahnhof|haltepunkt|hbf|railway|train)\b/i;
const BUS_STOP_RE = /\b(bushaltestelle|busbahnhof|bus\s*stop|haltestelle)\b/i;
const FUEL_RE = /\b(tankstelle|fuel|petrol|gas\s*station)\b/i;
const PHARMACY_RE = /\b(apotheke|pharmacy)\b/i;
const TOILET_RE = /\b(toilette|\bwc\b|restroom|public.?toilet)\b/i;
const INFO_RE =
  /\b(tourist.?info|touristen.?information|information.?office|i-punkt)\b/i;
const VIEWPOINT_RE = /\b(aussichtspunkt|viewpoint|panorama)\b/i;
const WATER_RE =
  /\b(trinkwasser|drinking.?water|wasserspender|wasser.?spender|trinkbrunnen|drinking.?fountain|water.?refill|brunnen)\b/i;
const DOCTOR_RE =
  /\b(zahnarzt|zahnärztin|zahnaerztin|arztpraxis|hausarzt|\bärzte\b|\baerzte\b|\barzt\b|ärztin|aerztin|doctors?|dentist|\bpraxis\b)\b/i;
const LANDSCAPE_NOT_PIN_RE =
  /\b(niederung|auenlandschaft|landschaftsschutz|ffh[- ]?gebiet|naturgebiet|marsch|auen\b)\b/i;
const BIKE_RE = /\b(fahrradverleih|bike.?rental|bicycle.?rental|mietrad)\b/i;
const FERRY_RE = /\b(fähre|faehre|ferry|anleger)\b/i;
const SUPERMARKET_RE =
  /\b(supermarkt|supermarket|discounter|verbrauchermarkt|hypermarkt|grocery|edeka|rewe|aldi|lidl|penny|netto|norma|kaufland|marktkauf|famila|konsum|frischecenter)\b/i;
const KIOSK_RE =
  /\b(kiosk|trinkhalle|späti|spaeti|spätkauf|spaetkauf|zeitungsladen)\b/i;
const BAR_RE =
  /\b(kneipe|pubs?|cocktailbars?|weinbars?|bierbars?|sportsbars?|nachtbars?|nightclubs?|nachtclubs?)\b|\bbar\b/i;
const RESTAURANT_RE =
  /\b(restaurants?|gaststätte|gaststaette|gasthof|pizzeria|trattoria|bistro|imbiss|steakhouse|gastwirtschaft)\b/i;
const KITA_RE =
  /\b(kindergarten|kita|krippe|kindertagesstätte|kindertagesstaette|kindertagespflege)\b/i;
const PARK_RE =
  /\b(stadtpark|volkspark|schlosspark|kurpark|waldpark|grünanlage|gruenanlage|park)\b/i;
const CAMPING_RE =
  /\b(campingplatz|camping|zeltplatz|campground|campsite|zeltwiese)\b/i;
const HOSTEL_RE = /hostel|herberge/i;
const HOTEL_RE =
  /hotel|motel|\bpension(?:en)?\b|\bunterkunft\b|\bgasthaus\b/i;
const ATTRACTION_RE =
  /sehensw(?:ü|ue)?rdigkeit|tourist(?:ic)?[- ]?attraction|\battractions?\b|sightseeing|denkmal|ehrenmal|monument|\blandmark\b|\bstatue\b|skulptur|kunstwerk|leuchtturm/i;
const MUSEUM_RE = /museum|museen/i;
const CINEMA_RE = /kino|cinema|filmtheater|lichtspiel/i;
const THEATER_RE =
  /theater|theatre|schauspielhaus|opernhaus|\boper\b/i;
const CAFE_RE =
  /café|cafes?|\bkaffee|\bcoffee|espresso|teestube/i;
const BAKERY_RE =
  /bäckerei|baeckerei|\bbäcker\b|\bbaecker\b|\bbakery\b|backstube|konditorei/i;
const ATM_RE =
  /\b(geldautomat|bankomat|\batm\b|geldausgabe|bargeldautomat|sparkasse|volksbank|commerzbank|deutsche\s+bank|\bbank\b|bankfiliale|sb-?filiale)\b/i;
const SOUVENIR_RE =
  /\b(souvenir(?:shop|laden)?|andenken(?:laden)?|geschenkartikel|postkartenladen|magnet(?:e|shop)|tourist(?:en)?[- ]?(?:shop|laden)|gift[- ]?shop)\b/i;
const SOUVENIR_EXCLUDE_RE =
  /\b(barf|messer|knife|knives|hundefutter|tierbedarf|wohnaccessoires|feines\s+leben)\b/i;
const CIVIC_RE =
  /\b(bürgerservice|buergerservice|einwohnermelde|rathaus|gemeindeverwaltung|bürgerbüro|buergerbuero)\b/i;
const NATURE_RE =
  /natur|stadtwald|auwald|\bwald\b|forst|düne|duene|\bwatt\b|heide|\bmoor\b|wildpark/i;
const VERWALTUNG_NOISE_RE =
  /\b(verwaltung|gemeindezentrum|feuerwache|bauhof|bilsbekraum)\b/i;
const HISTORIC_RE =
  /historisch|historic|\barchiv\b|heimatstube|geschichtspfad|ortschronik|heimatverein/i;
const ACTIVITY_RE =
  /\b(minigolf|beach\s*volley|wasserski|wakeboard|klettern|bouldern|escape|aktivität|aktivitaet|erlebnis)\b/i;

/** OSM-Piktogramme — selbst gezeichnet, kein Liberty-Sprite (wirkt wie Minus). */
export type HomeMapPlaceIcon =
  | 'rail'
  | 'bus'
  | 'parking'
  | 'post'
  | 'fuel'
  | 'pharmacy'
  | 'toilet'
  | 'info'
  | 'viewpoint'
  | 'water'
  | 'bike'
  | 'ferry'
  | 'doctor'
  | 'supermarket'
  | 'kiosk'
  | 'bar'
  | 'restaurant'
  | 'park'
  | 'camping'
  | 'hotel'
  | 'hostel'
  | 'attraction'
  | 'museum'
  | 'cinema'
  | 'theater'
  | 'cafe'
  | 'bakery'
  | 'atm'
  | 'souvenir'
  | 'nature'
  | 'historic'
  | 'activity';

export const HOME_MAP_PLACE_ICON_IDS: HomeMapPlaceIcon[] = [
  'rail',
  'bus',
  'parking',
  'post',
  'fuel',
  'pharmacy',
  'toilet',
  'info',
  'viewpoint',
  'water',
  'bike',
  'atm',
  'ferry',
  'doctor',
  'supermarket',
  'kiosk',
  'bar',
  'restaurant',
  'park',
  'camping',
  'hotel',
  'hostel',
  'attraction',
  'museum',
  'cinema',
  'theater',
  'cafe',
  'bakery',
  'souvenir',
  'nature',
  'historic',
  'activity',
];

/** Briefkasten, WC, Wasser, Arzt, Apotheke — erst ab Street-Zoom. */
export const HOME_MAP_STREET_AMENITY_ICONS: HomeMapPlaceIcon[] = [
  'parking',
  'post',
  'fuel',
  'pharmacy',
  'toilet',
  'info',
  'viewpoint',
  'water',
  'bike',
  'atm',
  'doctor',
  'supermarket',
  'kiosk',
  'bar',
  'restaurant',
  'park',
  'camping',
  'hotel',
  'hostel',
  'attraction',
  'museum',
  'cinema',
  'theater',
  'cafe',
  'bakery',
  'souvenir',
  'nature',
  'historic',
  'activity',
];

/** Bahnhof / Bus / Fähre — auch in der Übersicht. */
export const HOME_MAP_TRANSIT_ICONS: HomeMapPlaceIcon[] = [
  'rail',
  'bus',
  'ferry',
];

/** Park / Natur — erst ganz nah. */
export const HOME_MAP_PARK_ICONS: HomeMapPlaceIcon[] = ['park', 'nature'];

/**
 * Zoom-LOD für Amenity-Icons — Karte nicht mit Alltag/Gastro überladen.
 * transit → highlight → gastroTop → everyday → gastro → micro → park
 */
export type HomeMapIconLod =
  | 'transit'
  | 'highlight'
  | 'gastroTop'
  | 'everyday'
  | 'gastro'
  | 'micro'
  | 'park';

export const HOME_MAP_ICON_LOD_ZOOM = {
  transit: { goneAt: 9.4 },
  highlight: { goneAt: 11.0 },
  gastroTop: { goneAt: 11.8 },
  everyday: { goneAt: 12.6 },
  gastro: { goneAt: 13.4 },
  micro: { goneAt: 14.2 },
  park: { goneAt: 14.0 },
} as const;

const MICRO_ICONS = new Set<HomeMapPlaceIcon>([
  'post',
  'doctor',
  'parking',
]);
const EVERYDAY_ICONS = new Set<HomeMapPlaceIcon>([
  'atm',
  'pharmacy',
  'toilet',
  'supermarket',
  'bakery',
  'cafe',
  'kiosk',
  'fuel',
  'info',
  'water',
  'bike',
]);
const HIGHLIGHT_ICONS = new Set<HomeMapPlaceIcon>([
  'museum',
  'attraction',
  'hotel',
  'hostel',
  'viewpoint',
  'historic',
  'activity',
  'souvenir',
  'cinema',
  'theater',
  'camping',
]);
const GASTRO_ICONS = new Set<HomeMapPlaceIcon>(['restaurant', 'bar']);

/** Empfohlene Gastro früher sichtbar (Gasthof/Hotel/Story), Rest erst nah. */
export function isGastroMapHighlight(poi: Poi): boolean {
  const blob = blobOf(poi);
  if (HOTEL_RE.test(blob) || HOSTEL_RE.test(blob)) return true;
  if (/\bgasthof\b/i.test(blob)) return true;
  if (/\breview_facet\b/i.test(poi.tags_json ?? '') && /goldschätzchen|goldschaetzchen|hoyers/i.test(blob)) {
    return true;
  }
  const tier = Number(
    (poi.tags_json ?? '').match(/"place_tier"\s*:\s*(\d)/)?.[1] ??
      (poi.tags_json ?? '').match(/\btier([12])\b/)?.[1],
  );
  if (tier === 1 || tier === 2) return true;
  return false;
}

export function homeMapIconLod(
  icon: HomeMapPlaceIcon | string | null | undefined,
  poi?: Poi | null,
): HomeMapIconLod {
  if (!icon) return 'micro';
  if ((HOME_MAP_TRANSIT_ICONS as string[]).includes(icon)) return 'transit';
  if ((HOME_MAP_PARK_ICONS as string[]).includes(icon)) return 'park';
  if (MICRO_ICONS.has(icon as HomeMapPlaceIcon)) return 'micro';
  if (EVERYDAY_ICONS.has(icon as HomeMapPlaceIcon)) return 'everyday';
  if (HIGHLIGHT_ICONS.has(icon as HomeMapPlaceIcon)) return 'highlight';
  if (GASTRO_ICONS.has(icon as HomeMapPlaceIcon)) {
    return poi && isGastroMapHighlight(poi) ? 'gastroTop' : 'gastro';
  }
  return 'everyday';
}

function isRealSouvenirPoi(poi: Poi, blob: string): boolean {
  if (SOUVENIR_EXCLUDE_RE.test(blob)) return false;
  const name = poi.name ?? '';
  if (SOUVENIR_RE.test(name)) return true;
  if (SOUVENIR_RE.test(blob) && /souvenir|andenken|gift/i.test(name)) return true;
  return false;
}

const SHELTER_BUILDING_RE =
  /\b(wartehäuschen|wartehaeuschen|bahnwartehäuschen|bahnwartehaeuschen|shelter|unterstand)\b/i;

/** Halt / Bahnhof im Namen — der Stopp selbst, nicht das Wartehäuschen. */
const NAMED_TRANSIT_STOP_RE =
  /\b(haltepunkt|haltestelle|bushaltestelle|busbahnhof|bahnhof|hbf)\b/i;

/** Eisenbahnbrücke / Unterführung: immer Punkt auf der Kreuzung, kein Gebäude-Snap. */
export function isMapCrossingKeepDotPoi(poi: Poi): boolean {
  return /eisenbahn(brücke|bruecke|überführung|ueberfuehrung|unterführung|unterfuehrung)/i.test(
    poi.name ?? '',
  );
}

/** Bahnhof, Halt, Parkplatz, Briefkasten, Toilette, … — Icon statt Punkt. */
export function placeMapIcon(poi: Poi): HomeMapPlaceIcon | null {
  if (isMapShelterBuildingPoi(poi)) return null;
  const blob = blobOf(poi);
  if (isMapCrossingKeepDotPoi(poi)) return null;
  if (PARKING_RE.test(blob)) return 'parking';
  if (STREET_AMENITY_RE.test(blob)) return 'post';
  if (FUEL_RE.test(blob)) return 'fuel';
  if (DOCTOR_RE.test(blob)) return 'doctor';
  if (PHARMACY_RE.test(blob)) return 'pharmacy';
  if (ATM_RE.test(blob)) return 'atm';
  if (SUPERMARKET_RE.test(blob)) return 'supermarket';
  if (KIOSK_RE.test(blob)) return 'kiosk';
  if (isRealSouvenirPoi(poi, blob)) return 'souvenir';
  if (BAKERY_RE.test(blob)) return 'bakery';
  if (CAFE_RE.test(blob)) return 'cafe';
  if (BAR_RE.test(blob)) return 'bar';
  if (RESTAURANT_RE.test(blob)) return 'restaurant';
  if (KITA_RE.test(blob)) return null;
  if (CAMPING_RE.test(blob)) return 'camping';
  if (HOSTEL_RE.test(blob)) return 'hostel';
  if (HOTEL_RE.test(blob)) return 'hotel';
  if (MUSEUM_RE.test(blob)) return 'museum';
  if (CINEMA_RE.test(blob)) return 'cinema';
  if (THEATER_RE.test(blob)) return 'theater';
  if (ATTRACTION_RE.test(blob)) return 'attraction';
  if (HISTORIC_RE.test(blob) && !isTransitMapPoi(poi)) return 'historic';
  if (
    CIVIC_RE.test(blob) ||
    (VERWALTUNG_NOISE_RE.test(blob) &&
      !PARK_RE.test(blob) &&
      !MUSEUM_RE.test(blob))
  ) {
    return CIVIC_RE.test(blob) ? 'info' : null;
  }
  if (PARK_RE.test(blob)) return 'park';
  // Tag „natur“ allein (z. B. an Verwaltung) darf kein Berg-Icon triggern
  if (
    NATURE_RE.test(blob) &&
    !VERWALTUNG_NOISE_RE.test(blob) &&
    !/\bverwaltung\b/i.test(poi.category ?? '')
  ) {
    return 'nature';
  }
  if (ACTIVITY_RE.test(blob)) return 'activity';
  if (TOILET_RE.test(blob)) return 'toilet';
  if (INFO_RE.test(blob)) return 'info';
  if (VIEWPOINT_RE.test(blob)) return 'viewpoint';
  if (WATER_RE.test(blob)) return 'water';
  if (BIKE_RE.test(blob)) return 'bike';
  if (FERRY_RE.test(blob)) return 'ferry';
  if (isTransitMapPoi(poi) && RAIL_STOP_RE.test(blob)) return 'rail';
  if (isTransitMapPoi(poi) && BUS_STOP_RE.test(blob)) return 'bus';
  return null;
}

/** Briefkasten, Toilette, Info, Aussicht, Wasser, Mietrad — immer auf der Karte. */
export function isAlwaysOnMapAmenity(poi: Poi): boolean {
  const blob = blobOf(poi);
  return (
    STREET_AMENITY_RE.test(blob) ||
    TOILET_RE.test(blob) ||
    INFO_RE.test(blob) ||
    VIEWPOINT_RE.test(blob) ||
    WATER_RE.test(blob) ||
    ATM_RE.test(blob) ||
    BIKE_RE.test(blob) ||
    FERRY_RE.test(blob) ||
    PHARMACY_RE.test(blob) ||
    SUPERMARKET_RE.test(blob) ||
    KIOSK_RE.test(blob) ||
    (isRealSouvenirPoi(poi, blob) && SOUVENIR_RE.test(blob)) ||
    BAKERY_RE.test(blob) ||
    CAFE_RE.test(blob) ||
    BAR_RE.test(blob) ||
    RESTAURANT_RE.test(blob) ||
    PARK_RE.test(blob) ||
    (NATURE_RE.test(blob) &&
      !VERWALTUNG_NOISE_RE.test(blob) &&
      !/\bverwaltung\b/i.test(poi.category ?? '')) ||
    (HISTORIC_RE.test(blob) && !isTransitMapPoi(poi)) ||
    ACTIVITY_RE.test(blob) ||
    CAMPING_RE.test(blob) ||
    HOSTEL_RE.test(blob) ||
    HOTEL_RE.test(blob) ||
    MUSEUM_RE.test(blob) ||
    CINEMA_RE.test(blob) ||
    THEATER_RE.test(blob) ||
    ATTRACTION_RE.test(blob) ||
    DOCTOR_RE.test(blob)
  );
}

/** Auen/Niederung ohne echtes Gebäude — kein Dreieck-Pin. */
export function isNatureLandscapeNotPin(poi: Poi): boolean {
  const blob = blobOf(poi);
  if (/\b(aussichtspunkt|viewpoint)\b/i.test(blob)) return false;
  return LANDSCAPE_NOT_PIN_RE.test(blob);
}

/**
 * Wartehäuschen / Shelter: kleines Gebäude, kein ÖPNV-Punkt.
 * Auch als Sub-POI (Parent bleibt der Halt).
 */
export function isMapShelterBuildingPoi(poi: Poi): boolean {
  if (!SHELTER_BUILDING_RE.test(blobOf(poi))) return false;
  if ((poi.kind ?? '') === 'sub') return true;
  return !NAMED_TRANSIT_STOP_RE.test(poi.name ?? '');
}

/**
 * Haltepunkt / Bahnhof / Bushaltestelle bleiben Punkte — nie Bahnsteig-Fill.
 * Der OSM-Umriss ist oft 200–400 m lang und lässt den Pin kurz aufblitzen, dann
 * als unsichtbare Fläche entlang der Gleise verschwinden.
 * Wartehäuschen daneben bleibt Gebäude — beides gleichzeitig.
 * Eisenbahnbrücke = Punkt auf der Straße unter den Gleisen.
 */
export function isKeepDotMapPoi(poi: Poi): boolean {
  if (isMapShelterBuildingPoi(poi)) return false;
  if (isAlwaysOnMapAmenity(poi)) return true;
  if (placeMapIcon(poi)) return true;
  if (isMapCrossingKeepDotPoi(poi)) return true;
  return isTransitMapPoi(poi);
}

/** Typ-Chip für die Orte-Filter (kein Status). */
export function homeMapTypeFilterId(poi: Poi): string | null {
  if (isTransitMapPoi(poi)) return 'transit';
  const blob = blobOf(poi);
  if (
    /\b(restaurant|gastro|fisch|imbiss|pizzeria|bistro|essen|gaststätte|gaststaette|gasthof)\b/i.test(
      blob,
    )
  ) {
    return 'restaurant';
  }
  if (/\b(café|cafe|kaffee|tea|teestube|bäckerei|baeckerei|bäcker|baecker|bakery)\b/i.test(blob)) {
    return 'cafe';
  }
  if (/\b(museum)\b/i.test(blob)) return 'museum';
  if (
    /\b(galerie|kunst|denkmal|kultur|theater|kino|kirche|kapelle|kloster|dom\b|ausstellung)\b/i.test(
      blob,
    )
  ) {
    return 'kultur';
  }
  if (/\b(hotel|hostel|pension|unterkunft)\b/i.test(blob)) return 'hotel';
  if (
    /\b(einkauf|laden|shop|markt|supermarket|supermarkt|discounter|edeka|rewe|aldi|lidl)\b/i.test(
      blob,
    )
  ) {
    return 'einkaufen';
  }
  if (
    /\b(minigolf|beach\s*volley|wasserski|wakeboard|klettern|bouldern|escape|aktivität|aktivitaet|erlebnis)\b/i.test(
      blob,
    )
  ) {
    return 'aktivitaet';
  }
  if (
    /\b(freizeit|sport|spielplatz|bowling|bad\b|strand|zoo|tierpark|stadion)\b/i.test(
      blob,
    )
  ) {
    return 'freizeit';
  }
  if (/\b(park\b|garten|natur|düne|duene|watt|aussicht|wald|viewpoint)\b/i.test(blob)) {
    return 'natur';
  }
  if (
    /\b(apotheke|kindergarten|kita|schule|supermarkt|alltag|toilette|\bwc\b|tourist.?info)\b/i.test(
      blob,
    ) ||
    hasOsmOrDirectoryTag(poi)
  ) {
    return 'alltag';
  }
  return null;
}
