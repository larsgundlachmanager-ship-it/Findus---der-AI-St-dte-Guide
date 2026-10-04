/**
 * Homescreen Presence-Karte — Farben SSOT (App-Grün, gelbe Straßen, Ort-Töne).
 * Marktreife: ruhige Hierarchie, lesbare Grenzen, kein Neon-Fog.
 */

import { colors } from '../../constants/theme';
import { MODUL1_MAP_COLORS } from '../navigation/stampMapModul1';
import type { HomeMapCityTone } from './homeMapCityTone';

/**
 * Karten-Hintergrund = Land-Füllung. Sonst dunkle/helle Quadrate
 * (fehlende Wiesen-Kachel vs. Landuse-Kachel).
 */
/** Land — kräftigeres Grün/Petrol (vorher zu dunkel/schwach). */
export const HOME_MAP_LAND_MUTED = '#0F4A3A';
export const HOME_MAP_BG = HOME_MAP_LAND_MUTED;

/**
 * OSM-Gebäude — Vision: gedämpftes Waldgrün-Flächen,
 * heller Umriss für klare Silhouette auf dunklem Land.
 */
export const HOME_MAP_BUILDING_FILL = '#1A6949';
export const HOME_MAP_BUILDING_STROKE = '#D8E8DE';

/**
 * Wasser — dunkles Petrol mit etwas mehr Kontrast zum Land.
 * Bewusst dunkler als Wald, aber ohne knalliges See-Blau.
 */
export const HOME_MAP_WATER = '#0A2420';
export const HOME_MAP_PARK = '#1F5240';
/** Wald — klarer grüner als Wasser, nicht schwarz (sonst wirkt wie See). */
export const HOME_MAP_WOOD = '#216048';

export const HOME_MAP_ROAD_COLORS = {
  major: '#E4C45C',
  street: '#CFAE4E',
  path: '#B09048',
} as const;

/** Straßen-Namen auf der Basiskarte — hell auf dunklem Grün */
export const HOME_MAP_STREET_LABEL = {
  text: '#F0E6C8',
  halo: '#0F3A2E',
  haloWidth: 1.35,
} as const;

/**
 * Physische Gleise (OSM-Extract) — Stahlgrau.
 * Nicht lila: das ist die berechnete Route (HOME_MAP_ROUTE_AHEAD / liked).
 */
export const HOME_MAP_RAIL = '#8E9BA3';

/**
 * Fog-Konzept (Native):
 * - Kein Abdunkeln der Karte (kein Viewport-Schleier / kein dunkler Kasten beim Drehen/Rauszoomen).
 * - Nur erkundeter Pfad = Eis-Cyan-Reveal auf der normalen Basiskarte.
 */
/** Legacy-Maskenfarbe — nur wenn Maske wieder an. */
export const HOME_MAP_FOG_FILL = '#0A1524';
/** Masken-Deckkraft (0–1) — irrelevant solange Maske aus. */
export const HOME_MAP_FOG_MASK_OPACITY = 0.34;
/**
 * Schon erkundet — kühles Eis-Cyan (nicht Mic-Grün = Basiskarte).
 * Klarer Kontrast zu Land `#0F4A3A`, ohne Neon.
 */
export const HOME_MAP_FOG_REVEAL = '#7AD4E8';
/** Fog-Reveal-Deckkraft (0–1). */
export const HOME_MAP_FOG_REVEAL_OPACITY = 0.3;
/** Weicher Reveal-Rand (1 px Outline). */
export const HOME_MAP_FOG_REVEAL_EDGE = 'rgba(190, 245, 255, 0.5)';
/**
 * Viewport-Schleier über Unerkundetem — AUS.
 * Eingefrorene Boot-Bounds wirkten als dunkles, mitgedrehtes Viereck.
 * Reveal (Eis-Cyan-Pfad) bleibt an.
 */
export const HOME_MAP_FOG_MASK_ENABLED = false;

export const HOME_MAP_FOG_ENABLED = true;

