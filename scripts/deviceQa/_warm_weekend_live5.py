#!/usr/bin/env python3
"""Warm weekend Nothing: + Neue Reise, dann findus://reisebuero?q= Chunks."""
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
OUT = ROOT / ".cursor" / "live9" / "warm_weekend5"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"

CHUNKS = [
    "Langes Wochenende zu dritt. Abflug Donnerstag 15. Oktober ab 14 Uhr oder Freitag 16. Oktober. Zurueck spaetestens Dienstag.",
    "Start Prisdorf oder Tornesch. Flughafen Hamburg Berlin Bremen oder Hannover. Anreise zum Flughafen mitdenken und im Preis. Kein Abflug vor 14 Uhr am Donnerstag.",
    "Warm, Pool, unter 400 Euro pro Person, 3 Personen. All Inclusive ist Wunsch aber kein Muss. Selbstversorgung ok. Wenn Brief gruen: Suche starten.",
]


def ser() -> str:
    return require_qa_serial()


def adb(*a: str, timeout: int = 45) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", ser(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def log(m: str) -> None:
    print(m.encode("ascii", "replace").decode("ascii"), flush=True)


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/Download/ui.xml")
    except Exception:
        pass
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
    return "\n".join(f for n in nodes(xml) for f in (n["text"], n["desc"]) if f and f.strip())


def tap(x: int, y: int, w: float = 1.0, ms: int = 180) -> None:
    # longer press-in for RN Pressable on Nothing
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
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


def deeplink(q: str | None = None) -> None:
    if q:
        url = "findus://reisebuero?q=" + urllib.parse.quote(q)
    else:
        url = "findus://reisebuero"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, PKG)
    time.sleep(2.5)


def in_composer(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(re.search(r"akt\s*1|antwort tippen|erz[aä]hl los|brief\s*\d|mic an|suche starten", b))


def in_hub(xml: str) -> bool:
    b = blob(xml).lower()
    return bool(re.search(r"deine reisen|neue reise planen|noch keine gespeicherte", b))


def open_composer() -> bool:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
    # open hub via settings (deeplink alone unreliable on this build)
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(4)
    xml = dump()
    # settings
    for n in nodes(xml):
        if n["desc"] == "Einstellungen" or n["text"] in ("Einst.", "Einstellungen"):
            tap(n["cx"], n["cy"], 1.8, ms=200)
            break
    xml = dump()
    shot("settings")
    # reisebüro row — click parent
    tapped = False
    for n in nodes(xml):
        f = f"{n['text']} {n['desc']}"
        if re.search(r"yorros?\s*reiseb", f, re.I) and len(f) < 60:
            log("rb " + f.strip()[:40])
            tap(n["cx"], n["cy"], 2.2, ms=220)
            tapped = True
            break
    if not tapped:
        tap(540, 713, 2.2, ms=220)
    xml = dump()
    shot("hub")
    extract("hub", xml)

    # Prefer header + (Neue Reise) — worked earlier
    plus = None
    for n in nodes(xml):
        if n["desc"] == "Neue Reise" or (n["text"] == "Neue Reise" and n["click"]):
            plus = n
            break
    if plus:
        log(f"tap plus Neue Reise @ {plus['cx']},{plus['cy']}")
        tap(plus["cx"], plus["cy"], 2.5, ms=250)
    else:
        # clickable planen band
        for n in nodes(xml):
            if re.search(r"neue reise planen", f"{n['text']} {n['desc']}", re.I) and n["click"]:
                log(f"tap planen band @ {n['cy']}")
                tap(n["cx"], n["cy"], 2.5, ms=280)
                break
        else:
            tap(540, 2210, 2.5, ms=280)

    time.sleep(1.5)
    xml = dump()
    shot("composer1")
    extract("composer1", xml)
    if in_composer(xml):
        return True

    # retry plus + deeplink seed to force trip
    if in_hub(xml):
        for n in nodes(xml):
            if n["desc"] == "Neue Reise":
                tap(n["cx"], n["cy"], 2.5, ms=300)
                break
        time.sleep(1)
    deeplink("Erzaehl los: langes Wochenende zu dritt")
    time.sleep(3)
    xml = dump()
    shot("composer2")
    extract("composer2", xml)
    return in_composer(xml)


def send_chunk(text: str) -> None:
    # While overlay open, deeplink q enqueues utterance
    deeplink(text)
    time.sleep(3.5)
    log("queued " + text[:90])


def tap_search(timeout: float = 200.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        xml = dump()
        hits = [
            n
            for n in nodes(xml)
            if n["click"]
            and re.search(r"suche starten", f"{n['text']} {n['desc']}", re.I)
            and len(f"{n['text']} {n['desc']}") < 80
        ]
        if hits:
            h = max(hits, key=lambda n: n["cy"])
            log("search " + (h["text"] or h["desc"]))
            tap(h["cx"], h["cy"], 1.3, ms=250)
            shot("search")
            return True
        # also try deeplink nudge
        b = blob(xml).lower()
        if re.search(r"gr[uü]n|brief\s*8|brief\s*9|brief\s*100", b):
            deeplink("Passt, Suche starten")
            time.sleep(3)
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
    if not open_composer():
        log("FAIL open")
        (OUT / "report.json").write_text(
            json.dumps({"verdict": "FAIL", "error": "composer"}, indent=2), encoding="utf-8"
        )
        return 2

    for i, ch in enumerate(CHUNKS, 1):
        log(f"=== chunk {i} ===")
        send_chunk(ch)
        time.sleep(12)
        shot(f"chunk{i}")
        extract(f"chunk{i}", dump())

    time.sleep(4)
    if not tap_search():
        send_chunk("Passt, Suche starten")
        time.sleep(5)
        tap_search(90)

    xml, txt = wait_results()
    scored = score(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": ser(),
        **scored,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [f"# Warm Weekend5\n- Verdict: **{report['verdict']}** ({report['score']})\n"]
    for k, v in report["checks"].items():
        lines.append(f"- {k}: {'PASS' if v else 'MISS'}")
    lines += ["\n## Missing"] + [f"- {m}" for m in report["missing"]]
    lines += ["\n## Snippet\n```", report["snippet"], "```"]
    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    log(f"VERDICT {report['verdict']} {report['score']}")
    return 0 if report["verdict"] != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
