#!/usr/bin/env python3
"""Type a question like a human: tap mic, type ASCII, tap Fragen."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
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
            "click": 'clickable="true"' in n,
        }


def tap(x: int, y: int, wait: float = 0.4) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


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


def visible_text(xml: str) -> list[str]:
    out: list[str] = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = s.replace("&#10;", " ").strip()
            if s and s not in out and s not in (".", " "):
                out.append(s)
    return out


def find_mic(xml: str):
    return next(
        (n for n in nodes(xml) if "mikrofon" in n["blob"].lower() and n["click"]),
        None,
    )


def find_fragen(xml: str):
    return next(
        (
            n
            for n in nodes(xml)
            if n["desc"] == "Fragen" or n["text"] == "Fragen"
        ),
        None,
    )


def main() -> int:
    args = sys.argv[1:]
    tag = "uiask"
    wait = 50.0
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
        print("empty")
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "input", "keyevent", "224")
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(2.5)
    xml = dump_ui()
    mic = find_mic(xml)
    if not mic:
        print("NO_MIC — fallback 540,1977 short-tap")
        adb("shell", "input", "swipe", "540", "1977", "540", "1977", "80")
        time.sleep(1.8)
    else:
        print("mic", mic["cx"], mic["cy"])
        adb("shell", "input", "swipe", str(mic["cx"]), str(mic["cy"]), str(mic["cx"]), str(mic["cy"]), "80")
        time.sleep(1.8)
    xml = dump_ui()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit:
        print("NO_EDIT — retry lower mic")
        adb("shell", "input", "swipe", "540", "2100", "540", "2100", "80")
        time.sleep(1.8)
        xml = dump_ui()
        edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
        fragen = find_fragen(xml)
    if not edit:
        shot(f"{tag}-nomodal")
        (OUT / f"{tag}-nomodal.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
        print("FAIL no text field")
        return 1
    tap(edit["cx"], edit["cy"], 0.35)
    # adb input text: space as %s, no umlauts
    enc = (
        q.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace(" ", "%s")
    )
    adb("shell", "input", "text", enc)
    time.sleep(0.5)
    xml = dump_ui()
    fragen = find_fragen(xml) or fragen
    if not fragen:
        print("NO_FRAGEN")
        shot(f"{tag}-typed")
        return 1
    # hide IME so Fragen is tappable
    adb("shell", "input", "keyevent", "111")
    time.sleep(0.4)
    tap(fragen["cx"], fragen["cy"], 0.8)
    print("submitted", q)
    time.sleep(wait)
    shot(tag)
    xml = dump_ui()
    (OUT / f"{tag}.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
    print("--- UI ---")
    sys.stdout.buffer.write((OUT / f"{tag}.txt").read_bytes()[:4500])
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
