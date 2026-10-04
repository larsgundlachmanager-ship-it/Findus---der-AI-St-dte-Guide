#!/usr/bin/env python3
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_qa40_live.py")
t = p.read_text(encoding="utf-8")
start = t.find("def dismiss() -> None:")
end = t.find("\ndef reset_app() -> None:", start)
if start < 0 or end < 0:
    raise SystemExit(f"markers not found start={start} end={end}")
new = '''def dismiss() -> None:
    # Spickzettel / Nav / Timeline / Tippfeld zu — inkl. X auf Nav-Banner
    for _ in range(8):
        xml = dump()
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower().strip()
            text = (n["text"] or "").strip()
            if any(
                k in blob
                for k in (
                    "schließen",
                    "schliessen",
                    "fertig",
                    "timeline schließen",
                    "tippfeld schließen",
                    "abbrechen",
                    "aktionen schließen",
                    "navigation beenden",
                    "nav beenden",
                )
            ) and "karte schließen" not in blob:
                hit = n
                break
            if text in ("✕", "×", "x", "X") or blob in ("✕", "×"):
                hit = n
                break
        if not hit:
            adb("shell", "input", "keyevent", "4")
            time.sleep(0.35)
            return
        tap(hit["cx"], hit["cy"], 0.55)


'''
p.write_text(t[:start] + new + t[end + 1 :], encoding="utf-8")
print("dismiss patched ok")

# night100: reset unless follow-up
p2 = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_night100_run.py")
t2 = p2.read_text(encoding="utf-8")
old2 = '''        if s.get("reset_before"):
            qa.reset_app()
        else:
            qa.dismiss()
            time.sleep(0.6)
'''
new2 = '''        is_fu = ("_fu_" in s["id"]) or s["id"].endswith("_fu") or s.get("chain")
        if s.get("reset_before") or not is_fu:
            qa.reset_app()
        else:
            qa.dismiss()
            time.sleep(0.8)
'''
if old2 not in t2:
    print("night100 reset block not found")
else:
    p2.write_text(t2.replace(old2, new2, 1), encoding="utf-8")
    print("night100 reset patched")
