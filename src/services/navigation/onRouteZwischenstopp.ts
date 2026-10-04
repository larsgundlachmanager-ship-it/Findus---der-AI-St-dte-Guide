/**
 * Klar benannter Zwischenstopp unterwegs — Kindergarten/Club/… nicht nur Gastro.
 * Stadt-agnostisch: Struktur aus Formulierung, keine Orts-Hardcodes.
 */

const ON_ROUTE_HINT_RE =
  /\b(vorher|davor|zwischendurch|zwischenstopp|auf\s+dem\s+weg|unterwegs|nochmal\s+(?:kurz\s+)?(?:zum|zur|zu)|kurz\s+(?:zum|zur|zu)|erst\s+(?:noch\s+)?(?:zum|zur|nach)|vorbeifahren|vorbei\s+fahren|vor\s+nochmal|kurz\s+halten)\b/iu;

const GO_TO_RE =
  /\b(?:zum|zur|zu\s+dem|zu\s+der|nach|ins|in\s+den|in\s+die|an\s+(?:einem|einer|den|dem|die))\s+([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,5})/iu;

const VAGUE_CATEGORY_RE =
  /^(?:dem\s+|der\s+|den\s+|einem?\s+|einer\s+)?(?:nächste[rn]?\s+)?(?:eis|kaffee|café|cafe|bäcker|baecker|bäckerei|baeckerei|restaurant|imbiss|snack|tankstelle|laden|shop|briefkasten|postkasten|packstation|postfiliale|mailbox|etwas|was|pause)$/iu;

/** Alltag-Amenity für Top-2 auf der Route — nie Bahnhof/Bäckerei als Ersatz. */
const MAILBOX_AMENITY_RE =
  /\b(briefkasten|briefkästen|briefkaesten|postkasten|post_box|mailbox|letter\s*box|packstation|paketautomat|parcel\s*locker)\b/iu;

const STOP_TAIL_RE =
  /\s+(?:gehen|fahren|hin|noch|bitte|mal|kurz|vorbeifahren|vorbei|in\s+\w+|bei\s+\w+)$/iu;

const DISH_OR_ACTIVITY_RE =
  /\b(essen|trinken|eis\s+essen|kaffee\s+trinken|pizza|steak|sup\b|stand[\s-]?up)\b/iu;

/**
 * „Briefkasten / Packstation“ — Amenity-Zwischenstopp, nicht Gastro/Transit.
 */
export function isMailboxAmenityIntent(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return MAILBOX_AMENITY_RE.test(t);
}

/** Kanonischer Amenity-Wish für Pitch/OSM (briefkasten | packstation). */
export function extractMailboxAmenityWish(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\b(packstation|paketautomat|parcel\s*locker)\b/iu.test(t)) {
    return 'packstation';
  }
  if (MAILBOX_AMENITY_RE.test(t)) return 'briefkasten';
  return null;
}

/**
 * „vorher zum Kindergarten …“ / „nochmal zum Club“ unter aktiver Nav.
 */
export function isOnRouteZwischenstoppIntent(
  text: string,
  hasActiveNav: boolean,
): boolean {
  if (!hasActiveNav) return false;
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Briefkasten/Packstation unter aktiver Nav → immer Zwischenstopp-Top-2
  if (isMailboxAmenityIntent(t)) return true;
  if (ON_ROUTE_HINT_RE.test(t)) return true;
  // „Können wir … zum X gehen/fahren?“ / „an einem Briefkasten vorbeifahren“
  if (
    /\b(können|koennen|lass|können\s+wir|koennen\s+wir)\b/iu.test(t) &&
    (/\b(zum|zur|nach|zu|an)\b/iu.test(t) || isMailboxAmenityIntent(t)) &&
    /\b(geh(?:en)?|fahr(?:en)?|stopp|halt(?:en)?|vorbeifahren|vorbei)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Klarer Eigenname/Typ-Ort für Direkt-Insert — null = vage Kategorie → Top-2.
 */
export function extractNamedOnRoutePlace(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // Vage Wünsche („Eis essen“) → Top-2
  if (DISH_OR_ACTIVITY_RE.test(t) && !GO_TO_RE.test(t)) return null;
  // Briefkasten/Packstation immer Top-2, nie Unique-Venue
  if (isMailboxAmenityIntent(t)) return null;

  const m = t.match(GO_TO_RE);
  if (!m?.[1]) return null;
  let name = m[1]
    .replace(STOP_TAIL_RE, '')
    .replace(/[.,!?].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // „in Stadt“ abschneiden — Stadt ist Bias, nicht Name
  name = name.replace(/\s+in\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+$/u, '').trim();
  if (name.length < 3) return null;
  if (isMailboxAmenityIntent(name) || VAGUE_CATEGORY_RE.test(name)) return null;
  // Reine Gattung ohne Eigenname
  if (
    /^(?:kindergarten|kita|schule|museum|kirche|bahnhof|hotel|club|verein)$/iu.test(
      name,
    )
  ) {
    // Gattung + optional Stadt zählt als klar genug für Unique-Insert-Versuch
    return name;
  }
  return name;
}

/** Resume/Continue Originalziel nach Zwischenstopp. */
export function isResumeOriginalDestIntent(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(danach|weiter|zurück|zurueck|weiter\s+zum|dann\s+(?:zum|zur|nach))\b/iu.test(
      t,
    ) && /\b(zum|zur|nach|zu|navigation|route)\b/iu.test(t)
  );
}
