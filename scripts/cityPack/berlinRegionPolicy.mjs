/**
 * SSOT: Berlin-Region Pack-Familie (Paywall-fähig).
 *
 * - berlin-zentral  = Berlin Zentral (Base)
 * - berlin-umland   = Berlin Umland (Addon / später Paywall)
 * - potsdam         = Potsdam & Babelsberg (eigene Stadt)
 * - weitere Umland-Städte = eigenständige city_ids
 *
 * Strikte Trennung: kein Spot darf in Zentrum und Umland gleichzeitig liegen.
 */

/** Geographischer Kern: Charlottenburg ↔ Lichtenberg, Gesundbrunnen ↔ Schöneberg/Kreuzberg */
export const BERLIN_ZENTRUM_BBOX = {
  latMin: 52.478,
  latMax: 52.555,
  lngMin: 13.29,
  lngMax: 13.51,
};

/** Gesamtes Berlin + naher Stadtrand (Frohnau–Rudow, Gatow–Hellersdorf, Zehlendorf–Ahrensfelde) */
export const BERLIN_FULL_BBOX = {
  latMin: 52.338,
  latMax: 52.675,
  lngMin: 13.088,
  lngMax: 13.761,
};

/** Immer Zentrum (Highlights), auch wenn Pin knapp außerhalb der Box liegt */
export const BERLIN_ZENTRUM_FORCE_IDS = [
  'berlin_brandenburger_tor',
  'berlin_reichstagsgebaude',
  'berlin_berliner_fernsehturm',
  'berlin_museumsinsel',
  'berlin_berliner_dom',
  'berlin_checkpoint_charlie',
  'berlin_east_side_gallery',
  'berlin_denkmal_fur_die_ermordeten_juden_europas',
  'berlin_rotes_rathaus',
  'berlin_alexanderplatz',
  'berlin_humboldt_forum',
  'berlin_topographie_des_terrors',
  'berlin_schloss_charlottenburg',
  'berlin_kaiser_wilhelm_gedachtniskirche',
  'berlin_siegessaule',
  'berlin_unter_den_linden',
  'berlin_nikolaiviertel',
  'berlin_potsdamer_platz',
  'berlin_hackesche_hoefe',
  'berlin_neue_synagoge',
  'berlin_juedisches_museum_berlin',
  'berlin_deutsches_historisches_museum',
  'berlin_neues_museum',
  'berlin_altes_museum',
  'berlin_alte_nationalgalerie',
  'berlin_bode_museum',
  'berlin_pergamonmuseum_das_panorama',
  'berlin_zoologischer_garten_berlin',
  'berlin_grosser_tiergarten',
  'berlin_aussichtsturm_gedenkstatte_berliner_mauer',
  'berlin_konzerthaus_berlin',
  'berlin_deutsche_oper_berlin',
  'berlin_st_marienkirche',
  'berlin_franzosische_kirche_zu_berlin_hugenottenkirche',
  'berlin_mauerpark',
  'berlin_museum_fur_naturkunde',
];

/** Nie im Zentrum — gehören zu Umland / anderen Packs */
export const BERLIN_ZENTRUM_EXCLUDE_IDS = [
  'berlin_olympiastadion_berlin',
  'berlin_tempelhofer_feld',
  'berlin_garten_der_welt',
  'berlin_tierpark_berlin',
  'berlin_berlin_treptower_park',
  'berlin_berliner_mauerweg',
];

export const BERLIN_REGION_PACKS = {
  'berlin-zentral': {
    city_id: 'berlin-zentral',
    name: 'Berlin Zentral',
    product_tier: 'base',
    paywall: false,
    notes: 'Highlights Mitte/Kern: Charlottenburg–Lichtenberg, Gesundbrunnen–Schöneberg/Kreuzberg',
  },
  'berlin-umland': {
    city_id: 'berlin-umland',
    name: 'Berlin Umland',
    product_tier: 'addon',
    paywall: true,
    notes: 'Äußeres Berlin ohne Zentral-Orte — später extra freischalten',
  },
  potsdam: {
    city_id: 'potsdam',
    name: 'Potsdam',
    product_tier: 'city',
    paywall: false,
    notes: 'Potsdam & Babelsberg',
  },
};

/** Eigenständige Städte im weiteren Berlin-Umland (Tourismus) */
export const BERLIN_OUTLIER_CITIES = [
  { id: 'spreewald', city: 'Lübbenau', name: 'Spreewald', note: 'Lübbenau / Burg' },
  { id: 'beelitz', city: 'Beelitz', name: 'Beelitz', note: 'Beelitz-Heilstätten' },
  { id: 'oranienburg', city: 'Oranienburg', name: 'Oranienburg', note: 'Sachsenhausen, Schloss' },
  { id: 'werder', city: 'Werder (Havel)', name: 'Werder (Havel)', note: 'Inselstadt / Baumblüte' },
  { id: 'brandenburg_havel', city: 'Brandenburg an der Havel', name: 'Brandenburg an der Havel', note: 'Dominsel / Seen' },
  { id: 'bad_saarow', city: 'Bad Saarow', name: 'Bad Saarow', note: 'Scharmützelsee' },
  { id: 'chorin', city: 'Chorin', name: 'Kloster Chorin', note: 'Schorfheide / Biosphäre' },
  { id: 'wandlitz', city: 'Wandlitz', name: 'Wandlitz', note: 'Liepnitzsee / Waldsiedlung' },
  { id: 'rheinsberg', city: 'Rheinsberg', name: 'Rheinsberg', note: 'Schloss Rheinsberg' },
];

export function inBbox(lat, lng, box) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return lat >= box.latMin && lat <= box.latMax && lng >= box.lngMin && lng <= box.lngMax;
}

export function isBerlinZentrumSpot(spot, trigger) {
  const id = String(spot?.id || trigger?.id || '');
  if (BERLIN_ZENTRUM_EXCLUDE_IDS.includes(id)) return false;
  if (BERLIN_ZENTRUM_FORCE_IDS.includes(id)) return true;
  const lat = trigger?.lat ?? spot?.lat;
  const lng = trigger?.lng ?? spot?.lng;
  return inBbox(lat, lng, BERLIN_ZENTRUM_BBOX);
}

export function isBerlinUmlandSpot(spot, trigger) {
  const id = String(spot?.id || trigger?.id || '');
  if (BERLIN_ZENTRUM_FORCE_IDS.includes(id)) return false;
  if (isBerlinZentrumSpot(spot, trigger) && !BERLIN_ZENTRUM_EXCLUDE_IDS.includes(id)) {
    return false;
  }
  const lat = trigger?.lat ?? spot?.lat;
  const lng = trigger?.lng ?? spot?.lng;
  if (!inBbox(lat, lng, BERLIN_FULL_BBOX)) return false;
  // außerhalb Zentrum-Box oder explizit exclude→umland
  if (BERLIN_ZENTRUM_EXCLUDE_IDS.includes(id)) return true;
  return !inBbox(lat, lng, BERLIN_ZENTRUM_BBOX);
}
