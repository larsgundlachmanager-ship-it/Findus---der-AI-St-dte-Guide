#!/usr/bin/env python3
"""Submit Tennis-Villa ask and poll UI (release APK)."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")
Q = "Plane Urlaub: Villa mit Tennisplatz und Pool auf Mallorca fuer 4 Freunde"


def adb(*args: str) -> None:
    subprocess.run([ADB, "-s", S, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "tennis-villa.xml"))
    return (OUT / "tennis-villa.xml").read_text(encoding="utf-8", errors="ignore")


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        t = re.search(r'text="([^"]*)"', n)
        d = re.search(r'content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        c = re.search(r'class="([^"]*)"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        blob = ((t.group(1) if t else "") + " " + (d.group(1) if d else "")).strip()
        yield {
            "text": t.group(1) if t else "",
            "desc": d.group(1) if d else "",
            "blob": blob,
            "cls": c.group(1) if c else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
        }


def texts(xml: str) -> list[str]:
    out = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = s.replace("&#10;", " ").strip()
            if s and s not in out:
                out.append(s)
    return out


def hits(ts: list[str]) -> list[str]:
    keys = (
        "villa",
        "tennis",
        "pool",
        "mallorca",
        "alcud",
        "palma",
        "flug",
        "unterkunft",
        "option",
        "reise",
        "paket",
        "stay",
        "must",
        "brief",
        "buy",
        "€",
        "euro",
        "yorro",
        "moment",
        "recherch",
    )
    return [t for t in ts if any(k in t.lower() for k in keys) or len(t) > 55]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # close overlays
    for _ in range(3):
        adb("shell", "input", "keyevent", "4")
        time.sleep(0.4)
    adb("shell", "am", "start", "-n", "de.findus.app/.MainActivity")
    time.sleep(2.0)

    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        adb("shell", "input", "swipe", "540", "1977", "540", "1977", "70")
        time.sleep(1.8)
        xml = dump()
        edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        print("FAIL no edit")
        return 1

    adb("shell", "input", "tap", str(edit["cx"]), str(edit["cy"]))
    time.sleep(0.3)
    for _ in range(50):
        adb("shell", "input", "keyevent", "67")
    enc = Q.replace(" ", "%s")
    adb("shell", "input", "text", enc)
    time.sleep(0.6)
    xml = dump()
    (OUT / "tennis-villa-typed.txt").write_text("\n".join(texts(xml)), encoding="utf-8")
    fragen = next((n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen"), None)
    if not fragen:
        print("FAIL no Fragen")
        return 1
    print("TAP", fragen["cx"], fragen["cy"])
    adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))

    best: list[str] = []
    for i in range(12):
        time.sleep(12)
        xml = dump()
        h = hits(texts(xml))
        if h:
            best = h
            print(f"poll{i}", " | ".join(h[:5]).encode("ascii", "replace").decode())
            if any(len(x) > 60 for x in h) and not any(
                "Frage an Yorro" in x for x in h
            ):
                break
        else:
            print(f"poll{i} …")

    data = subprocess.check_output([ADB, "-s", S, "exec-out", "screencap", "-p"])
    (OUT / "tennis-villa.png").write_bytes(data)
    xml = dump()
    ts = texts(xml)
    (OUT / "tennis-villa.txt").write_text("\n".join(ts), encoding="utf-8")
    (OUT / "tennis-villa-hits.txt").write_text("\n".join(hits(ts) or best), encoding="utf-8")
    print("--- HITS ---")
    for h in hits(ts) or best:
        print(h.encode("ascii", "replace").decode())
    ok = any(
        k in " ".join(hits(ts) or best).lower()
        for k in ("tennis", "pool", "villa", "mallorca", "palma", "alcud", "flug", "reise")
    ) and not any("Frage an Yorro" == x for x in (hits(ts) or best)[:3])
    print("RESULT", "PASS" if ok else "PARTIAL/FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
