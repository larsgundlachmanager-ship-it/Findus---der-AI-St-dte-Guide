#!/usr/bin/env python3
"""Paste brief chunks into open Reisebüro composer on Nothing via clipboard."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
S = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\warm_weekend6")
EXTRACT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\extract_ui.py")

CHUNKS = [
    "Langes Wochenende zu dritt. Abflug Donnerstag 15. Oktober ab 14 Uhr oder Freitag 16. Oktober. Zurueck spaetestens Dienstag.",
    "Start Prisdorf oder Tornesch. Flughafen Hamburg Berlin Bremen oder Hannover. Anreise zum Flughafen mitdenken und im Preis. Kein Abflug vor 14 Uhr am Donnerstag.",
    "Warm, Pool, unter 400 Euro pro Person, 3 Personen. All Inclusive ist Wunsch aber kein Muss. Selbstversorgung ok.",
]


def adb(*a):
    return subprocess.run(
        [ADB, "-s", S, *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=45,
    )


def log(m):
    print(m.encode("ascii", "replace").decode("ascii"), flush=True)


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


def tap(x, y, w=0.8, ms=160):
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(w)


def shot(tag):
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag, xml):
    p = OUT / f"{tag}.xml"
    p.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(p)], check=False)


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


def focus_input(xml):
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if edit:
        tap(edit["cx"], edit["cy"], 0.4)
        return True
    for n in nodes(xml):
        if re.search(r"antwort tippen", f"{n['text']} {n['desc']}", re.I):
            tap(n["cx"], n["cy"], 0.5)
            return True
    # tippfeld approx on Nothing composer
    tap(400, 1710, 0.5)
    return True


def paste_send(text):
    xml = dump()
    focus_input(xml)
    for _ in range(100):
        adb("shell", "input", "keyevent", "67")
    safe = ascii_q(text)
    adb("shell", "cmd", "clipboard", "set", "--user", "0", safe)
    time.sleep(0.35)
    adb("shell", "input", "keyevent", "279")
    time.sleep(0.8)
    xml = dump()
    send = None
    for n in nodes(xml):
        if re.fullmatch(r"senden", (n["text"] or n["desc"] or "").strip(), re.I):
            send = n
            break
    if send:
        tap(send["cx"], send["cy"], 1.0, ms=200)
    else:
        tap(990, 1710, 1.0, ms=200)
    log("sent " + safe[:100])


def main():
    xml = dump()
    shot("paste-before")
    extract("paste-before", xml)
    b = blob(xml).lower()
    log("composer=" + str(bool(re.search(r"akt\s*1|antwort tippen|brief", b))))
    if not re.search(r"akt\s*1|antwort tippen|brief", b):
        log("NOT in composer — abort")
        return 2

    for i, ch in enumerate(CHUNKS, 1):
        log(f"=== paste chunk {i} ===")
        paste_send(ch)
        time.sleep(14)
        xml = dump()
        shot(f"paste-chunk{i}")
        extract(f"paste-chunk{i}", xml)
        log("brief hint: " + ("brief" in blob(xml).lower()))
        # print brief line
        for line in blob(xml).splitlines():
            if re.search(r"brief|muss|wunsch|pool|400|personen", line, re.I):
                log("UI: " + line[:120])

    # wait for green / search
    for _ in range(40):
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
            shot("search-tapped")
            break
        time.sleep(3)
    else:
        paste_send("Passt, Suche starten")
        time.sleep(5)
        xml = dump()
        for n in nodes(xml):
            if n["click"] and re.search(r"suche starten", f"{n['text']} {n['desc']}", re.I):
                tap(n["cx"], n["cy"], 1.4, ms=250)
                shot("search-tapped")
                break

    # wait results
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
        time.sleep(4)
    if not best_xml:
        best_xml = dump()
    extract("final", best_xml)
    shot("final")
    log("DONE score=" + str(best))
    # write quick report snippet
    (OUT / "paste-final-snippet.txt").write_text(blob(best_xml)[:3000], encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
