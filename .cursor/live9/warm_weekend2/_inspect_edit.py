import re
from pathlib import Path

OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\warm_weekend2")
for name in ("man.xml", "composer.xml", "hub.xml", "ui.xml"):
    p = OUT / name
    if p.exists() and p.stat().st_size > 100:
        xml = p.read_text(encoding="utf-8", errors="ignore")
        print("===", name, len(xml))
        hits = 0
        for n in re.findall(r"<node\b[^>]*>", xml):
            blob = n
            if not re.search(r"Antwort|EditText|tippen|TextView", blob, re.I):
                continue
            if not re.search(r"Antwort|EditText|tippen", blob, re.I):
                continue
            text = re.search(r'text="([^"]*)"', n)
            desc = re.search(r'content-desc="([^"]*)"', n)
            cls = re.search(r'class="([^"]*)"', n)
            bounds = re.search(r'bounds="([^"]*)"', n)
            print("cls", cls.group(1) if cls else None)
            print("text", ((text.group(1) if text else "")[:100]))
            print("desc", ((desc.group(1) if desc else "")[:100]))
            print("bounds", bounds.group(1) if bounds else None)
            print("click", 'clickable="true"' in n, "focus", 'focusable="true"' in n)
            print("---")
            hits += 1
            if hits > 20:
                break
        # also list all EditText / editable
        for n in re.findall(r"<node\b[^>]*>", xml):
            if "EditText" in n or 'password="false"' in n and 'focusable="true"' in n and "Edit" in n:
                print("EDITISH", n[:200])
