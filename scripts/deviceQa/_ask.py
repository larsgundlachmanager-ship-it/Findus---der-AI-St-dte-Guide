#!/usr/bin/env python3
"""Reliable human ask: close overlay, open type modal, type, submit, wait, shot."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")
XML = OUT / "ui.xml"


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True)


def dump_ui() -> str:
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
        blob = ((text.group(1) if text else "") + " " + (desc.group(1) if desc else "")).strip()
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "blob": blob,
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "y1": y1,
            "click": 'clickable="true"' in n,
        }


def visible_text(xml: str) -> list[str]:
    out: list[str] = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = s.replace("&#10;", " ").strip()
            if s and s not in out and s not in (".", " "):
                out.append(s)
    return out


def tap(x: int, y: int, wait: float = 0.45) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def swipe_tap(x: int, y: int, ms: int = 80) -> None:
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(1.6)


def shot(tag: str) -> None:
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass
    print("shot", dest)


def find_one(xml: str, pred) -> dict | None:
    return next((n for n in nodes(xml) if pred(n)), None)


def ascii_q(q: str) -> str:
    return (
        q.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace(" ", "%s")
    )


def close_overlays(xml: str) -> None:
    for n in nodes(xml):
        b = n["blob"].lower()
        if n["click"] and any(k in b for k in ("karte schließen", "karte schliessen", "abbrechen")):
            tap(n["cx"], n["cy"], 0.6)
            return


def main() -> int:
    args = sys.argv[1:]
    tag = "ask"
    wait = 48.0
    rest: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--tag" and i + 1 < len(args):
            tag = args[i + 1]
            i += 2
            continue
        if args[i] == "--wait" and i + 1 < len(args):
            wait = float(args[i + 1])
            i += 2
            continue
        rest.append(args[i])
        i += 1
    q = " ".join(rest).strip()
    if not q:
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "input", "keyevent", "224")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(2.0)
    xml = dump_ui()
    close_overlays(xml)
    time.sleep(0.8)
    xml = dump_ui()
    close_overlays(xml)
    time.sleep(0.6)

    xml = dump_ui()
    fragen = find_one(xml, lambda n: n["text"] == "Fragen" or n["desc"] == "Fragen")
    edit = find_one(xml, lambda n: "EditText" in n["cls"])
    if not edit:
        mic = find_one(xml, lambda n: "mikrofon" in n["blob"].lower() and n["click"])
        if mic:
            swipe_tap(mic["cx"], mic["cy"])
        else:
            swipe_tap(540, 1977)
        xml = dump_ui()
        edit = find_one(xml, lambda n: "EditText" in n["cls"])
        fragen = find_one(xml, lambda n: n["text"] == "Fragen" or n["desc"] == "Fragen")
    if not edit:
        shot(f"{tag}-nomodal")
        (OUT / f"{tag}-nomodal.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
        print("FAIL no field")
        return 1

    tap(edit["cx"], edit["cy"], 0.35)
    adb("shell", "input", "text", ascii_q(q))
    time.sleep(0.4)
    xml = dump_ui()
    (OUT / f"{tag}-typed.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
    shot(f"{tag}-typed")
    fragen = find_one(xml, lambda n: n["text"] == "Fragen" or n["desc"] == "Fragen") or fragen
    adb("shell", "input", "keyevent", "111")
    time.sleep(0.5)
    if fragen:
        tap(fragen["cx"], fragen["cy"], 0.8)
    else:
        tap(888, 1190, 0.8)
    print("submitted", q)
    time.sleep(wait)
    shot(tag)
    xml = dump_ui()
    (OUT / f"{tag}.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
    print("--- UI ---")
    sys.stdout.buffer.write((OUT / f"{tag}.txt").read_bytes()[:4000])
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
