from pathlib import Path
import re

t = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7/nothing-touch2.xml").read_text(
    encoding="utf-8", errors="replace"
)
print("bytes", len(t))
for needle in ("Einstellungen", "Timeline", "Mikrofon", "MapLibre", "Schließen", "Passport", "Ort"):
    print(needle, needle in t or needle.lower() in t.lower())

# map and mic bounds
for label, pat in [
    ("map", r'MapLibre[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
    ("mic", r'Mikrofon[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
    ("settings", r'content-desc="Einstellungen"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
]:
    m = re.search(pat, t)
    print(label, m.groups() if m else None)
