import json
from pathlib import Path

p = Path(
    r"C:\Users\larsf\.cursor\projects\c-Users-larsf-Findus-2-0\agent-transcripts\7a92c5ce-988a-45b4-9dcd-c97f7d6cd51f\7a92c5ce-988a-45b4-9dcd-c97f7d6cd51f.jsonl"
)
# line 270 had the priority roadmap
for i, line in enumerate(p.open(encoding="utf-8")):
    if i != 270:
        continue
    o = json.loads(line)
    parts = o.get("message", {}).get("content", [])
    text = "".join(
        c.get("text", "") for c in parts if isinstance(c, dict) and "text" in c
    )
    for key in ("Wangerooge", "Flug→Taxi", "Multi-Stop-Nav", "Insel", "Fähre"):
        idx = 0
        while True:
            idx = text.find(key, idx)
            if idx < 0:
                break
            Path(f".cursor/_s4_p{idx}.txt").write_text(
                text[max(0, idx - 80) : idx + 900], encoding="utf-8"
            )
            idx += len(key)
    Path(".cursor/_s4_full_p0.txt").write_text(text, encoding="utf-8")
    print("len", len(text))
