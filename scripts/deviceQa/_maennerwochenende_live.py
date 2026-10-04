#!/usr/bin/env python3
"""
Live proof: Männerwochenende via Yorros Reisebüro.

Path (reliable): Dock Einstellungen → Yorros Reisebüro öffnen → Neue Reise planen
→ Brief-Chunks tippen (EditText) → Suche starten → Magazine/Results dump.

Ask-Server (:8791) is optional for opening only; once Reisebüro is open, typed asks
are isolated (submitUserQuestion returns early) — chunks go via UI TextInput.
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

# This job explicitly reuses Travel serial when FINDUS_QA_SERIAL is set.
EXPECTED_SERIAL = "00143157P001105"
os.environ.setdefault("FINDUS_QA_SERIAL", EXPECTED_SERIAL)

from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"
XML = OUT / "ui.xml"
ASK_PORT = 8791
APK = ROOT / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"

BRIEF_CHUNKS = [
    "Maennerwochenende, 3 Personen, langes Wochenende",
    (
        "Donnerstag 15.10. ab 16:30 Flieger, Bahn ab 14:15 auch ok, "
        "Freitag entspannt je nach Preis; zurueck Montag oder besser Dienstag"
    ),
    "Fliegen von Hamburg, Berlin, Bremen oder Hannover — guenstigste",
    (
        "Warm, max 400 Euro p.P.; All-Inclusive-Hotel am geilsten, sonst Apartment "
        "— kein normales Hotel mit Halbpension; guenstiges Bier, Party, Pool"
    ),
    (
        "Bitte Transfer Flughafen zur Unterkunft klar mit Preis; "
        "wenn Mietwagen sinnvoll, sag das ehrlich. "
        "Wunsch: Padel spielen und gute Clubs — belegt raussuchen. "
        "Pauschalreise nur wenn sie wirklich besser passt, sonst einzeln buchen."
    ),
]

SEARCH_LABELS = (
    r"passt\s*[—\-–]?\s*suche starten",
    r"gr[uü]n\s*·?\s*suche starten",
    r"suche starten",
)

RESULT_HINTS = (
    r"magazin|story|option|unterkunft|hotel|apartment|all.?inclusive|"
    r"flug|pauschal|check24|€|eur|buy.?in|treffer|destination"
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
    # RN Pressable: zero-length swipe (press-in) ist auf Nothing zuverlässiger als tip
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
    """Match text OR desc; prefer short labels (dock) over long card copy."""
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
            # shorter match label + lower on screen
            scored.append((match_len, -n["cy"], n))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]))
    return scored[0][2]

def dismiss_chrome(max_rounds: int = 4) -> None:
    """Close tippfeld sheets but keep Reisebüro if open."""
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
    """Dock Einstellungen → Yorros Reisebüro öffnen → Neue Reise."""
    xml = dump()
    # Already in active briefing?
    if find_click(xml, r"antwort tippen", require_click=False) or find_click(
        xml, r"suche starten", require_click=False
    ):
        if find_click(xml, r"edittext|antwort tippen", require_click=False) or any(
            "EditText" in n["cls"] for n in nodes(xml)
        ):
            log("reisebuero already active")
            return True

    # Hub?
    if find_click(xml, r"neue reise", require_click=True):
        n = find_click(xml, r"neue reise planen", r"neue reise")
        if n:
            tap(n["cx"], n["cy"], 1.2)
            time.sleep(1.5)
            xml = dump()
            if any("EditText" in n["cls"] for n in nodes(xml)):
                return True

    # Open settings from dock — exact dock label, not weather-card copy
    settings = find_click(xml, r"^einstellungen$", r"^einst\.$")
    if not settings:
        # retry dump after wake
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
    # Nothing: manchmal braucht's 2. Press-In
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
        # scroll settings a bit
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

    # Hub → Neue Reise
    neu = find_click(xml, r"neue reise planen", r"^neue reise$")
    if neu:
        tap(neu["cx"], neu["cy"], 1.5)
        time.sleep(2.0)
        xml = dump()
    # Plus icon a11y
    if not any("EditText" in n["cls"] for n in nodes(xml)):
        plus = find_click(xml, r"^neue reise$")
        if plus:
            tap(plus["cx"], plus["cy"], 1.5)
            time.sleep(2.0)
            xml = dump()

    ok = any("EditText" in n["cls"] for n in nodes(xml)) or bool(
        find_click(xml, r"antwort tippen|suche starten|mikrofon", require_click=False)
    )
    shot("reisebuero-active")
    log(f"reisebuero open ok={ok}")
    return ok


def open_reisebuero_via_ask() -> bool:
    """Fallback: ask server / deep link while overlay closed."""
    ensure_reverse()
    if ask_health():
        try:
            post_ask("Oeffne Yorros Reisebuero")
            log("queued ask: Oeffne Yorros Reisebuero")
        except Exception as e:
            log(f"ask fail: {e}")
            return False
    else:
        # deep link tippfeld path
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
    """Type via clipboard paste — RN controlled TextInput ignores adb `input text`."""
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
    # clear existing
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    # Clipboard → Paste (fires RN onChangeText). Args list keeps spaces intact.
    r = adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    if r.returncode != 0:
        log(f"clipboard set warn: {(r.stderr or r.stdout or '')[:120]}")
    time.sleep(0.25)
    adb("shell", "input", "keyevent", "279")  # PASTE
    time.sleep(0.7)
    xml = dump()
    # verify something landed (optional soft)
    send = find_click(xml, r"^senden$")
    if send:
        tap(send["cx"], send["cy"], 0.9)
    else:
        adb("shell", "input", "keyevent", "66")
        time.sleep(0.8)
    log(f"sent chunk: {safe[:80]}")
    return True


def wait_thinking_idle(timeout_s: float = 90.0) -> None:
    """Wait until composer is free / not frozen mid-reply."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        b = ui_blob(xml).lower()
        # research already started
        if re.search(r"recherche|w[uü]hle|verify|magazin", b):
            return
        if any("EditText" in n["cls"] for n in nodes(xml)):
            # allow a short settle after send
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
                # Prefer bottom search button (larger / lower on screen)
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


