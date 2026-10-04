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

export type LiveInventoryKind =
  | 'hotel'
  | 'pitch_choice'
  | 'events'
  | 'activity_rental';

export type HotelPitchOutcome = 'empty' | 'named' | 'generic';

export type ActivityInventoryVenue = {
  name: string;
  lat: number;
  lng: number;
  websiteUrl?: string | null;
  priceLabel?: string | null;
};

/** Letzter Auftrag, der Live-Inventar + Pitch braucht — für „ja“ / „wie teuer“. */
let lastLiveInventory: {
  kind: LiveInventoryKind;
  query: string;
  atMs: number;
  /** Hotel: leer / generische Karte / benannte Optionen */
  hotelOutcome?: HotelPitchOutcome;
  hotelNames?: string[];
  /** Breitere Retry-Suche schon versucht */
  hotelRetried?: boolean;
  /** Phase 6: Activity/SUP — Anchor, Musts, Rejects, Venues */
  activityAnchor?: string | null;
  activityMust?: string[];
  activityRejects?: string[];
  activityVenues?: ActivityInventoryVenue[];
} | null = null;

/** Gewässer-Anker (Alster…) für SUP-Follow-up + Prefetch. */
let lastWaterAnchor: { name: string; atMs: number } | null = null;

/**
 * Root-Ziel der aktuellen Session (Ausgangswunsch) — hält über Follow-ups,
 * bis Topic-Cut / session=new. Autonomy Reboot.
 */
let sessionRootGoal: string | null = null;
/** Kurzer Faden: was schon geklärt/gewählt (kompakt). */
let sessionThreadSpine: string | null = null;

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
  lastWaterAnchor = null;
  sessionRootGoal = null;
  sessionThreadSpine = null;
  try {
    const { clearFollowThroughGoal } = require('../router/missionFollowThrough') as {
      clearFollowThroughGoal: () => void;
    };
    clearFollowThroughGoal();
  } catch {
    /* soft */
  }
}

export function clearSessionRootGoal(): void {
  sessionRootGoal = null;
  sessionThreadSpine = null;
}

