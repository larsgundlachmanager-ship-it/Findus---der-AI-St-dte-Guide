/**
 * Kurzzeitgedächtnis Modul 2 — Orte aus dem Chat.
 * Unabhängig vom ausgewählten City-Pack (Nachbarstadt-Sidequests ok).
 */

const CITY_RE =
  /\b(Wedel|Pinneberg|Hamburg|Uetersen|Tornesch|Prisdorf|Priestewitz|Elmshorn|Quickborn|Schenefeld|Halstenbek|Rellingen|Wangerooge|Berlin|München|Muenchen|Köln|Koeln|Bremen|Hannover|Kiel|Lübeck|Luebeck|Lubeck|Lübek|Lubek|Flensburg|Norderstedt|Ahrensburg|Stade|Itzehoe|Glückstadt|Glueckstadt|Scharbeutz|Laboe|Travemünde|Travemuende|Timmendorfer\s+Strand|Heiligenhafen|Eckernförde|Eckernfoerde|Schönberg|Schoenberg|Eimsbüttel|Eimsbuettel|Altona|Ottensen|St\.?\s*Pauli|Winterhude|Eppendorf|Harburg|Wandsbek|Bergedorf|Blankenese|Harvestehude|Rotherbaum|Sternschanze|Schanze|Lissabon|Lisbon|Lisboa|London|Paris|Amsterdam|Barcelona|Rom|Roma|Wien|Prag|Prague)\b/gi;

let lastMentionedCity: string | null = null;
let lastFullUserUtterance: string | null = null;
let lastTopic: string | null = null;
let lastPlaceName: string | null = null;
/** Letzte bekannte Speisekarten-/Menü-URL zum lastPlace */
let lastMenuUrl: string | null = null;
/** z. B. „mit Freunden“ — Kontextnotiz, kein Intent-Switch */
let lastCompanionsNote: string | null = null;
/** Pack-Download-Hinweis wenn User fremde Stadt nennt */
let lastCityPackOffer: {
  cityId: string;
  cityName: string;
  speechHint: string;
  atMs: number;
} | null = null;

export type LiveInventoryKind = 'hotel' | 'pitch_choice' | 'events';

/** Letzter Auftrag, der Live-Inventar + Pitch braucht — für „ja“ / „wie teuer“. */
let lastLiveInventory: {
  kind: LiveInventoryKind;
  query: string;
  atMs: number;
} | null = null;

const LIVE_INVENTORY_TTL_MS = 45 * 60_000;

