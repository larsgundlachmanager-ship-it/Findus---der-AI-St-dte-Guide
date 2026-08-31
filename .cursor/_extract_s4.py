import json
from pathlib import Path

p = Path(
    r"C:\Users\larsf\.cursor\projects\c-Users-larsf-Findus-2-0\agent-transcripts\7a92c5ce-988a-45b4-9dcd-c97f7d6cd51f\7a92c5ce-988a-45b4-9dcd-c97f7d6cd51f.jsonl"
)
out = []
for i, line in enumerate(p.open(encoding="utf-8")):
    if "Wangerooge" not in line and "Flug→Taxi" not in line and "Fähre vs" not in line:
        continue
    o = json.loads(line)
    if o.get("role") != "assistant":
        continue
    parts = o.get("message", {}).get("content", [])
    text = "".join(
        c.get("text", "") for c in parts if isinstance(c, dict) and "text" in c
    )
    for key in ("Sprint 4", "Wangerooge", "Fähre vs", "Flug→Taxi", "ferry vs"):
        idx = text.find(key)
        if idx >= 0 and ("Sprint 4" in text[max(0, idx - 200) : idx + 800] or "Fähre" in text[idx : idx + 400] or "Inselflieger" in text):
            out.append(f"=== line {i} key={key} ===\n{text[max(0, idx - 100) : idx + 1400]}\n\n")
            break
Path(".cursor/_s4_out.txt").write_text("".join(out[:8]), encoding="utf-8")
print("chunks", len(out))
