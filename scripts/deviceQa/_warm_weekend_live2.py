#!/usr/bin/env python3
"""Warm-weekend live on Nothing — robust open via deep link + settings fallback."""
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
os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "warm_weekend2"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"
XML = OUT / "ui.xml"

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
    print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/Download/ui.xml"
    adb("shell", "uiautomator", "dump", remote)
    adb("pull", remote, str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore") if XML.exists() else ""


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
            "click": 'clickable="true"' in n,
        }


def ui_blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        for f in (n["text"], n["desc"]):
            f = (f or "").strip()
            if f:
                parts.append(f)
    return "\n".join(parts)


def tap(x: int, y: int, wait: float = 0.8) -> None:
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "120")
    time.sleep(wait)


def shot(tag: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag: str, xml: str) -> str:
    p = OUT / f"{tag}.xml"
    p.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(p)], check=False)
    t = OUT / f"{tag}-text.txt"
    return t.read_text(encoding="utf-8", errors="ignore") if t.exists() else ""


def find_exact_settings(xml: str):
    """Dock Einstellungen only — not weather cards mentioning Einst."""
    cands = []
    for n in nodes(xml):
        if not n["click"]:
            continue
        t = (n["text"] or "").strip()
        d = (n["desc"] or "").strip()
        if d == "Einstellungen" or t in ("Einst.", "Einstellungen"):
            cands.append(n)
        elif re.fullmatch(r"Einst\.?", t, re.I):
            cands.append(n)
    if not cands:
        return None
    return max(cands, key=lambda n: n["cy"])


def find_pat(xml: str, *pats: str, require_click: bool = True, short_only: bool = False):
    scored = []
    for n in nodes(xml):
        if require_click and not n["click"]:
            continue
        fields = [f for f in (n["text"], n["desc"]) if f and f.strip()]
        for field in fields:
            if short_only and len(field) > 48:
                continue
            for pat in pats:
                if re.search(pat, field, re.I):
                    scored.append((len(field), -n["cy"], n))
                    break
    if not scored:
        return None
    scored.sort()
    return scored[0][2]


def has_edit(xml: str) -> bool:
    return any("EditText" in n["cls"] for n in nodes(xml))


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
    )


def ensure_reverse() -> None:
    adb("reverse", "tcp:8791", "tcp:8791")


def deep_link_reisebuero(q: str | None = None) -> None:
    if q:
        url = "findus://reisebuero?q=" + urllib.parse.quote(q)
    else:
        url = "findus://reisebuero"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url)
    time.sleep(3.0)


def open_via_settings() -> bool:
    xml = dump()
    s = find_exact_settings(xml)
    if not s:
        log("no settings dock")
        return False
    log(f"tap settings {s['cx']},{s['cy']}")
    tap(s["cx"], s["cy"], 1.6)
    xml = dump()
    shot("settings")
    # scroll for row
    for _ in range(4):
        rb = find_pat(
            xml,
            r"yorros?\s*reiseb[uü]ro\s*[oö]ffnen",
            r"yorros?\s*reiseb[uü]ro",
            short_only=True,
        )
        if rb:
            log(f"tap reisebuero row {rb['text'] or rb['desc']}")
            tap(rb["cx"], rb["cy"], 2.0)
            return True
        adb("shell", "input", "swipe", "540", "1700", "540", "700", "450")
        time.sleep(0.8)
        xml = dump()
    shot("no-rb-row")
    return False


def enter_new_trip() -> bool:
    xml = dump()
    shot("hub")
    extract("hub", xml)
    if has_edit(xml):
        return True
    neu = find_pat(xml, r"neue reise planen", r"^neue reise$", short_only=True)
    if neu:
        log(f"tap neue reise {neu['text'] or neu['desc']}")
        tap(neu["cx"], neu["cy"], 2.0)
        xml = dump()
    if not has_edit(xml):
        ph = find_pat(xml, r"antwort tippen", require_click=False)
        if ph:
            tap(ph["cx"], ph["cy"], 0.6)
            xml = dump()
    ok = has_edit(xml)
    shot("composer")
    extract("composer", xml)
    log(f"composer edit={ok}")
    return ok


def type_chunk(text: str) -> bool:
    xml = dump()
    if not has_edit(xml):
        ph = find_pat(xml, r"antwort tippen", require_click=False)
        if ph:
            tap(ph["cx"], ph["cy"], 0.5)
            xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        log("NO_EDITTEXT")
        shot("no-edit")
        return False
    tap(edit["cx"], edit["cy"], 0.4)
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(100):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    time.sleep(0.3)
    adb("shell", "input", "keyevent", "279")
    time.sleep(0.8)
    xml = dump()
    send = find_pat(xml, r"^senden$", short_only=True)
    if send:
        tap(send["cx"], send["cy"], 1.0)
    else:
        adb("shell", "input", "keyevent", "66")
        time.sleep(0.9)
    log("sent: " + safe[:90])
    return True


