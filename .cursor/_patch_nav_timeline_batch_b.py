# -*- coding: utf-8 -*-
"""Batch B: last-walk seedPath, platform badges, chips, naming, accordion."""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def patch(path: str, old: str, new: str, label: str) -> None:
    p = ROOT / path
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"FAIL {label}: old block not found in {path}")
    write_atomic(p, t.replace(old, new, 1))
    print(f"ok {label}")


# --- tourAheadRouteCache: only seed paths that actually connect a→b ---
patch(
    "src/services/navigation/tourAheadRouteCache.ts",
    """function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  const fromB = Array.isArray(b.path) && b.path.length >= 3 ? b.path : null;
  if (fromB) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 3 ? a.path : null;
  if (fromA) return fromA;
  return null;
}""",
    """function haversineRoughM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = (aLat - bLat) * 111_320;
  const dLng = (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** Nur wenn die Polyline wirklich von a nach b geht — sonst klaut der Alight-Rail-Pfad den Fußweg zum Ziel. */
function pathConnects(a: AheadCoord, b: AheadCoord, path: AheadCoord[]): boolean {
  if (path.length < 2) return false;
  const start = path[0]!;
  const end = path[path.length - 1]!;
  return (
    haversineRoughM(start.lat, start.lng, a.lat, a.lng) < 90 &&
    haversineRoughM(end.lat, end.lng, b.lat, b.lng) < 90
  );
}

function seedPath(a: AheadCoord, b: AheadCoord): AheadCoord[] | null {
  const fromB = Array.isArray(b.path) && b.path.length >= 3 ? b.path : null;
  if (fromB && pathConnects(a, b, fromB)) return fromB;
  const fromA = Array.isArray(a.path) && a.path.length >= 3 ? a.path : null;
  if (fromA && pathConnects(a, b, fromA)) return fromA;
  return null;
}""",
    "seedPath connect check",
)

