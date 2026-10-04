from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\cityPack.ts")
t = p.read_text(encoding="utf-8")
old = """  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);
  if (
    spot.pack_role === 'directory' ||
    Number(spot.place_tier) === 4
  ) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
"""
new = """  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);
  const isStory = spot.pack_role === 'story' || tags.has('story');
  // Story-Orte nie als Directory/Noise — sonst fehlen sie in „X von Y Orten“.
  if (isStory && spot.pack_role !== 'directory') {
    tags.delete('directory');
    tags.delete('tier4');
    tags.delete('offline_lookup');
    tags.delete('amenity_skip');
    tags.add('story');
  } else if (
    spot.pack_role === 'directory' ||
    Number(spot.place_tier) === 4
  ) {
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  }
"""
if old not in t:
    raise SystemExit("collectTags block not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("cityPack collectTags patched")
