import re
from pathlib import Path

xml = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\warm_weekend6\paste-chunk1.xml").read_text(
    encoding="utf-8", errors="ignore"
)
for n in re.findall(r"<node\b[^>]*>", xml):
    if "EditText" in n or re.search(r"Antwort|Senden|Brief|Stick", n, re.I):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        cls = re.search(r'class="([^"]*)"', n)
        bounds = re.search(r'bounds="([^"]*)"', n)
        print(
            (cls.group(1) if cls else "")[-30:],
            "|",
            ((text.group(1) if text else "")[:50]),
            "|",
            ((desc.group(1) if desc else "")[:40]),
            "|",
            bounds.group(1) if bounds else "",
        )
