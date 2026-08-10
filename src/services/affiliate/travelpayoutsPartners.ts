/**
 * Travelpayouts Partner-Katalog (Marker 760293).
 * Shortlinks aus dem Dashboard — keine erfundenen Deep-Link-Formeln.
 */

export const TRAVELPAYOUTS_MARKER = '760293';

export type TravelpayoutsCategory =
  | 'esim'
  | 'transfer'
  | 'car_rental'
  | 'tours'
  | 'city_pass'
  | 'luggage'
  | 'flights'
  | 'compensation'
  | 'bike'
  | 'wifi_power'
  | 'insurance';

export type TravelpayoutsPartnerId =
  | 'klook'
  | 'yesim'
  | 'kiwitaxi'
  | 'localrent'
  | 'welcome_pickups'
  | 'tiqets'
  | 'airalo'
  | 'gettransfer'
  | 'drimsim'
  | 'getrentacar'
  | 'airhelp'
  | 'gocity'
  | 'ekta'
  | 'economybookings_tpx'
  | 'bikesbooking'
  | 'qeeq'
  | 'wegotrip'
  | 'autoeurope'
  | 'radicalstorage'
  | 'aviasales'
  | 'kiwi'
  | 'intui'
  | 'compensair'
  | 'saily'
  | 'kkday';

export type TravelpayoutsPartner = {
  id: TravelpayoutsPartnerId;
  name: string;
  category: TravelpayoutsCategory;
  /** Dashboard-Shortlink (tracked). */
  url: string;
  /** Primär-Button-Label (DE). */
  label: string;
  /** Grobe öffentliche Provision (Travelpayouts / Partner-Seiten). */
  commissionNote: string;
  /** Einsatz-Schwerpunkt. */
  geo: string;
  /** Wann Findus den Button sinnvoll anbietet. */
  whenUseful: string;
};

/**
 * Kiwi.com tracked Deep-Link via Travelpayouts (promo_id=3791).
 * Docs: support.travelpayouts.com — Kiwi.com affiliate links
 */
export function buildKiwiTravelpayoutsUrl(
  kiwiPageUrl = 'https://www.kiwi.com/de/',
  opts?: { subId?: string },
): string {
  const marker = opts?.subId?.trim()
    ? `${TRAVELPAYOUTS_MARKER}.${opts.subId.trim()}`
    : TRAVELPAYOUTS_MARKER;
  const custom = encodeURIComponent(kiwiPageUrl);
  return (
    `https://c111.travelpayouts.com/click?shmarker=${encodeURIComponent(marker)}` +
    `&promo_id=3791&source_type=customlink&type=click&custom_url=${custom}`
  );
}

