/**
 * Stadt-Pack Deltas: Skip / Patch-Kette / Full-File.
 * Upload (scripts/cityPack/packDelta.mjs) muss dasselbe Format schreiben.
 */

export const PACK_PATCH_FORMAT = 1 as const;
export const MAX_PACK_PATCH_CHAIN = 3;
/** Patch nur, wenn er kleiner als dieser Anteil der Volldatei ist. */
export const PACK_PATCH_MAX_RATIO = 0.3;

export type CityPackPatchRef = {
  from: number;
  to: number;
  file: string;
  bytes?: number;
};

export type CityPackPatchV1 = {
  v: typeof PACK_PATCH_FORMAT;
  city_id: string;
  from_version: number;
  to_version: number;
  spots_upsert?: unknown[];
  spots_remove?: string[];
  pack_set?: Record<string, unknown>;
};

export type PackUpdateDecision =
  | { kind: 'skip' }
  | { kind: 'full' }
  | { kind: 'patch'; chain: CityPackPatchRef[] };

type SpotLike = {
  id?: unknown;
  name?: unknown;
};

export function packDataVersion(pack: { data_version?: unknown } | null | undefined): number {
  const n = Number(pack?.data_version);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function spotKey(spot: unknown): string {
  if (!spot || typeof spot !== 'object') return '';
  const s = spot as SpotLike;
  const id = String(s.id ?? '').trim().toLowerCase();
  if (id) return id;
  return String(s.name ?? '').trim().toLowerCase();
}

export function chooseUpdatePath(
  localVersion: number,
  remoteVersion: number,
  patches: CityPackPatchRef[] | null | undefined,
): PackUpdateDecision {
  const local = Math.max(0, Math.floor(localVersion || 0));
  const remote = Math.max(0, Math.floor(remoteVersion || 0));
  if (local > 0 && (remote <= 0 || local >= remote)) {
    return { kind: 'skip' };
  }
  if (local <= 0) {
    return { kind: 'full' };
  }
  const chain = chainPatches(local, remote, patches ?? []);
  if (chain && chain.length > 0 && chain.length <= MAX_PACK_PATCH_CHAIN) {
    return { kind: 'patch', chain };
  }
  return { kind: 'full' };
}

export function chainPatches(
  fromVersion: number,
  toVersion: number,
  patches: CityPackPatchRef[],
): CityPackPatchRef[] | null {
  if (fromVersion >= toVersion) return [];
  const byFrom = new Map<number, CityPackPatchRef[]>();
  for (const p of patches) {
    if (!p || p.from == null || p.to == null || !p.file) continue;
    const list = byFrom.get(p.from) ?? [];
    list.push(p);
    byFrom.set(p.from, list);
  }
  const queue: Array<{ ver: number; path: CityPackPatchRef[] }> = [
    { ver: fromVersion, path: [] },
  ];
  const seen = new Set<number>([fromVersion]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.path.length >= MAX_PACK_PATCH_CHAIN) continue;
    for (const p of byFrom.get(cur.ver) ?? []) {
      if (seen.has(p.to)) continue;
      const nextPath = [...cur.path, p];
      if (p.to === toVersion) return nextPath;
      seen.add(p.to);
      queue.push({ ver: p.to, path: nextPath });
    }
  }
  return null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function buildPackPatch(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): CityPackPatchV1 | null {
  const cityId = String(next.city_id || prev.city_id || '').trim().toLowerCase();
  const fromVersion = packDataVersion(prev);
  const toVersion = packDataVersion(next);
  if (!cityId || fromVersion <= 0 || toVersion <= fromVersion) return null;

  const prevSpots = Array.isArray(prev.spots) ? prev.spots : [];
  const nextSpots = Array.isArray(next.spots) ? next.spots : [];
  const prevMap = new Map<string, unknown>();
  for (const s of prevSpots) {
    const k = spotKey(s);
    if (k) prevMap.set(k, s);
  }
  const nextKeys = new Set<string>();
  const spots_upsert: unknown[] = [];
  for (const s of nextSpots) {
    const k = spotKey(s);
    if (!k) continue;
    nextKeys.add(k);
    const old = prevMap.get(k);
    if (!old || stableJson(old) !== stableJson(s)) {
      spots_upsert.push(s);
    }
  }
  const spots_remove: string[] = [];
  for (const k of prevMap.keys()) {
    if (!nextKeys.has(k)) spots_remove.push(k);
  }

  const pack_set: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === 'spots' || key === 'data_version') continue;
    if (stableJson(prev[key]) !== stableJson(next[key])) {
      if (key in next) pack_set[key] = next[key];
      else pack_set[key] = null;
    }
  }

  if (!spots_upsert.length && !spots_remove.length && !Object.keys(pack_set).length) {
    return null;
  }

  const patch: CityPackPatchV1 = {
    v: PACK_PATCH_FORMAT,
    city_id: cityId,
    from_version: fromVersion,
    to_version: toVersion,
  };
  if (spots_upsert.length) patch.spots_upsert = spots_upsert;
  if (spots_remove.length) patch.spots_remove = spots_remove;
  if (Object.keys(pack_set).length) patch.pack_set = pack_set;
  return patch;
}

