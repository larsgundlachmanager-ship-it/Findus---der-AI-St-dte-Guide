/**
 * Pitch-Titel aus User-Frage + Stadt — stadt-agnostisch, kein Script.
 * z. B. „Weinfest in Hamburg“, „Events heute“, „Zwei Optionen“.
 */

export function pitchHeadlineFromContext(opts: {
  userText?: string | null;
  city?: string | null;
  fallback?: string | null;
}): string {
  const raw = (opts.userText ?? '').replace(/\s+/g, ' ').trim();
  const city = (opts.city ?? '').trim();
  const fallback = (opts.fallback ?? 'Zwei Optionen').trim() || 'Zwei Optionen';

  try {
    const { extractNamedRestaurantWish } = require('./namedVenueIntent') as {
      extractNamedRestaurantWish: (s: string) => string | null;
    };
    const venue = extractNamedRestaurantWish(raw);
    if (venue) {
      return venue.slice(0, 28);
    }
  } catch {
    /* soft */
  }

  const topicMatch = raw.match(
    /\b(wein\s*fest|weinfest|stadtfest|sommerfest|volksfest|oktoberfest|musikfest|kulturfest|street\s*food|food\s*festival|festival|konzert|party|nightlife|nachtleben|events?|veranstaltung(?:en)?)\b/iu,
  );

  const capitalizeDe = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t) return t;
    if (/^wein\s*fest$/i.test(t) || /^weinfest$/i.test(t)) return 'Weinfest';
    if (/^street\s*food$/i.test(t)) return 'Street Food';
    if (/^food\s*festival$/i.test(t)) return 'Food Festival';
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  if (topicMatch) {
    const topic = capitalizeDe(topicMatch[1] || topicMatch[0] || '');
    if (city && topic) {
      return `${topic} in ${city}`.slice(0, 36);
    }
    if (topic) return topic.slice(0, 28);
  }

  if (city && /\b(heute|abend|geht|los)\b/iu.test(raw)) {
    return `Heute in ${city}`.slice(0, 36);
  }
  if (/\bwochenende\b/iu.test(raw) && city) {
    return `Wochenende · ${city}`.slice(0, 36);
  }
  if (city) return city.slice(0, 28);
  return fallback.slice(0, 28);
}
