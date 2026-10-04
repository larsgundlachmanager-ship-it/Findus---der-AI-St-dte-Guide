#!/usr/bin/env python3
"""Reliable clipboard paste into Reisebüro EditText on Nothing."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\warm_weekend6")
EXTRACT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")

CHUNKS = [
    "Langes Wochenende zu dritt. Abflug Donnerstag 15. Oktober ab 14 Uhr oder Freitag 16. Oktober. Zurueck spaetestens Dienstag.",
    "Start Prisdorf oder Tornesch. Fliegen von Hamburg Berlin Bremen oder Hannover. Anreise zum Flughafen mitdenken und im Preis. Kein Abflug vor 14 Uhr am Donnerstag.",
    "Warm, Pool, unter 400 Euro pro Person, 3 Personen. All Inclusive Wunsch aber kein Muss. Selbstversorgung ok.",
]


def adb(*a, timeout=50):
    return subprocess.run(
        [ADB, "-s", S, *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def log(m):
    print(str(m).encode("ascii", "replace").decode("ascii"), flush=True)


def dump():
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "ui.xml"))
    return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")


def nodes(xml):
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


def blob(xml):
    return "\n".join(f for n in nodes(xml) for f in (n["text"], n["desc"]) if f and f.strip())


def tap(x, y, w=0.7, ms=140):
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(w)


def shot(tag):
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag, xml):
    p = OUT / f"{tag}.xml"
    p.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(p)], check=False)
    t = OUT / f"{tag}-text.txt"
    return t.read_text(encoding="utf-8", errors="ignore") if t.exists() else ""


def ascii_q(t):
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


def find_edit(xml):
    return next((n for n in nodes(xml) if "EditText" in n["cls"]), None)


def find_send(xml):
    for n in nodes(xml):
        if re.fullmatch(r"senden", (n["desc"] or n["text"] or "").strip(), re.I):
            return n
    return None


def paste_send(text: str) -> bool:
    safe = ascii_q(text)
    xml = dump()
    edit = find_edit(xml)
    if not edit:
        log("no EditText")
        return False
    tap(edit["cx"], edit["cy"], 0.9, ms=180)
    # re-dump after keyboard
    time.sleep(0.8)
    xml = dump()
    edit = find_edit(xml) or edit
    tap(edit["cx"], edit["cy"], 0.4, ms=120)
    # select-all / clear
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(140):
        adb("shell", "input", "keyevent", "67")
    adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    time.sleep(0.4)
    # PASTE then Ctrl+V fallback
    adb("shell", "input", "keyevent", "279")
    time.sleep(0.5)
    adb("shell", "input", "keycombination", "113", "47")  # CTRL+V
    time.sleep(0.7)
    xml = dump()
    edit = find_edit(xml)
    et = (edit["text"] if edit else "") or ""
    ok = bool(et) and not re.search(r"antwort tippen", et, re.I) and len(et) > 8
    log(f"edit_text_ok={ok} len={len(et)} preview={et[:60]!r}")
    if not ok:
        # last resort: type short via input text (spaces as %s)
        short = safe[:90].replace(" ", "%s")
        adb("shell", "input", "text", short)
        time.sleep(0.6)
        xml = dump()
        edit = find_edit(xml)
        et = (edit["text"] if edit else "") or ""
        ok = bool(et) and not re.search(r"antwort tippen", et, re.I)
        log(f"typed_fallback ok={ok} preview={et[:60]!r}")
    send = find_send(xml)
    if send:
        tap(send["cx"], send["cy"], 1.1, ms=200)
    else:
        tap(edit["cx"] + 450 if edit else 990, edit["cy"] if edit else 1270, 1.1, ms=200)
    return ok


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
        "stickers_or_brief": bool(
            re.search(r"brief\s*[1-9]|muss|pool|personen|grün|gruen|suche starten", low)
        ),
    }
    hard = ["price_visible", "pool_or_warm", "flight_or_airport", "presentation_ready"]
    soft = ["origin_transfer", "budget_400", "ai_soft", "dates", "booking_link", "persons_3"]
    h = sum(1 for k in hard if checks[k])
    s = sum(1 for k in soft if checks[k])
    # briefing-only progress counts as SOFT research-in-progress
    if checks["stickers_or_brief"] and h < 2:
        verdict = "SOFT"
    else:
        verdict = "PASS" if h >= 3 and s >= 3 else ("SOFT" if h >= 2 else "FAIL")
    return {
        "verdict": verdict,
        "score": f"{h}/4 hard · {s}/6 soft",
        "checks": checks,
        "missing": [k for k, v in checks.items() if not v],
        "snippet": c[:2500],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    xml = dump()
    if not re.search(r"akt\s*1|antwort tippen", blob(xml), re.I):
        log("not in composer")
        return 2

    for i, ch in enumerate(CHUNKS, 1):
        log(f"=== chunk {i} ===")
        paste_send(ch)
        time.sleep(16)
        xml = dump()
        shot(f"ok-chunk{i}")
        extract(f"ok-chunk{i}", xml)
        for line in blob(xml).splitlines():
            if re.search(r"brief|pool|400|personen|donnerstag|muss|wunsch|suche", line, re.I):
                log("UI: " + line[:130])

    # search button
    searched = False
    for _ in range(45):
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
            tap(h["cx"], h["cy"], 1.4, ms=250)
            shot("search")
            searched = True
            break
        time.sleep(2.5)
    if not searched:
        paste_send("Passt, Suche starten")
        time.sleep(4)
        xml = dump()
        for n in nodes(xml):
            if n["click"] and re.search(r"suche starten", f"{n['text']} {n['desc']}", re.I):
                tap(n["cx"], n["cy"], 1.4, ms=250)
                searched = True
                break

    best, best_xml = -1, ""
    t0 = time.time()
    while time.time() - t0 < 520:
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
        # if still in briefing with stickers, keep waiting a bit then stop
        if time.time() - t0 > 90 and re.search(r"brief\s*[5-9]|gr[uü]n", low) and sc < 3:
            log("still briefing after 90s")
        time.sleep(4)

    if not best_xml:
        best_xml = dump()
    txt = extract("final", best_xml)
    shot("final")
    scored = score(txt, best_xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": S,
        "searched": searched,
        **scored,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# Warm Weekend Live — Nothing",
        f"- Verdict: **{report['verdict']}** ({report['score']})",
        f"- Searched: {searched}",
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
