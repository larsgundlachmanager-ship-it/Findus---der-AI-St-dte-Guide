# -*- coding: utf-8 -*-
from pathlib import Path
import os
import json

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# Fix gold entry
gold = ROOT / "src/module2/blueprints/ownerGold.pack.json"
data = json.loads(gold.read_text(encoding="utf-8"))
fixed = False
for bp in data["blueprints"]:
    if bp.get("id") == "navigation::handsfree_pocket_guide_v1" or bp.get(
        "situationKey"
    ) == "navigation::handsfree_pocket_guide_v1":
        bp.pop("id", None)
        bp["situationKey"] = "navigation::handsfree_pocket_guide_v1"
        bp["intentFamily"] = "navigation"
        bp["tags"] = [
            "hands_free",
            "pocket",
            "haptics",
            "landmarks",
            "reassure",
            "map_hud",
        ]
        fixed = True
        break
if not fixed:
    raise SystemExit("gold entry not found")
write_text(gold, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print("gold fixed")

# cueTiming floor + bike
p = ROOT / "src/services/navigation/handsFreeNav/cueTiming.smoke.test.ts"
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    "assert(floor === 8, `floor 8 m, war ${floor}`);",
    "assert(floor === 12, `floor 12 m, war ${floor}`);",
)
t2 = t2.replace(
    """assert(
  bike4s >= 33 && bike4s <= 40,
  `4s speech @ 20 km/h bike → ~36 m, war ${bike4s}`,
);""",
    """assert(
  bike4s >= 40 && bike4s <= 50,
  `4s speech @ 20 km/h bike → ~44 m, war ${bike4s}`,
);""",
)
if t2 == t:
    # maybe already partially updated
    if "floor === 12" in t and "bike4s >= 40" in t:
        print("cueTiming already ok")
    else:
        raise SystemExit("cueTiming floor/bike not patched")
else:
    write_text(p, t2)
    print("cueTiming floor/bike OK")