def wait_results(timeout_s: float = 480.0) -> tuple[str, str]:
    """Poll until magazine/options look ready. Returns (xml, text)."""
    deadline = time.time() + timeout_s
    best_xml = ""
    best_score = -1
    mid_marks = {30, 60, 120, 180, 240, 300, 360}
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
        if re.search(r"unterkunft|hotel|apartment|all.?inclusive|pool", low):
            score += 3
        if re.search(r"check24|pauschal|buchen|package", low):
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
        # Done-ish: options + price, no research theater
        if score >= 8 and not re.search(r"recherche l[aä]uft|w[uü]hle durch", low):
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

    stay_price = bool(
        re.search(
            r"(unterkunft|hotel|apartment|all.?inclusive|resort).{0,80}(\d+[.,]?\d*\s*€|\€\s*\d+|eur\s*\d+)"
            r"|(\d+[.,]?\d*\s*€|\€\s*\d+).{0,80}(unterkunft|hotel|apartment|nacht|p\.?\s*p)",
            combined,
            re.I | re.S,
        )
    ) or bool(
        re.search(
            r"(stay|unterkunft).{0,40}\d+|pro person.{0,20}\d+|p\.?\s*p\.?.{0,20}\d+",
            combined,
            re.I,
        )
    )
    # Also accept visible € near lodging words anywhere in dump
    if not stay_price:
        stay_price = bool(
            re.search(r"€|eur", combined)
            and re.search(r"hotel|apartment|all.?inclusive|unterkunft|resort|riads?", combined)
        )

    fake_gap = bool(re.search(r"ehrlich als\s*gap", combined, re.I))

    # Truncation: lots of ellipsis mid-word or single-char beat lines
    weird_trunc = False
    lines = [ln.strip() for ln in (txt or "").splitlines() if ln.strip()]
    for ln in lines:
        if re.search(r"\w…\w|\w\.\.\.\w", ln):
            weird_trunc = True
        if len(ln) <= 2 and re.search(r"[€a-zäöü]", ln, re.I):
            weird_trunc = True

    beats_ok = len(lines) >= 3 and not weird_trunc

    booking_btn = bool(
        re.search(r"check24|pauschal|ab.?in.?den.?urlaub|package|buchen|buchung", combined, re.I)
    )
    # clickable labels
    for n in nodes(xml or ""):
        if not n["click"]:
            continue
        lab = f"{n['text']} {n['desc']}".lower()
        if re.search(r"check24|pauschal|buchen|package|urlaub", lab):
            booking_btn = True

    outbound = bool(
        re.search(r"flug|flieger|bahn|anreise|ham\b|ber\b|haj\b|bre\b|ayt|pmi|her", combined, re.I)
    )
    transfer = bool(
        re.search(
            r"transfer|taxi|shuttle|mietwagen|miet.?auto|flughafen.?hotel|zum hotel",
            combined,
            re.I,
        )
    )
    wish_evidence = bool(
        re.search(r"padel|club|party|pool|nightlife|disco|beach.?club", combined, re.I)
    )
    multi_options = bool(
        re.search(r"option\s*[2-4]|alternative|variante|plan\s*[2-4]|karte\s*[2-4]", combined, re.I)
    ) or (
        len(re.findall(r"\d+\s*%|\d+\s*€", combined)) >= 4
    )

    checks = {
        "stay_price_visible": stay_price,
        "no_ehrlich_als_gap": not fake_gap,
        "beats_readable": beats_ok,
        "outbound_visible": outbound,
        "transfer_or_rental_visible": transfer,
        "wish_evidence_visible": wish_evidence,
        "booking_button_if_applicable": booking_btn,
        "multi_options_hint": multi_options,
    }
    passed = sum(1 for v in checks.values() if v)
    # hard: stay + no fake gaps + readable + Anreise + Transfer/Mietwagen
    hard_ok = (
        stay_price
        and not fake_gap
        and beats_ok
        and outbound
        and transfer
    )
    soft_notes = []
    if not booking_btn:
        soft_notes.append("no Check24/package booking button visible (ok if single-book better)")
    if not wish_evidence:
        soft_notes.append("padel/club/party evidence not visible in UI dump")
    if not multi_options:
        soft_notes.append("multiple options not clearly visible yet")
    return {
        "verdict": "PASS" if hard_ok else "FAIL",
        "score": f"{passed}/8",
        "checks": checks,
        "soft_notes": soft_notes,
        "line_count": len(lines),
        "snippet": " | ".join(lines[:20])[:800],
    }