/** Nav-Trail (A): nur Kernlinie — dicker, ohne Glow, kein Alpha-Stack. */
export const HOME_MAP_FOG_TRAIL_CORE_WIDTH = 10;
export const HOME_MAP_FOG_TRAIL_GLOW_WIDTH = 0;
export const HOME_MAP_FOG_TRAIL_CORE_OPACITY = 0.72;
export const HOME_MAP_FOG_TRAIL_GLOW_OPACITY = 0;

/**
 * Reveal früh sichtbar (kein „Fog fehlt beim Rauszoomen“).
 */
export const HOME_MAP_FOG_ZOOM = {
  goneAt: 6.5,
  fullAt: 9.0,
} as const;

/** Pitch / Bullets / Actions: Karte 50 % dunkler. */
export const HOME_MAP_CHROME_DIM = 0.5;

/** Aktive Wegführung — helleres Blau = aktuelles Bein */
export const HOME_MAP_ROUTE_LINE = '#3B7DD8';
export const HOME_MAP_ROUTE_LINE_CASING = '#1A4A8A';
/** Wegweiser-Preview (vor Tap) — gestricheltes Gelb */
export const HOME_MAP_ROUTE_PREVIEW = '#FFC107';
export const HOME_MAP_ROUTE_PREVIEW_CASING = '#B8860B';
/** Weitere Tour-Beine — Violett wie Modul-1-Trigger-Gebäude */
export const HOME_MAP_ROUTE_AHEAD = MODUL1_MAP_COLORS.liked;
export const HOME_MAP_ROUTE_AHEAD_CASING = '#4A2E7A';

export const HOME_MAP_PLACE_COLORS = {
  visited: MODUL1_MAP_COLORS.visited,
  liked: MODUL1_MAP_COLORS.liked,
  neutral: MODUL1_MAP_COLORS.neutral,
  planned: MODUL1_MAP_COLORS.planned,
  unwanted: MODUL1_MAP_COLORS.unwanted,
  /** Ruhiges Rest-Gelb: existiert, keine Story — nicht aggressiv. */
  rest: '#C6B889',
  tourist: '#C6B889',
  transit: '#7E98A8',
} as const;

/** Typ-Chips — eigene, gedämpfte Farben (nicht das Rest-Gelb). */
export const HOME_MAP_TYPE_COLORS: Record<string, string> = {
  transit: '#7E98A8',
  restaurant: '#B8876A',
  cafe: '#C4A06A',
  museum: '#7A6EA8',
  kultur: '#8A7A9E',
  hotel: '#9A8496',
  einkaufen: '#A8946C',
  freizeit: '#6A9A86',
  natur: '#6B9B7A',
  aktivitaet: '#5E8F8A',
  historie: '#8B7355',
  notfall: '#6A8FA8',
  alltag: '#C6B889',
};

export type HomeMapPlaceTone =
  | 'visited'
  | 'liked'
  | 'neutral'
  | 'planned'
  | 'unwanted'
  | 'rest'
  | 'tourist'
  | 'transit';

/**
 * Stadtflächen (Pack-Grenzen) — weiche Füllfarben, klare aber ruhige Kontur.
 * Kein Ampel-Rot/Neon-Grün: wirkt sonst wie Markierung statt Karte.
 */
export const HOME_MAP_CITY_FILL = {
  /** ≥30 Min vor Ort */
  visited: '#2E8F5C',
  /** Fester Timeline-Ort in dieser Stadt */
  planned: '#3A6FA8',
  /** Pack-Stadt, noch nicht da und nicht geplant */
  catalog: '#A85848',
} as const;

export const HOME_MAP_CITY_STROKE = {
  /** Klare weiße Kontur — Datensatz-Grenze auf dunkler Karte. */
  downloaded: '#F2F7F4',
  planned: '#F2F7F4',
  catalog: '#F2F7F4',
} as const;

export const HOME_MAP_CITY_FILL_OPACITY = {
  visited: 1,
  planned: 1,
  catalog: 1,
} as const;

/**
 * Rubbel-Füllung nach Zoom (höher = näher).
 * Übergang = solange detailliertere Straßen ausblenden
 * (Labels/Nebennetz ~12.8 → minorFrom ~10.4).
 * - Nah: klar. - Während Detailstraßen weggehen: Farbe rein.
 * - Wenn sie weg sind: Füllung fertig (Rot/Grün/Blau bleiben).
 * Kontur bleibt länger als die Füllung.
 */