/** Lokaler Spazier-/Stadt-Lock — nicht in Nachbar-Metropole driften. */
export function wantsLocalCityStay(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (
    /\b(hier\s+bleiben|in\s+\w+\s+bleiben|bleib(?:en)?\s+(?:wir\s+)?hier|nicht\s+(?:nach\s+)?raus|nicht\s+weg|nur\s+hier|vor\s+ort|in\s+der\s+(?:gleichen\s+)?stadt)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Spazier-/Sightseeing ohne fremde Stadt → lokal
  if (
    /\b(spazier|bummel|rundgang|sehenswürdigkeit|sehenswuerdigkeit|highlights?|erkunden|zwei\s+stunden|2\s*h(?:\b|our)|2\s*stunden)\b/i.test(
      t,
    )
  ) {
    const cities = [...t.matchAll(CITY_RE)].map((m) => m[1]!);
    // Nur aktuelle Stadt oder keine Stadt genannt → local stay
    return cities.length === 0;
  }
  return false;
}

export function clearLastMentionedCity(): void {
  lastMentionedCity = null;
}

/** Gesprächsstadt setzen (Flug-Ziel, Sidequest) — ohne die letzte User-Äußerung zu überschreiben. */
export function noteMentionedCity(city: string | null | undefined): void {
  const c = (city || '').replace(/\s+/g, ' ').trim();
  if (c.length < 2) return;
  lastMentionedCity = c.slice(0, 48);
}

/** Stadtwechsel (Pack/GPS): Sticky + Inventory clearen — kein Prisdorf in Lübeck. */
export function clearShortTermOnCitySwitch(): void {
  lastMentionedCity = null;
  lastTopic = null;
  lastPlaceName = null;
  lastMenuUrl = null;
  lastCompanionsNote = null;
  lastCityPackOffer = null;
  lastLiveInventory = null;
}

export function noteUserUtterance(text: string): void {
  lastFullUserUtterance = (text || '').trim() || lastFullUserUtterance;
  try {
    const { noteUserTextForAddressPrivacy } = require('../../utils/addressPrivacy') as {
      noteUserTextForAddressPrivacy: (t: string) => void;
    };
    noteUserTextForAddressPrivacy(text);
  } catch {
    /* soft */
  }
  const cities = extractCityFromText(text);
  if (cities) {
    lastMentionedCity = cities;
  }
  if (/hafencity|hafen\s*city/i.test(text)) {
    lastMentionedCity = 'Hamburg';
    lastTopic = 'HafenCity Hamburg';
  } else if (
    /\belphi\b|\belbphil\w*|\belphi[-\s]?harmonie\b|\ba[-\s]?harmonie\b/iu.test(
      text,
    )
  ) {
    // STT „A Harmonie“ / Elphi → Recherche-Kontext Hamburg (auch wenn Pack = Prisdorf)
    lastMentionedCity = 'Hamburg';
    lastTopic = 'Elbphilharmonie';
  } else if (/hafen/i.test(text) && lastMentionedCity) {
    lastTopic = `Hafen ${lastMentionedCity}`;
  }

  // Themenwechsel: lokaler Spaziergang / Stadt bleiben → Chat-Stadt-Sticky lösen
  if (wantsLocalCityStay(text)) {
    clearLastMentionedCity();
    if (/\b(spazier|bummel|rundgang|sehenswürdigkeit|sehenswuerdigkeit)\b/i.test(text)) {
      lastTopic = 'local_walk';
    }
  }

  // Neuer Küsten-/Aktivitätswunsch → Topic setzen (ohne Stadt zu überschreiben)
  if (
    /\b(spikeball|beachvolleyball|strand|ostsee|nordsee)\b/i.test(text) &&
    !wantsLocalCityStay(text)
  ) {
    lastTopic = 'beach_activity';
  }

  if (
    /\b(mit\s+freunden|mit\s+freundinnen|zu\s+zweit|zu\s+dritt|gruppe|kollegen|familie)\b/i.test(
      text,
    )
  ) {
    const m = text.match(
      /\b(mit\s+freunden|mit\s+freundinnen|zu\s+zweit|zu\s+dritt|gruppe|kollegen|familie)\b/i,
    );
    lastCompanionsNote = m?.[1]?.trim() ?? 'mit Begleitung';
  }
}

function cityFromLandmarkUtterance(text: string): string | null {
  try {
    const { canonicalizeLandmarkQuery } = require('../../services/navigation/landmarkAliases') as {
      canonicalizeLandmarkQuery: (s: string) => { preferredCityId: string | null };
    };
    const id = canonicalizeLandmarkQuery(text).preferredCityId;
    if (id === 'hamburg') return 'Hamburg';
    if (id === 'luebeck') return 'Lübeck';
    if (id === 'berlin') return 'Berlin';
    if (id === 'prisdorf') return 'Prisdorf';
  } catch {
    /* soft */
  }
  return null;
}

/** Füllwörter — keine Städte (stadt-agnostisch, kein Orts-Hardcode). */
const TRAVEL_CITY_STOP =
  /^(den|die|das|dem|der|ein|eine|einem|einer|eines|mein|meine|meinen|meinem|dein|deine|deinem|heute|morgen|abend|nacht|vormittag|nachmittag|flughafen|airport|hause|haus|arbeit|urlaub|bett|hotel|hotels|unterkunft|restaurant|stadt|datensatz|plan|timeline|nähe|naehe|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn|fünfzehn|fuenfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig|hundert|grad|paar|nacht(?:e|en)?|nächte|naechte|moment|dir|dich|mir|mich|uns|euch|ihnen|sich|wann|muss|müsst|muessen|müssen|soll|ich|wir|du|los|sein|oben|unten|vorne|hinten|links|rechts|für|fuer|for|ankunft|abfahrt|anreise|rückkehr|rueckkehr|ziel|start|regen|regnet|schauer|niesel|gewitter|sonne|wolken|schnee|wetter|sturm|wind|aus|es|mit|ohne|pool|sauna|spa|massage|terrasse|balkon|meerblick|seeblick|frühstück|fruehstueck|all.?inclusive|wochenende|wochenend|günstig|guenstig|billig|preiswert|unter|über|ueber|und|oder|plus)$/iu;

/** Hotel-/Amenity-Phrasen — nie als Zielstadt (z. B. „Hotel mit Pool und Sauna“). */
const TRAVEL_CITY_AMENITY_BLOB =
  /\b(pool|sauna|spa|massage|terrasse|balkon|meerblick|seeblick|all.?inclusive|frühstück|fruehstueck|wellness|whirlpool|fitness|parking|parkplatz|wlan|wifi)\b/iu;

function titleTravelCity(raw: string): string {
  return raw
    .replace(/[.,!?]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 48);
}

function keepTravelCityToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.replace(/[.,!?]+$/g, '').split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const p of parts) {
    if (TRAVEL_CITY_STOP.test(p)) break;
    kept.push(p);
  }
  const s = kept.join(' ').trim();
  if (s.length < 3 || TRAVEL_CITY_STOP.test(s)) return null;
  if (TRAVEL_CITY_AMENITY_BLOB.test(s)) return null;
  // „Mit Pool Und …“ / reine Präposition-Sätze
  if (/^(mit|ohne|und|oder)\b/iu.test(s)) return null;
  if (kept.length >= 2 && kept.every((p) => TRAVEL_CITY_STOP.test(p) || TRAVEL_CITY_AMENITY_BLOB.test(p))) {
    return null;
  }
  return titleTravelCity(s);
}

