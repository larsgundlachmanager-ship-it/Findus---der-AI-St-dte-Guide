/**
 * Ort-Granularität: Stadtteil vs. Straße/Venue — ohne Orts-Hardcodes.
 */

/** Konkreter Termin (Adresse nötig), nicht bloß „Stadtteil erkunden“. */
export function isConcreteAppointmentTitle(title: string): boolean {
  return /\b(bewerbung|vorstellungsgespräch|vorstellungsgespraech|job\s*interview|interview|gespräch|gespraech|meeting|termin|arzt|arzttermin|workshop|prüfung|pruefung|klausur|tennis|turnier|match|training|padel)\b/i.test(
    title,
  );
}

/** Sport-Termin (Tennis/Turnier…), der einen konkreten Club/Platz braucht. */
export function isSportVenueAppointment(title: string): boolean {
  return /\b(tennis|turnier|match|training|padel|fußballturnier|fussballturnier)\b/i.test(
    title,
  );
}

/** Straße / Hausnummer / klarer Venue-Name → genug für Anker. */
export function looksLikeStreetOrVenueAddress(location: string): boolean {
  const t = (location ?? '').trim();
  if (!t) return false;
  if (/\d{1,4}[a-zA-Z]?\b/.test(t) && t.length >= 5) return true;
  if (
    /\b(straße|strasse|str\.|weg|platz|allee|gasse|ring|ufer|damm|kamp|hof|chaussee|avenue|street|road)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(hotel|café|cafe|restaurant|museum|bahnhof|office|büro|buero|campus|studio|klinik|praxis|co-?working)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Konkreter Club-/Venue-Name (nicht nur „Tennisplätze“)
  if (
    /\b(tc\s+[A-Za-zÄÖÜäöüß]|thc\b|tennisclub\s+[A-Za-zÄÖÜäöüß]|phoenix|grün-?\s*weiß|gruen-?\s*weiss)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Nur Gebiet/Stadtteil ohne Straße — für harte Termine noch klären. */
export function isAreaOnlyLocation(location: string | null | undefined): boolean {
  const t = (location ?? '').trim();
  if (!t) return true;
  if (looksLikeStreetOrVenueAddress(t)) return false;
  // Kurzname ohne Straße → Gebiet
  const tokens = t.split(/[\s,]+/).filter(Boolean);
  return tokens.length <= 4;
}

/**
 * „Lübeck Tennisplätze“ / „Tennis in Lübeck“ ohne Club → zu vage für Route/Pitch-Anker.
 */
export function isVagueSportVenueLocation(
  title: string,
  location: string | null | undefined,
): boolean {
  if (
    !isSportVenueAppointment(title) &&
    !/\btennis|turnier\b/i.test(location ?? '')
  ) {
    return false;
  }
  const loc = (location ?? '').trim();
  if (!loc) return true;
  if (looksLikeStreetOrVenueAddress(loc)) return false;
  if (
    /\btennis(?:plätze|plaetze|platz|anlage)?\b/i.test(loc) &&
    !/\b(tc\s+|thc\b|tennisclub\s+|phoenix)\b/i.test(loc)
  ) {
    return true;
  }
  // Nur Stadt / Stadt+Sport-Gattung
  if (isAreaOnlyLocation(loc)) return true;
  return false;
}

export function appointmentNeedsExactAddress(
  title: string,
  location: string | null | undefined,
): boolean {
  if (isVagueSportVenueLocation(title, location)) return true;
  if (!isConcreteAppointmentTitle(title)) return false;
  return isAreaOnlyLocation(location);
}