def tap_search(timeout: float = 150.0) -> bool:
    pats = (
        r"passt\s*[—\-–]?\s*suche starten",
        r"gr[uü]n\s*·?\s*suche starten",
        r"suche starten",
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = dump()
        for pat in pats:
            hits = [
                n
                for n in nodes(xml)
                if n["click"] and re.search(pat, f"{n['text']} {n['desc']}", re.I)
            ]
            if hits:
                hit = max(hits, key=lambda n: n["cy"])
                log(f"search tap: {hit['text'] or hit['desc']}")
                tap(hit["cx"], hit["cy"], 1.0)
                shot("search-tapped")
                return True
        time.sleep(2.5)
    shot("no-search")
    return False


def wait_results(timeout: float = 540.0) -> tuple[str, str]:
    started = time.time()
    best_xml, best_score = "", -1
    while time.time() - started < timeout:
        xml = dump()
        blob = ui_blob(xml).lower()
        score = 0
        if re.search(r"magazin|option|unterkunft|hotel|apartment|destination|treffer", blob):
            score += 3
        if re.search(r"€|eur|\d+\s*euro", blob):
            score += 4
        if re.search(r"pool|warm|all.?inclusive|flug|hamburg|berlin", blob):
            score += 3
        if re.search(r"recherche l[aä]uft|w[uü]hle", blob):
            score -= 1
        if score > best_score:
            best_score = score
            best_xml = xml
            el = int(time.time() - started)
            shot(f"best-t{el}")
            extract(f"best-t{el}", xml)
            log(f"score={score} t={el}")
        if score >= 9 and not re.search(r"recherche l[aä]uft|w[uü]hle", blob):
            break
        time.sleep(4.0)
    if not best_xml:
        best_xml = dump()
    txt = extract("final", best_xml)
    shot("final")
    return best_xml, txt


def score(txt: str, xml: str) -> dict:
    c = (txt or "") + "\n" + ui_blob(xml)
    low = c.lower()
    checks = {
        "price_visible": bool(re.search(r"€|eur|\d{2,4}\s*euro", low)),
        "pool_or_warm": bool(re.search(r"pool|warm|sonne|meer|strand", low)),
        "flight_or_airport": bool(
            re.search(r"flug|flughafen|hamburg|berlin|bremen|hannover|ham|ber|haj|bre", low)
        ),
        "origin_transfer": bool(
            re.search(r"prisdorf|tornesch|anreise|zum flughafen|bahn|s-bahn|transfer", low)
        ),
        "budget_400": bool(re.search(r"400|budget|p\.?\s*p|pro person", low)),
        "ai_soft": bool(re.search(r"all.?inclusive|selbstversorg|appartement|apartment|hotel", low)),
        "dates": bool(re.search(r"donnerstag|freitag|dienstag|15\.|16\.|oktober|wochenende", low)),
        "booking_link": bool(
            re.search(r"check24|booking|buchen|kayak|skyscanner|expedia|pauschal|open", low)
        ),
        "presentation_ready": bool(
            re.search(r"magazin|option|unterkunft|destination|treffer|story", low)
        )
        and not bool(re.search(r"recherche l[aä]uft|w[uü]hle durch", low)),
        "persons_3": bool(re.search(r"3\s*(pers|leute)|zu\s*dritt|drei", low)),
    }
    hard = ["price_visible", "pool_or_warm", "flight_or_airport", "presentation_ready"]
    soft = ["origin_transfer", "budget_400", "ai_soft", "dates", "booking_link", "persons_3"]
    hard_ok = sum(1 for k in hard if checks[k])
    soft_ok = sum(1 for k in soft if checks[k])
    verdict = "PASS" if hard_ok >= 3 and soft_ok >= 3 else ("SOFT" if hard_ok >= 2 else "FAIL")
    notes = [k for k, v in checks.items() if not v]
    return {
        "verdict": verdict,
        "score": f"{hard_ok}/4 hard · {soft_ok}/6 soft",
        "checks": checks,
        "missing": notes,
        "snippet": c[:2000],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log(f"serial={serial()}")
    ensure_reverse()
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(4)

    # 1) Deep link hub
    deep_link_reisebuero()
    xml = dump()
    shot("after-deeplink")
    extract("after-deeplink", xml)
    path = "deeplink"
    if not (re.search(r"reiseb[uü]ro|neue reise", ui_blob(xml), re.I) or has_edit(xml)):
        path = "settings"
        if not open_via_settings():
            # last resort: ask server
            path = "ask"
            try:
                req = urllib.request.Request(
                    "http://127.0.0.1:8791/ask",
                    data=b"Oeffne Yorros Reisebuero",
                    method="POST",
                    headers={"Content-Type": "text/plain; charset=utf-8"},
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                log(f"ask fail {e}")
            time.sleep(8)
            xml = dump()

    if not enter_new_trip():
        # one more settings attempt
        if path != "settings":
            open_via_settings()
            if not enter_new_trip():
                log("FAIL open composer")
                report = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "verdict": "FAIL",
                    "error": "no composer",
                    "path": path,
                    "snippet": ui_blob(dump())[:800],
                }
                (OUT / "report.json").write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                return 2
        else:
            log("FAIL open composer")
            return 2

    for i, chunk in enumerate(BRIEF_CHUNKS, 1):
        log(f"=== chunk {i} ===")
        ok = type_chunk(chunk)
        if not ok:
            time.sleep(2)
            ok = type_chunk(chunk)
        time.sleep(8)
        shot(f"after-chunk-{i}")
        extract(f"after-chunk-{i}", dump())

    time.sleep(3)
    if not tap_search(160):
        type_chunk("Passt, Suche starten")
        time.sleep(4)
        tap_search(60)

    xml, txt = wait_results(540)
    scored = score(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": serial(),
        "path": path,
        **scored,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = [
        "# Warm Weekend Live (Nothing)",
        f"- Verdict: **{report['verdict']}** ({report['score']})",
        f"- Path: {path}",
        "",
        "## Checks",
    ]
    for k, v in (report.get("checks") or {}).items():
        md.append(f"- {k}: {'PASS' if v else 'MISS'}")
    md += ["", "## Missing", ""] + [f"- {m}" for m in report.get("missing") or []]
    md += ["", "## Snippet", "```", report.get("snippet") or "", "```"]
    (OUT / "report.md").write_text("\n".join(md), encoding="utf-8")
    log(f"VERDICT {report['verdict']} {report['score']}")
    return 0 if report["verdict"] != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
