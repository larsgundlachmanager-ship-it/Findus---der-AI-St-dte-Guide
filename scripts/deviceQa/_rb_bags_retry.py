#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import time
import urllib.parse
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\rb_surg")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*a: str):
    return subprocess.run([ADB, "-s", S, *a], capture_output=True, text=True, encoding="utf-8", errors="replace")


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui_s.xml")
    adb("pull", "/sdcard/Download/ui_s.xml", str(OUT / "ui.xml"))
    try:
        return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'\btext="([^"]*)"', n)
        d = re.search(r'\bcontent-desc="([^"]*)"', n)
        b = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": (t.group(1) if t else ""),
            "desc": (d.group(1) if d else ""),
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
        }


def tap_re(pat: str) -> bool:
    xml = dump()
    for n in nodes(xml):
        s = f"{n['text']} {n['desc']}"
        if re.search(pat, s, re.I) and len(s) < 90:
            print("tap", s[:70], flush=True)
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(1.1)
            return True
    return False


def link(q: str) -> None:
    url = "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(5.5)


def shot(tag: str) -> None:
    (OUT / f"{tag}.png").write_bytes(
        subprocess.check_output([ADB, "-s", S, "exec-out", "screencap", "-p"])
    )
    print("shot", tag, flush=True)


def main() -> int:
    tap_re(r"WEITER ERZ")
    time.sleep(1)
    link("Nur Handgepaeck, kein Aufgabegepaeck")
    shot("bags2")
    for _ in range(5):
        if tap_re(r"Gr.?n|Suche starten|Passt\s*[—\-–]"):
            time.sleep(1.5)
            if tap_re(r"TROTZDEM"):
                time.sleep(2)
            break
        time.sleep(1)
    shot("after_bags_search")
    # wait briefly for theater
    for i in range(20):
        xml = dump()
        low = " ".join(f"{n['text']} {n['desc']}" for n in nodes(xml)).lower()
        print(f"w{i}", "theater" if re.search(r"akt 3|w[uü]hle|option", low) else "…", flush=True)
        if re.search(r"reise ansehen|akt\s*3|weitere ideen", low):
            shot("got_mag")
            return 0
        time.sleep(6)
    shot("bags_timeout")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