def write_report(report: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    c = report.get("checks") or {}
    md = [
        "# Männerwochenende Reisebüro — Live Proof",
        "",
        f"- **When:** {report.get('ts')}",
        f"- **Serial:** {report.get('serial')}",
        f"- **Verdict:** {report.get('verdict')} ({report.get('score')})",
        f"- **Path:** {report.get('open_path')}",
        f"- **Ask server:** {report.get('ask_server')}",
        "",
        "## Checks",
        "",
        f"- stay/Unterkunft price visible: {'PASS' if c.get('stay_price_visible') else 'FAIL'}",
        f"- no „ehrlich als Gap“: {'PASS' if c.get('no_ehrlich_als_gap') else 'FAIL'}",
        f"- beats readable: {'PASS' if c.get('beats_readable') else 'FAIL'}",
        f"- Anreise (Flug/Bahn) visible: {'PASS' if c.get('outbound_visible') else 'FAIL'}",
        f"- Transfer/Mietwagen visible: {'PASS' if c.get('transfer_or_rental_visible') else 'FAIL'}",
        f"- Wunsch-Evidenz (Padel/Club/Pool): {'PASS' if c.get('wish_evidence_visible') else 'MISS'}",
        f"- Check24/package button: {'PASS' if c.get('booking_button_if_applicable') else 'MISS'}",
        f"- Multi-Optionen Hint: {'PASS' if c.get('multi_options_hint') else 'MISS'}",
        "",
        "## Notes",
        "",
    ]
    for n in report.get("soft_notes") or []:
        md.append(f"- {n}")
    md += ["", "## Snippet", "", "```", report.get("snippet") or "", "```", ""]
    (OUT / "report.md").write_text("\n".join(md), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ser = serial()
    log(f"serial={ser}")
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
            # one retry after dump
            time.sleep(2)
            if not type_into_reisebuero(chunk):
                log(f"chunk {i} failed")
        wait_thinking_idle(75)
        shot(f"after-chunk-{i}")
        extract(f"after-chunk-{i}", dump())
        time.sleep(2.0)

    # Give brief score time to go green
    time.sleep(3.0)
    if not tap_suche_starten(150):
        # try ask confirmation via UI send
        type_into_reisebuero("Passt, Suche starten")
        time.sleep(4)
        tap_suche_starten(60)

    xml, txt = wait_results(480)
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
            "final_xml": str(OUT / "final.xml"),
            "final_text": str(OUT / "final-text.txt"),
        },
    }
    write_report(report)
    log(f"VERDICT {report['verdict']} {report['score']}")
    log(f"report → {OUT / 'report.md'}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