/** Alle freigeschalteten Travelpayouts-Programme (Findus Marker). */
export const TRAVELPAYOUTS_PARTNERS: readonly TravelpayoutsPartner[] = [
  {
    id: 'klook',
    name: 'Klook',
    category: 'tours',
    url: 'https://klook.tpx.li/ivHp4VL2',
    label: '🎟️ Touren bei Klook',
    commissionNote: '2–5 %',
    geo: 'Stark Asien/Pazifik, global',
    whenUseful: 'Attraktionen, Tagestouren, Transfers in Asien',
  },
  {
    id: 'kkday',
    name: 'KKday',
    category: 'tours',
    url: 'https://kkday.tpx.li/NRB36nDJ',
    label: '🎟️ Erlebnisse KKday',
    commissionNote: 'typ. ~5–8 %',
    geo: 'Asien (TW/JP/KR/SEA)',
    whenUseful: 'Tickets & Experiences Asien',
  },
  {
    id: 'tiqets',
    name: 'Tiqets',
    category: 'tours',
    url: 'https://tiqets.tpx.li/BexIXdv6',
    label: '🎫 Tickets bei Tiqets',
    commissionNote: 'AWIN bis ~6 % (Primär); TPX-Shortlink Fallback',
    geo: 'Europa stark, global',
    whenUseful: 'Museen, Attraktionen, Skip-the-line EU',
  },
  {
    id: 'wegotrip',
    name: 'WeGoTrip',
    category: 'tours',
    url: 'https://wegotrip.tpx.li/yIfwtEuN',
    label: '🎧 Audio-Tour WeGoTrip',
    commissionNote: 'oft ~20–40 % (Produkt abhängig)',
    geo: 'Europa / Städte weltweit',
    whenUseful: 'Selbstgeführte Audio-Touren vor Ort',
  },
  {
    id: 'gocity',
    name: 'Go City',
    category: 'city_pass',
    url: 'https://gocity.tpx.li/ztK1fQbQ',
    label: '🏙️ City Pass Go City',
    commissionNote: '~3–6 %',
    geo: 'Große Städte (NYC, London, Paris, Rom, …)',
    whenUseful: 'Mehrere Sehenswürdigkeiten an einem Tag',
  },
  {
    id: 'airalo',
    name: 'Airalo',
    category: 'esim',
    url: 'https://airalo.tpx.li/STYvYI4N',
    label: '📱 eSIM Airalo',
    commissionNote: '~12 %',
    geo: 'Weltweit (Landes-/Regional-eSIMs)',
    whenUseful: 'Roaming vermeiden, Ankunft Ausland',
  },
  {
    id: 'saily',
    name: 'Saily',
    category: 'esim',
    url: 'https://saily.tpx.li/jy99EHCs',
    label: '📱 eSIM Saily',
    commissionNote: 'netzabhängig (oft ~20–40 %)',
    geo: 'Weltweit',
    whenUseful: 'Alternative eSIM (Nord Security)',
  },
  {
    id: 'yesim',
    name: 'Yesim',
    category: 'esim',
    url: 'https://yesim.tpx.li/Yi3QEo4E',
    label: '📱 eSIM Yesim',
    commissionNote: 'netzabhängig',
    geo: 'Weltweit',
    whenUseful: 'eSIM-Alternative',
  },
  {
    id: 'drimsim',
    name: 'Drimsim',
    category: 'esim',
    url: 'https://drimsim.tpx.li/EIZ1pczY',
    label: '📱 eSIM Drimsim',
    commissionNote: 'netzabhängig',
    geo: 'Weltweit',
    whenUseful: 'Pay-as-you-go Daten im Ausland',
  },
  {
    id: 'welcome_pickups',
    name: 'Welcome Pickups',
    category: 'transfer',
    url: 'https://tpx.li/Ex0uoBGe',
    label: '🚐 Flughafen-Transfer',
    commissionNote: '~8–9 %',
    geo: 'Viele Flughäfen weltweit',
    whenUseful: 'Abholung Flughafen → Hotel mit Fahrer',
  },
  {
    id: 'gettransfer',
    name: 'GetTransfer',
    category: 'transfer',
    url: 'https://gettransfer.tpx.li/hmr93QlH',
    label: '🚐 Transfer GetTransfer',
    commissionNote: '~7 %',
    geo: 'Global (Gebote / Festpreise)',
    whenUseful: 'Flughafen- oder Städte-Transfer',
  },
  {
    id: 'kiwitaxi',
    name: 'KiwiTaxi',
    category: 'transfer',
    url: 'https://kiwitaxi.tpx.li/IgZwaaAi',
    label: '🚕 Transfer KiwiTaxi',
    commissionNote: 'hoch (Rev-Share / % laut TP)',
    geo: 'Europa + viele Destinationen',
    whenUseful: 'Vorbestellter Flughafentransfer',
  },
  {
    id: 'intui',
    name: 'Intui.travel',
    category: 'transfer',
    url: 'https://intui.tpx.li/4ACuEqQg',
    label: '🚐 Transfer Intui',
    commissionNote: 'netzabhängig',
    geo: 'Europa / Urlaubsregionen',
    whenUseful: 'Transfer & Shuttle',
  },
  {
    id: 'economybookings_tpx',
    name: 'Economy Bookings (TPX)',
    category: 'car_rental',
    url: 'https://economybookings.tpx.li/2yGz7BLA',
    label: '🚗 Mietwagen Economy',
    commissionNote: '~23–25 %',
    geo: 'Weltweit',
    whenUseful: 'Mietwagen Flughafen / Roadtrip',
  },
  {
    id: 'localrent',
    name: 'Localrent',
    category: 'car_rental',
    url: 'https://localrent.tpx.li/FO7A5v71',
    label: '🚗 Mietwagen Localrent',
    commissionNote: 'oft hoch (lokale Anbieter)',
    geo: 'Stark Südeuropa / Urlaub',
    whenUseful: 'Günstige lokale Vermieter',
  },
  {
    id: 'getrentacar',
    name: 'GetRentacar',
    category: 'car_rental',
    url: 'https://getrentacar.tpx.li/R5GXyzLp',
    label: '🚗 Mietwagen GetRentacar',
    commissionNote: 'netzabhängig',
    geo: 'Global',
    whenUseful: 'Mietwagen-Vergleich',
  },
  {
    id: 'autoeurope',
    name: 'AutoEurope',
    category: 'car_rental',
    url: 'https://autoeurope.tpx.li/ufC7bGly',
    label: '🚗 Mietwagen AutoEurope',
    commissionNote: '~4–8 %',
    geo: 'EU / UK / US-Kanada Buchungen',
    whenUseful: 'Klassischer Mietwagen EU',
  },
  {
    id: 'bikesbooking',
    name: 'BikesBooking',
    category: 'bike',
    url: 'https://bikesbooking.tpx.li/oeSnSykT',
    label: '🏍️ Bike / Roller mieten',
    commissionNote: 'netzabhängig',
    geo: 'Urlaubsregionen weltweit',
    whenUseful: 'Motorrad, Scooter, Fahrrad mieten',
  },
  {
    id: 'radicalstorage',
    name: 'Radical Storage',
    category: 'luggage',
    url: 'https://radicalstorage.tpx.li/1AlHsDOR',
    label: '🧳 Gepäck Radical Storage',
    commissionNote: '~8 %',
    geo: 'Große Städte weltweit',
    whenUseful: 'Koffer lagern vor Check-in / nach Checkout',
  },
  {
    id: 'kiwi',
    name: 'Kiwi.com',
    category: 'flights',
    url: buildKiwiTravelpayoutsUrl('https://www.kiwi.com/de/'),
    label: '✈️ Flüge bei Kiwi',
    commissionNote: '~3 % vom Ticketpreis',
    geo: 'Global (Flüge, teils Bus/Bahn)',
    whenUseful: 'Flug suchen, Virtual Interlining, Kombi-Routen',
  },
  {
    id: 'aviasales',
    name: 'Aviasales',
    category: 'flights',
    url: 'https://aviasales.tpx.li/zk7udfoO',
    label: '✈️ Flüge Aviasales',
    commissionNote: '50–70 % der Aviasales-Marge',
    geo: 'Global (stark CIS/EU-Traffic)',
    whenUseful: 'Flug suchen / vergleichen',
  },
  {
    id: 'airhelp',
    name: 'AirHelp',
    category: 'compensation',
    url: 'https://airhelp.tpx.li/CWl59KXu',
    label: '✈️ Entschädigung AirHelp',
    commissionNote: 'CPA ~€14–32 / Claim',
    geo: 'EU-Fluggastrechte + global',
    whenUseful: 'Verspätung, Annullierung, Überbuchung',
  },
  {
    id: 'compensair',
    name: 'Compensair',
    category: 'compensation',
    url: 'https://compensair.tpx.li/N8iIcDEv',
    label: '✈️ Entschädigung Compensair',
    commissionNote: 'CPA / Success-Fee',
    geo: 'EU-Fluggastrechte',
    whenUseful: 'Flugproblem → Claim einreichen',
  },
  {
    id: 'ekta',
    name: 'Ekta Traveling',
    category: 'insurance',
    url: 'https://ektatraveling.tpx.li/4kiJL8xH',
    label: '🛡️ Reiseversicherung',
    commissionNote: 'netzabhängig',
    geo: 'Reiseversicherung global',
    whenUseful: 'Versicherung vor / während Trip',
  },
  {
    id: 'qeeq',
    name: 'QEEQ',
    category: 'wifi_power',
    url: 'https://qeeq.tpx.li/KcCoU6CL',
    label: '📶 Pocket-WiFi / Powerbank',
    commissionNote: 'netzabhängig',
    geo: 'Miete an Flughäfen / Destinationen',
    whenUseful: 'Pocket-WiFi oder Powerbank mieten',
  },
] as const;

