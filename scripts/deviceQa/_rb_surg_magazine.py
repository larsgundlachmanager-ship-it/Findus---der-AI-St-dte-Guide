#!/usr/bin/env python3
"""Surgical: dismiss Gmail, focus Findus, bags → search → wait magazine."""
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
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\rb_surg")
OUT.mkdir(parents=True, exist_ok=True)


def log(m: str) -> None:
    print(m.encode("ascii", "replace").decode("ascii"), flush=True)


def adb(*a: str):
    return subprocess.run([ADB, "-s", SERIAL, *a], capture_output=True, text=True, encoding="utf-8", errors="replace")


def shot(tag: str):
    p = OUT / f"{tag}.png"
    p.write_bytes(subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"]))
    log(f"shot {tag}")


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui_surg.xml")
    adb("pull", "/sdcard/Download/ui_surg.xml", str(OUT / "ui.xml"))
    try:
        return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'\btext="([^"]*)"', n)
        d = re.search(r'\bcontent-desc="([^"]*)"', n)
        b = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": (t.group(1) if t else "").replace("&#10;", " "),
            "desc": (d.group(1) if d else "").replace("&#10;", " "),
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def blob(xml: str) -> str:
    return "\n".join(
        s for n in nodes(xml) for s in (n["text"], n["desc"]) if (s or "").strip()
    )


def tap(x, y, w=0.8):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def tap_re(pat: str, xml: str | None = None) -> bool:
    xml = xml or dump()
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if re.search(pat, t, re.I) and len(t) < 80:
            log(f"tap {t[:50]}")
            tap(n["cx"], n["cy"])
            return True
    return False


def deeplink(q: str | None = None):
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.5)


def main() -> int:
    adb("reverse", "tcp:8791", "tcp:8791")
    # Dismiss Gmail / other
    for _ in range(3):
        xml = dump()
        b = blob(xml).lower()
        if re.search(r"e-mail bewerten|ich liebe es|nein, danke|später erinnern", b):
            tap_re(r"nein,? danke|später", xml) or tap_re(r"nein", xml)
            time.sleep(1)
            continue
        break

    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.2)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(4)
    deeplink()
    time.sleep(2)
    shot("start")
    xml = dump()
    if tap_re(r"neue reise", xml):
        time.sleep(2)

    q = (
        "Maennerwochenende 4 Leute 11. bis 13. Oktober 2026 ab Hamburg "
        "350 Euro p.P. Flug Apartment Pool Party warm guenstig. "
        "Nur Handgepaeck, kein Aufgabegepaeck. Verpflegung egal. Vor Ort OEPNV."
    )
    deeplink(q)
    time.sleep(8)
    shot("brief")
    deeplink("Nur Handgepaeck, kein Aufgabegepaeck")
    time.sleep(6)
    shot("bags")

    # Start search
    for i in range(8):
        xml = dump()
        b = blob(xml).lower()
        log(f"loop{i}: " + b[:180].replace("\n", " | "))
        if re.search(r"reise ansehen|weitere ideen|akt\s*3|akt\s*4", b):
            shot("mag_or_theater")
            break
        if re.search(r"fehlt noch|noch nicht alle|trotzdem suchen|trotzdem recherch|noch nicht ganz fertig|brief noch", b):
            if tap_re(r"trotzdem recherch|trotzdem suchen|suche starten", xml):
                time.sleep(3)
                continue
            tap_re(r"noch erg[aä]nz|weiter erz", xml)
            time.sleep(1)
            deeplink("Nur Handgepaeck, kein Aufgabegepaeck")
            time.sleep(5)
            continue
        if tap_re(r"passt\s*[—\-–].*suche|gr[uü]n\s*·|gelb\s*·\s*suche|suche starten|trotzdem recherch|brief\s*\d+", xml):
            time.sleep(2)
            xml2 = dump()
            b2 = blob(xml2).lower()
            if re.search(r"trotzdem recherch|trotzdem suchen", b2):
                tap_re(r"trotzdem recherch|trotzdem suchen", xml2)
                time.sleep(3)
            continue
        if re.search(r"gep[aä]ck", b):
            deeplink("Nur Handgepaeck, kein Aufgabegepaeck")
            time.sleep(5)
            continue
        if re.search(r"privat oder|bars?/clubs?", b):
            deeplink("Clubs und Bars")
            time.sleep(5)
            continue
        time.sleep(3)

    # Wait research
    t0 = time.time()
    result = {"ok": False}
    while time.time() - t0 < 240:
        xml = dump()
        b = blob(xml)
        low = b.lower()
        cards = len(re.findall(r"reise ansehen", low))
        matches = len(re.findall(r"\b\d{2,3}%\b", b))
        theater = bool(re.search(r"akt\s*3|w[uü]hle|flugmatrix|shortlist|recherch", low))
        log(f"wait cards={cards} matches={matches} theater={theater}")
        if cards or matches >= 2:
            shot("magazine")
            result = {"ok": True, "cards": cards, "matches": matches}
            if tap_re(r"reise ansehen", xml):
                time.sleep(3)
                shot("detail")
                adb("shell", "input", "swipe", "540", "1600", "540", "700", "400")
                time.sleep(1)
                shot("detail_scroll")
            break
        if theater:
            shot("theater")
        if re.search(r"passt das so|gr[uü]n|gelb", low):
            tap_re(r"passt|suche|gr[uü]n|gelb|brief", dump())
        time.sleep(6)
    else:
        shot("timeout")

    report = {"at": datetime.now(timezone.utc).isoformat(), "result": result, "snip": blob(dump())[:500]}
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
