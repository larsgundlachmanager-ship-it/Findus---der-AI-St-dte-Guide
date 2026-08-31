/**
 * Benannter Gastro-Ort aus der Äußerung — kein RN, keine Orts-Hardcodes.
 * „Empfehlung für X“ / „ich möchte X“ → diesen Laden suchen, nicht Nearby-Ersatz.
 */

const DINING_HINT_RE =
  /\b(empfehl\w*|restaurant|essen|hingehen|reservier\w*|speisekarte|menü|menu|frühstück|fruehstueck|mittag|abendessen|tisch|lecker|gastro)\b/iu;

const WANT_RE =
  /\b(möchte|moechte|will|hätt|haett|bock|suche|such|zeig)\b/iu;

const DISH_NOT_VENUE_RE =
  /\b(kartoffel|ofenkartoffel|erdapfel|steak|pizza|sushi|burger|pommes|schnitzel|salat|suppe|pannfisch|döner|doener|kebab|euro|preis|vegan|vegetar|picknick|picnic|städtetrip|staedtetrip)\b/iu;

/** Reise-/Plan-Blob — nie als Gastro-Ladenname (z. B. „ein Wochenende nach Lissabon“). */
const TRAVEL_NOT_VENUE_RE =
  /\b(wochenende|wochenend|urlaub|städtereise|staedtereise|städtetrip|staedtetrip|kurztrip|kurzreise|flug|flüge|fluege|flieger|hotel|unterkunft|planen|einplanen|tagesplan|timeline|kalender|programm)\b/iu;

const STOP_RE =
  /^(hier|dort|der|die|das|dem|den|ein|eine|einen|eines|nähe|nahe|stadt|ort|karte|speisekarte|restaurant|essen|heute|abend|mittag|empfehlung|bitte|mal|mir|mich|uns|dir|dich|besten|beste|guten|gutes|lecker|leckeres|hafen|see|laden|lokal|hotel|museum|kino|wochenende|urlaub|programm)$/i;

function cleanVenueToken(raw: string): string | null {
  const name = raw
    .replace(/^(das|den|die|dem|ein|eine|einen)\s+/i, '')
    .replace(/\s+(um|heute|abend|mittag|uhr|haben|essen|gehen|probieren|machen|bitte)\b.*$/i, '')
    .replace(/[.,!?].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 3) return null;
  if (STOP_RE.test(name)) return null;
  if (DISH_NOT_VENUE_RE.test(name)) return null;
  if (TRAVEL_NOT_VENUE_RE.test(name)) return null;
  // „Wochenende nach Lissabon …“ / reine Zielstadt ohne Gastro-Wort
  if (
    /\b(nach|in)\s+[A-ZÄÖÜ]/u.test(name) ||
    /^(wochenende|urlaub|kurztrip)\b/iu.test(name)
  ) {
    return null;
  }
  return name;
}

export function extractNamedRestaurantWish(text: string): string | null {
  const q = (text || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  // Reiseplanung / Flug / Wochenende — kein „Restaurant Wochenende nach X“
  if (TRAVEL_NOT_VENUE_RE.test(q) && !DINING_HINT_RE.test(q)) {
    return null;
  }
  if (
    TRAVEL_NOT_VENUE_RE.test(q) &&
    /\b(nach|in)\s+[A-ZÄÖÜ]/u.test(q) &&
    !/\b(essen|restaurant|speisekarte|reservier|frühstück|fruehstueck|tisch)\b/iu.test(
      q,
    )
  ) {
    return null;
  }
  const dining = DINING_HINT_RE.test(q) || WANT_RE.test(q);
  if (!dining) return null;
  if (
    /\b(museum|schloss|kirche|denkmal|hotel|kino|picknick|picnic)\b/iu.test(q) &&
    !/\b(essen|restaurant|speisekarte|reservier|frühstück|fruehstueck)\b/iu.test(q)
  ) {
    return null;
  }

  const patterns: RegExp[] = [
    /(?:für\s+(?:das|den|die|dem)\s+|für\s+)([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,4})/iu,
    /(?:bei|im|in\s+der|in\s+dem|am|zum|zur|zu\s+dem|ins|auf\s+dem|auf\s+der)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,5})/iu,
    /(?:ein|eine|das|den|dem|die)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{3,}(?:\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']+){0,3})(?:\s+(?:haben|essen|probieren|gehen))?/iu,
    /(?:empfehlung|empfehl)\s+(?:für\s+)?(?:das|den|die)?\s*([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{3,})/iu,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (!m?.[1]) continue;
    const name = cleanVenueToken(m[1]);
    if (name) return name;
  }
  return null;
}

export function namedVenueFromWishes(
  wishes: Array<{ kind?: string; text: string; hardness?: string }>,
): string | null {
  const v = wishes.find(
    (w) => w.kind === 'venue' && w.hardness === 'must' && (w.text || '').trim().length >= 3,
  );
  return v?.text?.trim() || null;
}

/** Name-Treffer: Unterstring, ohne Bindestrich/Leerzeichen. */
export function venueNameMatches(candidateName: string, venue: string): boolean {
  const a = (candidateName || '')
    .toLowerCase()
    .replace(/[-'’]/g, '')
    .replace(/\s+/g, '');
  const b = (venue || '')
    .toLowerCase()
    .replace(/[-'’]/g, '')
    .replace(/\s+/g, '');
  if (b.length < 3 || a.length < 3) return false;
  return a.includes(b) || b.includes(a);
}
