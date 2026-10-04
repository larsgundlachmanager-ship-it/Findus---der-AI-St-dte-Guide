#!/usr/bin/env python3
"""Warm weekend Nothing — force-stop, deeplink, planen, paste chunks, search."""
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
os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "warm_weekend4"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"

CHUNKS = [
    "Langes Wochenende zu dritt. Abflug Donnerstag 15. Oktober ab 14 Uhr oder Freitag 16. Oktober. Zurueck spaetestens Dienstag.",
    "Start Prisdorf oder Tornesch. Flughafen Hamburg Berlin Bremen oder Hannover. Anreise zum Flughafen mitdenken und im Preis. Donnerstag vor 14 Uhr kein Abflug.",
    "Warm, Pool, unter 400 Euro p.P., 3 Personen. All Inclusive Wunsch aber kein Muss. Selbstversorgung ok.",
]


def ser() -> str:
    return require_qa_serial()


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", ser(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )


def log(m: str) -> None:
    print(m.encode("ascii", "replace").decode("ascii"), flush=True)


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    # avoid hanging forever on idle
    adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "ui.xml"))
    p = OUT / "ui.xml"
    return p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""


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


def blob(xml: str) -> str:
    return "\n".join(
        f
        for n in nodes(xml)
        for f in (n["text"], n["desc"])
        if f and f.strip()
    )


def tap(x: int, y: int, w: float = 1.0) -> None:
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), "100")
    time.sleep(w)


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


def ascii_q(t: str) -> str:
    return (
        t.replace("ä", "ae")
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
    )


def find(xml: str, pat: str, bottom: bool = False, maxlen: int = 70):
    hits = []
    for n in nodes(xml):
        for f in (n["text"], n["desc"]):
            if not f or len(f) > maxlen:
                continue
            if re.search(pat, f, re.I):
                hits.append(n)
                break
    if not hits:
        return None
    return max(hits, key=lambda n: n["cy"]) if bottom else min(hits, key=lambda n: (len(n["text"] or n["desc"]), n["cy"]))


def open_flow() -> str:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.2)
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    # deeplink opens overlay + new trip
    url = "findus://reisebuero"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(5)
    xml = dump()
    shot("after-dl")
    extract("after-dl", xml)
    b = blob(xml).lower()
    if re.search(r"neue reise|yorros?\s*reiseb|akt\s*1|antwort tippen|erz[aä]hl", b):
        path = "deeplink"
    else:
        path = "settings"
        # launch then settings
        adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
        time.sleep(3)
        xml = dump()
        s = None
        for n in nodes(xml):
            if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
                s = n
        if s:
            tap(s["cx"], s["cy"], 2.0)
            xml = dump()
            shot("settings")
            extract("settings", xml)
            # match without requiring clickable on text node
            rb = None
            for n in nodes(xml):
                f = f"{n['text']} {n['desc']}"
                if re.search(r"reiseb[uü]ro", f, re.I) and "yorro" in f.lower():
                    rb = n
                    break
            if rb:
                tap(rb["cx"], rb["cy"], 2.2)
            else:
                # known Nothing settings row approx
                log("rb coords fallback")
                tap(540, 713, 2.2)
        xml = dump()
        shot("hub")
        extract("hub", xml)

    # If hub: tap Neue Reise planen (bottom)
    xml = dump()
    b = blob(xml).lower()
    if re.search(r"akt\s*1|antwort tippen|erz[aä]hl los|brief", b):
        log("already in composer")
        return path

    planen = find(xml, r"neue reise planen", bottom=True, maxlen=80)
    if planen:
        log(f"planen @ {planen['cy']}")
        tap(planen["cx"], planen["cy"], 2.2)
    else:
        plus = find(xml, r"^neue reise$", bottom=False, maxlen=20)
        if plus:
            tap(plus["cx"], plus["cy"], 2.0)
        else:
            log("planen coords fallback")
            tap(540, 2050, 2.2)
    xml = dump()
    shot("composer")
    extract("composer", xml)
    return path


