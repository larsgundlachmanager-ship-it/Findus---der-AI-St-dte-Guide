#!/usr/bin/env python3
"""Reliable UI ask + capture for overnight marathon (no askServer needed)."""
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


def adb(*args: str) -> subprocess.CompletedProcess:
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


def tap(x: int, y: int, wait: float = 0.4) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def shot(tag: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag: str, xml: str) -> str:
    path = OUT / f"{tag}.xml"
    path.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(path)], check=False)
    txt = OUT / f"{tag}-text.txt"
    return txt.read_text(encoding="utf-8", errors="ignore") if txt.exists() else ""


def dismiss() -> None:
    """Close sheets without spamming BACK (BACK opens system search)."""
    for _ in range(8):
        xml = dump()
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower()
            if any(
                k in blob
                for k in (
                    "schließen",
                    "schliessen",
                    "fertig",
                    "timeline schließen",
                    "karte schließen",
                    "tippfeld schließen",
                    "abbrechen",
                )
            ):
                hit = n
                break
        if not hit:
            return
        tap(hit["cx"], hit["cy"], 0.7)


def find_fragen(xml: str):
    return next(
        (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
        None,
    )


def tap_mic() -> bool:
    for cy in (1850, 1920, 1977, 2040, 1900, 2170):
        tap(540, cy, 0.15)
        time.sleep(1.6)
        xml = dump()
        if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
            return True
    return False


def ask(tag: str, text: str, wait_s: float = 28.0) -> str:
    dismiss()
    time.sleep(0.4)
    if not tap_mic():
        shot(f"{tag}-nomodal")
        xml = dump()
        extract(f"{tag}-nomodal", xml)
        print("NO_MODAL", tag)
        return ""
    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit or not fragen:
        shot(f"{tag}-nomodal")
        extract(f"{tag}-nomodal", dump())
        print("NO_MODAL", tag)
        return ""
    tap(edit["cx"], edit["cy"], 0.3)
    # ASCII-only for adb input text
    safe = (
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
    adb("shell", "input", "text", safe.replace(" ", "%s"))
    time.sleep(1.0)
    submitted = False
    for _ in range(4):
        xml = dump()
        fragen = find_fragen(xml)
        if not fragen:
            break
        tap(fragen["cx"], fragen["cy"], 0.8)
        submitted = True
        time.sleep(1.2)
        xml = dump()
        if find_fragen(xml) is None and not any(
            "EditText" in n["cls"] for n in nodes(xml)
        ):
            break
        # retry: tippfeld still up
        time.sleep(0.5)
    if not submitted:
        print("NO_FRAGEN", tag)
        return ""
    print("submitted", tag, safe[:80])
    deadline = time.time() + 12.0
    while time.time() < deadline:
        xml = dump()
        if find_fragen(xml) is None and not any(
            "EditText" in n["cls"] for n in nodes(xml)
        ):
            break
        # if still open, try Fragen again
        fragen = find_fragen(xml)
        if fragen:
            tap(fragen["cx"], fragen["cy"], 0.8)
        time.sleep(1.0)
    time.sleep(max(0.0, wait_s - 12.0))
    # Do NOT dismiss here — would close Alternativen/Spickzettel before capture
    shot(tag)
    xml = dump()
    txt = extract(tag, xml)
    print("captured", tag, "chars", len(txt))
    return txt


def tap_label(substr: str) -> bool:
    xml = dump()
    for n in nodes(xml):
        if not n["click"]:
            continue
        blob = n["desc"] + " " + n["text"]
        if substr.lower() in blob.lower():
            tap(n["cx"], n["cy"], 1.0)
            return True
    return False


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: _marathon_ask.py <tag> <question> [wait]")
        sys.exit(2)
    tag = sys.argv[1]
    q = sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 28.0
    ask(tag, q, wait)
