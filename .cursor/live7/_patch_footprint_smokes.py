from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\extractBuildingUnderPin.smoke.test.ts")
text = p.read_text(encoding="utf-8")
needle = "assert(!packRingNeedsTileSnap(offsetPack), 'Offset-Pack hat genug Ecken (kein Box-Snap)');\n\nconst forestPack"
insert = """assert(!packRingNeedsTileSnap(offsetPack), 'Offset-Pack hat genug Ecken (kein Box-Snap)');

// Gedrehte Raute (4 Ecken, ~90°) → Tile-Snap nötig.
const diamond: Array<[number, number]> = [
  [53.6782, 9.7587],
  [53.67805, 9.75895],
  [53.6782, 9.7592],
  [53.67835, 9.75895],
  [53.6782, 9.7587],
];
assert(packRingNeedsTileSnap(diamond), 'gedrehte Raute braucht Tile-Snap');
const fromDiamond = resolvePlaceFillRing(53.6782, 9.75895, diamond, buildings);
assert(fromDiamond === house, 'Raute → Extract-Haus unter Pin');

const forestPack"""
if needle not in text:
    raise SystemExit("needle missing")
p.write_text(text.replace(needle, insert), encoding="utf-8")
print("smoke patched")

p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\geo\polygonBox.smoke.test.ts")
t2 = p2.read_text(encoding="utf-8")
if "isNearRectanglePolygon" not in t2:
    t2 = t2.replace(
        "import {\n  isAxisAlignedBoxPolygon,\n  parsePolygonJson,\n} from './polygon';",
        "import {\n  isAxisAlignedBoxPolygon,\n  isNearRectanglePolygon,\n  parsePolygonJson,\n} from './polygon';",
    )
    t2 = t2.replace(
        "console.log('polygonBox.smoke.test ok');\n",
        """const diamond = parsePolygonJson(
  JSON.stringify([
    { lat: 53.6782, lng: 10.69 },
    { lat: 53.6780, lng: 10.6903 },
    { lat: 53.6782, lng: 10.6906 },
    { lat: 53.6784, lng: 10.6903 },
    { lat: 53.6782, lng: 10.69 },
  ]),
);
assert(diamond && isNearRectanglePolygon(diamond), 'rotated diamond is near-rectangle');

console.log('polygonBox.smoke.test ok');
""",
    )
    p2.write_text(t2, encoding="utf-8")
    print("polygonBox patched")
else:
    print("polygonBox already ok")
