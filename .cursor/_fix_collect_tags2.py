from pathlib import Path
import tempfile
import os
import shutil

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
out = t.replace(old, new, 1)
fd, tmp = tempfile.mkstemp(suffix=".ts", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(out, encoding="utf-8")
# Replace atomically-ish on Windows
bak = str(p) + ".bak_story_tags"
try:
    if os.path.exists(bak):
        os.remove(bak)
    os.replace(str(p), bak)
    os.replace(tmp, str(p))
    os.remove(bak)
except Exception as e:
    # rollback
    if os.path.exists(bak) and not p.exists():
        os.replace(bak, str(p))
    raise
print("cityPack collectTags patched via temp replace")