/**
 * Zielstadt aus Reise-/Hotel-Präposition — auch ohne Pack-Liste (Athen, Lissabon…).
 * CITY_RE bleibt vorn für bekannte Packs; das hier ist der Fallback.
 */
export function extractTravelCityFromText(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const prepRe =
    /\b(?:in|nach|für|fuer|bei|richtung)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-']+){0,2})\b/giu;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = prepRe.exec(t))) {
    const hit = keepTravelCityToken(m[1]);
    if (hit) last = hit;
  }
  if (last) return last;
  // „Hotel in Lissabon“ — nicht „Hotel mit Pool“ (mit/ohne = Amenity, keine Stadt)
  const hotelBare = t.match(
    /\bhotels?\s+in\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß\-']+){0,2})\b/iu,
  );
  return keepTravelCityToken(hotelBare?.[1] ?? null);
}

export function extractCityFromText(text: string): string | null {
  if (/hafencity|hafen\s*city/i.test(text)) return 'Hamburg';
  // „Hamburger Pannfisch“ / „Berliner Currywurst“ = Gericht-Adjektiv, keine Zielstadt
  const dishDemonymOnly =
    /\b(hamburg|berlin|münchen|muenchen|köln|koeln|dresden|leipzig|prag|wiener)er(?:in)?n?\s+\w{3,}/iu.test(
      text,
    ) &&
    !/\b(in|nach|aus|bei)\s+(hamburg|berlin|münchen|muenchen|köln|koeln|dresden|leipzig|prag|wien)\b/iu.test(
      text,
    );
  // Demonym: „Berliner Dom“ — Stamm vor CITY_RE; bei Gericht-Demonym Stamm entfernen.
  const demonymed = dishDemonymOnly
    ? text.replace(
        /\b(hamburg|berlin|münchen|muenchen|köln|koeln|dresden|leipzig|prag|wiener)er(?:in)?n?\b/giu,
        ' ',
      )
    : text.replace(
        /\b(hamburg|berlin|prisdorf|pinneberg)er(?:in)?n?\b/giu,
        '$1',
      );
  const cities = [...demonymed.matchAll(CITY_RE)].map((m) => m[1]!);
  if (cities.length) {
    const raw = cities[cities.length - 1]!;
    // STT-/Tipp-Varianten → kanonischer Name für Geocode/Stay22
    if (/l(ü|ue|u)be?ck?/i.test(raw)) return 'Lübeck';
    if (/eimsbu(tt|̈t)el/i.test(raw) || /eimsbüttel/i.test(raw)) {
      return 'Eimsbüttel';
    }
    if (/hamburg/i.test(raw)) return 'Hamburg';
    if (/lissabon|lisbon|lisboa/i.test(raw)) return 'Lissabon';
    if (/london/i.test(raw)) return 'London';
    return raw;
  }
  // Fuzzy: „in Pillerberg“ → Pinneberg (wenn nahe an bekannter Stadt)
  try {
    const { fuzzyResolveCityName } = require('../../services/navigation/fuzzyCityResolve') as {
      fuzzyResolveCityName: (s: string) => string | null;
    };
    const inCity = text.match(
      /\bin\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]{3,}(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]{2,}){0,2})\b/iu,
    );
    if (inCity?.[1]) {
      const fuzzy = fuzzyResolveCityName(inCity[1]);
      if (fuzzy) return fuzzy;
    }
  } catch {
    /* soft */
  }
  const travel = extractTravelCityFromText(text);
  if (travel) return travel;
  return cityFromLandmarkUtterance(text);
}

/**
 * @deprecated Nutze resolveWorkingPlace aus placeContext.ts.
 * Bleibt als dünne Hülle: explizit > Gespräch > Live-Label — nie Pack-Stadt.
 */
export function resolveQueryCity(
  text: string,
  liveLocationLabel?: string | null,
): string {
  const explicit = extractCityFromText(text);
  if (explicit) return explicit;
  if (lastMentionedCity) return lastMentionedCity;
  const live = liveLocationLabel?.trim();
  if (live) return extractCityFromText(live) ?? live;
  return 'hier in der Nähe';
}

export function getLastMentionedCity(): string | null {
  return lastMentionedCity;
}

export function getLastFullUserUtterance(): string | null {
  return lastFullUserUtterance;
}

