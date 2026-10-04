#!/usr/bin/env python3
"""Cold start then immediately open settings (fresh interactive window)."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SER = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende")


def log(m: str) -> None:
    try:
        print(m, flush=True)
    except UnicodeEncodeError:
        print(m.encode("ascii", "replace").decode("ascii"), flush=True)


def adb(*a: str):
    return subprocess.run(
        [ADB, "-s", SER, *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / f"{tag}.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(p))
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))
    return p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""


def nodes(xml: str):
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
            "y1": y1,
            "click": 'clickable="true"' in n,
        }


def wait_dock(timeout=60) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = dump("cold-wait")
        for n in nodes(xml):
            if n["desc"].strip().lower() == "einstellungen" and n["click"]:
                return xml
        time.sleep(2)
    return dump("cold-timeout")


def main() -> int:
    log("force-stop + cold launch")
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(2)
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    xml = wait_dock(90)
    s = None
    for n in nodes(xml):
        if n["desc"].strip().lower() == "einstellungen" and n["click"]:
            s = n
            break
    if not s:
        log("no dock after cold")
        return 2
    log(f"dock ready, tapping settings {s['cx']},{s['y1']+25}")
    # rapid taps in interactive window
    for i in range(5):
        y = s["y1"] + 25
        adb("shell", "input", "swipe", str(s["cx"]), str(y), str(s["cx"]), str(y), "160")
        time.sleep(1.2)
        xml = dump(f"cold-set-{i}")
        blob = " ".join(f"{n['text']} {n['desc']}" for n in nodes(xml)).lower()
        if re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise|pers[oö]nliche", blob):
            log(f"SETTINGS OPEN at try {i}")
            # open reise
            for _ in range(6):
                hit = None
                for n in nodes(xml):
                    if re.search(r"yorros?\s*reiseb|reiseb[uü]ro", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                        hit = n
                        break
                if hit:
                    adb(
                        "shell",
                        "input",
                        "swipe",
                        str(hit["cx"]),
                        str(hit["cy"]),
                        str(hit["cx"]),
                        str(hit["cy"]),
                        "150",
                    )
                    time.sleep(2)
                    xml = dump("cold-reise")
                    break
                adb("shell", "input", "swipe", "540", "1700", "540", "600", "350")
                time.sleep(0.7)
                xml = dump("cold-scroll")
            for n in nodes(xml):
                if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                    adb(
                        "shell",
                        "input",
                        "swipe",
                        str(n["cx"]),
                        str(n["cy"]),
                        str(n["cx"]),
                        str(n["cy"]),
                        "150",
                    )
                    time.sleep(2)
                    xml = dump("cold-active")
                    break
            log(f"EditText={'android.widget.EditText' in xml}")
            return 0 if "android.widget.EditText" in xml else 1
        log(f"try {i} fail")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
