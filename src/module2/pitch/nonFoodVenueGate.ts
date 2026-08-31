/**
 * Infrastruktur, die nie als Gastro-Pitch durchrutschen darf.
 * Keine Ortsnamen — nur Amenity-/Namens-Signale (Parkplatz, Waldparkplatz, OSM parking).
 */

const PARKING_TYPE_RE =
  /\b(parking|parking_space|parking_entrance|park_and_ride|amenity\s*[=:]\s*parking)\b/i;

const PARKING_NAME_RE =
  /waldparkplatz|wanderparkplatz|forstparkplatz|parkplatz|parkhaus|\bp\+\s*r\b|\bparking\s*lot\b|\bcar\s*park\b/i;

const GASTRO_IN_NAME_RE =
  /\b(restaurant|gasthof|gasthaus|gaststätte|gaststaette|wirtshaus|brasserie|trattoria|osteria|pizzeria|bistro|café|cafe|imbiss|steakhouse|grillhaus)\b/i;

/** Discounter / Verbrauchermarkt — nie Sit-down-Gastro, auch mit Places-Typ `food`. */
const GROCERY_TYPE_RE =
  /\b(supermarket|grocery_store|convenience_store|hypermarket|discount_store|shopping_mall|department_store|wholesale)\b/i;

const GROCERY_NAME_RE =
  /\b(aldi|lidl|rewe|edeka|kaufland|penny|netto|norma|marktkauf|famila|konsum|frischecenter|verbrauchermarkt|einkaufszentrum|einkaufcenter|allwörden|allwoerden)\b/i;

export function isParkingOrForestLotVenue(
  name: string,
  extra?: string | string[] | null,
): boolean {
  const extraBlob = Array.isArray(extra) ? extra.join(' ') : extra ?? '';
  const nameBlob = String(name ?? '');
  const blob = `${nameBlob} ${extraBlob}`;
  const gastroName = GASTRO_IN_NAME_RE.test(nameBlob);
  if (PARKING_NAME_RE.test(nameBlob) && !gastroName) return true;
  if (PARKING_TYPE_RE.test(blob) && !gastroName) return true;
  return false;
}

/** Markt / Discounter / Markt-Theke — kein Asia-Restaurant und kein Out-of-box-Gastro. */
export function isGroceryOrMarketCounterVenue(
  name: string,
  extra?: string | string[] | null,
): boolean {
  const extraBlob = Array.isArray(extra) ? extra.join(' ') : extra ?? '';
  const nameBlob = String(name ?? '');
  const blob = `${nameBlob} ${extraBlob}`;
  if (GASTRO_IN_NAME_RE.test(nameBlob) && !GROCERY_NAME_RE.test(nameBlob)) {
    return false;
  }
  if (GROCERY_TYPE_RE.test(blob) || GROCERY_NAME_RE.test(blob)) return true;
  // Bäckerei-Theke im Markt (nicht Straßen-Restaurant)
  if (
    /\b(bäck|baeck|bakery|theke)\b/i.test(blob) &&
    /\b(markt|marktkauf|frischecenter|edeka|rewe|center)\b/i.test(blob)
  ) {
    return true;
  }
  return false;
}


/** Approach/Teaser-POIs nie als Auswahl-Option pitchen. */
export function isWegweiserOrApproachName(
  name: string,
  tags?: string | null,
): boolean {
  const blob = `${name} ${tags ?? ''}`.toLowerCase();
  return (
    /\bwegweiser\b/.test(blob) ||
    /\bapproach\b/.test(blob) ||
    /\bteaser\b/.test(blob) ||
    /\bearly[_\s-]?teaser\b/.test(blob) ||
    /[·•|]\s*wegweiser\s*$/i.test(name.trim())
  );
}

/** Eingang/Sub-POI nie als zweite Pitch-Karte neben dem Hauptort. */
export function isSubEntranceName(
  name: string,
  tags?: string | null,
): boolean {
  const blob = `${name} ${tags ?? ''}`.toLowerCase();
  return (
    /\b(sub_poi|haupteingang|nebengingang|neben\s*eingang)\b/.test(blob) ||
    /[·•|]\s*(haupt)?eingang\s*$/i.test(name.trim())
  );
}
