/**
 * Homescreen Gebäude-Fill — SSOT Display-Vertrag (Karte Rebuild):
 *
 * SPEICHERN: Perfekte OSM-Rings im Pack → SQLite (einmal laden → immer da).
 * ANZEIGEN Fill nur wenn:
 *   - Modul-1 würde auslösen (lila), ODER
 *   - Navigation/Plan zu diesem Ort (blau), ODER
 *   - besucht (grün bleibt).
 * Alltag/Directory/Fuel/Hard-Amenity: nie Fill (Basemap-Label / Icon).
 * Offene Flächen: nie Fill.
 * Persistenz: Overpass nur Lücken → sofort polygon_json; Pack-Ring first.
 */

export type IdleFillPoiLike = {
  name?: string | null;
  category?: string | null;
  tags_json?: string | null;
};

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).map((t) => t.trim().toLowerCase()).filter(Boolean);
  } catch {
    return String(raw)
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
}

function poiBlob(poi: IdleFillPoiLike): string {
  const tags = parseTags(poi.tags_json);
  return `${poi.name ?? ''} ${poi.category ?? ''} ${tags.join(' ')}`;
}

/**
 * Offene Flächen / Zonen — nie Pack-Polygon (hässlich über Häuser).
 * Icon oder Punkt reicht; kein Fill auch bei Popup/Nav.
 */
export const OPEN_AREA_NO_FILL_RE =
  /\b(spielplatz|playground|gewerbegebiet|industriegebiet|gewerbepark|feldmark|zonenweg|straßenverzeichnis|strassenverzeichnis|dorfgeschichte|übergreifend|uebergreifend|niederung|moor|auwald|\bwald\b|forst|angelteich|jagdgemeinschaft|arboretum|gartenschau|naturlehrpfad)\b/i;

/** Alltag ohne Story — nie Idle-Fill / nie Pack-Story auf der Karte. */
const NO_IDLE_FILL_BLOB_RE =
  /\b(supermarket|supermarkt|edeka|rewe|aldi|lidl|penny|netto|marktkauf|frischecenter|discounter|tankstelle|fuel|petrol|packstation|parcel_locker|paketautomat|\bdhl\b|ernsting|kleidung|fashion|toilette|\bwc\b|spielplatz|playground|parkplatz|parkhaus|briefkasten|post_box|geldautomat|\batm\b|gewerbegebiet|karosserie|service|gesundheit|praxis|arzt|apotheke|frisör|frisoer|salon|kiosk|postfiliale)\b/i;

/** Café/Restaurant mit echter Geschichte → Hybrid-Story-Signal (Fill nur via Status-Gate). */
const STORY_HYBRID_VENUE_RE =
  /\b(restaurant|gasthof|café|cafe|bistro|bäckerei|baeckerei|bäcker|baecker|museum|kirche|denkmal|historisch)\b/i;

/** Shop/Praxis: Fokus nur mit echtem Gebäude — Fill trotzdem nur Status-Gate. */
const EVERYDAY_BUILDING_FOCUS_RE =
  /\b(supermarket|supermarkt|edeka|rewe|aldi|lidl|penny|netto|marktkauf|frischecenter|tankstelle|fuel|apotheke|pharmacy|café|cafe|bäckerei|baeckerei|bäcker|baecker|bakery|restaurant|bistro|karosserie|werkstatt)\b|gemeinschaftspraxis|arztpraxis|zahnarzt|\bpraxis\b|\barzt\b|doctor|gesundheit/i;

/** Offene Fläche / Zone — nie einfärben. */
export function isMapOpenAreaNoFillPoi(poi: IdleFillPoiLike): boolean {
  const tags = parseTags(poi.tags_json);
  if (tags.includes('map_icon_only')) return true;
  if (tags.includes('map_story_fill') || tags.includes('map_building_focus')) {
    return OPEN_AREA_NO_FILL_RE.test(poiBlob(poi));
  }
  return OPEN_AREA_NO_FILL_RE.test(poiBlob(poi));
}

