import re
from pathlib import Path

t = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\mic-hunt.xml").read_text(
    encoding="utf-8", errors="ignore"
)
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", t):
    text_m = re.search(r'text="([^"]*)"', n)
    desc_m = re.search(r'content-desc="([^"]*)"', n)
    text = text_m.group(1) if text_m else ""
    desc = desc_m.group(1) if desc_m else ""
    blob = (text + " " + desc).lower()
    if any(
        k in blob
        for k in ("mikro", "fragen", "timeline", "orte", "einst", "mic")
    ):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        print(
            repr(blob[:90]),
            b.group(0) if b else "",
            "click" if 'clickable="true"' in n else "",
        )
