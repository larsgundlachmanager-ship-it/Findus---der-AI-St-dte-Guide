#!/usr/bin/env python3
"""Diagnose dock taps on Nothing; then open Reisebüro via tippfeld if needed."""
from __future__ import annotations

import re
import subprocess
import time
import urllib.parse
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SER = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende")
OUT.mkdir(parents=True, exist_ok=True)


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
    return p.read_text(encoding="utf-8", errors="ignore")


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
            "y2": y2,
            "click": 'clickable="true"' in n,
        }


def press(x, y, ms=150):
    # DOWN/UP via swipe duration
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(0.2)


def find_desc(xml, *exact):
    for n in nodes(xml):
        if not n["click"]:
            continue
        d = n["desc"].strip().lower()
        t = n["text"].strip().lower()
        for e in exact:
            if d == e.lower() or t == e.lower():
                return n
    return None


def blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        for f in (n["text"], n["desc"]):
            if f and f.strip():
                parts.append(f.strip())
    return "\n".join(parts)


def main() -> int:
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(2)
    xml = dump("diag-home")
    # Tap Timeline
    tl = find_desc(xml, "Timeline und Routenplanung", "Timeline")
    if tl:
        y = tl["y1"] + 25
        log(f"tap timeline {tl['cx']},{y}")
        press(tl["cx"], y, 180)
        time.sleep(2)
        xml = dump("diag-timeline")
        log("timeline open? " + str(bool(re.search(r"timeline|kalender|plan", blob(xml), re.I))))
        # back
        adb("shell", "input", "keyevent", "4")
        time.sleep(1.2)
        xml = dump("diag-after-back")

    # Tap Settings with several strategies
    s = find_desc(xml, "Einstellungen", "Einst.")
    if not s:
        log("no settings")
        return 2
    strategies = [
        ("upper", s["cx"], s["y1"] + 20, 180),
        ("mid", s["cx"], s["cy"], 220),
        ("iconish", s["cx"], s["y1"] + 35, 300),
        ("tap_cmd", s["cx"], s["y1"] + 25, None),
    ]
    for name, x, y, ms in strategies:
        log(f"strategy {name} @ {x},{y}")
        if ms is None:
            adb("shell", "input", "tap", str(x), str(y))
        else:
            press(x, y, ms)
        time.sleep(2.0)
        xml = dump(f"diag-set-{name}")
        b = blob(xml).lower()
        if re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise|pers[oö]nliche", b):
            log(f"SETTINGS via {name}")
            break
        log(f"  no settings yet; sample={b[:120]!r}")
    else:
        # Tippfeld path: short tap mic → type → send
        log("tippfeld path")
        xml = dump("diag-pre-mic")
        mic = None
        for n in nodes(xml):
            if "mikrofon" in (n["desc"] + n["text"]).lower() and n["click"]:
                mic = n
                break
        if mic:
            press(mic["cx"], mic["cy"], 80)
            time.sleep(1.5)
            xml = dump("diag-tippfeld")
            log("tippfeld texts: " + blob(xml)[:200])
            edit = next((n for n in nodes(xml) if "EditText" in str(n)), None)
            # class check
            if "android.widget.EditText" in xml:
                # focus edit
                for n in nodes(xml):
                    if "EditText" in (n.get("text") or "") or True:
                        pass
                # find edit by class in raw
                for n in re.findall(r"<node\b[^>]*>", xml):
                    if "android.widget.EditText" in n:
                        bounds = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                        if bounds:
                            x1, y1, x2, y2 = map(int, bounds.groups())
                            press((x1 + x2) // 2, (y1 + y2) // 2, 80)
                            break
                q = "Oeffne%Yorros%Reisebuero"
                adb("shell", "input", "text", q)
                time.sleep(0.5)
                adb("shell", "input", "keyevent", "66")
                time.sleep(5)
                xml = dump("diag-after-ask")
                log("after ask: " + blob(xml)[:300])
            else:
                # deep link voice/ask
                q = urllib.parse.quote("Oeffne Yorros Reisebuero")
                for url in (
                    f"findus://ask?q={q}",
                    f"findus://voice/ask?text={q}",
                    f"de.findus.app://ask?q={q}",
                ):
                    log(f"try {url[:60]}")
                    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url)
                    time.sleep(4)
                    xml = dump("diag-dl")
                    if re.search(r"reiseb|antwort tippen|tippfeld|senden", blob(xml), re.I):
                        log("deeplink worked")
                        break

    b = blob(xml).lower()
    if re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise", b):
        # open reise row
        for i in range(5):
            for n in nodes(xml):
                if re.search(r"yorros?\s*reiseb|reiseb", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                    press(n["cx"], n["cy"], 150)
                    time.sleep(2)
                    xml = dump("diag-reise")
                    break
            else:
                adb("shell", "input", "swipe", "540", "1700", "540", "600", "350")
                time.sleep(0.7)
                xml = dump(f"diag-scroll{i}")
                continue
            break
        # neue reise if hub
        for n in nodes(xml):
            if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                press(n["cx"], n["cy"], 150)
                time.sleep(2)
                xml = dump("diag-active")
                break
    log(f"EditText={'android.widget.EditText' in xml}")
    log("final sample: " + blob(xml)[:400])
    return 0 if "android.widget.EditText" in xml or re.search(r"antwort tippen|akt 1", blob(xml), re.I) else 1


if __name__ == "__main__":
    raise SystemExit(main())
