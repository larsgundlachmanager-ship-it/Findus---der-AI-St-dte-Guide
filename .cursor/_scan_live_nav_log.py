from pathlib import Path
from collections import Counter
import re
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

p = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_live_nav_test_124.log")
lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
print(f"lines={len(lines)} size={p.stat().st_size}")

# first/last timestamp
print("first:", lines[0][:50] if lines else None)
print("last:", lines[-1][:50] if lines else None)

prefs = Counter()
warns = Counter()
for ln in lines:
    if "ReactNativeJS" not in ln:
        continue
    m = re.search(r"'([^']{1,100})'", ln)
    key = m.group(1) if m else ln[50:130]
    prefs[key] += 1
    if " W/" in ln or ln.startswith("W/") or "W/ReactNativeJS" in ln:
        warns[key] += 1

print("\n=== ALL RN message keys ===")
for k, v in prefs.most_common(100):
    print(f"{v:4} {k}")

print("\n=== WARN-only keys ===")
for k, v in warns.most_common(50):
    print(f"{v:4} {k}")

# Gaps after voice submit
print("\n=== voice submit + next 15 non-MapLibre lines ===")
for i, ln in enumerate(lines):
    if "voice] submit" in ln:
        print("\n>>", ln[:200])
        n = 0
        for j in range(i + 1, min(i + 80, len(lines))):
            if "MapLibre" in lines[j] or "Canceled" in lines[j]:
                continue
            print("  ", lines[j][:220])
            n += 1
            if n >= 15:
                break

# ENOENT / cue fail times
print("\n=== nav cue play failed timestamps ===")
for ln in lines:
    if "nav cue play failed" in ln:
        print(ln[:180])

print("\n=== cityCatalog fails ===")
for ln in lines:
    if "cityCatalog" in ln:
        print(ln[:200])
