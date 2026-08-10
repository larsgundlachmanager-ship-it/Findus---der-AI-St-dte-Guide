/**
 * Kurzzeitgedächtnis Modul 2 — Orte aus dem Chat.
 * Unabhängig vom ausgewählten City-Pack (Nachbarstadt-Sidequests ok).
 */

const CITY_RE =
  /\b(Wedel|Pinneberg|Hamburg|Uetersen|Tornesch|Prisdorf|Elmshorn|Quickborn|Schenefeld|Halstenbek|Rellingen|Wangerooge|Berlin|München|Muenchen|Köln|Koeln|Bremen|Hannover|Kiel|Lübeck|Luebeck|Flensburg|Norderstedt|Ahrensburg|Stade|Itzehoe|Glückstadt|Glueckstadt|Scharbeutz|Laboe|Travemünde|Travemuende|Timmendorfer\s+Strand|Heiligenhafen|Eckernförde|Eckernfoerde|Schönberg|Schoenberg)\b/gi;

let lastMentionedCity: string | null = null;
let lastTopic: string | null = null;
let lastPlaceName: string | null = null;
/** Letzte bekannte Speisekarten-/Menü-URL zum lastPlace */
let lastMenuUrl: string | null = null;
/** z. B. „mit Freunden“ — Kontextnotiz, kein Intent-Switch */
let lastCompanionsNote: string | null = null;

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

export function noteUserUtterance(text: string): void {
  const cities = [...text.matchAll(CITY_RE)].map((m) => m[1]!);
  if (cities.length) {
    lastMentionedCity = cities[cities.length - 1]!;
  }
  if (/hafencity|hafen\s*city/i.test(text)) {
    lastMentionedCity = 'Hamburg';
    lastTopic = 'HafenCity Hamburg';
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

export function extractCityFromText(text: string): string | null {
  if (/hafencity|hafen\s*city/i.test(text)) return 'Hamburg';
  const cities = [...text.matchAll(CITY_RE)].map((m) => m[1]!);
  return cities.length ? cities[cities.length - 1]! : null;
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

export function getShortTerm(): {
  lastMentionedCity: string | null;
  lastTopic: string | null;
  lastPlaceName: string | null;
  lastMenuUrl: string | null;
  lastCompanionsNote: string | null;
} {
  return {
    lastMentionedCity,
    lastTopic,
    lastPlaceName,
    lastMenuUrl,
    lastCompanionsNote,
  };
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
    lat: 53.6829229,
    lng: 9.7515229,
    city: 'Prisdorf',
  },
  'tennis-club': {
    name: 'Tennis-Club Prisdorf TCP',
    lat: 53.6829229,
    lng: 9.7515229,
    city: 'Prisdorf',
  },
  tcp: {
    name: 'Tennis-Club Prisdorf TCP',
    lat: 53.6829229,
    lng: 9.7515229,
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