export const HOME_MAP_CITY_FILL_ZOOM = {
  /** Pack-Stadtflächen ab Europa-Zoom. */
  visibleFrom: 2.6,
  /** Noch dichtes Detailnetz → Opacity 0. */
  noneAt: 12.8,
  /** Start: detailliertere Straßen beginnen auszublenden. */
  at12: 12.2,
  /** Mitte der Ausblendung. */
  at10: 11.4,
  /** Detailstraßen weg → Füllung fertig. */
  at85: 10.6,
  at57: 5.8,
  at35: 3.5,
  opacityNone: 0,
  opacity35: 0.55,
  opacity57: 0.75,
  opacity85: 0.8,
  opacity10: 0.55,
  opacity12: 0.28,
} as const;

/**
 * Pack-Stadt-Kontur bleibt bis Street-Zoom lesbar
 * („bis hier geht der Datensatz“).
 */
export const HOME_MAP_CITY_OUTLINE_UNTIL = 17.5;

/** Orts-Gebäudefüllung — Status-Ton klar lesbar (~80 %). */
export const HOME_MAP_PLACE_FILL_OPACITY = 0.8;

/** Ländergrenzen — hell und klar auf dunklem Land. */
export const HOME_MAP_COUNTRY_BORDER = '#F2F7F4';

/** Ozean unter dem Welt-Land — dunkles Petrol, kein knalliges Blau. */
export const HOME_MAP_OCEAN = '#0B2622';
/** Fern-Zoom Land — heller als Street-Grün, nur Overlay. */
export const HOME_MAP_LAND_FAR = '#3B8A70';

/** Grobe Stadtflächen (Natural Earth), ohne Pack-Häuser. */
export const HOME_MAP_URBAN_FILL = '#1A5242';

/** Bundesländer / Regionen — schwächer als Staatsgrenzen, aber lesbar. */
export const HOME_MAP_ADMIN1_BORDER = '#A8C0B4';
export const HOME_MAP_ADMIN1_FILL = '#175244';

/**
 * Zoom-Treppe Welt → Europa → Land → Bundesland → Stadt-Pack.
 * Kein Sprung von Street-Zoom direkt auf den Globus.
 */
export const HOME_MAP_OVERVIEW_LOD = {
  /** Ländergrenzen weltweit lesbar */
  countryFrom: 1.2,
  /** Europa füllt den Schirm — Grenzen kräftiger */
  europeFrom: 3.6,
  /** Bundesländer / Regionen (Schleswig-Holstein …) */
  admin1From: 5.0,
  /** Bundesländer / Regionen — früher aus, bevor Pack-Grenzen dicht werden */
  admin1Until: 7.2,
  /** Grobe Stadtflächen — bis Extract-Land (~9.4) überlappen */
  urbanFrom: 5.8,
  urbanUntil: 9.4,
} as const;

/** EU/World-Layer: ab Zoom 10 übernimmt der Stadt-Extract — GPU sparen. */
export const HOME_MAP_WORLD_MAX_ZOOM = 10;

export const HOME_MAP_WORLD_STRUCTURE_LOD = {
  riversMajorFrom: 2.0,
  riversMajorUntil: 9.2,
  /** Detail-Flüsse erst nah — sonst schwarzer Fleck über DE */
  riversDetailFrom: 6.8,
  riversDetailUntil: 9.6,
  /** Nur Autobahn / ganz grobe Fernstraßen auf Europa-Zoom */
  roadsFarFrom: 3.2,
  roadsFarUntil: 5.4,
  /** Bundesstraßen erst wenn DE wirklich lesbar ist */
  roadsNearFrom: 5.4,
  roadsNearUntil: 9.2,
  /** Feinere NE-Straßen bis Extract */
  roadsMidFrom: 7.0,
  roadsMidUntil: 9.4,
  citiesMajorFrom: 2.0,
  citiesMajorUntil: 8.6,
  citiesMidFrom: 4.2,
  /** Pack-Stadtlabels ab 8.5 — Welt-Namen vorher aus, sonst Doppel-Tornesch. */
  citiesMidUntil: 8.4,
  regionsFrom: 4.0,
  regionsUntil: 8.8,
  /**
   * Ländernamen: sobald Straßen/Stadtnetz weg sind (Weit-Zoom).
   * Aus, bevor Bundesländer/Regionen dichter werden.
   */
  countriesFrom: 1.4,
  countriesUntil: 5.6,
} as const;

