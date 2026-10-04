#!/usr/bin/env python3
"""
Live proof on Nothing: warmes langes Wochenende (Pool, <400€, 3 Pers, soft AI).
Explizit Travel-Serial — User-Auftrag.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

EXPECTED_SERIAL = "00143157P001105"
os.environ["FINDUS_QA_SERIAL"] = EXPECTED_SERIAL

from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "warm_weekend"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"
XML = OUT / "ui.xml"
ASK_PORT = 8791

BRIEF_CHUNKS = [
    (
        "Langes Wochenende zu dritt: Abflug Donnerstag 15. Oktober ab 14 Uhr "
        "oder entspannt Freitag 16. Oktober — dir egal wann. Zurueck spaetestens Dienstag."
    ),
    (
        "Wir starten aus Prisdorf oder Tornesch. Fliegen von Hamburg, Berlin, Bremen "
        "oder Hannover — guenstigste. WICHTIG: Anreise zum Flughafen mitdenken und "
        "im Preis. Donnerstag vor 14 Uhr kein Abflug. Wenn Flug z.B. 15 Uhr Berlin, "
        "pruefen ob wir rechtzeitig von Prisdorf/Tornesch da sind. Freitag 6 Uhr Flug "
        "braucht Bahn/Bus zum Flughafen mit im Gesamtpreis."
    ),
    (
        "Warm, Pool, Budget unter 400 Euro pro Person, 3 Personen. "
        "All Inclusive waere Wunsch, aber kein Muss — Selbstversorgung ok."
    ),
]

SEARCH_LABELS = (
    r"passt\s*[—\-–]?\s*suche starten",
    r"gr[uü]n\s*·?\s*suche starten",
    r"suche starten",
)

RESULT_HINTS = (
    r"magazin|story|option|unterkunft|hotel|apartment|all.?inclusive|"
    r"flug|pauschal|check24|€|eur|buy.?in|treffer|destination|pool|warm"
)


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


def ask_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{ASK_PORT}/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def post_ask(text: str) -> str:
    data = text.encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{ASK_PORT}/ask",
        data=data,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        return (r.read() or b"").decode("utf-8", errors="replace")


def ensure_reverse() -> None:
    adb("reverse", "tcp:8791", "tcp:8791")


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


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        text = re.search(r'\btext="([^"]*)"', n)
        desc = re.search(r'\bcontent-desc="([^"]*)"', n)
        bounds = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cls = re.search(r'\bclass="([^"]*)"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "click": 'clickable="true"' in n,
            "raw": n,
        }


def tap(x: int, y: int, wait: float = 0.5) -> None:
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "100")
    time.sleep(wait)


def shot(tag: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{tag}.png"
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(path))
    return path


def extract(tag: str, xml: str) -> str:
    path = OUT / f"{tag}.xml"
    path.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(path)], check=False)
    txt = OUT / f"{tag}-text.txt"
    return txt.read_text(encoding="utf-8", errors="ignore") if txt.exists() else ""


def ui_blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        t = (n["text"] or "").strip()
        d = (n["desc"] or "").strip()
        if t:
            parts.append(t)
        if d and d != t:
            parts.append(d)
    return "\n".join(parts)


def ascii_q(text: str) -> str:
    return (
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
        .replace(";", ",")
        .replace("(", "")
        .replace(")", "")
        .replace("'", "")
        .replace('"', "")
        .replace("&", "und")
        .replace("|", " ")
        .replace("<", " ")
        .replace(">", " ")
    )


def find_click(xml: str, *pats: str, require_click: bool = True):
    scored = []
    for n in nodes(xml):
        if require_click and not n["click"]:
            continue
        fields = [n["text"].strip(), n["desc"].strip()]
        fields = [f for f in fields if f]
        if not fields:
            continue
        matched = False
        match_len = 10_000
        for field in fields:
            for pat in pats:
                if re.search(pat, field, re.I):
                    matched = True
                    match_len = min(match_len, len(field))
                    break
            if matched and match_len < 40:
                break
        if matched:
            scored.append((match_len, -n["cy"], n))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]))
    return scored[0][2]


def dismiss_chrome(max_rounds: int = 4) -> None:
    for _ in range(max_rounds):
        xml = dump()
        blob = ui_blob(xml).lower()
        if re.search(r"yorros?\s*reiseb[uü]ro|antwort tippen|neue reise", blob):
            return
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            b = (n["desc"] + " " + n["text"]).lower()
            if "karte schließen" in b or "karte schliessen" in b:
                continue
            if "tippfeld" in b and ("schließ" in b or "schliess" in b or "abbrechen" in b):
                hit = n
                break
            if b.strip() in ("abbrechen",):
                hit = n
                break
        if not hit:
            return
        tap(hit["cx"], hit["cy"], 0.6)


def wait_app_ready(timeout_s: float = 90.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        b = ui_blob(xml).lower()
        if re.search(r"mikrofon|timeline|einstellungen|orte\b", b):
            if "splash" not in b and "wird geladen" not in b:
                return True
        time.sleep(1.5)
    return False


def launch_app() -> None:
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(3.0)


def open_reisebuero_via_settings() -> bool:
    xml = dump()

    def try_enter_new_trip(xml_in: str) -> bool:
        neu = find_click(xml_in, r"neue reise planen", r"^neue reise$")
        if neu:
            tap(neu["cx"], neu["cy"], 1.5)
            time.sleep(2.0)
            xml2 = dump()
            if any("EditText" in n["cls"] for n in nodes(xml2)):
                return True
            # placeholder tap
            ph = find_click(xml2, r"antwort tippen", require_click=False)
            if ph:
                tap(ph["cx"], ph["cy"], 0.5)
                xml2 = dump()
            return any("EditText" in n["cls"] for n in nodes(xml2))
        return False

    # Already in active briefing with EditText?
    if any("EditText" in n["cls"] for n in nodes(xml)):
        log("reisebuero already active (EditText)")
        return True

    # Hub visible → force Neue Reise (nie alte Auswertung weiternutzen)
    if find_click(xml, r"neue reise", require_click=False) or re.search(
        r"yorros?\s*reiseb|deine reisen", ui_blob(xml), re.I
    ):
        if try_enter_new_trip(xml):
            shot("reisebuero-active")
            log("reisebuero open ok=True (hub→neue)")
            return True

    settings = find_click(xml, r"^einstellungen$", r"^einst\.$")
    if not settings:
        time.sleep(1.0)
        xml = dump()
        settings = find_click(xml, r"^einstellungen$", r"^einst\.$")
    if not settings:
        log("FAIL: Einstellungen dock not found")
        shot("no-settings")
        return False
    tap(settings["cx"], settings["cy"], 1.2)
    time.sleep(1.5)
    xml = dump()
    if not re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise|pers[oö]nliche", ui_blob(xml), re.I):
        y = max(40, settings["cy"] - 30)
        tap(settings["cx"], y, 1.5)
        time.sleep(1.5)
        xml = dump()
    shot("settings-open")

    rb = find_click(
        xml,
        r"yorros?\s*reiseb[uü]ro\s*[oö]ffnen",
        r"yorros?\s*reiseb[uü]ro",
    )
    if not rb:
        adb("shell", "input", "swipe", "540", "1600", "540", "700", "400")
        time.sleep(0.8)
        xml = dump()
        rb = find_click(
            xml,
            r"yorros?\s*reiseb[uü]ro\s*[oö]ffnen",
            r"yorros?\s*reiseb[uü]ro",
        )
    if not rb:
        log("FAIL: Yorros Reisebüro row not found in settings")
        shot("no-reisebuero-row")
        (OUT / "settings-ui.xml").write_text(xml, encoding="utf-8")
        return False
    tap(rb["cx"], rb["cy"], 1.5)
    time.sleep(2.0)
    xml = dump()
    shot("reisebuero-hub")

    ok = try_enter_new_trip(xml)
    if not ok:
        # second attempt: plus / neue reise a11y
        xml = dump()
        ok = try_enter_new_trip(xml)
    shot("reisebuero-active")
    log(f"reisebuero open ok={ok}")
    return ok


def open_reisebuero_via_ask() -> bool:
    ensure_reverse()
    if ask_health():
        try:
            post_ask("Oeffne Yorros Reisebuero")
            log("queued ask: Oeffne Yorros Reisebuero")
        except Exception as e:
            log(f"ask fail: {e}")
            return False
    else:
        q = urllib.request.quote("Oeffne Yorros Reisebuero")
        adb(
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            f"findus://ask?q={q}",
        )
    deadline = time.time() + 45
    while time.time() < deadline:
        xml = dump()
        b = ui_blob(xml).lower()
        if re.search(r"yorros?\s*reiseb|neue reise|antwort tippen", b):
            neu = find_click(xml, r"neue reise planen", r"^neue reise$")
            if neu:
                tap(neu["cx"], neu["cy"], 1.5)
                time.sleep(1.5)
            if any("EditText" in n["cls"] for n in nodes(xml)):
                return True
            xml = dump()
            if any("EditText" in n["cls"] for n in nodes(xml)):
                return True
        time.sleep(2.0)
    return False


def type_into_reisebuero(text: str) -> bool:
    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        ph = find_click(xml, r"antwort tippen", require_click=False)
        if ph:
            tap(ph["cx"], ph["cy"], 0.4)
            xml = dump()
            edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        log("NO_EDITTEXT")
        shot("no-edittext")
        return False
    tap(edit["cx"], edit["cy"], 0.4)
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    r = adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    if r.returncode != 0:
        log(f"clipboard set warn: {(r.stderr or r.stdout or '')[:120]}")
    time.sleep(0.25)
    adb("shell", "input", "keyevent", "279")
    time.sleep(0.7)
    xml = dump()
    send = find_click(xml, r"^senden$")
    if send:
        tap(send["cx"], send["cy"], 0.9)
    else:
        adb("shell", "input", "keyevent", "66")
        time.sleep(0.8)
    log(f"sent chunk: {safe[:80]}")
    return True


def wait_thinking_idle(timeout_s: float = 90.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        b = ui_blob(xml).lower()
        if re.search(r"recherche|w[uü]hle|verify|magazin|suche starten", b):
            return
        if any("EditText" in n["cls"] for n in nodes(xml)):
            time.sleep(2.5)
            return
        time.sleep(1.5)


def tap_suche_starten(max_wait_s: float = 120.0) -> bool:
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        xml = dump()
        for pat in SEARCH_LABELS:
            hit = find_click(xml, pat)
            if hit:
                candidates = [
                    n
                    for n in nodes(xml)
                    if n["click"]
                    and re.search(pat, f"{n['text']} {n['desc']}", re.I)
                ]
                if candidates:
                    hit = max(candidates, key=lambda n: n["cy"])
                log(f"tap search: {hit['text'] or hit['desc']}")
                tap(hit["cx"], hit["cy"], 1.0)
                shot("search-tapped")
                return True
        time.sleep(2.0)
    shot("no-search-btn")
    return False


def wait_results(timeout_s: float = 540.0) -> tuple[str, str]:
    deadline = time.time() + timeout_s
    best_xml = ""
    best_score = -1
    mid_marks = {30, 60, 120, 180, 240, 300, 360, 420, 480}
    started = time.time()
    while time.time() < deadline:
        xml = dump()
        txt = ui_blob(xml)
        low = txt.lower()
        score = 0
        if re.search(RESULT_HINTS, low):
            score += 3
        if re.search(r"€|\beur\b|\d+\s*€", low):
            score += 4
        if re.search(r"unterkunft|hotel|apartment|all.?inclusive|pool|resort", low):
            score += 3
        if re.search(r"flug|ham|txl|ber|haj|bre|abflug", low):
            score += 2
        if re.search(r"check24|pauschal|buchen|package|booking", low):
            score += 2
        if re.search(r"recherche l[aä]uft|w[uü]hle durch", low):
            score -= 1
        if score > best_score:
            best_score = score
            best_xml = xml
            elapsed = int(time.time() - started)
            shot(f"best-t{elapsed}")
            extract(f"best-t{elapsed}", xml)
            log(f"result_score={score} t={elapsed}s")
        elapsed = int(time.time() - started)
        if elapsed in mid_marks:
            mid_marks.discard(elapsed)
            shot(f"mid-t{elapsed}")
            extract(f"mid-t{elapsed}", xml)
        if score >= 9 and not re.search(r"recherche l[aä]uft|w[uü]hle durch", low):
            break
        time.sleep(4.0)
    if not best_xml:
        best_xml = dump()
    final_txt = extract("final", best_xml)
    shot("final")
    return best_xml, final_txt


def score_results(txt: str, xml: str) -> dict:
    low = (txt or "").lower()
    blob = ui_blob(xml).lower() if xml else low
    combined = low + "\n" + blob

    checks = {
        "price_visible": bool(re.search(r"€|\beur\b|\d{2,4}\s*(euro|€)", combined, re.I)),
        "under_400_context": bool(
            re.search(r"400|unter\s*4|budget|p\.?\s*p|pro person", combined, re.I)
        ),
        "pool_or_warm": bool(re.search(r"pool|warm|sonne|meer|strand|s[uü]d", combined, re.I)),
        "persons_3": bool(re.search(r"3\s*(personen|pers|leute)|zu\s*dritt|drei", combined, re.I)),
        "ai_soft": bool(re.search(r"all.?inclusive|halbpension|selbstversorg|appartement|apartment", combined, re.I)),
        "flight_or_airport": bool(
            re.search(
                r"flug|flughafen|ham|haj|bre|ber|sch[oö]nefeld|txl|fuhlsb[uü]ttel|hannover|bremen|berlin|hamburg",
                combined,
                re.I,
            )
        ),
        "origin_transfer_hint": bool(
            re.search(
                r"prisdorf|tornesch|anreise|bahn|s-bahn|transfer|zum flughafen|ab\s*(prisdorf|tornesch|hamburg)",
                combined,
                re.I,
            )
        ),
        "dates_weekend": bool(
            re.search(
                r"donnerstag|freitag|dienstag|15\.?\s*10|16\.?\s*10|oktober|langes wochenende|wochenende",
                combined,
                re.I,
            )
        ),
        "booking_link": bool(
            re.search(
                r"check24|booking|buchen|hotel\.|expedia|kayak|google flights|skyscanner|open.?url|pauschal",
                combined,
                re.I,
            )
        ),
        "multi_options": bool(
            re.search(r"option\s*[2-9]|alternative|auch|oder|zwei|drei option", combined, re.I)
        )
        or len(re.findall(r"€", combined)) >= 2,
        "presentation_ready": bool(
            re.search(r"magazin|story|option|unterkunft|destination|treffer|kurztrip|wochenende", combined, re.I)
        )
        and not bool(re.search(r"recherche l[aä]uft|w[uü]hle durch", combined, re.I)),
    }

    hard = [
        "price_visible",
        "pool_or_warm",
        "flight_or_airport",
        "presentation_ready",
    ]
    soft = [
        "under_400_context",
        "persons_3",
        "ai_soft",
        "origin_transfer_hint",
        "dates_weekend",
        "booking_link",
        "multi_options",
    ]
    hard_ok = sum(1 for k in hard if checks[k])
    soft_ok = sum(1 for k in soft if checks[k])
    verdict = "PASS" if hard_ok >= 3 and soft_ok >= 3 else ("SOFT" if hard_ok >= 2 else "FAIL")

    notes = []
    if not checks["origin_transfer_hint"]:
        notes.append("Anreise Prisdorf/Tornesch → Flughafen in UI wenig sichtbar")
    if not checks["booking_link"]:
        notes.append("Keine klaren Buchungs-/Portal-Links erkannt")
    if not checks["under_400_context"]:
        notes.append("Budget <400€ nicht klar in der Präsentation")
    if not checks["ai_soft"]:
        notes.append("All-Inclusive / Alternative Verpflegung nicht klar")

    return {
        "verdict": verdict,
        "score": f"{hard_ok}/4 hard · {soft_ok}/7 soft",
        "checks": checks,
        "soft_notes": notes,
        "snippet": (txt or blob)[:1800],
    }


def write_report(report: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    c = report.get("checks") or {}
    md = [
        "# Warm Weekend Reisebüro — Live Proof (Nothing)",
        "",
        f"- **When:** {report.get('ts')}",
        f"- **Serial:** {report.get('serial')}",
        f"- **Verdict:** {report.get('verdict')} ({report.get('score')})",
        f"- **Path:** {report.get('open_path')}",
        "",
        "## Checks",
        "",
    ]
    for k, v in c.items():
        md.append(f"- {k}: {'PASS' if v else 'MISS'}")
    md += ["", "## Notes", ""]
    for n in report.get("soft_notes") or []:
        md.append(f"- {n}")
    md += ["", "## Snippet", "", "```", report.get("snippet") or "", "```", ""]
    (OUT / "report.md").write_text("\n".join(md), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ser = serial()
    log(f"serial={ser}")
    if ser != EXPECTED_SERIAL:
        log(f"WARN unexpected serial {ser}")
    ensure_reverse()
    ask_ok = ask_health()
    log(f"ask_server={ask_ok}")

    launch_app()
    if not wait_app_ready(100):
        log("WARN app_ready timeout — continuing")
    dismiss_chrome()

    open_path = "settings"
    if not open_reisebuero_via_settings():
        open_path = "ask_fallback"
        if not open_reisebuero_via_ask():
            report = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "serial": ser,
                "verdict": "FAIL",
                "score": "0/4",
                "open_path": open_path,
                "ask_server": ask_ok,
                "error": "could not open Reisebüro",
                "checks": {},
                "snippet": ui_blob(dump())[:500],
            }
            write_report(report)
            return 2

    shot("before-chunks")
    for i, chunk in enumerate(BRIEF_CHUNKS, 1):
        log(f"=== chunk {i}/{len(BRIEF_CHUNKS)} ===")
        if not type_into_reisebuero(chunk):
            time.sleep(2)
            if not type_into_reisebuero(chunk):
                log(f"chunk {i} failed")
        wait_thinking_idle(75)
        shot(f"after-chunk-{i}")
        extract(f"after-chunk-{i}", dump())
        time.sleep(2.0)

    time.sleep(3.0)
    if not tap_suche_starten(150):
        type_into_reisebuero("Passt, Suche starten")
        time.sleep(4)
        tap_suche_starten(60)

    xml, txt = wait_results(540)
    scored = score_results(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": ser,
        "package": PKG,
        "open_path": open_path,
        "ask_server": ask_ok,
        "chunks": BRIEF_CHUNKS,
        **scored,
        "artifacts": {
            "dir": str(OUT),
            "final_png": str(OUT / "final.png"),
            "final_text": str(OUT / "final-text.txt"),
        },
    }
    write_report(report)
    log(f"VERDICT {report['verdict']} {report['score']}")
    log(f"report → {OUT / 'report.md'}")
    return 0 if report["verdict"] in ("PASS", "SOFT") else 1


if __name__ == "__main__":
    raise SystemExit(main())
