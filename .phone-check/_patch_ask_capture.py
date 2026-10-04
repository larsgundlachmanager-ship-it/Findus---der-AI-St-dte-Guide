#!/usr/bin/env python3
from pathlib import Path
import re

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_qa40_live.py")
t = p.read_text(encoding="utf-8")
pat = re.compile(
    r"def ask_and_capture\(tag: str, text: str, wait_s: float\) -> tuple\[str, str\]:.*?return txt, logs\n",
    re.S,
)
m = pat.search(t)
if not m:
    raise SystemExit("ask_and_capture not found")
new = '''def ask_and_capture(tag: str, text: str, wait_s: float) -> tuple[str, str]:
    dismiss()
    adb("logcat", "-c")
    try:
        resp = post_ask(text)
        print("queued", tag, resp[:80], flush=True)
    except Exception as e:
        print("ASK_FAIL", tag, e, flush=True)
        return "", f"ask_fail:{e}"
    # Poller ~900ms; wait for answer — Spickzettel NICHT vor Capture schliessen
    time.sleep(max(12.0, wait_s))
    shot(f"{tag}-mid")
    time.sleep(min(10.0, max(3.0, wait_s * 0.3)))
    xml = dump()
    shot(tag)
    txt = extract(tag, xml)
    logs = grab_logcat(tag)
    return txt, logs

'''
t2 = pat.sub(new, t, count=1)
p.write_text(t2, encoding="utf-8")
print("ask_and_capture fixed")
