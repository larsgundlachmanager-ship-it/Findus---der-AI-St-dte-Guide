#!/usr/bin/env python3
"""Nothing warm-weekend: settings → Neue Reise planen → Mic-Tap Tippfeld → paste."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "warm_weekend3"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"

BRIEF_CHUNKS = [
    (
        "Langes Wochenende zu dritt: Abflug Donnerstag 15. Oktober ab 14 Uhr "
        "oder entspannt Freitag 16. Oktober. Zurueck spaetestens Dienstag."
    ),
    (
        "Start Prisdorf oder Tornesch. Fliegen Hamburg, Berlin, Bremen oder Hannover. "
        "Anreise zum Flughafen mitdenken und im Preis. Donnerstag vor 14 Uhr kein Abflug. "
        "Fruehflug Freitag braucht Bahn zum Flughafen im Gesamtpreis."
    ),
    (
        "Warm, Pool, unter 400 Euro p.P., 3 Personen. "
        "All Inclusive Wunsch aber kein Muss, Selbstversorgung ok. Passt so, Suche starten."
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


def dump(retries: int = 4) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/Download/ui.xml"
    local = OUT / "ui.xml"
    for i in range(retries):
        r = adb("shell", "uiautomator", "dump", remote)
        err = ((r.stdout or "") + (r.stderr or "")).lower()
        if "error" in err and i < retries - 1:
            time.sleep(1.2)
            continue
        adb("pull", remote, str(local))
        if local.exists() and local.stat().st_size > 500:
            return local.read_text(encoding="utf-8", errors="ignore")
        time.sleep(1.0)
    return local.read_text(encoding="utf-8", errors="ignore") if local.exists() else ""


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
            "y1": y1,
            "y2": y2,
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


def tap(x: int, y: int, wait: float = 0.9) -> None:
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "100")
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


def find_label(xml: str, *pats: str, prefer_bottom: bool = False, max_len: int = 55):
    scored = []
    for n in nodes(xml):
        if not n["click"]:
            continue
        for f in (n["text"], n["desc"]):
            if not f or len(f) > max_len:
                continue
            for pat in pats:
                if re.search(pat, f, re.I):
                    # prefer longer label match for "Neue Reise planen" over "Neue Reise"
                    scored.append((-len(f) if "planen" in pat else len(f), -n["cy"] if prefer_bottom else n["cy"], n, f))
                    break
    if not scored:
        return None
    # For planen: longest match + bottom
    scored.sort()
    return scored[0][2]


def open_reisebuero() -> bool:
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(3.5)
    xml = dump()
    # settings dock
    settings = None
    for n in nodes(xml):
        if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
            settings = n
    if not settings:
        log("no settings")
        shot("no-settings")
        return False
    tap(settings["cx"], settings["cy"], 1.8)
    xml = dump()
    shot("settings")
    rb = None
    for n in nodes(xml):
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"yorros?\s*reiseb[uü]ro", blob, re.I) and n["click"] and len(blob) < 50:
            rb = n
            break
    if not rb:
        adb("shell", "input", "swipe", "540", "1700", "540", "800", "400")
        time.sleep(0.8)
        xml = dump()
        for n in nodes(xml):
            blob = f"{n['text']} {n['desc']}"
            if re.search(r"yorros?\s*reiseb[uü]ro", blob, re.I) and n["click"] and len(blob) < 50:
                rb = n
                break
    if not rb:
        log("no reisebuero row")
        return False
    log(f"tap rb {rb['text'] or rb['desc']}")
    tap(rb["cx"], rb["cy"], 2.2)
    xml = dump()
    shot("hub")
    extract("hub", xml)

    # Prefer bottom "Neue Reise planen"
    planen = None
    for n in nodes(xml):
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"neue reise planen", blob, re.I) and n["click"]:
            if planen is None or n["cy"] > planen["cy"]:
                planen = n
    if not planen:
        # gold button roughly bottom center on Nothing 1080x2392
        log("fallback tap neue reise planen coords")
        tap(540, 2050, 2.0)
    else:
        log(f"tap planen {planen['text'] or planen['desc']} @ {planen['cy']}")
        tap(planen["cx"], planen["cy"], 2.2)

    xml = dump()
    shot("composer")
    extract("composer", xml)
    blob = ui_blob(xml).lower()
    ok = bool(
        re.search(r"antwort tippen|akt\s*1|brief|erz[aä]hl los|suche starten|mic an", blob)
    )
    log(f"composer_ok={ok}")
    return ok


def focus_tippfeld(xml: str | None = None) -> None:
    xml = xml or dump()
    # 1) EditText
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if edit:
        tap(edit["cx"], edit["cy"], 0.5)
        return
    # 2) placeholder
    for n in nodes(xml):
        if re.search(r"antwort tippen", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 0.5)
            return
    # 3) short tap mic inside overlay (tippen schreibt) — lower center-ish
    # In reisebüro composer, tippfeld is above Mic an — approx y=1750-1900
    log("tippfeld fallback coords")
    tap(420, 1780, 0.6)


def type_chunk(text: str) -> bool:
    focus_tippfeld()
    # clear
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(120):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    r = adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    if r.returncode != 0:
        log("clipboard warn " + ((r.stderr or r.stdout or "")[:80]))
    time.sleep(0.35)
    adb("shell", "input", "keyevent", "279")  # paste
    time.sleep(0.9)
    xml = dump()
    send = None
    for n in nodes(xml):
        if re.fullmatch(r"senden", (n["text"] or n["desc"] or "").strip(), re.I) and n["click"]:
            send = n
    if send:
        tap(send["cx"], send["cy"], 1.0)
    else:
        # send icon right of tippfeld
        tap(980, 1780, 1.0)
    log("sent " + safe[:90])
    return True


def tap_search(timeout: float = 180.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = dump()
        hits = []
        for n in nodes(xml):
            blob = f"{n['text']} {n['desc']}"
            if n["click"] and re.search(r"suche starten", blob, re.I) and len(blob) < 80:
                hits.append(n)
        if hits:
            hit = max(hits, key=lambda n: n["cy"])
            log(f"search {hit['text'] or hit['desc']}")
            tap(hit["cx"], hit["cy"], 1.2)
            shot("search-tapped")
            return True
        # maybe already searching / green enough — try sending confirmation
        time.sleep(2.5)
    shot("no-search")
    return False


def wait_results(timeout: float = 560.0) -> tuple[str, str]:
    started = time.time()
    best_xml, best = "", -1
    while time.time() - started < timeout:
        xml = dump()
        blob = ui_blob(xml).lower()
        score = 0
        if re.search(r"magazin|option|unterkunft|hotel|apartment|destination|treffer|story", blob):
            score += 3
        if re.search(r"€|eur|\d+\s*euro", blob):
            score += 4
        if re.search(r"pool|warm|flug|all.?inclusive|hamburg|berlin|resort", blob):
            score += 3
        if re.search(r"recherche l[aä]uft|w[uü]hle|brief\s*\d", blob) and score < 6:
            score -= 1
        if score > best:
            best = score
            best_xml = xml
            el = int(time.time() - started)
            shot(f"best-t{el}")
            extract(f"best-t{el}", xml)
            log(f"score={score} t={el}")
        if score >= 9 and not re.search(r"recherche l[aä]uft|w[uü]hle durch", blob):
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
            re.search(r"flug|flughafen|hamburg|berlin|bremen|hannover|ham\b|ber\b|haj|bre", low)
        ),
        "origin_transfer": bool(
            re.search(r"prisdorf|tornesch|anreise|zum flughafen|bahn|s-bahn|transfer", low)
        ),
        "budget_400": bool(re.search(r"400|budget|p\.?\s*p|pro person", low)),
        "ai_soft": bool(re.search(r"all.?inclusive|selbstversorg|appartement|apartment|hotel", low)),
        "dates": bool(re.search(r"donnerstag|freitag|dienstag|15\.|16\.|oktober|wochenende", low)),
        "booking_link": bool(
            re.search(r"check24|booking|buchen|kayak|skyscanner|expedia|pauschal", low)
        ),
        "presentation_ready": bool(
            re.search(r"magazin|option|unterkunft|destination|treffer|story|flug", low)
        )
        and not bool(re.search(r"recherche l[aä]uft|w[uü]hle durch", low)),
        "persons_3": bool(re.search(r"3\s*(pers|leute)|zu\s*dritt|drei", low)),
    }
    hard = ["price_visible", "pool_or_warm", "flight_or_airport", "presentation_ready"]
    soft = ["origin_transfer", "budget_400", "ai_soft", "dates", "booking_link", "persons_3"]
    hard_ok = sum(1 for k in hard if checks[k])
    soft_ok = sum(1 for k in soft if checks[k])
    verdict = "PASS" if hard_ok >= 3 and soft_ok >= 3 else ("SOFT" if hard_ok >= 2 else "FAIL")
    return {
        "verdict": verdict,
        "score": f"{hard_ok}/4 hard · {soft_ok}/6 soft",
        "checks": checks,
        "missing": [k for k, v in checks.items() if not v],
        "snippet": c[:2200],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log(f"serial={serial()}")
    adb("reverse", "tcp:8791", "tcp:8791")
    if not open_reisebuero():
        report = {"verdict": "FAIL", "error": "open", "ts": datetime.now(timezone.utc).isoformat()}
        (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return 2

    for i, chunk in enumerate(BRIEF_CHUNKS, 1):
        log(f"=== chunk {i} ===")
        type_chunk(chunk)
        time.sleep(10)
        shot(f"after-chunk-{i}")
        extract(f"after-chunk-{i}", dump())

    time.sleep(4)
    if not tap_search(160):
        type_chunk("Passt, Suche starten bitte")
        time.sleep(5)
        tap_search(90)

    xml, txt = wait_results(560)
    scored = score(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": serial(),
        **scored,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# Warm Weekend Live3 (Nothing)",
        f"- **Verdict:** {report['verdict']} ({report['score']})",
        "",
        "## Checks",
    ]
    for k, v in report["checks"].items():
        lines.append(f"- {k}: {'PASS' if v else 'MISS'}")
    lines += ["", "## Missing"] + [f"- {m}" for m in report["missing"]]
    lines += ["", "## Snippet", "```", report["snippet"], "```"]
    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    log(f"VERDICT {report['verdict']} {report['score']}")
    return 0 if report["verdict"] != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
