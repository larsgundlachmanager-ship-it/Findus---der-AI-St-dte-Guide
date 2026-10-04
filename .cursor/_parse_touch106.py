from pathlib import Path
import re

t = Path(r"c:/Users/larsf/Findus 2.0/.cursor/live7/nothing-touch-106.xml").read_text(
    encoding="utf-8", errors="replace"
)
for label, pat in [
    ("map", r'MapLibre[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
    ("mic", r'Mikrofon[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
    ("dock", r'Timeline und Routenplanung[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
    ("compass", r'Norden oben[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'),
]:
    m = re.search(pat, t)
    print(label, m.groups() if m else None)

mm = re.search(r'MapLibre[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
mic = re.search(r'Mikrofon[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
if mm and mic:
    map_b = int(mm.group(4))
    mic_t = int(mic.group(2))
    print("map_bottom", map_b, "mic_top", mic_t, "gap", mic_t - map_b, "overlap", map_b > mic_t)
