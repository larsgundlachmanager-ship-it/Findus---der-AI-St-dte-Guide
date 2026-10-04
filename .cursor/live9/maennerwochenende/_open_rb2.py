#!/usr/bin/env python3
"""Force-open settings/reisebüro: swipe-tap dock + deep-link ask fallback."""
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


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


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


def texts(xml: str) -> list[str]:
    out = []
    for n in nodes(xml):
        for f in (n["text"], n["desc"]):
            f = (f or "").strip()
            if f and f not in out:
                out.append(f)
    return out


def find_settings(xml: str):
    best = None
    for n in nodes(xml):
        if not n["click"]:
            continue
        if n["desc"].strip().lower() == "einstellungen" or n["text"].strip().lower() in (
            "einst.",
            "einstellungen",
        ):
            if best is None or n["y1"] > best["y1"]:
                best = n
    return best


def look_like_settings(xml: str) -> bool:
    blob = "\n".join(texts(xml)).lower()
    return bool(
        re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise|pers[oö]nliche informationen", blob)
    )


def look_like_reise(xml: str) -> bool:
    blob = "\n".join(texts(xml)).lower()
    return bool(re.search(r"yorros?\s*reise|neue reise|antwort tippen|suche starten", blob)) or (
        "android.widget.EditText" in xml and "reise" in blob
    )


def swipe_tap(x: int, y: int, hold_ms: int = 90):
    # RN Pressable often needs press-in duration; zero-length swipe helps
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(hold_ms))
    time.sleep(0.35)


def main() -> int:
    # Do NOT force-stop — cold boot leaves empty a11y tree for a while on Nothing.
    adb(
        "shell",
        "am",
        "start",
        "-n",
        "de.findus.app/.MainActivity",
    )
    log("bring to foreground…")
    time.sleep(3)
    xml = dump("boot2")
    log("boot texts sample: " + " | ".join(texts(xml)[:8]))

    s = find_settings(xml)
    if not s:
        log("no settings node")
        return 2
    # tap upper half of button (avoid gesture nav)
    y = s["y1"] + max(20, (s["y2"] - s["y1"]) // 3)
    log(f"settings bounds cy≈{s['cy']} try y={y}")
    for attempt in range(3):
        swipe_tap(s["cx"], y, 120)
        time.sleep(1.8)
        xml = dump(f"after-settings-{attempt}")
        if look_like_settings(xml):
            log("SETTINGS OPEN")
            break
        log(f"attempt {attempt}: still home-ish")
    else:
        # Deep-link: tippfeld ask to open Reisebüro (works on release)
        q = urllib.parse.quote("Oeffne Yorros Reisebuero und starte eine neue Reise")
        log("deep link ask fallback")
        adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"findus://ask?q={q}")
        for i in range(20):
            time.sleep(2)
            xml = dump(f"deeplink-{i}")
            if look_like_reise(xml) or look_like_settings(xml):
                log(f"deeplink hit at t={i*2}s")
                break
            # also try tippen mic open
            tip = None
            for n in nodes(xml):
                if re.search(r"tippen schreibt|mikrofon", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                    tip = n
                    break
            if tip and i == 3:
                swipe_tap(tip["cx"], tip["cy"], 80)

    if look_like_settings(xml):
        # scroll + open reise
        for i in range(6):
            for n in nodes(xml):
                blob = f"{n['text']} {n['desc']}"
                if re.search(r"yorros?\s*reiseb|reiseb[uü]ro", blob, re.I) and n["click"]:
                    log(f"tap reise row {blob[:60]}")
                    swipe_tap(n["cx"], n["cy"], 100)
                    time.sleep(2)
                    xml = dump("reise-hub")
                    break
            else:
                adb("shell", "input", "swipe", "540", "1700", "540", "600", "350")
                time.sleep(0.7)
                xml = dump(f"set-scroll-{i}")
                continue
            break

    if look_like_reise(xml) or "android.widget.EditText" in xml:
        neu = None
        for n in nodes(xml):
            if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                neu = n
                break
        if neu:
            swipe_tap(neu["cx"], neu["cy"], 100)
            time.sleep(2)
            xml = dump("reise-active")
        log(f"EditText={'android.widget.EditText' in xml}")
        for t in texts(xml):
            if re.search(r"reise|suche|antwort|tippen|plan", t, re.I):
                log(f"  {t[:100]}")
        return 0 if ("android.widget.EditText" in xml or look_like_reise(xml)) else 1

    log("FAILED to open")
    (OUT / "open-fail2.txt").write_text("\n".join(texts(xml)), encoding="utf-8")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
