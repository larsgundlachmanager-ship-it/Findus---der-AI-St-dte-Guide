#!/usr/bin/env python3
"""Visual Magazin-Check: tippen → soft-search → Screenshots bewerten."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\mag_look")
OUT.mkdir(parents=True, exist_ok=True)

BRIEF = (
    "Maennerwochenende 4 Leute 11. bis 13. Oktober 2026 ab Hamburg "
    "Budget 350 Euro pro Person fliegen Apartment Pool Party warm. "
    "Nur Handgepaeck kein Aufgabegepaeck. Clubs und Bars. Vor Ort OEPNV."
)


def log(m: str) -> None:
    print(m.encode("ascii", "replace").decode("ascii"), flush=True)


def adb(*a: str):
    return subprocess.run(
        [ADB, "-s", SERIAL, *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def shot(tag: str) -> Path:
    p = OUT / f"{tag}.png"
    p.write_bytes(subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"]))
    log(f"shot {tag}")
    return p


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui_mag.xml")
    adb("pull", "/sdcard/Download/ui_mag.xml", str(OUT / "ui.xml"))
    try:
        return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'\btext="([^"]*)"', n)
        d = re.search(r'\bcontent-desc="([^"]*)"', n)
        rid = re.search(r'\bresource-id="([^"]*)"', n)
        b = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": (t.group(1) if t else "").replace("&#10;", " "),
            "desc": (d.group(1) if d else "").replace("&#10;", " "),
            "rid": rid.group(1) if rid else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "y1": y1,
        }


def blob(xml: str) -> str:
    return "\n".join(s for n in nodes(xml) for s in (n["text"], n["desc"]) if (s or "").strip())


def tap(x, y, w=0.7):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def tap_re(pat: str, xml: str | None = None) -> bool:
    xml = xml or dump()
    cands = [n for n in nodes(xml) if re.search(pat, f"{n['text']} {n['desc']}", re.I) and len(f"{n['text']}{n['desc']}") < 90]
    if not cands:
        return False
    cands.sort(key=lambda n: -n["y1"])
    n = cands[0]
    log(f"tap {(n['text'] or n['desc'])[:50]}")
    tap(n["cx"], n["cy"])
    return True


def deeplink(q: str | None = None):
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.8)


def type_into_field(text: str) -> bool:
    xml = dump()
    field = None
    for n in nodes(xml):
        if re.search(r"antwort tippen|reisebueroTypeInput|edittext", f"{n['text']} {n['desc']} {n['rid']}", re.I):
            field = n
            break
    if not field:
        # geometric tip field area on Nothing ~1080x2400
        tap(400, 1750, 0.5)
    else:
        tap(field["cx"], field["cy"], 0.5)
    # clear + paste via am broadcast is flaky; use deeplink seed as primary
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    # Escape spaces for adb input text (%s)
    safe = text.replace(" ", "%s")[:180]
    adb("shell", "input", "text", safe)
    time.sleep(0.8)
    # send button (paper plane) near tip field
    if not tap_re(r"senden|absenden|paper", dump()):
        tap(980, 1750, 0.8)  # gold send circle
    time.sleep(4)
    return True


def main() -> int:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(5)
    deeplink()
    time.sleep(2)
    shot("00_hub_or_brief")
    tap_re(r"neue reise")
    time.sleep(2)

    # Prefer deeplink seed (works on release); then tip fallback
    deeplink(BRIEF)
    time.sleep(10)
    shot("01_after_seed")
    xml = dump()
    b = blob(xml).lower()
    if "noch nichts angepinnt" in b or not re.search(r"oktober|hamburg|350|pool|leute|gruppe", b):
        log("seed weak — tip field")
        type_into_field(BRIEF)
        time.sleep(8)
        shot("01b_after_type")

    # Soft force search
    for i in range(10):
        xml = dump()
        b = blob(xml).lower()
        log(f"loop{i}: " + b[:160].replace("\n", " | "))
        if re.search(r"reise ansehen|akt\s*3|akt\s*4|weitere ideen", b):
            break
        if re.search(r"trotzdem recherch|trotzdem suchen|noch nicht ganz fertig|brief noch", b):
            tap_re(r"trotzdem recherch|trotzdem suchen|suche starten", xml)
            time.sleep(3)
            continue
        if tap_re(r"gr[uü]n\s*·|gelb\s*·|rot\s*·|suche starten|passt\s*[—\-–]|brief\s*\d+", xml):
            time.sleep(1.5)
            continue
        if re.search(r"gep.?ck|handgep|aufgabegep", b):
            deeplink("Nur Handgepaeck kein Aufgabegepaeck")
            time.sleep(6)
            continue
        if re.search(r"privat oder|bars?", b):
            deeplink("Clubs und Bars")
            time.sleep(5)
            continue
        # Search / Ampel (auch ohne ·)
        if tap_re(r"gr[uü]n|gelb|rot\s*[·.]?\s*brief|suche starten|passt|brief\s*\d+\s*%|trotzdem", xml):
            time.sleep(1.5)
            xml2 = dump()
            b2 = blob(xml2).lower()
            if re.search(r"trotzdem recherch|trotzdem suchen|noch nicht ganz|brief noch", b2):
                tap_re(r"trotzdem recherch|trotzdem suchen", xml2) or tap(540, 2100, 1)
            continue

    # Wait magazine
    t0 = time.time()
    ok = False
    while time.time() - t0 < 300:
        xml = dump()
        b = blob(xml)
        low = b.lower()
        cards = len(re.findall(r"reise ansehen", low))
        matches = len(re.findall(r"\b\d{2,3}%\b", b))
        theater = bool(re.search(r"akt\s*3|w[uü]hle|shortlist|flugmatrix|recherch", low))
        log(f"wait cards={cards} matches={matches} theater={theater}")
        if cards or matches >= 2 or re.search(r"weitere ideen|4\s+optionen", low):
            shot("02_magazine_grid")
            ok = True
            if tap_re(r"reise ansehen", xml):
                time.sleep(3.5)
                shot("03_magazine_hero")
                for i, tag in enumerate(["04_scroll_a", "05_scroll_b", "06_scroll_c"]):
                    adb("shell", "input", "swipe", "540", "1700", "540", "700", "450")
                    time.sleep(1.2)
                    shot(tag)
            break
        if theater:
            shot("theater")
        if re.search(r"trotzdem recherch|trotzdem suchen", low):
            tap_re(r"trotzdem recherch|trotzdem suchen", dump())
        time.sleep(6)
    else:
        shot("timeout")

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "snip": blob(dump())[:800],
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps({"ok": ok}))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