function utf8Bytes(text: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(text, 'utf8');
  }
  return new TextEncoder().encode(text).length;
}

export function patchTooLarge(
  patch: CityPackPatchV1,
  nextPack: unknown,
  ratio = PACK_PATCH_MAX_RATIO,
): boolean {
  const patchBytes = utf8Bytes(JSON.stringify(patch));
  const fullBytes = utf8Bytes(JSON.stringify(nextPack));
  if (fullBytes <= 0) return true;
  return patchBytes > fullBytes * ratio;
}

export function applyPackPatch(
  pack: Record<string, unknown>,
  patch: CityPackPatchV1,
): Record<string, unknown> {
  if (!patch || patch.v !== PACK_PATCH_FORMAT) {
    throw new Error('Ungültiges Pack-Patch');
  }
  const expected = packDataVersion(pack);
  if (expected > 0 && patch.from_version !== expected) {
    throw new Error(
      `Patch erwartet v${patch.from_version}, lokal ist v${expected}`,
    );
  }
  const packSet = { ...(patch.pack_set || {}) };
  delete packSet.spots;
  const next: Record<string, unknown> = { ...pack, ...packSet };
  let spots = Array.isArray(next.spots) ? [...next.spots] : [];
  const remove = new Set(
    (patch.spots_remove ?? []).map((k) => String(k).trim().toLowerCase()),
  );
  if (remove.size) {
    spots = spots.filter((s) => !remove.has(spotKey(s)));
  }
  for (const upsert of patch.spots_upsert ?? []) {
    const k = spotKey(upsert);
    if (!k) continue;
    const i = spots.findIndex((s) => spotKey(s) === k);
    if (i >= 0) spots[i] = upsert;
    else spots.push(upsert);
  }
  next.spots = spots;
  next.data_version = patch.to_version;
  return next;
}

export function applyPackPatchChain(
  pack: Record<string, unknown>,
  patches: CityPackPatchV1[],
): Record<string, unknown> {
  let cur = pack;
  for (const p of patches) {
    cur = applyPackPatch(cur, p);
  }
  return cur;
}

export function patchObjectPath(cityId: string, from: number, to: number): string {
  const id = cityId.trim().toLowerCase();
  return `patches/${id}.v${from}-v${to}.patch.json`;
}

export function keepLatestPatchRefs(
  refs: CityPackPatchRef[],
  headVersion: number,
  max = MAX_PACK_PATCH_CHAIN,
): CityPackPatchRef[] {
  const usable = refs.filter(
    (p) => p && p.to <= headVersion && p.from < p.to && p.file,
  );
  const chain = chainPatches(
    Math.max(0, headVersion - max),
    headVersion,
    usable,
  );
  if (chain && chain.length) return chain;
  return usable
    .filter((p) => p.to === headVersion)
    .sort((a, b) => b.from - a.from)
    .slice(0, max);
}
