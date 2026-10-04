from pathlib import Path

# --- cityLocalStorage: add spotKeyBelongsToCity + stricter poisLookLikeCity ---
p = Path("src/services/cityPack/cityLocalStorage.ts")
s = p.read_text(encoding="utf-8")
old = '''export function poisLookLikeCity(
  cityId: string,
  pois: Array<{ spot_key?: string | null }>,
): boolean {
  const id = cityId.trim().toLowerCase();
  if (!id || !pois.length) return false;
  const prefix = `${id}_`;
  const colon = `${id}:`;
  const n = Math.min(pois.length, 48);
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    const k = (pois[i]?.spot_key || '').toLowerCase();
    if (k.startsWith(prefix) || k.startsWith(colon)) hit += 1;
  }
  return hit >= Math.max(3, Math.ceil(n * 0.2));
}'''

new = '''/** Spot-Key der Stadt? `prisdorf_bahnhof` / `prisdorf:…` / exakt `prisdorf`. */
export function spotKeyBelongsToCity(
  spotKey: string | null | undefined,
  cityId: string | null | undefined,
): boolean {
  const id = String(cityId || '').trim().toLowerCase();
  if (!id) return true;
  const key = String(spotKey || '').trim().toLowerCase();
  if (!key) return false;
  return key === id || key.startsWith(`${id}_`) || key.startsWith(`${id}:`);
}

export function poisLookLikeCity(
  cityId: string,
  pois: Array<{ spot_key?: string | null }>,
): boolean {
  const id = cityId.trim().toLowerCase();
  if (!id || !pois.length) return false;
  const n = Math.min(pois.length, 64);
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    if (spotKeyBelongsToCity(pois[i]?.spot_key, id)) hit += 1;
  }
  // Mehrheit der Sample-POIs — 20 % ließ Danzig-Reste als „Prisdorf“ durch.
  return hit >= Math.max(3, Math.ceil(n * 0.55));
}'''

if old not in s:
    raise SystemExit('poisLookLikeCity block not found')
tmp = Path('.cursor/_cityLocalStorage_new.ts')
tmp.write_text(s.replace(old, new), encoding='utf-8')
tmp.replace(p)
print('cityLocalStorage ok')

# --- cityExploreProgress: use spotKeyBelongsToCity ---
p2 = Path('src/services/discovery/cityExploreProgress.ts')
s2 = p2.read_text(encoding='utf-8')
if "spotKeyBelongsToCity" not in s2:
    s2 = s2.replace(
        "import type { WalkTrackPoint } from './walkTrackService';",
        "import type { WalkTrackPoint } from './walkTrackService';\n"
        "import { spotKeyBelongsToCity } from '../cityPack/cityLocalStorage';",
    )
# replace helper functions
import re
s2 = re.sub(
    r'/\*\* Spot gehört zur aktiven Stadt.*?\nfunction poiInActiveCity\([\s\S]*?return pointInCityBounds\(p\.lat, p\.lng, bounds\);\n\}',
    '''/** Story-POI gehört zur aktiven Stadt (Key zuerst, sonst Bounds). */
function poiInActiveCity(
  p: Poi,
  cityId: string | null,
  bounds: ReturnType<typeof resolveCityCoverageBoundsSync>,
): boolean {
  const key = String(p.spot_key ?? '').trim();
  if (cityId && key) {
    return spotKeyBelongsToCity(p.spot_key, cityId);
  }
  if (!bounds) return true;
  if (bounds.polygon && bounds.polygon.length >= 3) {
    if (cityContainsPoint(p.lat, p.lng, bounds)) return true;
    const padLat = 400 / 111_320;
    const padLng =
      400 / (111_320 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
    return (
      p.lat >= bounds.latMin - padLat &&
      p.lat <= bounds.latMax + padLat &&
      p.lng >= bounds.lngMin - padLng &&
      p.lng <= bounds.lngMax + padLng
    );
  }
  return pointInCityBounds(p.lat, p.lng, bounds);
}''',
    s2,
    count=1,
)
# ensure filter call has cityId
s2 = s2.replace(
    'isCityExploreMapPoi(p) && poiInActiveCity(p, bounds)',
    'isCityExploreMapPoi(p) && poiInActiveCity(p, cityId, bounds)',
)
# remove duplicate poiSpotKeyMatchesCity if present
s2 = re.sub(
    r'/\*\* Spot gehört zur aktiven Stadt — Prefixe[\s\S]*?function poiSpotKeyMatchesCity[\s\S]*?\n\}\n\n',
    '',
    s2,
    count=1,
)
tmp2 = Path('.cursor/_cityExploreProgress_new2.ts')
tmp2.write_text(s2, encoding='utf-8')
tmp2.replace(p2)
print('cityExploreProgress ok')