const BY_ID = new Map(
  TRAVELPAYOUTS_PARTNERS.map((p) => [p.id, p] as const),
);

/** Primäre Partner pro Kategorie (1 Button, keine Flut). */
export const PRIMARY_BY_CATEGORY: Record<
  TravelpayoutsCategory,
  TravelpayoutsPartnerId
> = {
  esim: 'airalo',
  transfer: 'welcome_pickups',
  car_rental: 'economybookings_tpx',
  tours: 'tiqets',
  city_pass: 'gocity',
  luggage: 'radicalstorage',
  flights: 'kiwi',
  compensation: 'airhelp',
  bike: 'bikesbooking',
  wifi_power: 'qeeq',
  insurance: 'ekta',
};

/** Asien-Touren: Klook vor Tiqets. */
const ASIA_HINT_RE =
  /\b(japan|tokyo|osaka|kyoto|korea|seoul|busan|taiwan|taipei|thailand|bangkok|phuket|vietnam|hanoi|saigon|singapore|singapur|malaysia|kuala|hong\s*kong|macau|china|shanghai|beijing|bali|indonesia|philippines|manila|asia)\b/iu;

export function getTravelpayoutsPartner(
  id: TravelpayoutsPartnerId,
): TravelpayoutsPartner | undefined {
  return BY_ID.get(id);
}

