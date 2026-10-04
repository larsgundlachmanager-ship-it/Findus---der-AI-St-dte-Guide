#!/usr/bin/env python3
"""Minimal Nothing 7.6: Settings→RB→fat brief paste→tap Brief%→wait options."""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\phase76_nothing")


def adb(*a):
    return subprocess.run(
        [ADB, "-s", S, *a], capture_output=True, text=True, encoding="utf-8", errors="replace"
    )


def log(m):
    print(str(m).encode("ascii", "replace").decode("ascii"), flush=True)


def dump():
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "ui.xml"))
    return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")


def shot(tag):
    data = subprocess.check_output([ADB, "-s", S, "exec-out", "screencap", "-p"])
    (OUT / f"{tag}.png").write_bytes(data)
    log(f"shot {tag}")


def nodes(xml):
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
            "click": 'clickable="true"' in n,
        }


def blob(xml):
    return "\n".join(x for n in nodes(xml) for x in (n["text"], n["desc"]) if x.strip())


def tap(x, y, w=0.8):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def open_rb():
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.5)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(5)
    xml = dump()
    shot("min_home")
    for n in nodes(xml):
        if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
            tap(n["cx"], n["cy"], 2)
            break
    xml = dump()
    shot("min_settings")
    for n in nodes(xml):
        f = f"{n['text']} {n['desc']}"
        if re.search(r"reiseb", f, re.I) and len(f) < 60:
            tap(n["cx"], n["cy"], 2.5)
            break
    xml = dump()
    shot("min_hub")
    for n in nodes(xml):
        if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 2.5)
            break
    xml = dump()
    shot("min_composer")
    return "Antwort tippen" in blob(xml) or "Akt 1" in blob(xml) or "erz" in blob(xml).lower()


def deeplink_q(q: str):
    url = "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(5)


def tap_brief_search():
    xml = dump()
    # unfocus: tap title area
    tap(540, 160, 0.4)
    xml = dump()
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if n["click"] and re.search(r"Brief\s*\d+\s*%|Suche starten|Suche m", t, re.I):
            log(f"tap {t[:50]} @ {n['cx']},{n['cy']}")
            tap(n["cx"], n["cy"], 1.5)
            time.sleep(1)
            xml2 = dump()
            for m in nodes(xml2):
                tt = f"{m['text']} {m['desc']}"
                if re.search(r"Trotzdem suchen", tt, re.I):
                    tap(m["cx"], m["cy"], 1.5)
                    log("trotzdem")
            return True
    log("no brief btn — geometric")
    tap(540, 1960, 1.5)
    return False


def count_opts(xml):
    low = blob(xml).lower()
    cards = len(re.findall(r"reise ansehen", low))
    matches = len(re.findall(r"\b\d{2,3}%\b", blob(xml)))
    hint4 = bool(re.search(r"4\s+optionen|städte\s*&\s*deals", low))
    hint2 = bool(re.search(r"pakete|flugfenster|stay-spur", low))
    return {
        "cards": cards,
        "matches": matches,
        "hint4": hint4,
        "hint2": hint2,
        "est": max(cards, matches),
        "akt3": bool(re.search(r"akt\s*3", low)),
        "akt4": bool(re.search(r"akt\s*4|optionen —|weitere ideen", low)),
    }


def main():
    adb("reverse", "tcp:8791", "tcp:8791")
    report = {"at": datetime.now(timezone.utc).isoformat(), "device": S, "scenarios": {}}
    if not open_rb():
        report["error"] = "open_rb"
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 2

    # A warm open
    log("=== A ===")
    deeplink_q(
        "Irgendwohin warm und guenstig, Deal, zu zweit ab Hamburg, "
        "Anfang Oktober zwei Naechte, Budget 300 Euro p.P., fliegen ok, "
        "Apartment oder Hotel, Pool cool, Verpflegung egal, OEPNV, nur Handgepaeck, "
        "Drinks egal, Highlight egal. Bitte vier Optionen suchen."
    )
    shot("min_a_brief")
    time.sleep(3)
    for _ in range(3):
        tap_brief_search()
        time.sleep(4)
        c = count_opts(dump())
        log(c)
        if c["akt3"] or c["akt4"] or c["est"] >= 2:
            break
    # wait up to 4 min
    t0 = time.time()
    a = c
    while time.time() - t0 < 240:
        xml = dump()
        a = count_opts(xml)
        log(f"wait A {a}")
        if a["est"] >= 4 or a["hint4"] or (a["akt4"] and a["est"] >= 2):
            shot("min_a_ok")
            a["ok"] = True
            break
        if a["akt3"]:
            time.sleep(10)
            continue
        tap_brief_search()
        time.sleep(8)
    else:
        shot("min_a_timeout")
        a["ok"] = False
    report["scenarios"]["A"] = a

    # B Prag — reopen neue reise
    log("=== B ===")
    for n in nodes(dump()):
        if re.search(r"schlie", f"{n['text']}{n['desc']}", re.I):
            tap(n["cx"], n["cy"], 1)
            break
    open_rb()
    deeplink_q(
        "Nur Prag Wochenende zu zweit ab Hamburg fliegen. "
        "Freitag 25. September bis Sonntag 27. September 2026. "
        "Budget 400 Euro p.P. Apartment erst, Notfall Hotel. "
        "Verpflegung egal, OEPNV, Handgepaeck. Zwei Pakete bitte."
    )
    shot("min_b_brief")
    for _ in range(3):
        tap_brief_search()
        time.sleep(4)
    t0 = time.time()
    b = count_opts(dump())
    while time.time() - t0 < 240:
        b = count_opts(dump())
        log(f"wait B {b}")
        if b["est"] >= 2 or b["hint2"] or b["akt4"]:
            shot("min_b_ok")
            b["ok"] = True
            break
        if b["akt3"]:
            time.sleep(10)
            continue
        tap_brief_search()
        time.sleep(8)
    else:
        shot("min_b_timeout")
        b["ok"] = False
    report["scenarios"]["B"] = b

    # C dump
    log("=== C ===")
    for n in nodes(dump()):
        if re.search(r"schlie", f"{n['text']}{n['desc']}", re.I):
            tap(n["cx"], n["cy"], 1)
            break
    open_rb()
    deeplink_q(
        "Zu viert Maennerwochenende Anfang Oktober ab Hamburg. "
        "Flug und Hotel fehlen noch. Budget 350 Euro p.P. Party und Pool. "
        "Max 4 Stunden Anreise. Apartment sonst Hotel. Verpflegung egal. "
        "Bitte nur offene Luecken kurz nachfragen."
    )
    time.sleep(6)
    xml = dump()
    shot("min_c")
    low = blob(xml).lower()
    c = {
        "ok": bool(re.search(r"fehlt|lücke|recap|budget|anreise|passt|brief", low)),
        "snip": blob(xml)[:400],
    }
    report["scenarios"]["C"] = c
    report["pass"] = {
        "A": bool(a.get("ok")),
        "B": bool(b.get("ok")),
        "C": bool(c.get("ok")),
    }
    report["pass"]["all"] = all(report["pass"].values())
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(report["pass"], indent=2))
    return 0 if report["pass"]["all"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
