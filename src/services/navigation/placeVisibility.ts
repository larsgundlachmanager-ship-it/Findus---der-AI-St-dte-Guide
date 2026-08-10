/**
 * Plausible Sichtbarkeit eines Orts von der aktuellen GPS-Position.
 * Kein echtes LOS — Distanz + Ortstyp-Heuristik für Speech-Visuals.
 */

import { haversineMeters } from '../../db/database';

export type PlaceVisibilityClass =
  | 'landmark_tall'
  | 'building'
  | 'shop_small'
  | 'unknown';

export type PlaceVisibility = {
  distanceM: number | null;
  placeClass: PlaceVisibilityClass;
  /** Plausibel sichtbar / erkennbar von hier */
  likelyVisible: boolean;
  /** Faktenzeile für Agent/Synthese — nie wörtlich vorlesen */
  promptLine: string;
};

const TALL_RE =
  /\b(turm|kirche|dom|cathedral|michel|elphi|elbphil|rathaus|aussicht|observation|skyscraper|hochhaus|brücke|bruecke|leuchtturm|fernsehturm|minarett|basilika|schloss|castle|denkmal|statue)\b/i;
const SHOP_RE =
  /\b(laden|shop|boutique|imbiss|kiosk|bäckerei|baeckerei|café|cafe|bar|kneipe|pub|apotheke|supermarket|supermarkt|dm\b|rewe|aldi)\b/i;

export function classifyPlaceVisibilityClass(
  name: string,
  extra = '',
): PlaceVisibilityClass {
  const blob = `${name} ${extra}`;
  if (TALL_RE.test(blob)) return 'landmark_tall';
  if (SHOP_RE.test(blob)) return 'shop_small';
  if (/\b(museum|galerie|theater|oper|hotel|bahnhof|station)\b/i.test(blob)) {
    return 'building';
  }
  return 'unknown';
}

/** Sicht-Radius je Klasse (m) — hohe Bauwerke: großzügiger. */
function visibilityRadiusM(cls: PlaceVisibilityClass): number {
  switch (cls) {
    case 'landmark_tall':
      return 3_500;
    case 'building':
      return 450;
    case 'shop_small':
      return 90;
    default:
      return 250;
  }
}

export function assessPlaceVisibility(opts: {
  userLat: number | null | undefined;
  userLng: number | null | undefined;
  placeLat: number | null | undefined;
  placeLng: number | null | undefined;
  placeName: string;
  extraHints?: string;
}): PlaceVisibility {
  const placeClass = classifyPlaceVisibilityClass(
    opts.placeName,
    opts.extraHints ?? '',
  );
  const uLat = opts.userLat;
  const uLng = opts.userLng;
  const pLat = opts.placeLat;
  const pLng = opts.placeLng;

  if (
    uLat == null ||
    uLng == null ||
    pLat == null ||
    pLng == null ||
    !Number.isFinite(uLat) ||
    !Number.isFinite(uLng) ||
    !Number.isFinite(pLat) ||
    !Number.isFinite(pLng)
  ) {
    return {
      distanceM: null,
      placeClass,
      likelyVisible: false,
      promptLine:
        'SICHTBARKEIT: unbekannt (kein Ort-GPS). Keine „vor dir / riesig vor dir“-Visuals. Allgemeine Beschreibung ok.',
    };
  }

  const distanceM = Math.round(haversineMeters(uLat, uLng, pLat, pLng));
  const radius = visibilityRadiusM(placeClass);
  const likelyVisible = distanceM <= radius;

  if (likelyVisible) {
    const distLabel =
      distanceM < 1000
        ? `${distanceM} m`
        : `${(distanceM / 1000).toFixed(1).replace('.', ',')} km`;
    return {
      distanceM,
      placeClass,
      likelyVisible: true,
      promptLine:
        `SICHTBARKEIT: ja (~${distLabel}). Visuelle Beschreibung der Silhouette/Fassade ok — ehrlich zur Distanz.` +
        (placeClass === 'landmark_tall'
          ? ' Hohes Bauwerk: auch aus etwas Entfernung erkennbar.'
          : ''),
    };
  }

  return {
    distanceM,
    placeClass,
    likelyVisible: false,
    promptLine:
      `SICHTBARKEIT: nein (~${distanceM < 1000 ? `${distanceM} m` : `${(distanceM / 1000).toFixed(1).replace('.', ',')} km`}). ` +
      `User sieht den Ort JETZT vermutlich nicht. KEINE Formulierungen ala „vor dir steht“, „riesig vor dir“, „schau mal“. ` +
      `Allgemeine Beschreibung / Fakten ok; optional Distanz erwähnen.`,
  };
}