export function getTravelpayoutsUrl(id: TravelpayoutsPartnerId): string {
  return BY_ID.get(id)?.url ?? '';
}

export function pickTourPartnerId(opts?: {
  cityOrQuery?: string | null;
  preferAsia?: boolean;
}): TravelpayoutsPartnerId {
  const q = opts?.cityOrQuery ?? '';
  if (opts?.preferAsia || ASIA_HINT_RE.test(q)) return 'klook';
  return 'tiqets';
}

export function pickPrimaryPartner(
  category: TravelpayoutsCategory,
  opts?: { cityOrQuery?: string | null },
): TravelpayoutsPartner {
  if (category === 'tours') {
    const id = pickTourPartnerId(opts);
    return BY_ID.get(id)!;
  }
  const id = PRIMARY_BY_CATEGORY[category];
  return BY_ID.get(id)!;
}

export function buildTravelpayoutsOpenUrlAction(
  category: TravelpayoutsCategory,
  opts?: { cityOrQuery?: string | null; label?: string },
): { type: 'OPEN_URL'; label: string; payload: { url: string } } {
  const p = pickPrimaryPartner(category, opts);
  return {
    type: 'OPEN_URL',
    label: opts?.label?.trim() || p.label,
    payload: { url: p.url },
  };
}

/** Regex: Travelpayouts / Partner-Hosts in OPEN_URL erkennen. */
export const TRAVELPAYOUTS_URL_RE =
  /tpx\.li|c111\.travelpayouts\.com|kiwi\.com|klook\.com|tiqets\.com|kkday\.com|wegotrip\.com|gocity\.com|airalo\.com|saily\.com|yesim\.|drimsim\.|welcomepickups\.com|gettransfer\.com|kiwitaxi\.com|intui\.travel|economybookings\.com|localrent\.com|getrentacar\.com|autoeurope\.|bikesbooking\.com|radicalstorage\.com|aviasales\.|airhelp\.com|compensair\.com|ektatraveling\.com|qeeq\.com/i;
