/**
 * Kontext-Pitches für Free-Roam: Transit-Vorbeifahrt & Fahrrad.
 */

import type { PoiWithFacts } from '../../db/types';
import type { TransportMode } from '../navigation/navigationTypes';
import { isTransitMode } from '../navigation/transportMode';

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
  opts?: { navigatingElsewhere?: boolean },
): string {
  const name = poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  const tags = (poi.tags_json ?? '').toLowerCase();
  const looksMajor =
    /kirche|dom|museum|schloss|rathaus|platz|markt|denkmal/i.test(
      `${name} ${tags}`,
    );

  if (opts?.navigatingElsewhere) {
    return `Kurz am Rad: ${name} liegt hier.`;
  }

  if (looksMajor) {
    return `${name} — wenn du willst, kannst du kurz absteigen und einmal drumrumlaufen. Sonst rollen wir weiter.`;
  }

  return `${name} — vom Sattel aus kurz sichtbar. Wir rollen weiter; wenn du einen Foto-Stopp willst, sag Bescheid.`;
}
