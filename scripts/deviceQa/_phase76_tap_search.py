#!/usr/bin/env python3
"""Debug + tap Grün Suche starten on Nothing."""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\phase76_nothing")
PKG = "de.findus.app"


def adb(*a):
    return subprocess.run([ADB, "-s", S, *a], capture_output=True, text=True, encoding="utf-8", errors="replace")


def dump():
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "debug.xml"))
    return (OUT / "debug.xml").read_text(encoding="utf-8", errors="ignore")


def nodes(xml):
    for n in re.findall(r"<node\b[^>]*>", xml):
        text = re.search(r'\btext="([^"]*)"', n)
        desc = re.search(r'\bcontent-desc="([^"]*)"', n)
        bounds = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
            "y1": y1,
            "y2": y2,
        }


def main():
    # reopen RB if needed
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "findus://reisebuero", PKG)
    time.sleep(2.5)
    xml = dump()
    hits = []
    for n in nodes(xml):
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"Suche|Gelb|Gr.|passt|%|Highlight|starten", blob, re.I):
            hits.append(n)
            print(f"HIT click={n['click']} ({n['cx']},{n['cy']}) {blob[:80]!r}")
    # Prefer green search
    target = None
    for n in hits:
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"Suche starten|Suche m", blob, re.I):
            target = n
            break
    if not target:
        for n in hits:
            if "%" in f"{n['text']}{n['desc']}" and n["click"]:
                target = n
                break
    if not target:
        # geometric fallback above mic
        print("NO NODE — geometric tap")
        adb("shell", "input", "tap", "540", "1680")
    else:
        print(f"TAP {target['cx']},{target['cy']}")
        adb("shell", "input", "tap", str(target["cx"]), str(target["cy"]))
    time.sleep(2)
    # alert
    xml = dump()
    for n in nodes(xml):
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"Trotzdem suchen|Suche starten", blob, re.I) and len(blob) < 40:
            print(f"ALERT {blob}")
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(2)
            break
    # answer highlight if still there
    xml = dump()
    b = "\n".join(f"{n['text']}" for n in nodes(xml) if n["text"])
    print("AFTER:", b[:400].replace("\n", " | "))
    if re.search(r"Highlight", b, re.I):
        url = "findus://reisebuero?q=" + __import__("urllib.parse").parse.quote(
            "Highlight egal, Party und Pool reichen"
        )
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
        time.sleep(5)
        xml = dump()
        for n in nodes(xml):
            blob = f"{n['text']} {n['desc']}"
            if re.search(r"Suche starten", blob, re.I):
                adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
                print("retap search")
                break
    time.sleep(3)
    data = subprocess.check_output([ADB, "-s", S, "exec-out", "screencap", "-p"])
    (OUT / "after_search_tap.png").write_bytes(data)
    print("shot after_search_tap.png")


if __name__ == "__main__":
    main()
