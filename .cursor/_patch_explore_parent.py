from pathlib import Path

p = Path("src/services/navigation/stampMapModul1.ts")
s = p.read_text(encoding="utf-8")
old = """export function isCityExploreMapPoi(poi: Poi): boolean {
  if (!isAreaLike(poi)) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;
  if (isNonStoryTouristNoisePoi(poi)) return false;
  return isPackStoryMapPoi(poi);
}"""
new = """export function isCityExploreMapPoi(poi: Poi): boolean {
  if (!isAreaLike(poi)) return false;
  // Approach/Sub nie — auch wenn kind in alter SQLite fehlt/legacy ist.
  if (poi.parent_poi_id != null) return false;
  if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return false;
  if (isNonStoryTouristNoisePoi(poi)) return false;
  return isPackStoryMapPoi(poi);
}"""
if old not in s:
    raise SystemExit('isCityExploreMapPoi not found')
tmp = Path('.cursor/_stamp_explore_parent.ts')
tmp.write_text(s.replace(old, new), encoding='utf-8')
tmp.replace(p)
print('parent_poi_id gate ok')