def paste_send(text: str) -> None:
    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if edit:
        tap(edit["cx"], edit["cy"], 0.4)
    else:
        ph = find(xml, r"antwort tippen", maxlen=40)
        if ph:
            tap(ph["cx"], ph["cy"], 0.5)
        else:
            tap(400, 1780, 0.5)
    for _ in range(80):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    time.sleep(0.3)
    adb("shell", "input", "keyevent", "279")
    time.sleep(0.7)
    xml = dump()
    send = find(xml, r"^senden$", maxlen=12)
    if send:
        tap(send["cx"], send["cy"], 1.0)
    else:
        tap(990, 1780, 1.0)
    log("sent " + safe[:100])


def tap_search() -> bool:
    for _ in range(50):
        xml = dump()
        hit = find(xml, r"suche starten", bottom=True, maxlen=80)
        if hit:
            log("search " + (hit["text"] or hit["desc"]))
            tap(hit["cx"], hit["cy"], 1.2)
            shot("search")
            return True
        time.sleep(2.5)
    return False


def wait_results() -> tuple[str, str]:
    best_xml, best = "", -1
    t0 = time.time()
    while time.time() - t0 < 560:
        xml = dump()
        low = blob(xml).lower()
        sc = 0
        if re.search(r"magazin|option|unterkunft|hotel|apartment|destination|treffer", low):
            sc += 3
        if re.search(r"€|eur|euro", low):
            sc += 4
        if re.search(r"pool|warm|flug|all.?inclusive|hamburg|berlin", low):
            sc += 3
        if sc > best:
            best, best_xml = sc, xml
            el = int(time.time() - t0)
            shot(f"best-t{el}")
            extract(f"best-t{el}", xml)
            log(f"score={sc} t={el}")
        if sc >= 9 and not re.search(r"recherche l[aä]uft|w[uü]hle durch", low):
            break
        time.sleep(4)
    if not best_xml:
        best_xml = dump()
    return best_xml, extract("final", best_xml)


def score(txt: str, xml: str) -> dict:
    c = (txt or "") + "\n" + blob(xml)
    low = c.lower()
    checks = {
        "price_visible": bool(re.search(r"€|eur|\d{2,4}\s*euro", low)),
        "pool_or_warm": bool(re.search(r"pool|warm|sonne|meer|strand", low)),
        "flight_or_airport": bool(
            re.search(r"flug|flughafen|hamburg|berlin|bremen|hannover", low)
        ),
        "origin_transfer": bool(
            re.search(r"prisdorf|tornesch|anreise|zum flughafen|bahn|transfer", low)
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
    h = sum(1 for k in hard if checks[k])
    s = sum(1 for k in soft if checks[k])
    verdict = "PASS" if h >= 3 and s >= 3 else ("SOFT" if h >= 2 else "FAIL")
    return {
        "verdict": verdict,
        "score": f"{h}/4 hard · {s}/6 soft",
        "checks": checks,
        "missing": [k for k, v in checks.items() if not v],
        "snippet": c[:2200],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    log(f"serial={ser()}")
    adb("reverse", "tcp:8791", "tcp:8791")
    path = open_flow()
    xml = dump()
    if not re.search(r"akt\s*1|antwort tippen|erz[aä]hl|brief|mic an|suche starten", blob(xml), re.I):
        log("FAIL composer")
        shot("fail-composer")
        (OUT / "report.json").write_text(
            json.dumps({"verdict": "FAIL", "error": "composer", "path": path}, indent=2),
            encoding="utf-8",
        )
        return 2

    for i, ch in enumerate(CHUNKS, 1):
        log(f"=== chunk {i} ===")
        paste_send(ch)
        time.sleep(11)
        shot(f"chunk{i}")
        extract(f"chunk{i}", dump())

    time.sleep(3)
    if not tap_search():
        paste_send("Passt, Suche starten")
        time.sleep(4)
        tap_search()

    xml, txt = wait_results()
    scored = score(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": ser(),
        "path": path,
        **scored,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = [f"# Warm Weekend4\n- Verdict: **{report['verdict']}** ({report['score']})\n"]
    for k, v in report["checks"].items():
        md.append(f"- {k}: {'PASS' if v else 'MISS'}")
    md += ["\n## Snippet\n```", report["snippet"], "```"]
    (OUT / "report.md").write_text("\n".join(md), encoding="utf-8")
    log(f"VERDICT {report['verdict']} {report['score']}")
    return 0 if report["verdict"] != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
