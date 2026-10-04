#!/usr/bin/env python3
"""Gap-Inventory-Live Device-QA — langer Dump → nur Lücken fragen.

Nur QA-Serial (Galaxy S7) — nie Nothing/Travel.

Pass-Kriterien nach einem Dump:
  1) gap_fill-Signale auf dem Board / in der Frage (Flug fehlt, Hotel steht, …)
  2) KEINE erneute Frage nach schon gesetzten Kern-Slots (Gruppe 4, Oktober, Lissabon, 400€)
  3) Offene Frage zielt auf Lücke (Flug/Bags/Transfer/Gepäck/Anreise) — nicht Purpose/Adults/When von vorn

Run:
  python scripts/deviceQa/_gap_inventory_live_qa.py
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

from _device_ids import QA_SERIAL, TRAVEL_SERIAL, require_qa_serial  # noqa: E402

# Explizites FINDUS_QA_SERIAL darf Travel sein (wie Phase-7.6 Nothing-Freigabe).
_explicit = (os.environ.get("FINDUS_QA_SERIAL") or "").strip()
if not _explicit:
    os.environ["FINDUS_QA_SERIAL"] = (QA_SERIAL or "ce12171cccf9c0810c").strip()
if not _explicit and os.environ["FINDUS_QA_SERIAL"] == TRAVEL_SERIAL:
    raise SystemExit(f"FAIL: Travel/Nothing ({TRAVEL_SERIAL}) ist kein QA-Gerät")

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "gap_inventory"
XML = OUT / "ui.xml"

# Langer Dump aus Smoke — Hotel gebucht, Flug+Transfer+Mietwagen Lücken
DUMP = (
    "Also wir sind zu viert, Oktober, Budget so 400 Euro pro Person, "
    "Hotel in Lissabon haben wir schon gebucht, Flug fehlt noch, "
    "Transfer brauchen wir auch noch, und Mietwagen waere nice, "
    "Party und Pool waere cool"
)

# Nach Dump sollten diese Themen NICHT als offene Kernfrage wiederkommen
MUST_NOT_REASK = [
    r"\bzu\s*viert\b|\bwie\s*viele\b|\bgruppe\b|\bpersonen\b",
    r"\boktober\b|\bwann\b|\bzeitraum\b|\bmonat\b",
    r"\b400\b.*euro|\bbudget\b.*\?",
    r"\blissabon\b.*\?|\bwelche\s*stadt\b|\bwohhin\b",
]

# Erwartete Lücken-Signale (Recap / Frage / Sticker)
GAP_SIGNALS = [
    r"flug",
    r"transfer",
    r"mietwagen|leihwagen",
    r"fehlt|luecke|lücke|noch\s+offen|brauchen",
    r"gepaeck|gepäck|handgepaeck|handgepäck",
    r"anreise|fliegen|direktflug",
]

HAVE_SIGNALS = [
    r"hotel|unterkunft",
    r"steht|gebucht|schon",
    r"lissabon",
    r"4\s*erwachsene|gruppe:\s*4",
    r"oktober\s*2026|reisezeit",
    r"400",
]


def serial() -> str:
    return require_qa_serial()


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", serial(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def looks_like_foreign_ui(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(
        re.search(
            r"\b(gmail|antworten|weiterleiten|archiv|papierkorb|betreff|empf[aä]nger)\b|"
            r"von meinem/meiner galaxy|wochenliche wiederholung|raumbuchung",
            b,
        )
    )


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    # Fokus auf Findus — sonst landet uiautomator oft in Mail/Notification
    adb("shell", "am", "start", "--activity-single-top", "-n", f"{PKG}/.MainActivity")
    time.sleep(0.6)
    remote = "/data/local/tmp/findus_ui.xml"
    r = adb("shell", "uiautomator", "dump", remote)
    if r.returncode != 0 or "ERROR" in ((r.stdout or "") + (r.stderr or "")).upper():
        adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
        remote = "/sdcard/Download/ui.xml"
    adb("pull", remote, str(XML))
    try:
        xml = XML.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        xml = ""
    if looks_like_foreign_ui(xml):
        log("dump: Fremd-UI — Deeplink Reisebüro + retry")
        deeplink()
        time.sleep(2.5)
        adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
        adb("pull", "/sdcard/Download/ui.xml", str(XML))
        try:
            xml = XML.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            xml = ""
    return xml


def shot(tag: str) -> Path:
    dest = OUT / f"{tag}.png"
    try:
        data = subprocess.check_output([ADB, "-s", serial(), "exec-out", "screencap", "-p"])
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


def tap(x: int, y: int, wait: float = 0.6) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def deeplink(q: str | None = None) -> None:
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.8)


def hub_or_composer(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(
        re.search(
            r"deine reisen|neue reise|akt\s*[1-5]|antwort tippen|erz[aä]hl|brief|budget|"
            r"flipchart|yorro|gepaeck|gepäck|flug|hotel",
            b,
        )
    )


def open_rb() -> bool:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    time.sleep(0.4)
    # Andere Apps (Mail etc.) können Deeplink schlucken — Findus hart nach vorne
    adb("shell", "am", "force-stop", PKG)
    time.sleep(0.8)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3.5)
    deeplink()
    time.sleep(3)
    xml = dump()
    shot("00_open")
    if hub_or_composer(xml):
        return True
    for n in nodes(xml):
        if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
            tap(n["cx"], n["cy"], 1.5)
            break
    xml = dump()
    for n in nodes(xml):
        f = f"{n['text']} {n['desc']}"
        if re.search(r"yorros?\s*reiseb|reiseb[uü]ro", f, re.I) and len(f.strip()) < 80:
            tap(n["cx"], n["cy"], 2.2)
            break
    xml = dump()
    shot("00_hub")
    for n in nodes(xml):
        if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 2.2)
            break
    xml = dump()
    shot("00_composer")
    if hub_or_composer(xml):
        return True
    # Zweiter Versuch: nur Deeplink
    deeplink()
    time.sleep(3)
    xml = dump()
    shot("00_retry")
    return hub_or_composer(xml)


def new_trip() -> None:
    xml = dump()
    for n in nodes(xml):
        if re.search(r"schlie[sß]en|^x$", f"{n['text']} {n['desc']}".strip(), re.I):
            tap(n["cx"], n["cy"], 1.2)
            break
    time.sleep(1.0)
    deeplink()
    time.sleep(2.5)
    xml = dump()
    for n in nodes(xml):
        if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 2.0)
            return
    shot("new_trip_hub")


def send(text: str, wait: float = 6.0) -> str:
    safe = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace("—", "-")
        .replace("–", "-")
        .replace("€", "Euro")
    )
    log("deeplink q: " + safe[:140])
    deeplink(safe)
    time.sleep(max(4.0, wait))
    return dump()


def extract_question(xml: str) -> str:
    """Board-Frage / offene ❓ — oft großes Accent-Label oben."""
    b = blob(xml)
    # Prefer lines with ?
    qs = [ln.strip() for ln in b.splitlines() if "?" in ln and len(ln.strip()) >= 6]
    if qs:
        # shortest meaningful question-ish (board is short)
        qs.sort(key=lambda s: (0 if re.search(r"flug|gepaeck|gepäck|transfer|miet|anreise|direkt", s, re.I) else 1, len(s)))
        return qs[0][:200]
    for n in nodes(xml):
        t = (n["text"] or "").strip()
        if t.endswith("?") and 4 <= len(t) <= 120:
            return t
    return ""


def dismiss_search_alert(xml: str | None = None) -> bool:
    """Alert „Trotzdem suchen?“ → WEITER ERZÄHLEN (Briefing bleiben)."""
    xml = xml or dump()
    b = blob(xml).lower()
    if not re.search(r"trotzdem suchen|noch nicht alle infos|fehlt noch", b):
        return False
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}".strip()
        if re.search(r"weiter\s*erz[aä]hlen", t, re.I) and len(t) < 40:
            tap(n["cx"], n["cy"], 1.2)
            log(f"dismiss alert: {t}")
            time.sleep(1.0)
            return True
    # geometric: left button on alert
    tap(270, 1180, 1.0)
    log("dismiss alert geometric")
    time.sleep(1.0)
    return True


def score_gap_inventory(xml: str) -> dict:
    b = blob(xml)
    low = b.lower()
    q = extract_question(xml)
    qlow = q.lower()

    gap_hits = [p for p in GAP_SIGNALS if re.search(p, low, re.I)]
    have_hits = [p for p in HAVE_SIGNALS if re.search(p, low, re.I)]
    # Sticker-Phrasen aus Live-Board
    sticker_have = bool(
        re.search(
            r"unterkunft:\s*hotel|hotel\s+in\s+\w+|gruppe:\s*4|reisezeit:\s*oktober|budget:\s*400",
            low,
            re.I,
        )
    )
    sticker_gap = bool(
        re.search(
            r"flug:\s*noch|transfer:\s*noch|mietwagen:\s*gew[uü]nscht|noch\s+zu\s+buchen",
            low,
            re.I,
        )
    )
    reask_hits = [p for p in MUST_NOT_REASK if re.search(p, qlow, re.I)]

    q_is_gap = bool(
        re.search(
            r"flug|gepaeck|gepäck|transfer|mietwagen|anreise|direkt|handgepaeck|bags|umsteigen|von\s+wo|start",
            qlow,
            re.I,
        )
    )
    # Origin fehlt im Dump → „Von wo?“ ist korrekte Lücke, kein Reask
    if re.search(r"von\s+wo|startet", qlow):
        q_is_gap = True

    board_gap = len(gap_hits) >= 2 or sticker_gap
    board_have = len(have_hits) >= 1 or sticker_have

    pass_ok = board_gap and board_have and not reask_hits and (q_is_gap or "fehlt" in low or "noch zu buchen" in low)

    return {
        "question": q,
        "gap_hits": gap_hits,
        "have_hits": have_hits,
        "sticker_have": sticker_have,
        "sticker_gap": sticker_gap,
        "reask_hits": reask_hits,
        "q_is_gap": q_is_gap,
        "board_gap": board_gap,
        "board_have": board_have,
        "pass": pass_ok,
        "blob_preview": b[:1200],
    }


def main() -> int:
    ser = serial()
    log(f"QA serial={ser}")
    r = adb("get-state")
    if "device" not in (r.stdout or ""):
        log(f"FAIL: Gerät nicht ready: {(r.stdout or '') + (r.stderr or '')}")
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    if not open_rb():
        log("FAIL: Reisebüro nicht geöffnet")
        shot("fail_open")
        return 2

    new_trip()
    time.sleep(1.5)
    xml = send(DUMP, wait=7.0)
    shot("01_after_dump")
    # Speech/Parse kann nachziehen; Alert „Trotzdem suchen“ weg tippen
    time.sleep(2.0)
    dismiss_search_alert()
    time.sleep(2.0)
    xml = dump()
    dismiss_search_alert(xml)
    time.sleep(1.5)
    xml = dump()
    shot("02_settle")

    result = score_gap_inventory(xml)
    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "serial": ser,
        "dump": DUMP,
        **result,
    }
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "blob.txt").write_text(result["blob_preview"], encoding="utf-8")

    log("--- score ---")
    log(f"Q: {result['question']!r}")
    log(f"gap_hits={result['gap_hits']}")
    log(f"have_hits={result['have_hits']}")
    log(f"reask_hits={result['reask_hits']}")
    log(f"pass={result['pass']}")

    if result["pass"]:
        log("PASS Gap-Inventory-Live")
        return 0

    log("FAIL Gap-Inventory-Live — Dump nicht als nur-Lücken verdichtet")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
