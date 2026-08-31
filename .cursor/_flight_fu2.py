#!/usr/bin/env python3
"""Robust flight + Flughafen follow-ups (Tippfeld, no periods in adb text)."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\flight-fu2")
EXTRACT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / f"{tag}.xml"
    r = adb("pull", "/sdcard/Download/ui.xml", str(p))
    if not p.exists():
        # fallback empty hierarchy
        p.write_text("<hierarchy/>", encoding="utf-8")
        print("dump_fail", tag, (r.stderr or "")[:120])
    return p.read_text(encoding="utf-8", errors="ignore")


def shot(tag: str) -> None:
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


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


def find_fragen(xml: str):
    return next(
        (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
        None,
    )


def dismiss() -> None:
    for _ in range(6):
        xml = dump("dismiss")
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower()
            if any(
                k in blob
                for k in (
                    "tippfeld schließen",
                    "schließen",
                    "schliessen",
                    "abbrechen",
                    "fertig",
                )
            ):
                # Don't tap map "Karte schließen" as first if tippfeld open
                if "karte schließen" in blob and find_fragen(xml):
                    continue
                hit = n
                break
        if not hit:
            return
        adb("shell", "input", "tap", str(hit["cx"]), str(hit["cy"]))
        time.sleep(0.7)


def open_tippfeld() -> bool:
    xml = dump("pre-mic")
    if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
        return True
    for cy in (1850, 1920, 1980, 2040, 2100):
        adb("shell", "input", "tap", "540", str(cy))
        time.sleep(1.7)
        xml = dump(f"mic-{cy}")
        if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
            return True
    return False


def ask(tag: str, text: str, wait_s: float) -> str:
    dismiss()
    time.sleep(0.4)
    if not open_tippfeld():
        shot(f"{tag}-nomodal")
        dump(f"{tag}-nomodal")
        print("NO_MODAL", tag)
        return ""
    xml = dump(f"{tag}-open")
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit or not fragen:
        print("NO_EDIT", tag)
        return ""
    adb("shell", "input", "tap", str(edit["cx"]), str(edit["cy"]))
    time.sleep(0.3)
    # clear
    for _ in range(60):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")
    safe = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace(".", "")
        .replace(",", "")
        .replace(":", "")
        .replace("?", "")
        .replace("!", "")
    )
    adb("shell", "input", "text", safe.replace(" ", "%s"))
    time.sleep(0.8)
    xml = dump(f"{tag}-typed")
    fragen = find_fragen(xml)
    if not fragen:
        print("NO_FRAGEN", tag)
        return ""
    adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))
    print("submitted", tag, safe[:90])
    # wait tippfeld gone
    deadline = time.time() + min(12.0, wait_s)
    while time.time() < deadline:
        xml = dump(f"{tag}-wait")
        if find_fragen(xml) is None:
            break
        time.sleep(1.0)
    time.sleep(max(0.0, wait_s - 12.0))
    shot(tag)
    xml = dump(tag)
    subprocess.run(["python", str(EXTRACT), str(OUT / f"{tag}.xml")], check=False)
    txt_path = OUT / f"{tag}-text.txt"
    txt = txt_path.read_text(encoding="utf-8", errors="ignore") if txt_path.exists() else ""
    print("captured", tag, "chars", len(txt))
    return txt


def score(txt: str) -> dict:
    low = txt.lower()
    return {
        "flight": any(
            k in low
            for k in (
                "flug",
                "abflug",
                "ham",
                "vie",
                "wien",
                "flughafen",
                "boarding",
                "gate",
                "leave",
            )
        ),
        "airport_nav": any(
            k in low
            for k in (
                "s-bahn",
                "sbahn",
                "taxi",
                "zum flughafen",
                "flughafen",
                "los",
                "uhr",
                "route",
                "öpnv",
                "oepnv",
                "fahren",
            )
        ),
        "pollution": any(
            k in low
            for k in ("heimatverein", "pinnau", "bäckerei", "baeckerei", "museum in gehweite")
        ),
        "preview": " | ".join(txt.splitlines()[:12])[:320],
    }


def main() -> None:
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1.2)
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(14)

    steps = [
        ("f1", "Flug von Hamburg nach Wien morgen Abend", 60.0),
        ("f2", "Wie komme ich zum Flughafen", 45.0),
        ("f3", "Wann muss ich von zu Hause los", 40.0),
        ("f4", "Mit der S-Bahn oder besser mit dem Taxi", 40.0),
    ]
    print("=== FLIGHT FOLLOW-UP LIVE ===")
    for tag, q, w in steps:
        txt = ask(tag, q, w)
        s = score(txt)
        print(tag, s)
        time.sleep(2.0)


if __name__ == "__main__":
    main()
