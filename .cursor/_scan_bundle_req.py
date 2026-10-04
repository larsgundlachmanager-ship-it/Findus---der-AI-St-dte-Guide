"""Symbolicate metroRequire@1:77042 and nearby; find dependencyMap holes."""
from pathlib import Path
import json
import re

bundle = Path(
    r"C:\Users\larsf\Findus 2.0\android\app\build\generated\assets\createBundleReleaseJsAndAssets\index.android.bundle"
)
smap = Path(
    r"C:\Users\larsf\Findus 2.0\android\app\build\generated\sourcemaps\react\release\index.android.bundle.map"
)

# Quick: find modules that call require with a non-numeric / suspicious pattern
text = bundle.read_text(encoding="utf-8", errors="ignore")
# Metro often: _$$_REQUIRE(_dependencyMap[N], "name")
# Find requires of modules named oddly
hits = re.findall(r'_\$\$_REQUIRE\(_dependencyMap\[(\d+)\],\s*"([^"]*)"\)', text)
print("named requires", len(hits))
empty_names = [h for h in hits if h[1] in ("", "undefined", "null")]
print("empty/undefined names", len(empty_names), empty_names[:10])

# Look for dependencyMap arrays containing null/undefined literals
null_maps = list(re.finditer(r"_dependencyMap\s*=\s*\[[^\]]{0,400}\]", text))
print("dependencyMap assigns", len(null_maps))
bad = []
for m in null_maps:
    s = m.group(0)
    if "null" in s or "void 0" in s or ",," in s:
        bad.append(s[:200])
print("suspicious maps", len(bad))
for b in bad[:15]:
    print("---", b)

out = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6w\bundle_req_scan.txt")
out.write_text("\n".join(bad[:50]), encoding="utf-8")
print("wrote", out)
