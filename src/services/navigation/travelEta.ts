/**
 * Standort-basierte ETA: immer vom aktuellen GPS, nie Ziel-zu-Ziel-Fantasy.
 * Wangerooge: Fähre/Inselbahn ehrlich einrechnen, wenn Nutzer noch nicht auf der Insel ist.
 */

import { haversineMeters } from '../../db/database';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import { env } from '../../config/env';

const WALK_M_PER_MIN = 80;
const BIKE_M_PER_MIN = 220;

/** Grobe Insel-Bounding-Box Wangerooge (ohne Harlesiel-Festland). */
const WANGEROOGE_BOX = {
  latMin: 53.772,
  latMax: 53.805,
  lngMin: 7.84,
  lngMax: 7.935,
};

/** Typische Zusatzzeiten: Überfahrt + Inselbahn Dorf. */
const FERRY_CROSSING_MIN = 55;
const INSELBAHN_MIN = 18;
const FERRY_BUFFER_MIN = 10;

export type TravelEta = {
  /** Distanz Luftlinie GPS → Ziel (m) */
  distanceM: number;
  /** Reine Fuß-/Rad-Minuten aus Distanz (ohne Logistik) */
  directWalkMinutes: number;
  /** Realistische Gesamtzeit inkl. Logistik */
  totalMinutes: number;
  /** Kurzlabel für Spickzettel / Prompt */
  label: string;
  /** Prompt-Hinweis für das LLM */
  promptHint: string;
  needsFerryLogistics: boolean;
};

function cityId(): string {
  return (
    getCachedUserProfile()?.cityId ||
    env.cityId?.() ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();
}

function mpm(): number {
  const mobility = resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  return mobility === 'bike' ? BIKE_M_PER_MIN : WALK_M_PER_MIN;
}

export function walkMinutesForDistanceM(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / mpm()));
}

export function isInsideWangeroogeIsland(lat: number, lng: number): boolean {
  return (
    lat >= WANGEROOGE_BOX.latMin &&
    lat <= WANGEROOGE_BOX.latMax &&
    lng >= WANGEROOGE_BOX.lngMin &&
    lng <= WANGEROOGE_BOX.lngMax
  );
}

/**
 * ETA vom aktuellen Nutzer-Standort zum Ziel.
 * Erfindet keine Zeiten — nur Haversine + bekannte Insel-Logistik.
 */
export function estimateTravelEta(opts: {
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  destName?: string;
}): TravelEta {
  const distanceM = Math.round(
    haversineMeters(opts.userLat, opts.userLng, opts.destLat, opts.destLng),
  );
  const directWalkMinutes = walkMinutesForDistanceM(distanceM);
  const name = (opts.destName ?? 'Ziel').trim() || 'Ziel';

  const onWangerooge = cityId() === 'wangerooge';
  const userOnIsland = isInsideWangeroogeIsland(opts.userLat, opts.userLng);
  const destOnIsland = isInsideWangeroogeIsland(opts.destLat, opts.destLng);

  // Nutzer noch Festland / Fähre → Inselziel: ehrliche Logistik statt „5 Min Fußweg“
  if (onWangerooge && !userOnIsland && destOnIsland) {
    const islandWalk = Math.min(directWalkMinutes, 25);
    const totalMinutes =
      FERRY_BUFFER_MIN + FERRY_CROSSING_MIN + INSELBAHN_MIN + islandWalk;
    const label = `Fähre + Inselbahn, insgesamt ca. ${totalMinutes} Min`;
    return {
      distanceM,
      directWalkMinutes,
      totalMinutes,
      label,
      needsFerryLogistics: true,
      promptHint:
        `ETA PFLICHT (vom GPS, nicht erfinden): ${name} ist auf der Insel, Nutzer noch NICHT auf Wangerooge ` +
        `(Distanz Luftlinie ${distanceM} m). Sag ehrlich: erst Fähre (ca. ${FERRY_CROSSING_MIN} Min), ` +
        `dann Inselbahn (ca. ${INSELBAHN_MIN} Min), danach kurzer Fußweg — insgesamt ca. ${totalMinutes} Min. ` +
        `NIEMALS „ca. 5 Minuten Fußweg“ oder reine Fußweg-ETA ohne Fähre/Inselbahn. ` +
        `Kompass-Navigation zum Insel-POI erst sinnvoll nach Ankunft auf der Insel; bis dahin Fähranleger/Inselbahn erklären.`,
    };
  }

  // Sehr große Distanz ohne Logistik-Sonderfall: ehrlich lang, kein Fantasie-Fußweg
  if (distanceM > 4_000) {
    const totalMinutes = Math.max(directWalkMinutes, 45);
    const label =
      directWalkMinutes >= 60
        ? `eher ${Math.round(directWalkMinutes / 60)} Std unterwegs`
        : `ca. ${totalMinutes} Min (nicht nur kurzer Fußweg)`;
    return {
      distanceM,
      directWalkMinutes,
      totalMinutes,
      label,
      needsFerryLogistics: false,
      promptHint:
        `ETA vom aktuellen GPS: ${distanceM} m → ca. ${directWalkMinutes} Min zu Fuß/Rad. ` +
        `Keine kürzere Zeit erfinden. Bei Wasser/Fähre dazwischen: Logistik erwähnen.`,
    };
  }

  const modeLabel =
    resolvePersonaEngine(getCachedUserProfile()).mobilityMode === 'bike'
      ? 'Rad'
      : 'Fußweg';
  return {
    distanceM,
    directWalkMinutes,
    totalMinutes: directWalkMinutes,
    label: `${modeLabel} ca. ${directWalkMinutes} Min`,
    needsFerryLogistics: false,
    promptHint:
      `ETA vom aktuellen GPS zu „${name}“: ${distanceM} m ≈ ${directWalkMinutes} Min ${modeLabel}. ` +
      `Nur diese Zahl nutzen — keine Fantasie-Minuten, keine Ziel-zu-Ziel-Rechnung.`,
  };
}

export function formatEtaBullet(eta: TravelEta): string {
  return eta.label;
}
