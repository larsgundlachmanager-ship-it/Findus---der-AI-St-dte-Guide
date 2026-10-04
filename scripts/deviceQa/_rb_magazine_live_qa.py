#!/usr/bin/env python3
"""Focused Reisebüro live QA: Brief → Recap → Research → Magazin.

Nothing (nur Gerät online). Deeplink q= für Tippen.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

from _device_ids import TRAVEL_SERIAL  # noqa: E402

SERIAL = TRAVEL_SERIAL
os.environ["FINDUS_QA_SERIAL"] = SERIAL
os.environ["ANDROID_SERIAL"] = SERIAL

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "rb_magazine_qa"
XML = OUT / "ui.xml"


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/Download/ui_rb.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(XML))
    try:
        return XML.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def shot(tag: str) -> Path:
    dest = OUT / f"{tag}.png"
    try:
        data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
        dest.write_bytes(data)
        log(f"shot {dest.name}")
    except Exception as e:
        log(f"shot fail {e}")
    return dest


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        text = re.search(r'\btext="([^"]*)"', n)
        desc = re.search(r'\bcontent-desc="([^"]*)"', n)
        bounds = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": (text.group(1) if text else "").replace("&#10;", " "),
            "desc": (desc.group(1) if desc else "").replace("&#10;", " "),
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "y1": y1,
            "click": 'clickable="true"' in n,
        }


def blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = (s or "").strip()
            if s:
                parts.append(s)
    return "\n".join(parts)


def tap(x: int, y: int, wait: float = 0.7) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def deeplink(q: str | None = None) -> None:
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.6)


def send(text: str, wait: float = 5.5) -> str:
    safe = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace("€", "Euro")
    )
    log(">> " + safe[:110])
    deeplink(safe)
    time.sleep(wait)
    return dump()


def dismiss_kb() -> None:
    tap(540, 160, 0.4)


def tap_by_re(pattern: str, xml: str | None = None, prefer_lower: bool = True) -> bool:
    xml = xml or dump()
    cands = []
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}".strip()
        if not re.search(pattern, t, re.I):
            continue
        if len(t) > 90:
            continue
        cands.append(n)
    if not cands:
        return False
    if prefer_lower:
        cands.sort(key=lambda n: -n["y1"])
    n = cands[0]
    log(f"tap '{(n['text'] or n['desc'])[:60]}' @ {n['cx']},{n['cy']}")
    tap(n["cx"], n["cy"], 1.1)
    return True


def open_rb() -> bool:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3)
    deeplink()
    time.sleep(2.5)
    xml = dump()
    shot("00_open")
    b = blob(xml).lower()
    if re.search(r"yorros?\s*reise|neue reise|akt\s*[1-5]|erzähl|antwort tippen", b):
        return True
    # Settings path
    tap_by_re(r"einstell", xml)
    xml = dump()
    tap_by_re(r"reiseb", xml)
    time.sleep(2)
    return bool(re.search(r"reise|akt|erzähl", blob(dump()).lower()))


def new_trip() -> None:
    xml = dump()
    tap_by_re(r"schlie[sß]en|^x$", xml, prefer_lower=False)
    time.sleep(1)
    deeplink()
    time.sleep(2)
    xml = dump()
    if not tap_by_re(r"neue reise", xml):
        deeplink("Neue Reise bitte")
        time.sleep(2)
    shot("01_new")


def confirm_search_sheet() -> bool:
    xml = dump()
    b = blob(xml).lower()
    if re.search(r"trotzdem suchen|suche starten|weiter erzählen|brief noch", b):
        shot("confirm_sheet")
        if tap_by_re(r"trotzdem suchen|suche starten", xml):
            return True
    return False


def start_search() -> bool:
    dismiss_kb()
    xml = dump()
    b = blob(xml).lower()
    # Recap green
    if tap_by_re(
        r"passt\s*[—\-–].*suche|gr[uü]n\s*·\s*suche|suche starten|gelb\s*·\s*suche|rot\s*·\s*brief",
        xml,
    ):
        time.sleep(1.2)
        confirm_search_sheet()
        return True
    # a11y only percent
    if tap_by_re(r"brief\s*\d+\s*%|suche m[oö]glich", xml):
        time.sleep(1.2)
        confirm_search_sheet()
        return True
    log("no search btn — blob snip: " + b[:200].replace("\n", " | "))
    return False


def answer_gaps(max_rounds: int = 6) -> None:
    for i in range(max_rounds):
        xml = dump()
        b = blob(xml)
        low = b.lower()
        if re.search(r"passt das so|akt\s*2", low):
            log(f"gap{i}: recap")
            start_search()
            return
        if re.search(r"privat oder|bars?/clubs?|party-stil|feiert ihr", low):
            send("Eher Clubs und Bars, nicht privat", wait=5)
            continue
        if re.search(r"verpflegung|frühstück|fruehstueck", low):
            send("Verpflegung egal, Selbstversorgung ok", wait=5)
            continue
        if re.search(r"gep[aä]ck|handgep", low):
            send("Nur Handgepaeck, ein Handgepaeck, kein Aufgabegepaeck", wait=5)
            continue
        if re.search(r"noch nicht alle infos|fehlt noch|trotzdem suchen", low):
            # Altes Alert: erst Gepaeck nachziehen, dann bestaetigen
            send("Nur Handgepaeck reicht", wait=5)
            dismiss_kb()
            tap_by_re(r"trotzdem suchen", dump())
            return
        if re.search(r"vor ort|mietwagen", low):
            send("Vor Ort OEPNV und zu Fuss", wait=5)
            continue
        if re.search(r"drinks|wie wichtig", low):
            send("Guenstige Drinks nice-to-have", wait=5)
            continue
        # stuck on open question?
        if "❓" in b and re.search(r"gr[uü]n|gelb|suche", low):
            start_search()
            return
        break


def wait_research_or_magazine(timeout_s: float = 280.0) -> dict:
    t0 = time.time()
    last: dict = {"ok": False}
    while time.time() - t0 < timeout_s:
        xml = dump()
        b = blob(xml)
        low = b.lower()
        cards = len(re.findall(r"reise ansehen", low))
        matches = len(re.findall(r"\b\d{2,3}%\b", b))
        theater = bool(re.search(r"akt\s*3|w[uü]hle|flugmatrix|theater|recherch|shortlist|optionen", low))
        mag = cards >= 1 or matches >= 2 or bool(re.search(r"weitere ideen|4\s+optionen|pakete", low))
        last = {
            "cards": cards,
            "matches": matches,
            "theater": theater,
            "mag": mag,
            "snip": b[:400].replace("\n", " | "),
        }
        log(f"wait {last}")
        if mag:
            shot("magazine")
            last["ok"] = True
            return last
        if theater:
            shot("theater")
        # Altes Alert: Gepaeck-Blocker
        if re.search(r"fehlt noch.*gep[aä]ck|noch nicht alle infos", low):
            log("alert bags — answer then confirm")
            # Dismiss via WEITER then answer, or confirm after bags deeplink
            if tap_by_re(r"weiter erz", xml):
                time.sleep(1)
            send("Nur Handgepaeck, kein Aufgabegepaeck", wait=6)
            start_search()
            time.sleep(4)
            continue
        if re.search(r"trotzdem suchen", low) and tap_by_re(r"trotzdem suchen", xml):
            time.sleep(4)
            continue
        if re.search(r"passt das so|akt\s*2", low):
            start_search()
            time.sleep(5)
            continue
        if re.search(r"gr[uü]n|gelb|brief\s*\d+", low) and not theater:
            answer_gaps(3)
            start_search()
            time.sleep(6)
            continue
        time.sleep(5)
    shot("timeout")
    return last


def open_first_magazine() -> bool:
    xml = dump()
    if tap_by_re(r"reise ansehen", xml):
        time.sleep(3)
        shot("magazine_open")
        return True
    # tap match % card
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if re.search(r"\d{2,3}%", t) and n["click"]:
            tap(n["cx"], n["cy"], 2.5)
            shot("magazine_open")
            return True
    return False


def magazine_looks_ok(xml: str) -> dict:
    b = blob(xml).lower()
    checks = {
        "has_title": bool(re.search(r"yorro|ideen|tag\s*\d|flug|hotel|apartment|€|euro", b)),
        "has_nav_or_timeline": bool(re.search(r"timeline|tag\s*1|anreise|buchen|check", b)),
        "not_empty_error": not bool(re.search(r"fehlgeschlagen|crash|etwas ist schief", b)),
        "pin_spam": len(re.findall(r"📌", blob(xml))) >= 6,
    }
    checks["ok"] = checks["has_title"] and checks["not_empty_error"]
    return checks


def count_pins(xml: str) -> int:
    return blob(xml).count("📌")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "at": datetime.now(timezone.utc).isoformat(),
        "serial": SERIAL,
        "steps": {},
    }
    log(f"RB magazine QA on {SERIAL}")
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")

    if not open_rb():
        report["error"] = "open_rb"
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 2

    new_trip()
    dump_text = (
        "Maennerwochenende zu viert, 11. bis 13. Oktober 2026, ab Hamburg, "
        "Budget 350 Euro pro Person, fliegen ok, Apartment oder Hotel, "
        "Pool und Party muessen, Verpflegung egal, vor Ort OEPNV, "
        "nur Handgepaeck kein Aufgabegepaeck, "
        "irgendwo warm und guenstig Deal suchen"
    )
    send(dump_text, wait=9)
    shot("02_brief")
    # Gepaeck explizit nachziehen (Hard-Gate vor Suche)
    send("Nur Handgepaeck, kein Aufgabegepaeck", wait=6)
    shot("02b_bags")
    xml = dump()
    report["steps"]["brief_pins"] = count_pins(xml)
    report["steps"]["brief_snip"] = blob(xml)[:500]

    answer_gaps(8)
    shot("03_after_gaps")
    start_search()
    time.sleep(3)
    confirm_search_sheet()
    shot("04_search_tapped")

    wait = wait_research_or_magazine(260)
    report["steps"]["wait"] = wait

    opened = False
    if wait.get("ok") or wait.get("mag"):
        opened = open_first_magazine()
    report["steps"]["magazine_opened"] = opened
    if opened:
        time.sleep(2)
        xml = dump()
        look = magazine_looks_ok(xml)
        report["steps"]["magazine_look"] = look
        shot("05_magazine_detail")
        # scroll a bit for visual
        adb("shell", "input", "swipe", "540", "1600", "540", "700", "400")
        time.sleep(1.2)
        shot("06_magazine_scrolled")

    report["pass"] = bool(
        wait.get("ok")
        and opened
        and report.get("steps", {}).get("magazine_look", {}).get("ok", True)
    )
    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(report["pass"]))
    log(json.dumps({k: report["steps"].get(k) for k in ("brief_pins", "wait", "magazine_opened", "magazine_look")}, ensure_ascii=False)[:800])
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
