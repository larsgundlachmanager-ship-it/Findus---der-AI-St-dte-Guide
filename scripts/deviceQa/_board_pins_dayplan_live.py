#!/usr/bin/env python3
"""Live-QA: Board-Pins · ❓-Kurzfrage · eSIM/Museum/Konzert im Tagesplan.

Nur QA-Serial (Galaxy S7) — nie Nothing/Travel.

Run:
  python scripts/deviceQa/_board_pins_dayplan_live.py

Voraussetzungen: USB QA, App (__DEV__ oder Metro), optional askServer :8791.
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

from _device_ids import QA_SERIAL, TRAVEL_SERIAL, require_qa_serial  # noqa: E402

# Force QA device — never silently fall back to Travel
os.environ["FINDUS_QA_SERIAL"] = (
    os.environ.get("FINDUS_QA_SERIAL") or QA_SERIAL or "ce12171cccf9c0810c"
).strip()
if os.environ["FINDUS_QA_SERIAL"] == TRAVEL_SERIAL:
    raise SystemExit(f"FAIL: Travel/Nothing ({TRAVEL_SERIAL}) ist kein QA-Gerät")

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "board_pins_dayplan"
XML = OUT / "ui.xml"
ASK_PORT = 8791

# Brief: genug Slots + Extras für eSIM/Museum/Konzert
BRIEF_CHUNKS = [
    "Wochenendreise zu zweit, ab Hamburg, fliegen",
    "Freitag 10. Oktober bis Sonntag 12. Oktober, Budget 500 Euro pro Person",
    "Hotel mit All Inclusive waere geil, sonst eigenes Apartment — Pool waere cool",
    (
        "Wir brauchen eine eSIM am Ziel, wollen ein Museum und ein Konzert oder Festival "
        "mitdenken — bitte im Tagesplan und Checkliste"
    ),
]

# Nach erster Frage: Lage beantworten → Pin ersetzen
LAGE_ANSWER = "eher ruhig und abgeschieden"


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


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    remote = "/data/local/tmp/findus_ui.xml"
    r = adb("shell", "uiautomator", "dump", remote)
    if r.returncode != 0 or "ERROR" in ((r.stdout or "") + (r.stderr or "")).upper():
        adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
        remote = "/sdcard/Download/ui.xml"
    adb("pull", remote, str(XML))
    try:
        return XML.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def shot(tag: str) -> None:
    dest = OUT / f"{tag}.png"
    try:
        data = subprocess.check_output([ADB, "-s", serial(), "exec-out", "screencap", "-p"])
        dest.write_bytes(data)
        log(f"shot {dest.name}")
    except Exception as e:
        log(f"shot fail {e}")


def nodes(xml: str):
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


def blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = (s or "").replace("&#10;", " ").strip()
            if s:
                parts.append(s)
    return "\n".join(parts)


def tap(x: int, y: int, wait: float = 0.5) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def deeplink(q: str | None = None) -> None:
    url = "findus://reisebuero" if not q else "findus://reisebuero?q=" + urllib.parse.quote(q)
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.5)


def ensure_reverse() -> None:
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")


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
    with urllib.request.urlopen(req, timeout=8) as r:
        r.read()


def hub_or_composer(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(
        re.search(
            r"deine reisen|neue reise|akt\s*1|antwort tippen|erz[aä]hl|brief\s*\d|lage\?|budget\?",
            b,
        )
    )


def open_rb() -> bool:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(3)
    deeplink()
    time.sleep(3)
    xml = dump()
    shot("open")
    if hub_or_composer(xml):
        return True
    # Settings path
    for n in nodes(xml):
        if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
            tap(n["cx"], n["cy"], 1.5)
            break
    xml = dump()
    for n in nodes(xml):
        f = f"{n['text']} {n['desc']}"
        if re.search(r"yorros?\s*reiseb", f, re.I) and len(f.strip()) < 60:
            tap(n["cx"], n["cy"], 2.2)
            break
    xml = dump()
    shot("hub")
    if hub_or_composer(xml):
        return True
    for n in nodes(xml):
        if re.search(r"neue reise", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 2.2)
            break
    xml = dump()
    shot("composer")
    return hub_or_composer(xml)


def send(text: str) -> str:
    if ask_health():
        try:
            post_ask(text)
            log("ask " + text[:100])
            time.sleep(4)
            return dump()
        except Exception as e:
            log(f"ask fail {e} → deeplink")
    deeplink(text)
    time.sleep(3.5)
    return dump()


def score_board(xml: str) -> dict:
    b = blob(xml)
    low = b.lower()
    # Open ask: short ❓ theme, not long speech sentence
    open_short = bool(
        re.search(r"(lage|budget|gruppe|zeit|unterkunft|anreise|essen|gepäck|highlight)\?", low)
        or "❓" in b
        or "?" in b
        and re.search(r"lage\?|budget\?|gruppe\?", low)
    )
    long_q_leak = bool(
        re.search(
            r"ist euch eher zentral oder|richtig ruhig und abgeschieden am liebsten",
            low,
        )
    )
    pins_present = bool(
        re.search(
            r"hamburg|2\s*(leute|pers)|500|oktober|10\.|12\.|hotel|apartment|pool|all.?inclusive",
            low,
        )
    )
    return {
        "open_q_short": open_short and not long_q_leak,
        "no_full_question_leak": not long_q_leak,
        "board_pins_visible": pins_present,
        "snippet": b[:1800],
    }


def score_extras(xml: str) -> dict:
    b = blob(xml)
    low = b.lower()
    return {
        "esim": bool(re.search(r"e-?sim|airalo", low)),
        "museum": bool(re.search(r"museum", low)),
        "concert": bool(re.search(r"konzert|festival|hellfest|live.?musik|gig", low)),
        "dayplan_or_checklist": bool(
            re.search(r"tagesplan|checkliste|tag\s*1|anreise|magazin|programm|block", low)
        ),
        "snippet": b[:2200],
    }


def tap_search(timeout: float = 120.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        xml = dump()
        hits = [
            n
            for n in nodes(xml)
            if n["click"]
            and re.search(r"suche starten", f"{n['text']} {n['desc']}", re.I)
            and len(f"{n['text']} {n['desc']}") < 90
        ]
        if hits:
            h = max(hits, key=lambda n: n["cy"])
            log("search " + (h["text"] or h["desc"]))
            tap(h["cx"], h["cy"], 1.5)
            shot("search")
            return True
        time.sleep(2.5)
    return False


def wait_results(timeout: float = 420.0) -> str:
    t0 = time.time()
    best, best_sc = "", -1
    while time.time() - t0 < timeout:
        xml = dump()
        low = blob(xml).lower()
        sc = 0
        if re.search(r"magazin|option|unterkunft|checkliste|tagesplan", low):
            sc += 3
        if re.search(r"e-?sim|museum|konzert|festival|airalo|tiqets", low):
            sc += 4
        if re.search(r"€|eur", low):
            sc += 2
        if sc > best_sc:
            best_sc, best = sc, xml
            shot(f"best-t{int(time.time() - t0)}")
            log(f"score={sc}")
        if sc >= 7 and not re.search(r"recherche l[aä]uft|w[uü]hle", low):
            break
        time.sleep(4)
    return best or dump()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ser = serial()
    if ser == TRAVEL_SERIAL:
        log("FAIL: Travel serial")
        return 2
    st = adb("get-state")
    if st.returncode != 0 or "device" not in (st.stdout or "").lower():
        log(f"FAIL: QA {ser} nicht verbunden — Galaxy S7 per USB anschließen.")
        (OUT / "report.json").write_text(
            json.dumps({"verdict": "BLOCKED", "error": "no_qa_device", "serial": ser}, indent=2),
            encoding="utf-8",
        )
        return 2

    log(f"QA serial={ser}")
    ensure_reverse()
    if not ask_health():
        log("WARN: askServer :8791 down — deeplink fallback")

    if not open_rb():
        log("FAIL open reisebuero")
        return 2

    checks: dict = {"phases": {}}

    # --- Phase Board + ❓ ---
    for i, ch in enumerate(BRIEF_CHUNKS[:2], 1):
        log(f"=== brief {i} ===")
        xml = send(ch)
        shot(f"brief{i}")
        (OUT / f"brief{i}.txt").write_text(blob(xml), encoding="utf-8")
        time.sleep(2)

    board1 = score_board(dump())
    shot("board1")
    checks["phases"]["board_after_brief"] = board1
    log(f"board1 open_q_short={board1['open_q_short']} pins={board1['board_pins_visible']}")

    # Answer open Lage-style question → pin should shorten
    log("=== lage answer ===")
    xml = send(LAGE_ANSWER)
    shot("lage")
    (OUT / "lage.txt").write_text(blob(xml), encoding="utf-8")
    board2 = score_board(xml)
    low2 = blob(xml).lower()
    board2["lage_pin"] = bool(re.search(r"lage|ruhig|abgeschieden", low2))
    checks["phases"]["board_after_answer"] = board2

    # Rest of brief + extras
    for i, ch in enumerate(BRIEF_CHUNKS[2:], 3):
        log(f"=== brief {i} ===")
        xml = send(ch)
        shot(f"brief{i}")
        (OUT / f"brief{i}.txt").write_text(blob(xml), encoding="utf-8")
        time.sleep(3)

    board3 = score_board(dump())
    checks["phases"]["board_before_search"] = board3
    extras_brief = score_extras(dump())
    checks["phases"]["extras_on_board"] = extras_brief

    if not tap_search(150):
        send("Passt, Suche starten")
        time.sleep(4)
        tap_search(90)

    res_xml = wait_results()
    shot("results")
    (OUT / "results.txt").write_text(blob(res_xml), encoding="utf-8")
    extras_res = score_extras(res_xml)
    checks["phases"]["extras_in_results"] = extras_res

    hard = [
        board1.get("open_q_short") or board2.get("open_q_short") or board3.get("open_q_short"),
        board1.get("no_full_question_leak", True)
        and board2.get("no_full_question_leak", True)
        and board3.get("no_full_question_leak", True),
        board1.get("board_pins_visible")
        or board2.get("board_pins_visible")
        or board3.get("board_pins_visible"),
        extras_res.get("esim") or extras_brief.get("esim"),
        extras_res.get("museum") or extras_brief.get("museum"),
        extras_res.get("concert") or extras_brief.get("concert"),
    ]
    soft = [
        board2.get("lage_pin"),
        extras_res.get("dayplan_or_checklist") or extras_brief.get("dayplan_or_checklist"),
    ]
    h_ok = sum(1 for x in hard if x)
    s_ok = sum(1 for x in soft if x)
    verdict = "PASS" if h_ok >= 5 and s_ok >= 1 else ("SOFT" if h_ok >= 4 else "FAIL")

    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": ser,
        "verdict": verdict,
        "hard": f"{h_ok}/{len(hard)}",
        "soft": f"{s_ok}/{len(soft)}",
        "checks": checks,
        "missing": [
            name
            for name, ok in [
                ("open_q_short", hard[0]),
                ("no_full_q_leak", hard[1]),
                ("board_pins", hard[2]),
                ("esim", hard[3]),
                ("museum", hard[4]),
                ("concert", hard[5]),
                ("lage_pin", soft[0]),
                ("dayplan_or_checklist", soft[1]),
            ]
            if not ok
        ],
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = [
        f"# Board-Pins / ❓ / Dayplan Live-QA\n",
        f"- Verdict: **{verdict}** ({report['hard']} hard · {report['soft']} soft)\n",
        "## Missing\n",
    ] + [f"- {m}" for m in report["missing"]]
    (OUT / "report.md").write_text("\n".join(md), encoding="utf-8")
    log(f"VERDICT {verdict} hard={report['hard']} soft={report['soft']} missing={report['missing']}")
    return 0 if verdict != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
