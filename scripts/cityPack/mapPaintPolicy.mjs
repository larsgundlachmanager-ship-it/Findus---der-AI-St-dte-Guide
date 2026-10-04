/**
 * Pack-SSOT: wie ein Ort auf der Karte gemalt wird — schon bei Datensatz-Erstellung.
 *
 *   map_paint:
 *     story_fill      → echte M1-Story: Idle-Fill + OSM-Gebäudeumriss Pflicht
 *     building_focus  → Directory-Gebäude: Idle nur Icon; Nav/Tap = echtes Haus
 *     icon_only       → Spielplatz/Zone/Punkt-Amenity: nie Fläche, Polygon raus
 *
 * Tags (landen in SQLite): map_story_fill | map_building_focus | map_icon_only
 */

export const MAP_PAINT = {
  STORY_FILL: 'story_fill',
  BUILDING_FOCUS: 'building_focus',
  ICON_ONLY: 'icon_only',
};

const MAP_PAINT_TAGS = {
  story_fill: 'map_story_fill',
  building_focus: 'map_building_focus',
  icon_only: 'map_icon_only',
};

/** Offene Fläche / Zone — nie Gebäude-Fill, auch nicht bei Nav. */
const OPEN_AREA_RE =
  /\b(spielplatz|playground|gewerbegebiet|industriegebiet|gewerbepark|feldmark|zonenweg|straßenverzeichnis|strassenverzeichnis|dorfgeschichte|übergreifend|uebergreifend|niederung|moor|auwald|\bwald\b|forst|angelteich|jagdgemeinschaft|arboretum|gartenschau|naturlehrpfad)\b/i;

/** Punkt-Amenities — Icon, kein Umriss. */
const POINT_AMENITY_RE =
  /\b(toilette|\bwc\b|briefkasten|post_box|trinkwasser|drinking_water|\batm\b|geldautomat|haltestelle|bus_stop|bushaltestelle|map_point|packstation|parcel_locker)\b/i;

/** Directory-Gebäude: Umriss ja, Idle-Fill nein. */
const BUILDING_FOCUS_CATS = new Set([
  'supermarket',
  'tankstelle',
  'gesundheit',
  'apotheke',
  'cafe',
  'restaurant',
  'bakerei',
  'bakery',
  'hotel',
  'service',
  'tourist_info',
  'einkaufen',
  'verwaltung',
  'sport',
  'freizeit',
  'eisdiele',
  'markt',
  'directory',
]);

const BUILDING_FOCUS_BLOB_RE =
  /\b(supermarket|supermarkt|edeka|rewe|aldi|lidl|penny|netto|marktkauf|frischecenter|tankstelle|fuel|apotheke|pharmacy|café|cafe|bäckerei|baeckerei|bäcker|baecker|bakery|restaurant|bistro|karosserie|werkstatt|tourist.?info|hotel|service)\b|gemeinschaftspraxis|arztpraxis|zahnarzt|\bpraxis\b|\barzt\b|doctor|gesundheit/i;

function blobOf(spot) {
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase()).join(' ');
  return `${spot.id || ''} ${spot.name || ''} ${spot.category || ''} ${tags}`;
}

function isStorySpot(spot) {
  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('directory') || tags.includes('tier4')) {
    // Hybrid: Directory-Tag, aber echte Story-Signale
    if (
      tags.includes('story') ||
      tags.includes('story_enriched') ||
      tags.includes('module1') ||
      tags.includes('must_have') ||
      tags.includes('historical_core')
    ) {
      return true;
    }
    return spot.pack_role === 'story' && Number(spot.place_tier) <= 2;
  }
  return (
    spot.pack_role === 'story' ||
    tags.includes('story') ||
    tags.includes('story_enriched') ||
    tags.includes('module1') ||
    tags.includes('must_have') ||
    Number(spot.place_tier) <= 2
  );
}

