/**
 * Facing-Prefix für Concierge/Amenity — Kompass, kein LLM-Raten.
 */

import { lookCueSpeechToDest } from '../../services/navigation/module1Facing';
import { useFinnusStore } from '../../store/useFinnusStore';

/** „nach rechts, etwa 10 Meter“ wenn User-GPS + Ziel da; sonst null. */
export function facingPrefixForDest(opts: {
  destLat: number;
  destLng: number;
  /** Nur wenn in Sichtweite sinnvoll (Default 250 m) */
  maxDistM?: number;
}): string | null {
  try {
    const s = useFinnusStore.getState();
    const uLat = s.lastGpsLat;
    const uLng = s.lastGpsLng;
    if (
      typeof uLat !== 'number' ||
      typeof uLng !== 'number' ||
      !Number.isFinite(opts.destLat) ||
      !Number.isFinite(opts.destLng)
    ) {
      return null;
    }
    const cue = lookCueSpeechToDest({
      userLat: uLat,
      userLng: uLng,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
    if (!cue) return null;
    const max = opts.maxDistM ?? 250;
    // Distanz aus Phrase grob: wenn „Kilometer“ → zu weit für Facing-Fokus
    if (/kilometer/i.test(cue) && max <= 800) return null;
    const m = cue.match(/etwa\s+(\d+)\s+Meter/i);
    if (m) {
      const d = Number(m[1]);
      if (Number.isFinite(d) && d > max) return null;
    }
    return cue;
  } catch {
    return null;
  }
}

/** Draft mit Facing-Prefix, ohne Doppelung. */
export function withFacingPrefix(
  draft: string,
  destLat: number | null | undefined,
  destLng: number | null | undefined,
  maxDistM?: number,
): string {
  if (
    destLat == null ||
    destLng == null ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng)
  ) {
    return draft;
  }
  if (/\b(nach\s+(links|rechts)|geradeaus|vor\s+dir)\b/i.test(draft)) {
    return draft;
  }
  const face = facingPrefixForDest({
    destLat,
    destLng,
    maxDistM,
  });
  if (!face) return draft;
  return `${face.charAt(0).toUpperCase()}${face.slice(1)} — ${draft}`;
}
