#!/usr/bin/env python3
"""Phase 7.6 Nothing — force-stop + deeplink clean path."""
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


def tap(x, y, w=0.7):
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(w)


def boot_rb():
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.8)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(5)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "findus://reisebuero", PKG)
    time.sleep(3.5)
    xml = dump()
    shot("boot")
    return "Antwort tippen" in blob(xml) or "Brief" in blob(xml)


def send_q(q: str, wait=6.0):
    url = "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    log("q: " + q[:100])
    time.sleep(wait)


def tap_search():
    # unfocus input
    tap(540, 200, 0.4)
    xml = dump()
    # Alert: nur der kurze Button, nie der Titel „Es fehlt noch… Trotzdem suchen?“
    for n in nodes(xml):
        t = (n["text"] or n["desc"] or "").strip()
        if re.fullmatch(r"TROTZDEM\s+SUCHEN|Trotzdem suchen", t, re.I):
            log(f"alert btn {t}")
            tap(n["cx"], n["cy"], 1.8)
            time.sleep(2)
            return True
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if n["click"] and re.search(r"Brief\s*\d+\s*%|Suche starten|Suche m", t, re.I):
            log(f"tap search {t.strip()[:55]} @({n['cx']},{n['cy']})")
            tap(n["cx"], n["cy"], 1.4)
            time.sleep(1.2)
            xml2 = dump()
            for m in nodes(xml2):
                tt = (m["text"] or m["desc"] or "").strip()
                if re.fullmatch(r"TROTZDEM\s+SUCHEN|Trotzdem suchen", tt, re.I):
                    log(f"trotzdem {tt}")
                    tap(m["cx"], m["cy"], 1.8)
                    time.sleep(2.5)
            return True
    log("fallback geometric search")
    tap(540, 2001, 1.4)
    return False


def score(xml):
    b = blob(xml)
    low = b.lower()
    return {
        "cards": len(re.findall(r"reise ansehen", low)),
        "matches": len(re.findall(r"\b\d{2,3}%\b", b)),
        "hint4": bool(re.search(r"4\s+optionen|städte", low)),
        "hint2": bool(re.search(r"\d\s+pakete|flugfenster|stay-spur|stay ·", low)),
        "akt2": bool(re.search(r"akt\s*2|passt das so", low)),
        "akt3": bool(re.search(r"akt\s*3", low)),
        "akt4": bool(re.search(r"akt\s*4|weitere ideen", low)),
        "brief": (re.search(r"Brief\s*(\d+)\s*%", b, re.I) or [None, None])[1],
        "snip": b[:280].replace("\n", " | "),
    }


def wait_opts(tag, min_n, timeout=300):
    t0 = time.time()
    last = {}
    while time.time() - t0 < timeout:
        xml = dump()
        last = score(xml)
        log(f"wait {tag}: { {k:last[k] for k in ('cards','matches','akt2','akt3','akt4','brief','hint4','hint2')} }")
        est = max(last["cards"], last["matches"])
        if est >= min_n or (min_n >= 4 and last["hint4"]) or (min_n >= 2 and (last["hint2"] or last["akt4"])):
            shot(f"{tag}_ok")
            last["ok"] = True
            last["est"] = est
            return last
        if last["akt2"]:
            tap_search()
            time.sleep(5)
            continue
        if last["akt3"]:
            time.sleep(12)
            continue
        # still briefing — answer common gaps lightly + search
        low = last["snip"].lower()
        if "drinks" in low:
            send_q("Drinks nice-to-have", 4)
        elif "highlight" in low:
            send_q("Highlight egal", 4)
        elif "gep" in low and "ack" in low:
            send_q("Nur Handgepaeck", 4)
        elif "vor ort" in low or "mietwagen" in low:
            send_q("OEPNV und zu Fuss", 4)
        tap_search()
        time.sleep(6)
    shot(f"{tag}_timeout")
    last["ok"] = False
    last["est"] = max(last.get("cards", 0), last.get("matches", 0))
    return last


def main():
    adb("reverse", "tcp:8791", "tcp:8791")
    report = {"at": datetime.now(timezone.utc).isoformat(), "serial": S, "scenarios": {}}
    if not boot_rb():
        report["error"] = "boot"
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 2

    log("=== A warm/guenstig → 4 ===")
    send_q(
        "Irgendwohin warm und guenstig, Deal suchen, zu zweit ab Hamburg. "
        "Anfang Oktober zwei Naechte. Budget 300 Euro pro Person. Fliegen ok. "
        "Apartment oder Hotel. Pool cool. Verpflegung egal. OEPNV. Nur Handgepaeck. "
        "Drinks egal. Highlight egal. Nur Handgepaeck, kein Aufgabegepaeck.",
        8,
    )
    send_q("Nur Handgepaeck reicht", 5)
    shot("A_brief")
    for _ in range(2):
        tap_search()
        time.sleep(3)
    a = wait_opts("A", 4, 320)
    report["scenarios"]["A_warm_open4"] = a

    log("=== B Prag → 2 ===")
    boot_rb()
    send_q(
        "Nur Prag, Wochenende zu zweit, ab Hamburg fliegen, kein Party kein Pool. "
        "Freitag 25. September bis Sonntag 27. September 2026. "
        "Budget 400 Euro pro Person. Apartment erst, Notfall Hotel. "
        "Verpflegung egal. OEPNV. Nur Handgepaeck.",
        7,
    )
    shot("B_brief")
    for _ in range(2):
        tap_search()
        time.sleep(3)
    b = wait_opts("B", 2, 320)
    report["scenarios"]["B_prag_specific2"] = b

    log("=== C langer Dump ===")
    boot_rb()
    send_q(
        "Zu viert Maennerwochenende Anfang Oktober ab Hamburg. "
        "Flug und Hotel fehlen noch. Budget 350 Euro p.P. Party und Pool. "
        "Max vier Stunden Anreise. Apartment sonst Hotel. Verpflegung egal. "
        "Bitte nur offene Luecken kurz nachfragen, dann suchen.",
        8,
    )
    time.sleep(4)
    xml = dump()
    shot("C_dump")
    low = blob(xml).lower()
    c = {
        "ok": bool(re.search(r"fehlt|lücke|budget|anreise|brief|passt|gruppe|frage", low)),
        "recap_or_gap": bool(re.search(r"fehlt|lücke|recap|noch|frage", low)),
        "snip": blob(xml)[:450],
    }
    report["scenarios"]["C_long_dump"] = c

    report["pass"] = {
        "A": bool(a.get("ok")),
        "B": bool(b.get("ok")),
        "C": bool(c.get("ok")),
    }
    report["pass"]["all"] = all(report["pass"].values())
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(report["pass"], indent=2))
    log(f"report {OUT/'report.json'}")
    return 0 if report["pass"]["all"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
