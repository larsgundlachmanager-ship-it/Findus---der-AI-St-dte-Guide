#!/usr/bin/env python3
"""Robust live ask + poll UI for answer (release APK)."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True)


def dump_ui() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(OUT / "ui.xml"))
    return (OUT / "ui.xml").read_text(encoding="utf-8", errors="ignore")


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cls = re.search(r'class="([^"]*)"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        blob = ((text.group(1) if text else "") + " " + (desc.group(1) if desc else "")).strip()
        yield {
            "text": (text.group(1) if text else "").replace("&#10;", " "),
            "desc": (desc.group(1) if desc else "").replace("&#10;", " "),
            "blob": blob.replace("&#10;", " "),
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def visible_text(xml: str) -> list[str]:
    out: list[str] = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = s.strip()
            if s and s not in out and s not in (".", " "):
                out.append(s)
    return out


def tap(x: int, y: int, wait: float = 0.45) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def shot(tag: str) -> None:
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass


def ascii_q(q: str) -> str:
    return (
        q.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace(" ", "%s")
    )


def interesting(texts: list[str]) -> list[str]:
    keys = (
        "ayce",
        "all you",
        "essen",
        "buffet",
        "mercedes",
        "burrito",
        "asia",
        "asiat",
        "tennis",
        "pool",
        "villa",
        "mallorca",
        "alcudia",
        "flug",
        "unterkunft",
        "option",
        "empfehl",
        "treffer",
        "route",
        "€",
        "euro",
        "yorro",
        "entschuldig",
        "moment",
        "suche",
        "recherch",
    )
    hits = []
    for t in texts:
        low = t.lower()
        if any(k in low for k in keys) or len(t) > 40:
            hits.append(t)
    return hits


def main() -> int:
    args = sys.argv[1:]
    tag = "live"
    wait = 90.0
    rest: list[str] = []
    i = 0
    while i < len(args):
        if args[i] == "--tag" and i + 1 < len(args):
            tag = args[i + 1]
            i += 2
            continue
        if args[i] == "--wait" and i + 1 < len(args):
            wait = float(args[i + 1])
            i += 2
            continue
        rest.append(args[i])
        i += 1
    q = " ".join(rest).strip()
    if not q:
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    adb("logcat", "-c")
    adb("shell", "input", "keyevent", "224")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(2.5)

    # dismiss overlays
    xml = dump_ui()
    for n in nodes(xml):
        b = n["blob"].lower()
        if n["click"] and any(k in b for k in ("karte schließen", "karte schliessen", "abbrechen")):
            tap(n["cx"], n["cy"], 0.7)

    xml = dump_ui()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not edit:
        mic = next((n for n in nodes(xml) if "mikrofon" in n["blob"].lower() and n["click"]), None)
        if mic:
            adb("shell", "input", "swipe", str(mic["cx"]), str(mic["cy"]), str(mic["cx"]), str(mic["cy"]), "70")
        else:
            adb("shell", "input", "swipe", "540", "1977", "540", "1977", "70")
        time.sleep(1.8)
        xml = dump_ui()
        edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)

    if not edit:
        shot(f"{tag}-nomodal")
        print("FAIL no EditText")
        return 1

    tap(edit["cx"], edit["cy"], 0.4)
    # clear field
    adb("shell", "input", "keyevent", "123")  # move end
    for _ in range(40):
        adb("shell", "input", "keyevent", "67")  # del
    adb("shell", "input", "text", ascii_q(q))
    time.sleep(0.6)
    xml = dump_ui()
    (OUT / f"{tag}-typed.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
    shot(f"{tag}-typed")

    # hide IME with BACK once — if modal gone, reopen
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.5)
    xml = dump_ui()
    fragen = next(
        (n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen"),
        None,
    )
    edit2 = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    if not fragen and not edit2:
        # modal closed — reopen and type again
        adb("shell", "input", "swipe", "540", "1977", "540", "1977", "70")
        time.sleep(1.6)
        xml = dump_ui()
        edit2 = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
        if edit2:
            tap(edit2["cx"], edit2["cy"], 0.3)
            adb("shell", "input", "text", ascii_q(q))
            time.sleep(0.4)
            xml = dump_ui()
        fragen = next(
            (n for n in nodes(xml) if n["text"] == "Fragen" or n["desc"] == "Fragen"),
            None,
        )

    if not fragen:
        # coordinate fallback from typed dump
        fragen = {"cx": 888, "cy": 1190}
        print("WARN Fragen fallback coords")

    tap(fragen["cx"], fragen["cy"], 0.9)
    print("submitted", q)

    deadline = time.time() + wait
    best: list[str] = []
    while time.time() < deadline:
        time.sleep(8)
        xml = dump_ui()
        texts = visible_text(xml)
        hits = interesting(texts)
        if hits:
            best = hits
            print("poll hits:", " | ".join(hits[:6]).encode("ascii", "replace").decode())
            # keep polling until we have a long answer-ish line
            if any(len(h) > 55 for h in hits):
                break
        else:
            print("poll…", int(deadline - time.time()), "s left")

    shot(tag)
    xml = dump_ui()
    texts = visible_text(xml)
    (OUT / f"{tag}.txt").write_text("\n".join(texts), encoding="utf-8")
    (OUT / f"{tag}-hits.txt").write_text("\n".join(interesting(texts) or best), encoding="utf-8")
    log = adb("logcat", "-d", "-t", "500")
    (OUT / f"{tag}-log.txt").write_text(log.stdout or "", encoding="utf-8", errors="ignore")
    print("--- HITS ---")
    for h in interesting(texts) or best:
        print(h.encode("ascii", "replace").decode())
    print("--- DONE ---", tag)
    return 0 if (interesting(texts) or best) else 1


if __name__ == "__main__":
    raise SystemExit(main())