# --- navRouteMapPayload: chip + platform ---
patch(
    "src/services/navigation/navRouteMapPayload.ts",
    """function gleisBit(plat?: string | null): string {
  const p = (plat ?? '').trim();
  if (!p) return '';
  const asGleis = p.replace(/^(?:bus)?steig\\b/i, 'Gleis').trim();
  return /gleis|kante|abschnitt|abfahrbereich/i.test(asGleis)
    ? asGleis
    : `Gleis ${asGleis}`;
}

export function chipForTourStop(
  s: {
    role?: string | null;
    name: string;
    line?: string | null;
    headsign?: string | null;
    platform?: string | null;
    delaySec?: number | null;
    vehicleStartMs?: number | null;
    startMs?: number | null;
  },
  next?: {
    role?: string | null;
    name?: string;
    line?: string | null;
    headsign?: string | null;
    startMs?: number | null;
  } | null,
): { title: string; sub?: string } | null {
  const plat = gleisBit(s.platform);
  const line = (s.line || next?.line || '').trim();
  const head = (s.headsign || next?.headsign || '').trim();
  const when = chipClock(s.vehicleStartMs ?? next?.startMs ?? null);
  const delay = delayBit(s.delaySec ?? null);
  const ride = line ? (head ? `${line} nach ${head}` : line) : '';
  if (s.role === 'dest') {
    return { title: stripPinName(s.name) || 'Ziel' };
  }
  if (s.role === 'walk' || s.role === 'board') {
    const title = ride || stripPinName(s.name);
    const bits: string[] = [];
    if (plat) bits.push(plat);
    if (when) bits.push(when);
    if (delay) bits.push(delay);
    const alightAt =
      next?.role === 'alight' ? stripPinName(next.name || '') : '';
    if (alightAt) bits.push(`Ausstieg ${alightAt}`);
    if (!bits.length) return { title: stripPinName(s.name) };
    return { title, sub: bits.join(' · ') };
  }
  if (s.role === 'transfer' || s.role === 'alight') {
    const nxtLine = (next?.line || '').trim();
    const ownLine = (s.line || '').trim();
    const nxtHead = (next?.headsign || '').trim();
    const realTransfer =
      next &&
      (next.role === 'alight' || next.role === 'board') &&
      nxtLine &&
      nxtLine !== ownLine;
    if (realTransfer) {
      return {
        title: `Umsteigen ${nxtLine}${nxtHead ? ` nach ${nxtHead}` : ''}`,
        sub: [plat, when].filter(Boolean).join(' · ') || undefined,
      };
    }
    if (!next || next.role === 'dest' || next.role === 'walk') {
      const bits = [plat, ride].filter(Boolean);
      return {
        title: `Aussteigen · ${stripPinName(s.name)}`,
        sub: bits.length ? bits.join(' · ') : undefined,
      };
    }
  }
  return { title: stripPinName(s.name) };
}""",
    """function isBusVehicle(mode?: string | null): boolean {
  return /^(BUS|FERRY)$/i.test(String(mode || '').trim());
}

/** Nur belegte Labels — Bus ohne Steig/Abfahrtsbereich → leer (kein erfundenes Gleis). */
function gleisBit(plat?: string | null, mode?: string | null): string {
  const p = (plat ?? '').trim();
  if (!p) return '';
  if (/\\b(gleis|steig|kante|abschnitt|abfahr(?:ts)?bereich|gate|bay)\\b/i.test(p)) {
    if (isBusVehicle(mode) && /^gleis\\b/i.test(p)) {
      return p.replace(/^gleis\\b/i, 'Abfahrtsbereich').trim();
    }
    return p;
  }
  if (isBusVehicle(mode)) return '';
  return `Gleis ${p}`;
}

export function chipForTourStop(
  s: {
    role?: string | null;
    name: string;
    line?: string | null;
    headsign?: string | null;
    platform?: string | null;
    delaySec?: number | null;
    vehicleStartMs?: number | null;
    startMs?: number | null;
    vehicleMode?: string | null;
  },
  next?: {
    role?: string | null;
    name?: string;
    line?: string | null;
    headsign?: string | null;
    startMs?: number | null;
    vehicleMode?: string | null;
    platform?: string | null;
  } | null,
): { title: string; sub?: string } | null {
  const mode = s.vehicleMode || next?.vehicleMode || null;
  const plat = gleisBit(s.platform ?? next?.platform, mode);
  const line = (s.line || next?.line || '').trim();
  const head = (s.headsign || next?.headsign || '').trim();
  const when = chipClock(s.vehicleStartMs ?? next?.startMs ?? null);
  const delay = delayBit(s.delaySec ?? null);
  const ride = line ? (head ? `${line} nach ${head}` : line) : '';
  if (s.role === 'dest') {
    return { title: stripPinName(s.name) || 'Ziel' };
  }
  if (s.role === 'walk' || s.role === 'board') {
    // Linie + Verspätung oben; Uhr nur als „Abfahrt HH:MM“ — nicht „11:19 +1“ (verwirrt).
    const title = ride
      ? delay
        ? `${ride} · ${delay}`
        : ride
      : stripPinName(s.name);
    const bits: string[] = [];
    if (plat) bits.push(plat);
    if (when) bits.push(`Abfahrt ${when}`);
    if (!bits.length) return { title: title || stripPinName(s.name) };
    return { title, sub: bits.join(' · ') };
  }
  if (s.role === 'transfer' || s.role === 'alight') {
    const nxtLine = (next?.line || '').trim();
    const ownLine = (s.line || '').trim();
    const nxtHead = (next?.headsign || '').trim();
    const realTransfer =
      next &&
      (next.role === 'alight' || next.role === 'board') &&
      nxtLine &&
      nxtLine !== ownLine;
    if (realTransfer) {
      const nxtPlat = gleisBit(next?.platform ?? s.platform, next?.vehicleMode || mode);
      const nxtWhen = chipClock(next?.startMs ?? null);
      return {
        title: `Umsteigen ${nxtLine}${nxtHead ? ` nach ${nxtHead}` : ''}`,
        sub:
          [nxtPlat, nxtWhen ? `Abfahrt ${nxtWhen}` : ''].filter(Boolean).join(' · ') ||
          undefined,
      };
    }
    if (!next || next.role === 'dest' || next.role === 'walk') {
      const onward =
        next?.role === 'dest' || next?.role === 'walk'
          ? `weiter zu ${stripPinName(next?.name || '') || 'Fuß'}`
          : '';
      return {
        title: `Aussteigen · ${stripPinName(s.name)}`,
        sub: onward || undefined,
      };
    }
  }
  return { title: stripPinName(s.name) };
}""",
    "chipForTourStop",
)

# --- liveTourSchedule boardingBadge + groupLabel ---
patch(
    "src/module2/timeline/liveTourSchedule.ts",
    """function boardingBadge(
  platform?: string | null,
  _vehicleMode?: string | null,
): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  // „Steig“ klingt komisch — immer Gleis, auch wenn die Quelle Bussteig sagt.
  const asGleis = p.replace(/^(?:bus)?steig\\b/i, 'Gleis').trim();
  if (/\\b(gleis|kante|abschnitt|abfahrbereich)\\b/i.test(asGleis)) return asGleis;
  return `Gleis ${asGleis}`;
}""",
    """function boardingBadge(
  platform?: string | null,
  vehicleMode?: string | null,
): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  const bus = /^(BUS|FERRY)$/i.test(String(vehicleMode || '').trim());
  // Nur belegte Labels — Bus ohne Steig/Abfahrtsbereich → kein Fake-Gleis.
  if (/\\b(gleis|steig|kante|abschnitt|abfahr(?:ts)?bereich|gate|bay)\\b/i.test(p)) {
    if (bus && /^gleis\\b/i.test(p)) {
      return p.replace(/^gleis\\b/i, 'Abfahrtsbereich').trim();
    }
    return p;
  }
  if (bus) return null;
  return `Gleis ${p}`;
}""",
    "boardingBadge",
)

patch(
    "src/module2/timeline/liveTourSchedule.ts",
    """function platformLabel(platform?: string | null): string {
  const plat = (platform || '').trim();
  if (!plat) return '';
  const asGleis = plat.replace(/^(?:bus)?steig\\b/i, 'Gleis').trim();
  return /gleis|kante|abschnitt|abfahrbereich/i.test(asGleis)
    ? asGleis
    : `Gleis ${asGleis}`;
}""",
    """function platformLabel(platform?: string | null, vehicleMode?: string | null): string {
  return boardingBadge(platform, vehicleMode) ?? '';
}""",
    "platformLabel",
)

