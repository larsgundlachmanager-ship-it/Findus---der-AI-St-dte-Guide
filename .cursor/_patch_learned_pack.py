from pathlib import Path
import os

src = Path(r"c:\Users\larsf\Findus 2.0\src\types\learnedRules.ts")
tmp = Path(r"c:\Users\larsf\Findus 2.0\src\types\learnedRules.ts.new")
bak = Path(r"c:\Users\larsf\Findus 2.0\src\types\learnedRules.ts.bak")

t = src.read_text(encoding="utf-8")
t = t.replace(
    "| 'booking'\n  | 'general';",
    "| 'booking'\n  | 'packing'\n  | 'general';",
    1,
)
t = t.replace(
    "| 'complete_sentences';",
    "| 'complete_sentences'\n  | 'pack_prefs';",
    1,
)
t = t.replace(
    "| 'essay';",
    "| 'essay'\n  | 'pack_unwanted_items';",
    1,
)
t = t.replace(
    "complete_sentences: 'vollständige Fließtext-Sätze, kein Telegramm-Stakkato',\n};",
    "complete_sentences: 'vollständige Fließtext-Sätze, kein Telegramm-Stakkato',\n"
    "  pack_prefs: 'persönliche Pack-Prefs (nie/immer) respektieren',\n};",
    1,
)
t = t.replace(
    "essay: 'kein Essay / keine unnötige Länge',\n};",
    "essay: 'kein Essay / keine unnötige Länge',\n"
    "  pack_unwanted_items: 'keine unerwünschten Pack-Items (User-Prefs)',\n};",
    1,
)

if "packing" not in t or "pack_prefs" not in t or "pack_unwanted_items" not in t:
    raise SystemExit(f"patch incomplete: packing={'packing' in t} prefs={'pack_prefs' in t}")

tmp.write_text(t, encoding="utf-8")
print("tmp written", tmp.stat().st_size)

if bak.exists():
    bak.unlink()
os.replace(src, bak)
os.replace(tmp, src)
print("replaced OK")
