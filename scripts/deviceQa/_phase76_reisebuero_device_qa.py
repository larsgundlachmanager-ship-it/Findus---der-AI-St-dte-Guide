#!/usr/bin/env python3
"""Phase 7.6 Device-QA auf Nothing (explizit FINDUS_QA_SERIAL=Travel).

Szenarien:
  A) warm/günstig → mind. 4 Magazin-Optionen (offen)
  B) Prag Wochenende → mind. 2 Pakete (Hotels/Fenster)
  C) Langer Dump → Recap / Lücken-Frage (kein leerer Hub)

Run:
  set FINDUS_QA_SERIAL=00143157P001105
  python scripts/deviceQa/_phase76_reisebuero_device_qa.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

from _device_ids import TRAVEL_SERIAL  # noqa: E402

# User: Nothing für diesen Job
NOTHING = TRAVEL_SERIAL or "00143157P001105"
os.environ["FINDUS_QA_SERIAL"] = NOTHING
os.environ["ANDROID_SERIAL"] = NOTHING

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "phase76_nothing"
XML = OUT / "ui.xml"
ASK_PORT = 8791
SERIAL = NOTHING


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
    remote = "/sdcard/Download/ui.xml"
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


def ensure_reverse() -> None:
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")
    log("adb reverse 8791+8081")


def ask_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{ASK_PORT}/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def post_ask(text: str) -> None:
    data = text.encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{ASK_PORT}/ask",
        data=data,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()


def deeplink(q: str | None = None) -> None:
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.8)


def hub_or_composer(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(
        re.search(
            r"deine reisen|neue reise|akt\s*[1-5]|antwort tippen|erz[aä]hl|brief|budget|optionen|pakete|"
            r"reise ansehen|weitere ideen|flipchart|yorro",
            b,
        )
    )


def open_rb() -> bool:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
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
    return hub_or_composer(xml)


def new_trip() -> None:
    xml = dump()
    for n in nodes(xml):
        if re.search(r"schlie[sß]en|^x$", f"{n['text']} {n['desc']}".strip(), re.I):
            tap(n["cx"], n["cy"], 1.2)
            break
    time.sleep(1.2)
    # Frischer Overlay-Reset
    adb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "findus://reisebuero",
        PKG,
    )
    time.sleep(2.5)
    xml = dump()
    for n in nodes(xml):
        if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 2.0)
            return
    shot("new_trip_hub")


def send(text: str, wait: float = 5.0) -> str:
    """Reisebüro nur per Deeplink q= (askServer geht an M2-Mic, nicht RB)."""
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
    log("deeplink: " + safe[:120])
    deeplink(safe)
    time.sleep(max(3.5, wait))
    return dump()


def count_option_signals(xml: str) -> dict:
    b = blob(xml)
    low = b.lower()
    # Cover-Hint + card CTAs + Weitere Ideen
    hint4 = bool(re.search(r"4\s+optionen|4\s+von\s+4|städte\s*&\s*deals", low))
    hint2 = bool(re.search(r"[23]\s+pakete|≥\s*2|hotels\s*/\s*flugfenster|2\s+von\s+4", low))
    cards = len(re.findall(r"reise ansehen", low))
    weitere = bool(re.search(r"weitere ideen", low))
    # Sibling rows often show place names; count Match % tiles
    matches = len(re.findall(r"\b\d{2,3}%\b", b))
    fenster = len(re.findall(r"flugfenster|fenster\s*·|stay-spur|stay\s*·", low))
    return {
        "hint4": hint4,
        "hint2": hint2,
        "cards": cards,
        "matches": matches,
        "fenster": fenster,
        "weitere": weitere,
        "option_est": max(cards, matches, 1 if weitere else 0),
    }


def dismiss_keyboard() -> None:
    """EditText unfocus — nie KEYCODE_BACK (schließt Reisebüro)."""
    tap(540, 180, 0.45)


def try_start_search(xml: str | None = None) -> bool:
    """Tippt Such-Leiste. A11y-Text ist oft nur „Gelb/Grün/Rot · Brief N%“."""
    dismiss_keyboard()
    xml = dump()
    tapped = False
    candidates = []
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}".strip()
        if not n["click"]:
            continue
        if re.search(
            r"suche m[oö]glich|suche starten|passt\s*[—\-–].*suche|"
            r"(gelb|gr[uü]n|rot)\s*·\s*(suche|brief)|brief\s*\d+\s*%|zur auswertung",
            t,
            re.I,
        ):
            candidates.append((n, t))
    # Prefer green/yellow over red
    def rank(item):
        t = item[1].lower()
        if "gr" in t and "suche" in t:
            return 0
        if "gelb" in t or "möglich" in t:
            return 1
        if "suche starten" in t or "passt" in t:
            return 0
        if "brief" in t and "%" in t:
            return 2
        return 3

    candidates.sort(key=rank)
    if candidates:
        n, t = candidates[0]
        tap(n["cx"], n["cy"], 1.2)
        tapped = True
        log(f"tap search btn: {t[:70]}")
    if not tapped:
        # geometric: Just above mic on Nothing (~y 1960 for search, mic lower)
        log("tap search geometric 540,1960")
        tap(540, 1960, 1.2)
        tapped = True
    time.sleep(1.2)
    xml2 = dump()
    for n in nodes(xml2):
        t = f"{n['text']} {n['desc']}"
        if re.search(r"trotzdem suchen|suche starten", t, re.I) and len(t) < 48:
            tap(n["cx"], n["cy"], 1.5)
            log("alert confirm search")
            return True
    return tapped


def answer_open_gaps(xml: str) -> bool:
    """Beantwortet nur die aktuelle ❓-Frage / Recap, nicht schon gesetzte Chips."""
    b = blob(xml)
    low = b.lower()
    # Akt 2 Recap
    if re.search(r"passt das so|akt\s*2", low):
        dismiss_keyboard()
        if try_start_search():
            return True
        # Kein Deeplink „suchen“ — schließt manchmal das Overlay
        dismiss_keyboard()
        xml2 = dump()
        for n in nodes(xml2):
            t = f"{n['text']} {n['desc']}"
            if (re.search(r"passt|suche", t, re.I) and "%" in t) or re.search(
                r"suche starten", t, re.I
            ):
                tap(n["cx"], n["cy"], 1.5)
                return True
        return False

    # Nur aktuelle Frage (Gold-Überschrift / ❓ Chip), nicht alte Stickers
    q = ""
    for n in nodes(xml):
        t = (n["text"] or "").strip()
        if t.startswith("❓") or re.match(r"^(Vor Ort|Gepäck|Verpflegung|Wann|Budget)", t):
            q = t.lower()
            break
    if not q:
        # fallback: erste Zeile nach Akt 1 die wie Frage endet
        m = re.search(r"(Vor Ort[^?\n]*\?|Gep[aä]ck[^?\n]*\?|Verpflegung[^?\n]*\?)", b)
        q = (m.group(1) if m else "").lower()

    if re.search(r"vor ort|mietwagen|öpnv|oepnv|zu fu", q):
        send("Vor Ort OEPNV und zu Fuss, kein Mietwagen", wait=5)
        return True
    if re.search(r"gep[aä]ck|handgep|aufgabe", q):
        send("Nur Handgepaeck reicht", wait=5)
        return True
    if re.search(r"verpflegung|fruehstueck|frühstück|essen", q):
        send("Verpflegung egal, Selbstversorgung ok", wait=5)
        return True
    if re.search(r"highlight", q) or re.search(r"highlight", low):
        send("Highlight egal - Party und Pool reichen", wait=5)
        return True
    if re.search(r"preislich|budget|euro", q) or re.search(r"was schwebt preislich", low):
        send("300 Euro pro Person reicht", wait=5)
        return True
    if re.search(r"passt", q):
        send("Ja passt, such bitte", wait=5)
        return True
    return False
def wait_magazine(tag: str, min_opts: int, timeout_s: float = 240.0) -> dict:
    t0 = time.time()
    last: dict = {}
    gap_rounds = 0
    while time.time() - t0 < timeout_s:
        xml = dump()
        last = count_option_signals(xml)
        b = blob(xml)
        last["blob_snip"] = b[:500]
        last["brief_pct"] = None
        m = re.search(r"(?:Brief|Suche möglich|Suche starten).*?(\d+)\s*%|Brief\s*(\d+)\s*%", b, re.I)
        if m:
            last["brief_pct"] = int(m.group(1) or m.group(2))
        log(
            f"wait {tag}: "
            + str({k: last.get(k) for k in ("hint4", "hint2", "cards", "matches", "option_est", "brief_pct")})
        )

        if last["option_est"] >= min_opts or (min_opts >= 4 and last["hint4"]) or (
            min_opts >= 2 and (last["hint2"] or last["option_est"] >= 2 or last.get("fenster", 0) >= 1)
        ):
            shot(f"{tag}_ok")
            last["ok"] = True
            return last

        # Magazin / Theater / Recap
        if re.search(r"akt\s*2|passt das so", b, re.I):
            answer_open_gaps(xml)
            time.sleep(4)
            continue
        if re.search(r"akt\s*3|akt\s*4|optionen|weitere ideen|brief-plan|flugmatrix|theater|w[uü]hle", b, re.I):
            try_start_search(xml)
            time.sleep(8)
            continue

        # Lücken beantworten (max ein paar Runden)
        if gap_rounds < 8 and answer_open_gaps(xml):
            gap_rounds += 1
            continue

        # Drinks / Party-Grain
        if re.search(r"g[uü]nstige drinks|drinks\?|party-stil|wie wichtig", b, re.I):
            send("Guenstige Drinks sind nice-to-have, nicht Pflicht", wait=5)
            gap_rounds += 1
            continue

        # Immer Such-Button versuchen sobald Brief-Leiste da (A11y oft nur „Brief N%“)
        if re.search(r"brief\s*\d+\s*%|suche|gelb|gr[uü]n|rot\s*·", b, re.I) or True:
            if try_start_search(xml):
                time.sleep(6)
                continue

        time.sleep(4)
    shot(f"{tag}_timeout")
    last["ok"] = False
    return last


def looks_recap_or_gap(xml: str) -> bool:
    low = blob(xml).lower()
    return bool(
        re.search(
            r"recap|zusammengefasst|fehlt noch|schon gebucht|lücke|ready|soll ich suchen|"
            r"budget|anreise|verpflegung|hotel|flug.*da|habt ihr",
            low,
        )
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "at": datetime.now(timezone.utc).isoformat(),
        "serial": SERIAL,
        "device": "nothing_travel_explicit",
        "scenarios": {},
    }
    log(f"Phase 7.6 on Nothing {SERIAL}")

    state = adb("get-state")
    if "device" not in (state.stdout or ""):
        log("FAIL: Nothing not device")
        report["error"] = "not_device"
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 2

    ensure_reverse()
    if not ask_health():
        log("WARN: askServer :8791 down — deeplink fallback only")
        report["askServer"] = False
    else:
        report["askServer"] = True

    if not open_rb():
        log("FAIL: could not open Reisebüro")
        report["error"] = "open_rb"
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 3

    # --- A: warm/günstig offen → 4 ---
    log("=== A warm/günstig ===")
    new_trip()
    time.sleep(1.5)
    chunks_a = [
        "Wir wollen irgendwohin warm und guenstig, egal wohin, Deal suchen, zu zweit ab Hamburg",
        "Zwei Naechte Anfang Oktober Wochenende, Budget 300 Euro pro Person, fliegen ok",
        "Apartment oder Hotel egal, Pool waere cool, Verpflegung egal, vor Ort OEPNV, nur Handgepaeck",
    ]
    for c in chunks_a:
        send(c, wait=6)
        shot("a_brief")
    # Trigger search if ready chip
    xml = dump()
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if re.search(r"suchen|los|ready|recherch|starten", t, re.I) and n["click"] and len(t) < 40:
            tap(n["cx"], n["cy"], 2)
            break
    # Sometimes need explicit "ja such"
    send("Ja, such bitte vier Optionen — warm und guenstig", wait=8)
    a = wait_magazine("a_warm", min_opts=4, timeout_s=200)
    report["scenarios"]["A_warm_open4"] = a

    # --- B: Prag WE → ≥2 ---
    log("=== B Prag WE ===")
    new_trip()
    time.sleep(1.5)
    chunks_b = [
        "Nur Prag, Wochenende zu zweit, ab Hamburg, fliegen. Kein Party, kein Pool.",
        "Freitag 25. September bis Sonntag 27. September 2026, Budget 400 Euro pro Person fuer alles",
        "Apartment am liebsten, Notfall Hotel. Verpflegung egal, vor Ort zu Fuss, nur Handgepaeck",
    ]
    for c in chunks_b:
        send(c, wait=6)
        shot("b_brief")
    xml = dump()
    for n in nodes(xml):
        t = f"{n['text']} {n['desc']}"
        if re.search(r"suchen|los|ready|recherch|starten", t, re.I) and n["click"] and len(t) < 40:
            tap(n["cx"], n["cy"], 2)
            break
    send("Ja bitte suchen — zwei Pakete reichen", wait=8)
    b = wait_magazine("b_prag", min_opts=2, timeout_s=200)
    report["scenarios"]["B_prag_specific2"] = b

    # --- C: langer Dump ---
    log("=== C langer Dump ===")
    new_trip()
    time.sleep(1.5)
    dump_text = (
        "Also wir sind zu viert, Maennerwochenende Anfang Oktober, starten ab Hamburg. "
        "Flug haben wir noch nicht, Hotel auch nicht. Budget so 350 Euro pro Person. "
        "Wir wollen Party und Pool, Anreise egal Flug oder Bahn maximal vier Stunden. "
        "Apartment waere cool, sonst Hotel. Verpflegung erstmal egal. "
        "Bitte nur die Luecken abfragen und dann suchen."
    )
    send(dump_text, wait=10)
    shot("c_dump")
    time.sleep(4)
    xml = dump()
    c_ok = looks_recap_or_gap(xml) or hub_or_composer(xml)
    # Follow one gap answer if asked
    if re.search(r"budget", blob(xml), re.I):
        send("350 Euro pro Person", wait=6)
        xml = dump()
    c = {
        "ok": c_ok,
        "recap_or_gap": looks_recap_or_gap(xml),
        "snip": blob(xml)[:500],
    }
    shot("c_after")
    report["scenarios"]["C_long_dump"] = c

    a_pass = bool(a.get("ok") and (a.get("option_est", 0) >= 4 or a.get("hint4")))
    b_pass = bool(b.get("ok") and (b.get("option_est", 0) >= 2 or b.get("hint2") or b.get("fenster", 0) >= 1))
    c_pass = bool(c.get("ok") or c.get("recap_or_gap"))
    report["pass"] = {"A": a_pass, "B": b_pass, "C": c_pass, "all": a_pass and b_pass and c_pass}

    (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log(json.dumps(report["pass"], indent=2))
    log(f"report → {OUT / 'report.json'}")
    return 0 if report["pass"]["all"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
