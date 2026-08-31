#!/usr/bin/env python3
"""Dump-based live ask: short-tap mic, type ASCII, tap Fragen."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
XML = Path(r"C:\Users\larsf\Findus 2.0\.cursor\phone-ui.xml")
SHOT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\phone-live.png")
SHOT_SM = Path(r"C:\Users\larsf\Findus 2.0\.cursor\phone-live-sm.png")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True, text=True)


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
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def shot(tag: str | None = None) -> None:
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    dest = SHOT if not tag else SHOT.with_name(f"phone-{tag}.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(dest))
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        sm = dest.with_name(dest.stem + "-sm.png")
        im.save(sm)
    except Exception:
        pass


def tap(x: int, y: int, wait: float = 0.4) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def find_fragen(xml: str):
    return next(
        (
            n
            for n in nodes(xml)
            if n["desc"] == "Fragen" or n["text"] == "Fragen"
        ),
        None,
    )


def dismiss_overlays() -> None:
    """Settings, Spickzettel, Modals weg — sonst landen Fragen im falschen Screen."""
    for _ in range(3):
        xml = dump_ui()
        close = next(
            (
                n
                for n in nodes(xml)
                if n["click"]
                and any(
                    k in (n["desc"] + n["text"]).lower()
                    for k in (
                        "schließen",
                        "schliessen",
                        "karte schließen",
                        "abbrechen",
                        "tippfeld schließen",
                    )
                )
            ),
            None,
        )
        if close:
            tap(close["cx"], close["cy"], 0.5)
            continue
        # Android back
        adb("shell", "input", "keyevent", "4")
        time.sleep(0.6)


def tap_mic() -> None:
    """Kurz-Tipp auf Mic (nicht Hold) — öffnet Tippfeld."""
    for cy in (1977, 2040, 2170):
        tap(540, cy, 0.15)
        time.sleep(1.8)
        xml = dump_ui()
        if find_fragen(xml):
            return
    # Fallback: kurzer Swipe (legacy)
    adb("shell", "input", "swipe", "540", "1980", "540", "1980", "80")
    time.sleep(2.0)


def ask(text: str, wait_s: float = 22.0) -> None:
    dismiss_overlays()
    time.sleep(0.5)
    tap_mic()
    xml = dump_ui()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit or not fragen:
        print("NO_MODAL")
        shot("nomodal")
        return
    tap(edit["cx"], edit["cy"], 0.3)
    enc = text.replace(" ", "%s")
    adb("shell", "input", "text", enc)
    time.sleep(0.6)
    xml = dump_ui()
    fragen = find_fragen(xml)
    if not fragen:
        print("NO_FRAGEN")
        return
    tap(fragen["cx"], fragen["cy"], 1.2)
    print("submitted", text)
    # Warten bis Modal weg oder Spickzettel da
    deadline = time.time() + min(wait_s, 8.0)
    while time.time() < deadline:
        xml = dump_ui()
        if find_fragen(xml) is None:
            break
        time.sleep(1.0)
    time.sleep(max(0.0, wait_s - 8.0))
    shot("ask")
    dump_ui()
    print("done")


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
    if not q:
        sys.exit(2)
    ask(q)
