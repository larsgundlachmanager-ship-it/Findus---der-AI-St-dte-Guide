#!/usr/bin/env python3
"""Ask via already-open tippfeld or open mic; do not dismiss result sheets."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")
XML = OUT / "ui.xml"
EXTRACT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")


def adb(*args: str):
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cls = re.search(r'class="([^"]*)"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def tap(x, y, w=0.4):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def shot(tag: str):
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag: str, xml: str) -> str:
    path = OUT / f"{tag}.xml"
    path.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(path)], check=False)
    t = OUT / f"{tag}-text.txt"
    return t.read_text(encoding="utf-8", errors="ignore") if t.exists() else ""


def find_fragen(xml: str):
    return next(
        (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
        None,
    )


def ascii_q(text: str) -> str:
    return (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace("—", "-")
        .replace("–", "-")
    )


def ensure_tippfeld() -> bool:
    xml = dump()
    if find_fragen(xml) and any("EditText" in n["cls"] for n in nodes(xml)):
        return True
    # open mic
    for cy in (1977, 2040, 1900):
        tap(540, cy, 0.2)
        time.sleep(1.5)
        xml = dump()
        if find_fragen(xml):
            return True
    return False


def ask(tag: str, text: str, wait_s: float = 35.0) -> str:
    if not ensure_tippfeld():
        print("NO_MODAL", tag)
        shot(f"{tag}-nomodal")
        return ""
    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if edit:
        tap(edit["cx"], edit["cy"], 0.3)
    # clear field: select all + delete
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")  # DEL
    safe = ascii_q(text)
    adb("shell", "input", "text", safe.replace(" ", "%s"))
    time.sleep(0.8)
    xml = dump()
    fragen = find_fragen(xml)
    if not fragen:
        print("NO_FRAGEN", tag)
        return ""
    tap(fragen["cx"], fragen["cy"], 1.0)
    print("submitted", tag, safe[:90])
    deadline = time.time() + 15.0
    while time.time() < deadline:
        xml = dump()
        if find_fragen(xml) is None:
            break
        fragen = find_fragen(xml)
        if fragen:
            tap(fragen["cx"], fragen["cy"], 0.8)
        time.sleep(1.0)
    time.sleep(max(0.0, wait_s - 15.0))
    shot(tag)
    xml = dump()
    txt = extract(tag, xml)
    print("captured", tag, "chars", len(txt))
    # fail hints
    if tag.endswith("vegan") and re.search(r"steakhouse|bulls|rindock", txt, re.I):
        print("FAIL vegan->steakhouse")
    if "Zwei Optionen" in txt or "Alternativen" in txt or "Speisekarte" in txt:
        print("OK options/sheet visible")
    return txt


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(2)
    ask(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 35.0)
