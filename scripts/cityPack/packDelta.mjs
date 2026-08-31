/**
 * Node-Spiegel von src/services/cityPack/packDelta.ts — Format muss gleich bleiben.
 */

export const PACK_PATCH_FORMAT = 1;
export const MAX_PACK_PATCH_CHAIN = 3;
export const PACK_PATCH_MAX_RATIO = 0.3;

export function packDataVersion(pack) {
  const n = Number(pack?.data_version);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function spotKey(spot) {
  if (!spot || typeof spot !== 'object') return '';
  const id = String(spot.id ?? '').trim().toLowerCase();
  if (id) return id;
  return String(spot.name ?? '').trim().toLowerCase();
}

function stableJson(value) {
  return JSON.stringify(value);
}

export function buildPackPatch(prev, next) {
  const cityId = String(next.city_id || prev.city_id || '')
    .trim()
    .toLowerCase();
  const fromVersion = packDataVersion(prev);
  const toVersion = packDataVersion(next);
  if (!cityId || fromVersion <= 0 || toVersion <= fromVersion) return null;

  const prevSpots = Array.isArray(prev.spots) ? prev.spots : [];
  const nextSpots = Array.isArray(next.spots) ? next.spots : [];
  const prevMap = new Map();
  for (const s of prevSpots) {
    const k = spotKey(s);
    if (k) prevMap.set(k, s);
  }
  const nextKeys = new Set();
  const spots_upsert = [];
  for (const s of nextSpots) {
    const k = spotKey(s);
    if (!k) continue;
    nextKeys.add(k);
    const old = prevMap.get(k);
    if (!old || stableJson(old) !== stableJson(s)) {
      spots_upsert.push(s);
    }
  }
  const spots_remove = [];
  for (const k of prevMap.keys()) {
    if (!nextKeys.has(k)) spots_remove.push(k);
  }

  const pack_set = {};
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

  const patch = {
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

export function patchTooLarge(patch, nextPack, ratio = PACK_PATCH_MAX_RATIO) {
  const patchBytes = Buffer.byteLength(JSON.stringify(patch), 'utf8');
  const fullBytes = Buffer.byteLength(JSON.stringify(nextPack), 'utf8');
  if (fullBytes <= 0) return true;
  return patchBytes > fullBytes * ratio;
}

export function patchObjectPath(cityId, from, to) {
  const id = String(cityId || '')
    .trim()
    .toLowerCase();
  return `patches/${id}.v${from}-v${to}.patch.json`;
}

export function chainPatches(fromVersion, toVersion, patches) {
  if (fromVersion >= toVersion) return [];
  const byFrom = new Map();
  for (const p of patches || []) {
    if (!p || p.from == null || p.to == null || !p.file) continue;
    const list = byFrom.get(p.from) || [];
    list.push(p);
    byFrom.set(p.from, list);
  }
  const queue = [{ ver: fromVersion, path: [] }];
  const seen = new Set([fromVersion]);
  while (queue.length) {
    const cur = queue.shift();
    if (cur.path.length >= MAX_PACK_PATCH_CHAIN) continue;
    for (const p of byFrom.get(cur.ver) || []) {
      if (seen.has(p.to)) continue;
      const nextPath = [...cur.path, p];
      if (p.to === toVersion) return nextPath;
      seen.add(p.to);
      queue.push({ ver: p.to, path: nextPath });
    }
  }
  return null;
}

export function keepLatestPatchRefs(refs, headVersion, max = MAX_PACK_PATCH_CHAIN) {
  const usable = (refs || []).filter(
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