# Update stopNotes calls that use platformLabel(s.platform) - need vehicleMode
# Check if platformLabel is called with one arg - still works with optional mode.

patch(
    "src/module2/timeline/liveTourSchedule.ts",
    """  const gleis = platformLabel(s.platform);
  const delay =
    typeof s.delaySec === 'number' && s.delaySec >= 60
      ? `+${Math.round(s.delaySec / 60)} Min`
      : '';
  const liveHint = (s.liveHint || '').trim();
  const waitBit = waitMin > 0 ? `${waitMin} Min warten` : '';
  // Einstieg: nur Warten + Gleis — Linie steht auf dem Fahrbein (kein Doppel-RB61).
  if (s.role === 'walk' || s.role === 'board') {
    if (liveHint) {
      return [liveHint, gleis, delay].filter(Boolean).join(' · ');
    }
    if (waitMin > 0) {
      return [waitBit, gleis, delay].filter(Boolean).join(' · ');
    }
    return ['Einstieg', gleis, delay].filter(Boolean).join(' · ');
  }
  if (s.role === 'transfer') {
    const nextMode = String(next?.vehicleMode || s.vehicleMode || '').toUpperCase();
    const busBit = nextMode === 'BUS' ? 'Bus' : '';
    if (liveHint) {
      return [liveHint, gleis].filter(Boolean).join(' · ');""",
    """  const gleis = platformLabel(s.platform, s.vehicleMode || next?.vehicleMode);
  const delay =
    typeof s.delaySec === 'number' && s.delaySec >= 60
      ? `+${Math.round(s.delaySec / 60)} Min`
      : '';
  const liveHint = (s.liveHint || '').trim();
  const waitBit = waitMin > 0 ? `${waitMin} Min warten` : '';
  // Einstieg: nur Warten + Gleis — Linie steht auf dem Fahrbein (kein Doppel-RB61).
  if (s.role === 'walk' || s.role === 'board') {
    if (liveHint) {
      return [liveHint, gleis, delay].filter(Boolean).join(' · ');
    }
    if (waitMin > 0) {
      return [waitBit, gleis, delay].filter(Boolean).join(' · ');
    }
    return ['Einstieg', gleis, delay].filter(Boolean).join(' · ');
  }
  if (s.role === 'transfer') {
    const nextMode = String(next?.vehicleMode || s.vehicleMode || '').toUpperCase();
    const busBit = nextMode === 'BUS' ? 'Bus' : '';
    if (liveHint) {
      return [liveHint, gleis].filter(Boolean).join(' · ');""",
    "stopNotes platform mode",
)

patch(
    "src/module2/timeline/liveTourSchedule.ts",
    """  const groupLabel = hasTransit
    ? (tripTitle?.trim() || `Fahrt nach ${stripEmojiName(destName)}`)
    : undefined;""",
    """  const groupLabel = hasTransit
    ? (tripTitle?.trim() || `Fahrt zu ${stripEmojiName(destName)}`)
    : undefined;""",
    "groupLabel Fahrt zu",
)

# --- plannedJourneyGroup gleisBadge ---
patch(
    "src/module2/timeline/plannedJourneyGroup.ts",
    """function gleisBadge(platform?: string | null): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  const asGleis = p.replace(/^(?:bus)?steig\\b/i, 'Gleis').trim();
  if (/\\b(gleis|kante|abschnitt|abfahrbereich)\\b/i.test(asGleis)) return asGleis;
  return `Gleis ${asGleis}`;
}""",
    """function gleisBadge(platform?: string | null, mode?: string | null): string | null {
  const p = (platform ?? '').trim();
  if (!p) return null;
  const bus = /^(BUS|FERRY)$/i.test(String(mode || '').trim());
  if (/\\b(gleis|steig|kante|abschnitt|abfahr(?:ts)?bereich|gate|bay)\\b/i.test(p)) {
    if (bus && /^gleis\\b/i.test(p)) {
      return p.replace(/^gleis\\b/i, 'Abfahrtsbereich').trim();
    }
    return p;
  }
  if (bus) return null;
  return `Gleis ${p}`;
}""",
    "planned gleisBadge",
)

patch(
    "src/module2/timeline/plannedJourneyGroup.ts",
    """    const gleis = gleisBadge(leg.fromPlatform);""",
    """    const gleis = gleisBadge(leg.fromPlatform, leg.mode);""",
    "planned gleis from mode",
)

# badge on halt cards - find second gleisBadge call
patch(
    "src/module2/timeline/plannedJourneyGroup.ts",
    """      badge: isWalkish ? null : gleisBadge(leg.toPlatform ?? leg.fromPlatform),""",
    """      badge: isWalkish ? null : gleisBadge(leg.toPlatform ?? leg.fromPlatform, leg.mode),""",
    "planned halt gleis mode",
)

print("batch B part1 done")