/** Setzt/aktualisiert Root-Ziel (nur bei neuem Thema oder wenn leer). */
export function noteSessionRootGoal(goal: string | null | undefined): void {
  const g = (goal || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  if (!g) return;
  sessionRootGoal = g;
}

export function getSessionRootGoal(): string | null {
  return sessionRootGoal;
}

export function appendSessionThreadSpine(bit: string | null | undefined): void {
  const b = (bit || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!b) return;
  if (!sessionThreadSpine) {
    sessionThreadSpine = b;
    return;
  }
  if (sessionThreadSpine.includes(b.slice(0, 40))) return;
  sessionThreadSpine = `${sessionThreadSpine} · ${b}`.slice(0, 400);
}

export function getSessionThreadSpine(): string | null {
  return sessionThreadSpine;
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
  // Benanntes Gewässer → Sticky für SUP/Aktivitäts-Follow-ups + Prefetch
  if (
    /\b(see|meer|fluss|alster|außenalster|aussenalster|innenalster|elb[e]?|weiher|bucht|lagune)\b/iu.test(
      text,
    ) &&
    !/\b(restaurant|essen|steak|café|cafe|bäck|baeck)\b/iu.test(text)
  ) {
    lastTopic = 'named_water';
    try {
      const {
        extractWaterAnchorName,
        prefetchActivitySport,
      } = require('../../services/research/activityPrefetch') as {
        extractWaterAnchorName: (s: string) => string | null;
        prefetchActivitySport: (o: {
          namedPlace: string;
          cityHint?: string | null;
        }) => Promise<unknown>;
      };
      const water = extractWaterAnchorName(text);
      if (water) {
        noteWaterAnchor(water);
        void prefetchActivitySport({
          namedPlace: water,
          cityHint: lastMentionedCity || cityFromLandmarkUtterance(text),
        }).catch(() => {});
      }
    } catch {
      /* soft */
    }
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
  rootGoal: string | null;
  threadSpine: string | null;
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
    rootGoal: sessionRootGoal,
    threadSpine: sessionThreadSpine,
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

export function noteWaterAnchor(name: string | null | undefined): void {
  const n = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (n.length < 2) return;
  lastWaterAnchor = { name: n, atMs: Date.now() };
}

export function getLastWaterAnchor(): string | null {
  if (!lastWaterAnchor) return null;
  if (Date.now() - lastWaterAnchor.atMs > LIVE_INVENTORY_TTL_MS) {
    lastWaterAnchor = null;
    return null;
  }
  return lastWaterAnchor.name;
}

export function noteLastLiveInventory(opts: {
  kind: LiveInventoryKind;
  query: string;
  hotelOutcome?: HotelPitchOutcome;
  hotelNames?: string[];
  hotelRetried?: boolean;
}): void {
  const query = (opts.query || '').replace(/\s+/g, ' ').trim();
  if (!query) return;
  const prev =
    lastLiveInventory?.kind === opts.kind &&
    lastLiveInventory.query === query.slice(0, 400)
      ? lastLiveInventory
      : null;
  lastLiveInventory = {
    kind: opts.kind,
    query: query.slice(0, 400),
    atMs: Date.now(),
    hotelOutcome:
      opts.kind === 'hotel'
        ? opts.hotelOutcome ?? prev?.hotelOutcome
        : undefined,
    hotelNames:
      opts.kind === 'hotel'
        ? opts.hotelNames ?? prev?.hotelNames
        : undefined,
    hotelRetried:
      opts.kind === 'hotel'
        ? opts.hotelRetried ?? prev?.hotelRetried
        : undefined,
    activityAnchor:
      opts.kind === 'activity_rental'
        ? prev?.activityAnchor
        : undefined,
    activityMust:
      opts.kind === 'activity_rental' ? prev?.activityMust : undefined,
    activityRejects:
      opts.kind === 'activity_rental' ? prev?.activityRejects : undefined,
    activityVenues:
      opts.kind === 'activity_rental' ? prev?.activityVenues : undefined,
  };
  if (opts.kind === 'hotel') {
    lastTopic = 'hotel';
  } else if (opts.kind === 'events') {
    lastTopic = query.slice(0, 80) || 'events';
  } else if (opts.kind === 'activity_rental') {
    lastTopic = 'named_water';
  }
}

/** Phase 6 — Musts/Rejects/Venues am offenen Activity-Auftrag. */
export function noteActivityInventoryDetails(opts: {
  anchor?: string | null;
  must?: string[];
  rejects?: string[];
  venues?: ActivityInventoryVenue[];
}): void {
  if (!lastLiveInventory || lastLiveInventory.kind !== 'activity_rental') {
    return;
  }
  if (opts.anchor != null) {
    lastLiveInventory.activityAnchor = String(opts.anchor).slice(0, 48);
    noteWaterAnchor(opts.anchor);
  }
  if (opts.must) {
    lastLiveInventory.activityMust = opts.must
      .map((m) => String(m || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (opts.rejects) {
    lastLiveInventory.activityRejects = opts.rejects
      .map((m) => String(m || '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (opts.venues) {
    lastLiveInventory.activityVenues = opts.venues.slice(0, 4);
  }
  lastLiveInventory.atMs = Date.now();
}

export function pushActivityReject(name: string | null | undefined): void {
  const n = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  if (!n || !lastLiveInventory || lastLiveInventory.kind !== 'activity_rental') {
    return;
  }
  const prev = lastLiveInventory.activityRejects ?? [];
  if (prev.some((x) => x.toLowerCase() === n.toLowerCase())) return;
  lastLiveInventory.activityRejects = [...prev, n].slice(0, 12);
  lastLiveInventory.atMs = Date.now();
}

export function getLastLiveInventory(): {
  kind: LiveInventoryKind;
  query: string;
  hotelOutcome?: HotelPitchOutcome;
  hotelNames?: string[];
  hotelRetried?: boolean;
  activityAnchor?: string | null;
  activityMust?: string[];
  activityRejects?: string[];
  activityVenues?: ActivityInventoryVenue[];
} | null {
  if (!lastLiveInventory) return null;
  if (Date.now() - lastLiveInventory.atMs > LIVE_INVENTORY_TTL_MS) {
    lastLiveInventory = null;
    return null;
  }
  return {
    kind: lastLiveInventory.kind,
    query: lastLiveInventory.query,
    hotelOutcome: lastLiveInventory.hotelOutcome,
    hotelNames: lastLiveInventory.hotelNames,
    hotelRetried: lastLiveInventory.hotelRetried,
    activityAnchor: lastLiveInventory.activityAnchor,
    activityMust: lastLiveInventory.activityMust,
    activityRejects: lastLiveInventory.activityRejects,
    activityVenues: lastLiveInventory.activityVenues,
  };
}

export function clearLastLiveInventory(): void {
  lastLiveInventory = null;
}

/**
 * Bekannte lokale Anker — nur Named Lookup (User sagt den Ortsnamen).
 * Nie Soft-Fill für AYCE/Dining-Musts (Goldschätzchen ≠ All-you-can-eat).
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
  // AYCE/Specialty ohne Namen → kein Goldschätzchen Soft-Fill
  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const namedHint =
      /goldschatz|hoyers|tennis|tcp|goldjatze|goldjaetze/.test(t);
    if (looksLikeAyceQuery(text) && !namedHint) return null;
  } catch {
    /* soft */
  }
  for (const [key, val] of Object.entries(LOCAL_PLACE_ANCHORS)) {
    if (t.includes(key.replace(/ä/g, 'a'))) return val;
  }
  if (/gold/.test(t) && /schatz|jatze|jätze|saetze/.test(t)) {
    return LOCAL_PLACE_ANCHORS.goldschatz!;
  }
  // STT: Priesdorf / prisodrf / prsidorf / Tennisclub / „Tennis Club“ / Tennisklub
  if (
    /\btennisclub\b/.test(t) ||
    (/\btennis\b/.test(t) &&
      /\b(club|klub|tcp|halle|prisdorf|prsidorf|prisodrf|priesdorf)\b/.test(t))
  ) {
    return LOCAL_PLACE_ANCHORS.tennisclub!;
  }
  return null;
}
