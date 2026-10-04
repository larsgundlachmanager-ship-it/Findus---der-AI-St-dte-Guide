from pathlib import Path
import re

p = Path("src/services/discovery/cityExploreProgress.ts")
s = p.read_text(encoding="utf-8")

helper = '''
/** Wenn Profile-cityId fehlt: Mehrheit der Spot-Key-Prefixe (prisdorf_…). */
function inferCityIdFromPois(pois: Poi[]): string | null {
  const counts = new Map<string, number>();
  for (const p of pois) {
    const k = String(p.spot_key ?? '').trim().toLowerCase();
    const m = /^([a-z][a-z0-9]*)[_:]/.exec(k);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return bestN >= 5 ? best : null;
}

'''

if "inferCityIdFromPois" not in s:
    s = s.replace(
        "export function computeCityExploreProgress(opts: {",
        helper + "export function computeCityExploreProgress(opts: {",
    )

old = """  const profile = getCachedUserProfile();
  const cityId =
    (opts.cityId ?? profile?.cityId ?? '').toLowerCase() || null;
  const bounds = resolveCityCoverageBoundsSync(cityId);"""

new = """  const profile = getCachedUserProfile();
  const fromOpts = (opts.cityId ?? '').trim().toLowerCase();
  const fromProfile = (profile?.cityId ?? '').trim().toLowerCase();
  // Profile/Opts zuerst — sonst Prefix aus Store (verhindert 94 Danzig bei leerem cityId).
  const cityId =
    fromOpts ||
    fromProfile ||
    inferCityIdFromPois(opts.pois) ||
    null;
  const bounds = resolveCityCoverageBoundsSync(cityId);"""

if old not in s:
    raise SystemExit('cityId block not found')
s = s.replace(old, new)

tmp = Path(".cursor/_cityExploreProgress_infer.ts")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("infer ok")