export function getShortTerm(): {
  lastMentionedCity: string | null;
  lastTopic: string | null;
  lastPlaceName: string | null;
  lastMenuUrl: string | null;
  lastCompanionsNote: string | null;
  cityPackOffer: {
    cityId: string;
    cityName: string;
    speechHint: string;
  } | null;
} {
  const offer =
    lastCityPackOffer && Date.now() - lastCityPackOffer.atMs < 10 * 60_000
      ? {
          cityId: lastCityPackOffer.cityId,
          cityName: lastCityPackOffer.cityName,
          speechHint: lastCityPackOffer.speechHint,
        }
      : null;
  return {
    lastMentionedCity,
    lastTopic,
    lastPlaceName,
    lastMenuUrl,
    lastCompanionsNote,
    cityPackOffer: offer,
  };
}

export function noteCityPackOffer(opts: {
  cityId: string;
  cityName: string;
  speechHint: string;
}): void {
  lastCityPackOffer = { ...opts, atMs: Date.now() };
}

export function clearCityPackOffer(): void {
  lastCityPackOffer = null;
}

export function setLastPlaceName(name: string | null): void {
  lastPlaceName = name;
  if (!name) lastMenuUrl = null;
}

export function setLastMenuUrl(url: string | null): void {
  lastMenuUrl = url?.trim() || null;
}

export function setLastTopic(topic: string | null): void {
  lastTopic = topic;
}

export function noteLastLiveInventory(opts: {
  kind: LiveInventoryKind;
  query: string;
}): void {
  const query = (opts.query || '').replace(/\s+/g, ' ').trim();
  if (!query) return;
  lastLiveInventory = {
    kind: opts.kind,
    query: query.slice(0, 400),
    atMs: Date.now(),
  };
  if (opts.kind === 'hotel') {
    lastTopic = 'hotel';
  } else if (opts.kind === 'events') {
    lastTopic = query.slice(0, 80) || 'events';
  }
}

export function getLastLiveInventory(): {
  kind: LiveInventoryKind;
  query: string;
} | null {
  if (!lastLiveInventory) return null;
  if (Date.now() - lastLiveInventory.atMs > LIVE_INVENTORY_TTL_MS) {
    lastLiveInventory = null;
    return null;
  }
  return {
    kind: lastLiveInventory.kind,
    query: lastLiveInventory.query,
  };
}

export function clearLastLiveInventory(): void {
  lastLiveInventory = null;
}

/**
 * Bekannte lokale Anker — optionale Offline-Hilfe, kein Pack-Zwang.
 * Navigation darf sie nutzen, wenn der User den Namen sagt.
 */
export const LOCAL_PLACE_ANCHORS: Record<
  string,
  { name: string; lat: number; lng: number; city: string }
> = {
  goldschätzchen: {
    name: 'Restaurant Goldschätzchen',
    lat: 53.6764,
    lng: 9.758,
    city: 'Prisdorf',
  },
  goldschatzchen: {
    name: 'Restaurant Goldschätzchen',
    lat: 53.6764,
    lng: 9.758,
    city: 'Prisdorf',
  },
  goldschatz: {
    name: 'Restaurant Goldschätzchen',
    lat: 53.6764,
    lng: 9.758,
    city: 'Prisdorf',
  },
  goldjätze: {
    name: 'Restaurant Goldschätzchen',
    lat: 53.6764,
    lng: 9.758,
    city: 'Prisdorf',
  },
  hoyers: {
    name: 'Hoyers Gasthof',
    lat: 53.6754,
    lng: 9.7607,
    city: 'Prisdorf',
  },
  tennisclub: {
    name: 'Tennis-Club Prisdorf TCP',
    lat: 53.6831575,
    lng: 9.7513199,
    city: 'Prisdorf',
  },
  'tennis-club': {
    name: 'Tennis-Club Prisdorf TCP',
    lat: 53.6831575,
    lng: 9.7513199,
    city: 'Prisdorf',
  },
  tcp: {
    name: 'Tennis-Club Prisdorf TCP',
    lat: 53.6831575,
    lng: 9.7513199,
    city: 'Prisdorf',
  },
};

export function resolveLocalAnchor(
  text: string,
): (typeof LOCAL_PLACE_ANCHORS)[string] | null {
  const t = text
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
  for (const [key, val] of Object.entries(LOCAL_PLACE_ANCHORS)) {
    if (t.includes(key.replace(/ä/g, 'a'))) return val;
  }
  if (/gold/.test(t) && /schatz|jatze|jätze|saetze/.test(t)) {
    return LOCAL_PLACE_ANCHORS.goldschatz!;
  }
  // STT: Priesdorf / Tennisclub / „Tennis Club“
  if (
    /\btennis\b/.test(t) &&
    /\b(club|tcp|halle|prisdorf|priesdorf)\b/.test(t)
  ) {
    return LOCAL_PLACE_ANCHORS.tennisclub!;
  }
  return null;
}