/**
 * @returns {'story_fill'|'building_focus'|'icon_only'}
 */
export function resolveMapPaint(spot) {
  const existing = String(spot.map_paint || '').toLowerCase().trim();
  if (
    existing === MAP_PAINT.STORY_FILL ||
    existing === MAP_PAINT.BUILDING_FOCUS ||
    existing === MAP_PAINT.ICON_ONLY
  ) {
    // Explizit gesetzt — nur Open-Area/Punkt überschreiben (Schutz vor Fehleintrag).
    const blob = blobOf(spot);
    if (OPEN_AREA_RE.test(blob) || POINT_AMENITY_RE.test(blob)) {
      return MAP_PAINT.ICON_ONLY;
    }
    return existing;
  }

  const tags = (spot.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('map_icon_only')) return MAP_PAINT.ICON_ONLY;
  if (tags.includes('map_story_fill')) return MAP_PAINT.STORY_FILL;
  if (tags.includes('map_building_focus')) return MAP_PAINT.BUILDING_FOCUS;

  const blob = blobOf(spot);
  if (OPEN_AREA_RE.test(blob) || POINT_AMENITY_RE.test(blob)) {
    return MAP_PAINT.ICON_ONLY;
  }
  if (tags.includes('map_point')) return MAP_PAINT.ICON_ONLY;

  if (isStorySpot(spot) && !OPEN_AREA_RE.test(blob)) {
    return MAP_PAINT.STORY_FILL;
  }

  const cat = String(spot.category || '').toLowerCase();
  if (BUILDING_FOCUS_CATS.has(cat) || BUILDING_FOCUS_BLOB_RE.test(blob)) {
    return MAP_PAINT.BUILDING_FOCUS;
  }

  // Rest Directory ohne Gebäude-Signal → Icon
  return MAP_PAINT.ICON_ONLY;
}

/** Tag-Set ohne alte map_*_ Tags, plus neuer Paint-Tag. */
export function mapPaintTagsFor(paint, existingTags = []) {
  const drop = new Set(Object.values(MAP_PAINT_TAGS));
  const next = (existingTags || [])
    .map((t) => String(t))
    .filter((t) => !drop.has(t.toLowerCase()));
  const add = MAP_PAINT_TAGS[paint];
  if (add) next.push(add);
  return [...new Set(next)];
}

/**
 * Stempel map_paint + Tags auf alle Spots.
 * icon_only: grobe Pack-Polygone entfernen (hässliche Zonen-Fills).
 */
export function stampMapPaintOnPack(pack) {
  let storyFill = 0;
  let buildingFocus = 0;
  let iconOnly = 0;
  let polysCleared = 0;
  for (const spot of pack.spots || []) {
    const paint = resolveMapPaint(spot);
    spot.map_paint = paint;
    spot.tags = mapPaintTagsFor(paint, spot.tags || []);
    if (paint === MAP_PAINT.STORY_FILL) storyFill += 1;
    else if (paint === MAP_PAINT.BUILDING_FOCUS) buildingFocus += 1;
    else iconOnly += 1;

    if (paint === MAP_PAINT.ICON_ONLY) {
      if (spot.polygonCoordinates || spot.polygon || spot.polygonRings) {
        delete spot.polygonCoordinates;
        delete spot.polygon;
        delete spot.polygonRings;
        polysCleared += 1;
      }
      const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
      if (trigger) {
        delete trigger.polygon;
        delete trigger.polygonCoordinates;
      }
    }
  }
  return { storyFill, buildingFocus, iconOnly, polysCleared };
}

export function needsBuildingFootprint(spot) {
  const paint = resolveMapPaint(spot);
  return (
    paint === MAP_PAINT.STORY_FILL || paint === MAP_PAINT.BUILDING_FOCUS
  );
}

export function isIconOnlyPaint(spot) {
  return resolveMapPaint(spot) === MAP_PAINT.ICON_ONLY;
}
