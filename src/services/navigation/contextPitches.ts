/**
 * Kontext-Pitches für Free-Roam: Transit-Vorbeifahrt & Fahrrad.
 */

import type { PoiWithFacts } from '../../db/types';
import type { TransportMode } from './navigationTypes';
import { isTransitMode } from './transportMode';
import {
  findNearbyBikeShare,
  formatBikeParkHint,
} from '../mobility/bikeShare';
import {
  findNearbyParking,
  formatParkingHint,
} from '../mobility/parking';

export function isDriveByTransitMode(mode: TransportMode | null): boolean {
  return mode != null && isTransitMode(mode);
}

export function isActiveBicycleMode(mode: TransportMode | null): boolean {
  return mode === 'bicycle';
}

/** ~10-Sekunden-Erwähnung beim Vorbeifahren — leicht, ohne Absteigen-Druck. */
export function buildTransitDriveByPitch(
  poi: PoiWithFacts,
  opts?: { nextStationHint?: string | null; navigatingElsewhere?: boolean },
): string {
  const name = poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  const teaser =
    (poi.teaser_text ?? '').trim() ||
    poi.facts
      .find((f) => f.fact_text.startsWith('[Teaser]'))
      ?.fact_text.replace(/^\[Teaser\]\s*/u, '')
      .trim() ||
    '';
  const short =
    teaser.length > 0
      ? teaser.length > 110
        ? `${teaser.slice(0, 107).trim()}…`
        : teaser
      : `${name} — kurz erwähnt.`;

  // Während Navigation zu anderem Ziel: nur erwähnen, nicht umleiten
  if (opts?.navigatingElsewhere) {
    return `Nebenbei: ${name}. ${short}`;
  }

  return `Kurz vorbei an ${name}: ${short}`;
}

/** Fahrrad: kurze Erwähnung — kein „lohnt sich nicht abzusteigen“. */
export function buildBicycleContextPitch(
  poi: PoiWithFacts,
  opts?: { navigatingElsewhere?: boolean; parkHint?: string | null },
): string {
  const name = poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  const tags = (poi.tags_json ?? '').toLowerCase();
  const looksMajor =
    /kirche|dom|museum|schloss|rathaus|platz|markt|denkmal/i.test(
      `${name} ${tags}`,
    );
  const park = opts?.parkHint?.trim();

  if (opts?.navigatingElsewhere) {
    return park
      ? `Kurz am Rad: ${name}. ${park}`
      : `Kurz am Rad: ${name} liegt hier.`;
  }

  if (looksMajor) {
    const base = `${name} — wenn du willst, kannst du kurz absteigen und einmal drumrumlaufen. Sonst rollen wir weiter.`;
    return park ? `${base} ${park}` : base;
  }

  const base = `${name} — vom Sattel aus kurz sichtbar. Wir rollen weiter; wenn du einen Foto-Stopp willst, sag Bescheid.`;
  return park ? `${base} ${park}` : base;
}

/**
 * Holt nextbike / Call a Bike / Pack-Parking und baut „Rad hier abstellen?“-Hinweis.
 */
export async function resolveBikeParkHintNear(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const [share, parking] = await Promise.all([
      findNearbyBikeShare({ lat, lng, radiusM: 600, limit: 3 }),
      findNearbyParking({ lat, lng, radiusM: 500, preferBike: true, limit: 3 }),
    ]);
    return (
      formatBikeParkHint(share) ||
      formatParkingHint(parking, { forBike: true }) ||
      null
    );
  } catch {
    return null;
  }
}
