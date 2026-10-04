/**
 * Warm (RAM/Disk) vs. Paint (MapLibre) — Prefetch setzt nie die Karte.
 */

export type MapPaintKind = 'near' | 'places' | 'final';

type WarmEntry = { atMs: number };
type PaintEntry = { kinds: Set<MapPaintKind>; atMs: number };

const warm = new Map<string, WarmEntry>();
const painted = new Map<string, PaintEntry>();

function idOf(cityId: string | null | undefined): string {
  return (cityId || '').toLowerCase();
}

export function noteMapDataWarm(cityId: string | null | undefined): void {
  const id = idOf(cityId);
  if (!id) return;
  warm.set(id, { atMs: Date.now() });
}

export function isMapDataWarm(cityId: string | null | undefined): boolean {
  const id = idOf(cityId);
  return id ? warm.has(id) : false;
}

export function noteMapDataPainted(
  cityId: string | null | undefined,
  kind: MapPaintKind,
): void {
  const id = idOf(cityId);
  if (!id) return;
  const prev = painted.get(id) ?? { kinds: new Set<MapPaintKind>(), atMs: 0 };
  prev.kinds.add(kind);
  prev.atMs = Date.now();
  painted.set(id, prev);
}

export function isMapDataPainted(
  cityId: string | null | undefined,
  kind?: MapPaintKind,
): boolean {
  const id = idOf(cityId);
  if (!id) return false;
  const p = painted.get(id);
  if (!p) return false;
  if (!kind) return p.kinds.size > 0;
  return p.kinds.has(kind);
}

export function resetMapDataCache(cityId?: string | null): void {
  if (!cityId) {
    warm.clear();
    painted.clear();
    return;
  }
  const id = idOf(cityId);
  warm.delete(id);
  painted.delete(id);
}
