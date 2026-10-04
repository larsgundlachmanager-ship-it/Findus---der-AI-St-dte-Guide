import json
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\data\staedte\danzig.json")
d = json.loads(p.read_text(encoding="utf-8"))
noise = {"directory", "tier4", "offline_lookup", "amenity_skip"}
fixed = 0
added_story = 0
for s in d.get("spots") or []:
    if not isinstance(s, dict):
        continue
    if s.get("pack_role") != "story":
        continue
    tags = s.get("tags")
    if not isinstance(tags, list):
        tags = []
    cleaned = []
    seen = set()
    for t in tags:
        tl = str(t).strip().lower()
        if not tl or tl in noise:
            continue
        if tl in seen:
            continue
        seen.add(tl)
        cleaned.append(tl if tl == str(t).strip().lower() else str(t))
    if "story" not in seen:
        cleaned.append("story")
        added_story += 1
        seen.add("story")
    if cleaned != [str(x).strip().lower() for x in tags if str(x).strip().lower() not in noise] or any(
        str(x).strip().lower() in noise for x in tags
    ):
        # normalize compare
        pass
    before = [str(x).strip().lower() for x in tags]
    after = cleaned
    if before != after:
        s["tags"] = cleaned
        fixed += 1

# recount
story_ok = 0
for s in d.get("spots") or []:
    if not isinstance(s, dict) or s.get("pack_role") != "story":
        continue
    tags = [str(t).lower() for t in (s.get("tags") or [])]
    if "directory" in tags:
        continue
    if "story" in tags or "story_enriched" in tags:
        story_ok += 1

idx = d.get("_pack_index")
if isinstance(idx, dict):
    idx["story"] = sum(1 for s in d["spots"] if isinstance(s, dict) and s.get("pack_role") == "story")

p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"fixed_spots={fixed} added_story_tag={added_story} explore_like={story_ok}")
