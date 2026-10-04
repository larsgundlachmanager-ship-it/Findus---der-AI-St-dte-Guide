from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapPlaceType.ts")
t = p.read_text(encoding="utf-8")

old = r"""const BIKE_RE = /\b(fahrradverleih|bike.?rental|bicycle.?rental|mietrad)\b/i;
const FERRY_RE = /\b(fähre|faehre|ferry|anleger)\b/i;"""
new = r"""const BIKE_RE = /\b(fahrradverleih|bike.?rental|bicycle.?rental|mietrad|radwerkstatt|fahrradladen)\b/i;
const LUGGAGE_RE =
  /\b(gepäckaufbewahrung|gepaeckaufbewahrung|gepäck|gepaeck|left.?luggage|luggage.?storage|schließfach|schliessfach|lockers?)\b/i;
const LAUNDRY_RE =
  /\b(waschsalon|wäscherei|waescherei|laundry|laundromat|waschmaschine)\b/i;
const CHARGING_RE =
  /\b(ladestation|ladesäule|ladesaeule|charging.?station|e-?lade|ev.?charging)\b/i;
const CAR_RENTAL_RE =
  /\b(autoverleih|mietwagen|car.?rental|carsharing|car.?sharing|sixt|europcar)\b/i;
const SCOOTER_RE =
  /\b(rollerverleih|scooter.?rental|motorcycle.?rental|vespa.?verleih)\b/i;
const BEACH_RE = /\b(strand|beach|badenstrand|badestrand)\b/i;
const FX_RE =
  /\b(wechselstube|geldwechsel|bureau.?de.?change|currency.?exchange)\b/i;
const ICE_RE = /\b(eisdiele|eiscafé|eiscafe|ice.?cream|gelateria)\b/i;
const PICNIC_RE = /\b(picknick|picnic)\b/i;
const FERRY_RE = /\b(fähre|faehre|ferry|anleger)\b/i;"""
if old not in t:
    raise SystemExit("BIKE_RE block not found")
t = t.replace(old, new, 1)

old2 = """  | 'activity';

export const HOME_MAP_PLACE_ICON_IDS: HomeMapPlaceIcon[] = ["""
new2 = """  | 'activity'
  | 'luggage'
  | 'laundry'
  | 'charging';

export const HOME_MAP_PLACE_ICON_IDS: HomeMapPlaceIcon[] = ["""
if old2 not in t:
    raise SystemExit("type union not found")
t = t.replace(old2, new2, 1)

# First IDS occurrence (HOME_MAP_PLACE_ICON_IDS)
idx = t.find("export const HOME_MAP_PLACE_ICON_IDS")
idx2 = t.find("export const HOME_MAP_STREET_AMENITY_ICONS")
block = t[idx:idx2]
old3 = """  'historic',
  'activity',
];
"""
new3 = """  'historic',
  'activity',
  'luggage',
  'laundry',
  'charging',
];
"""
if old3 not in block:
    raise SystemExit("IDS array not found")
t = t[:idx] + block.replace(old3, new3, 1) + t[idx2:]

idx3 = t.find("export const HOME_MAP_STREET_AMENITY_ICONS")
idx4 = t.find("/** Bahnhof / Bus")
block2 = t[idx3:idx4]
if old3 not in block2:
    raise SystemExit("STREET list not found")
t = t[:idx3] + block2.replace(old3, new3, 1) + t[idx4:]

old5 = """const MICRO_ICONS = new Set<HomeMapPlaceIcon>([
  'parking',
  'toilet',
  'water',
  'atm',
  'pharmacy',
]);
const EVERYDAY_ICONS = new Set<HomeMapPlaceIcon>([
  'supermarket',
  'bakery',
  'cafe',
  'kiosk',
  'fuel',
  'info',
  'bike',
]);"""
new5 = """const MICRO_ICONS = new Set<HomeMapPlaceIcon>([
  'parking',
  'toilet',
  'water',
  'atm',
  'pharmacy',
  'charging',
  'luggage',
]);
const EVERYDAY_ICONS = new Set<HomeMapPlaceIcon>([
  'supermarket',
  'bakery',
  'cafe',
  'kiosk',
  'fuel',
  'info',
  'bike',
  'laundry',
]);"""
if old5 not in t:
    raise SystemExit("MICRO set not found")
t = t.replace(old5, new5, 1)

old6 = """  if (TOILET_RE.test(blob)) return 'toilet';
  if (PARKING_RE.test(blob)) return 'parking';
  if (STREET_AMENITY_RE.test(blob)) return 'post';
  if (FUEL_RE.test(blob)) return 'fuel';"""
new6 = """  if (TOILET_RE.test(blob)) return 'toilet';
  if (LUGGAGE_RE.test(blob)) return 'luggage';
  if (LAUNDRY_RE.test(blob)) return 'laundry';
  if (CHARGING_RE.test(blob)) return 'charging';
  if (PARKING_RE.test(blob) || /\\bparkplatz\\b/i.test(blob)) return 'parking';
  if (STREET_AMENITY_RE.test(blob) || /\\bpackstation\\b/i.test(blob)) return 'post';
  if (FUEL_RE.test(blob)) return 'fuel';
  if (FX_RE.test(blob)) return 'atm';
  if (ICE_RE.test(blob)) return 'cafe';
  if (PICNIC_RE.test(blob)) return 'park';
  if (BEACH_RE.test(blob)) return 'nature';
  if (CAR_RENTAL_RE.test(blob) || SCOOTER_RE.test(blob)) return 'activity';"""
if old6 not in t:
    raise SystemExit("placeMapIcon early not found")
t = t.replace(old6, new6, 1)

old7 = """    TOILET_RE.test(blob) ||
    PARKING_RE.test(blob) ||
    INFO_RE.test(blob) ||"""
new7 = """    TOILET_RE.test(blob) ||
    LUGGAGE_RE.test(blob) ||
    LAUNDRY_RE.test(blob) ||
    CHARGING_RE.test(blob) ||
    PARKING_RE.test(blob) ||
    INFO_RE.test(blob) ||"""
if old7 not in t:
    raise SystemExit("isStreetPoint not found")
t = t.replace(old7, new7, 1)

old8 = """    TOILET_RE.test(blob) ||
    INFO_RE.test(blob) ||
    VIEWPOINT_RE.test(blob) ||
    WATER_RE.test(blob) ||
    ATM_RE.test(blob) ||
    BIKE_RE.test(blob) ||"""
new8 = """    TOILET_RE.test(blob) ||
    LUGGAGE_RE.test(blob) ||
    LAUNDRY_RE.test(blob) ||
    CHARGING_RE.test(blob) ||
    INFO_RE.test(blob) ||
    VIEWPOINT_RE.test(blob) ||
    WATER_RE.test(blob) ||
    ATM_RE.test(blob) ||
    BIKE_RE.test(blob) ||
    BEACH_RE.test(blob) ||
    CAR_RENTAL_RE.test(blob) ||
    SCOOTER_RE.test(blob) ||"""
if old8 not in t:
    raise SystemExit("isAlwaysOn not found")
t = t.replace(old8, new8, 1)

p.write_text(t, encoding="utf-8")
print("homeMapPlaceType ok")
