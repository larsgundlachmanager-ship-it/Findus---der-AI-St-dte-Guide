#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*a: str) -> None:
    subprocess.run([ADB, "-s", S, *a], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "tv2.xml"))
    return (OUT / "tv2.xml").read_text(encoding="utf-8", errors="ignore")


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        t = re.search(r'text="([^"]*)"', n)
        d = re.search(r'content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        c = re.search(r'class="([^"]*)"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": t.group(1) if t else "",
            "desc": d.group(1) if d else "",
            "cls": c.group(1) if c else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
        }


def main() -> int:
    xml = dump()
    fragen = next((n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen"), None)
    print("fragen", fragen)
    if not fragen:
        print("no Fragen — modal gone?")
        return 1
    # dismiss IME by tapping header
    adb("shell", "input", "tap", "540", "420")
    time.sleep(0.6)
    xml = dump()
    fragen = next((n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen"), None) or fragen
    print("tap", fragen["cx"], fragen["cy"])
    adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))
    time.sleep(0.7)
    adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))
    adb("shell", "input", "keyevent", "66")
    print("submitted")

    for i in range(12):
        time.sleep(12)
        xml = dump()
        texts = [(n["text"] or n["desc"]) for n in nodes(xml) if (n["text"] or n["desc"])]
        modal = any(t == "Fragen" for t in texts)
        interesting = [
            t
            for t in texts
            if any(
                k in t.lower()
                for k in (
                    "reiseb",
                    "urlaub",
                    "mallorca",
                    "tennis",
                    "pool",
                    "villa",
                    "flug",
                    "unterkunft",
                    "option",
                    "brief",
                    "moment",
                    "suche",
                    "palma",
                    "alcud",
                )
            )
            or (
                len(t) > 60
                and "Regen" not in t
                and "MapLibre" not in t
                and "Frage an" not in t
            )
        ]
        print(
            f"poll{i}",
            "modal" if modal else "nomodal",
            "|".join(interesting[:5]).encode("ascii", "replace").decode()[:200],
        )
        if interesting and not modal:
            break

    (OUT / "tennis-villa2.txt").write_text("\n".join(texts), encoding="utf-8")
    data = subprocess.check_output([ADB, "-s", S, "exec-out", "screencap", "-p"])
    (OUT / "tennis-villa2.png").write_bytes(data)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
