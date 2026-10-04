from pathlib import Path
import re

# 1) placePhotoResolve
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\placePhotoResolve.ts")
t = p.read_text(encoding="utf-8")
if "staticMapTitlePhoto" not in t:
    insert = """
/** Immer verfuegbares Titelbild aus GPS (Wikimedia OSM-Static). */
export function staticMapTitlePhoto(
  lat?: number | null,
  lng?: number | null,
  zoom = 12,
): string | null {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const z = Math.max(5, Math.min(15, Math.round(zoom)));
  return (
    'https://maps.wikimedia.org/img/osm-intl,' +
    z +
    ',' +
    lat.toFixed(5) +
    ',' +
    lng.toFixed(5) +
    ',900x560.png'
  );
}

"""
    idx = t.find("export type PhotoResolveKind")
    t = t[:idx] + insert + t[idx:]
    tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
    tmp.write_text(t, encoding="utf-8")
    if bak.exists():
        bak.unlink()
    p.rename(bak)
    tmp.rename(p)
    bak.unlink(missing_ok=True)
    print("ok placePhotoResolve")
else:
    print("placePhotoResolve already has helper")

# 2) magazineEnsure
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\magazineEnsure.ts")
t2 = p2.read_text(encoding="utf-8")
t2 = t2.replace(
    "import { resolveLocatedPhoto } from './placePhotoResolve';",
    "import { resolveLocatedPhoto, staticMapTitlePhoto } from './placePhotoResolve';\nexport { staticMapTitlePhoto } from './placePhotoResolve';",
)
t2 = re.sub(
    r"/\*\* Immer verfügbares Titelbild aus GPS \(Wikimedia OSM-Static\)\. \*/\s*export function staticMapTitlePhoto\([\s\S]*?\n\}\n\n",
    "",
    t2,
    count=1,
)
# also without umlaut variant
t2 = re.sub(
    r"/\*\* Immer verfuegbares Titelbild aus GPS \(Wikimedia OSM-Static\)\. \*/\s*export function staticMapTitlePhoto\([\s\S]*?\n\}\n\n",
    "",
    t2,
    count=1,
)
tmp, bak = p2.with_suffix(".ts.__new"), p2.with_suffix(".ts.__bak")
tmp.write_text(t2, encoding="utf-8")
if bak.exists():
    bak.unlink()
p2.rename(bak)
tmp.rename(p2)
bak.unlink(missing_ok=True)
print("ok magazineEnsure")

# 3) storyMagazine
p3 = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\storyMagazine.ts")
t3 = p3.read_text(encoding="utf-8")
t3 = t3.replace("require('./magazineEnsure')", "require('./placePhotoResolve')")
tmp, bak = p3.with_suffix(".ts.__new"), p3.with_suffix(".ts.__bak")
tmp.write_text(t3, encoding="utf-8")
if bak.exists():
    bak.unlink()
p3.rename(bak)
tmp.rename(p3)
bak.unlink(missing_ok=True)
print("ok storyMagazine")
