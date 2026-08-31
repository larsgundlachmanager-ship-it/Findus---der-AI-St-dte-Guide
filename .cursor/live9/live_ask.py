#!/usr/bin/env python3
"""ADB live ask helper: tap mic → type German question → submit → dump UI/screenshot."""
from __future__ import annotations

import argparse
import html
import re
import subprocess
import sys
import time
from pathlib import Path

ADB = str(Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe")
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9")


def adb(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [ADB, *args],
        check=check,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )


def dump_ui(label: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
    xml = OUT / f"{label}.xml"
    adb("pull", "/sdcard/ui.xml", str(xml), check=False)
    adb("shell", "screencap", "-p", "/sdcard/live9.png", check=False)
    png = OUT / f"{label}.png"
    adb("pull", "/sdcard/live9.png", str(png), check=False)
    try:
        from PIL import Image

        im = Image.open(png)
        im.resize((540, max(1, int(im.height * 540 / im.width)))).save(
            OUT / f"{label}-sm.png"
        )
    except Exception as e:
        print("shrink fail", e, file=sys.stderr)
    texts = []
    if xml.exists():
        t = xml.read_text(encoding="utf-8", errors="replace")
        seen = set()
        for x in re.findall(r'text="([^"]*)"', t) + re.findall(
            r'content-desc="([^"]*)"', t
        ):
            x = html.unescape(x).strip()
            if x and x not in seen:
                seen.add(x)
                texts.append(x)
        (OUT / f"{label}.txt").write_text("\n".join(texts), encoding="utf-8")
    return xml


def find_bounds(xml: Path, *needles: str) -> tuple[int, int] | None:
    if not xml.exists():
        return None
    t = xml.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(
        r'content-desc="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
        r'|text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
        t,
    ):
        g = m.groups()
        label = html.unescape(g[0] or g[5] or "")
        if g[0] is not None:
            x1, y1, x2, y2 = map(int, g[1:5])
        else:
            x1, y1, x2, y2 = map(int, g[6:10])
        low = label.lower()
        if any(n.lower() in low for n in needles):
            return (x1 + x2) // 2, (y1 + y2) // 2
    return None


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y), check=False)


def set_clipboard(text: str) -> None:
    # Prefer cmd clipboard service; fall back to input text (ASCII only)
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    r = adb(
        "shell",
        "cmd",
        "clipboard",
        "set-text",
        text,
        check=False,
    )
    if r.returncode != 0:
        # ASCII-ish fallback: replace umlauts
        ascii_map = str.maketrans(
            {
                "ä": "ae",
                "ö": "oe",
                "ü": "ue",
                "Ä": "Ae",
                "Ö": "Oe",
                "Ü": "Ue",
                "ß": "ss",
                "–": "-",
                "—": "-",
                "„": '"',
                "“": '"',
                "‚": "'",
                "‘": "'",
            }
        )
        safe = text.translate(ascii_map)
        safe = re.sub(r"[^A-Za-z0-9 .,!?;:'\"/+@#%&\-]", " ", safe)
        adb("shell", "input", "text", safe.replace(" ", "%s"), check=False)


def paste() -> None:
    # KEYCODE_PASTE = 279 on many devices; also Ctrl-V via META
    adb("shell", "input", "keyevent", "279", check=False)
    time.sleep(0.2)
    adb("shell", "input", "keyevent", "--longpress", "KEYCODE_CTRL_LEFT", "KEYCODE_V", check=False)


def ask(text: str, label: str, wait_s: float = 18.0) -> None:
    print(f"=== ASK [{label}] {text}")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity", check=False)
    time.sleep(1.2)
    xml = dump_ui(f"{label}-pre")
    mic = find_bounds(xml, "Mikrofon", "halten spricht", "tippen schreibt")
    if not mic:
        # fallback center-bottom mic
        mic = (540, 2000)
    tap(*mic)
    time.sleep(1.0)
    xml2 = dump_ui(f"{label}-typed-open")
    field = find_bounds(xml2, "Frage", "Schreib", "Tippfeld")
    # Focus TextInput: usually in the modal card
    if field:
        tap(*field)
    else:
        tap(540, 1700)
    time.sleep(0.4)
    set_clipboard(text)
    time.sleep(0.2)
    paste()
    # Also try input text as backup if clipboard empty
    time.sleep(0.3)
    submit = find_bounds(dump_ui(f"{label}-before-submit"), "Fragen")
    if submit:
        tap(*submit)
    else:
        tap(800, 1550)  # typical Fragen button area
    print(f"waiting {wait_s}s …")
    time.sleep(wait_s)
    dump_ui(f"{label}-after")
    # logcat slice
    log = adb(
        "logcat",
        "-d",
        "-t",
        "200",
        "-s",
        "ReactNativeJS:V",
        "Findus:V",
        "Yorro:V",
        check=False,
    )
    (OUT / f"{label}-log.txt").write_text(log.stdout or "", encoding="utf-8")
    print("done", label)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("text")
    p.add_argument("--label", default="ask")
    p.add_argument("--wait", type=float, default=18.0)
    args = p.parse_args()
    ask(args.text, args.label, args.wait)


if __name__ == "__main__":
    main()