/**
 * Straßennamen nur auf der Linien-Geometrie — erst wenn die Straße dick genug
 * ist und der Text mit maxAngle/Collision wirklich passt.
 */
export const HOME_MAP_STREET_LABEL_LOD = {
  /** Autobahn / Major — ab Übersicht */
  majorFrom: 11.2,
  /** normale Straßen (k=1) */
  streetFrom: 12.8,
  /** Kurven dürfen Labels behalten (vorher 22° → fast nichts sichtbar) */
  maxAngleDeg: 48,
  spacing: 160,
} as const;

/**
 * Zoom-Stufen für Basiskarte (SSOT).
 * Street-Zoom (≥14) bleibt detailliert — Fog/Gebäude/Orte unverändert.
 */
export const HOME_MAP_BASE_LOD = {
  /** Autobahn / große Flüsse ab hier */
  motorwayFrom: 3,
  /** Bundesstraßen / Primary */
  primaryFrom: 8.2,
  /** Weniger Straßen (früher unter 9) — Wohnnetz schon in Stadt-Übersicht. */
  secondaryFrom: 9.2,
  /** Wohn-/Nebenstraßen — früher, sonst „fehlen Straßen“ beim Rauszoomen */
  minorFrom: 10.4,
  /** Wälder/Parks komplett weg (7 und weiter raus) */
  woodsGoneBelow: 7,
  /** Wälder fast weg */
  woodsAlmostGone: 8.5,
  /** Wälder beginnen auszublenden */
  woodsReduceFrom: 10.2,
} as const;

/**
 * Einheitlicher Zoom-Fade für Fog, Gebäude, Orte und Punkte.
 * 10.5 = voll sichtbar · 10.0 = weg (kein hartes Cut bei 12.5).
 */
export const HOME_MAP_DETAIL_FADE = {
  goneAt: 10.0,
  fullAt: 10.5,
} as const;

/**
 * Alltag-Icons (Briefkasten, WC, Arzt, Parkplatz, Kita, …).
 * Unter Stadt-Übersicht weg — sonst klebt der Schirm voller Bäume/Sterne.
 */
export const HOME_MAP_STREET_AMENITY_ZOOM = {
  goneAt: 14.8,
  fullAt: 15.4,
} as const;

/** Park / Wald — erst ganz nah, sonst wirkt jeder Baum wie ein Orts-Pin. */
export const HOME_MAP_PARK_ZOOM = {
  goneAt: 15.2,
  fullAt: 15.8,
} as const;

export function colorsForHomeMapCityTone(tone: HomeMapCityTone): {
  fill: string;
  stroke: string;
  fillOpacity: number;
  dashed: boolean;
} {
  if (tone === 'visited') {
    return {
      fill: HOME_MAP_CITY_FILL.visited,
      stroke: HOME_MAP_CITY_STROKE.downloaded,
      fillOpacity: HOME_MAP_CITY_FILL_OPACITY.visited,
      dashed: false,
    };
  }
  if (tone === 'planned') {
    return {
      fill: HOME_MAP_CITY_FILL.planned,
      stroke: HOME_MAP_CITY_STROKE.planned,
      fillOpacity: HOME_MAP_CITY_FILL_OPACITY.planned,
      dashed: false,
    };
  }
  return {
    fill: HOME_MAP_CITY_FILL.catalog,
    stroke: HOME_MAP_CITY_STROKE.catalog,
    fillOpacity: HOME_MAP_CITY_FILL_OPACITY.catalog,
    dashed: false,
  };
}

/** OpenFreeMap Vector-Tiles (weltweit) */
export const HOME_MAP_VECTOR_STYLE =
  'https://tiles.openfreemap.org/styles/liberty';

/** Mikrofon-Grün als Referenz (Theme) */
export const HOME_MAP_MIC_GREEN = colors.online;
