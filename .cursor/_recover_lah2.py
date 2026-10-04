import json, os, re
root = r"C:\Users\larsf\.cursor\projects\c-Users-larsf-Findus-2-0\agent-transcripts"
# Collect all StrReplace new_string that mention seedPath or fetchRailLeg from lookAhead files
chunks = []
for dirpath, _, files in os.walk(root):
    for fn in files:
        if not fn.endswith(".jsonl"):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for lineno, line in enumerate(f):
                if "lookAheadRouteCache" not in line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                content = (o.get("message") or {}).get("content")
                if not isinstance(content, list):
                    continue
                for c in content:
                    if c.get("type") != "tool_use":
                        continue
                    inp = c.get("input") or {}
                    p = str(inp.get("path") or "")
                    if "lookAheadRouteCache" not in p.replace("\\\\", "/"):
                        # path may be missing in some tools; check old/new
                        ns = str(inp.get("new_string") or "")
                        if "fetchRailLeg" not in ns and "seedPath" not in ns:
                            continue
                    ns = inp.get("new_string") or inp.get("contents") or ""
                    if isinstance(ns, str) and len(ns) > 80:
                        chunks.append((len(ns), path[-50:], lineno, c.get("name"), ns[:200]))
print("chunks", len(chunks))
chunks.sort(reverse=True)
for c in chunks[:15]:
    print(c[0], c[1], "L"+str(c[2]), c[3], repr(c[4][:120]))