/** Pack-Story — auf der Homescreen-Karte halten. */
export function isPackStoryMapPoi(poi: IdleFillPoiLike): boolean {
  const tags = parseTags(poi.tags_json);
  const blob = poiBlob(poi);
  if (NO_IDLE_FILL_BLOB_RE.test(blob)) return false;
  if (OPEN_AREA_NO_FILL_RE.test(blob)) return false;
  if (
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('amenity_skip')
  ) {
    return false;
  }
  return tags.includes('story') || tags.includes('story_enriched');
}

/**
 * @deprecated Name historisch — bedeutet „Story-Kandidat für Status-Fill“,
 * nicht mehr „Idle immer rot einfärben“. Display = shouldPaintPlaceBuildingFill.
 */
export function isMapIdleStoryFillPoi(poi: IdleFillPoiLike): boolean {
  const tags = parseTags(poi.tags_json);
  // Pack-SSOT (Datensatz-Erstellung): map_paint Tags schlagen Heuristik.
  if (tags.includes('map_icon_only')) return false;
  if (tags.includes('map_building_focus')) return false;
  if (tags.includes('map_story_fill')) return true;
  const blob = poiBlob(poi);
  if (OPEN_AREA_NO_FILL_RE.test(blob)) return false;
  if (NO_IDLE_FILL_BLOB_RE.test(blob)) return false;
  if (isPackStoryMapPoi(poi)) return true;
  const hasStorySignal =
    tags.includes('story') ||
    tags.includes('story_enriched') ||
    tags.includes('geschichte') ||
    tags.includes('historical_core') ||
    tags.includes('landmark') ||
    tags.includes('must_have') ||
    tags.includes('module1');
  if (
    hasStorySignal &&
    STORY_HYBRID_VENUE_RE.test(blob) &&
    !NO_IDLE_FILL_BLOB_RE.test(blob)
  ) {
    return true;
  }
  return false;
}

/**
 * Gebäude-Fill zeichnen? — einziger Display-Gate (SSOT).
 * visited | nav/plan | modul1Auto — sonst nie.
 */
export function shouldPaintPlaceBuildingFill(opts: {
  visited: boolean;
  navOrPlanFocus: boolean;
  modul1Auto: boolean;
  openArea: boolean;
  /** Fuel/Toilette/Briefkasten/Hard-Amenity-Punkt */
  streetPointAmenity: boolean;
  /** Directory ohne Pack-Story */
  directoryNoStory: boolean;
}): boolean {
  if (opts.openArea) return false;
  if (opts.streetPointAmenity) return false;
  if (opts.directoryNoStory) return false;
  return opts.visited || opts.navOrPlanFocus || opts.modul1Auto;
}

/**
 * Directory-Alltag: beim Tippen/Nav höchstens echtes Gebäude —
 * nie die grobe Pack-Zone. Fill trotzdem nur via shouldPaintPlaceBuildingFill.
 */
export function isMapEverydayBuildingFocusPoi(poi: IdleFillPoiLike): boolean {
  const tags0 = parseTags(poi.tags_json);
  if (tags0.includes('map_building_focus')) return true;
  if (tags0.includes('map_icon_only') || tags0.includes('map_story_fill')) return false;
  if (isMapOpenAreaNoFillPoi(poi)) return false;
  if (isMapIdleStoryFillPoi(poi)) return false;
  const tags = tags0;
  const blob = poiBlob(poi);
  const isDirectory =
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('amenity_skip') ||
    tags.includes('map_outline');
  if (!isDirectory && !EVERYDAY_BUILDING_FOCUS_RE.test(blob)) return false;
  return EVERYDAY_BUILDING_FOCUS_RE.test(blob);
}

/** Alltag — nie Modul-1-Auto-Story (Name/Kategorie/Tags). */
export const NO_MODUL1_AUTO_BLOB_RE =
  /\b(supermarket|supermarkt|edeka|rewe|aldi|lidl|penny|netto|marktkauf|frischecenter|discounter|tankstelle|fuel|petrol|packstation|parcel_locker|paketautomat|\bdhl\b|ernsting|kleidung|fashion|spielplatz|playground|toilette|\bwc\b|gewerbegebiet|karosserie|praxis|arzt)\b/i;
