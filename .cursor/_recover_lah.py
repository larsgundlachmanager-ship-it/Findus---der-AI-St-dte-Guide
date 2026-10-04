import json, os
root = r"C:\Users\larsf\.cursor\projects\c-Users-larsf-Findus-2-0\agent-transcripts"
out = r"C:\Users\larsf\Findus 2.0\.cursor\_lookAhead_recovered.ts"
best = ""
best_path = ""
for dirpath, _, files in os.walk(root):
    for fn in files:
        if not fn.endswith(".jsonl"):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if "lookAheadRouteCache.ts" not in line:
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
                    if "lookAheadRouteCache" not in p:
                        continue
                    contents = inp.get("contents") or ""
                    if isinstance(contents, str) and len(contents) > len(best):
                        best = contents
                        best_path = path
                    # also accumulate from new_string if it looks like full file
                    ns = inp.get("new_string") or ""
                    if isinstance(ns, str) and ns.startswith("/**") and len(ns) > len(best):
                        best = ns
                        best_path = path + ":new"
print("best_len", len(best), "from", best_path[-80:] if best_path else None)
if best:
    open(out, "w", encoding="utf-8").write(best)
    print("wrote", out)
