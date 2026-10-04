#!/usr/bin/env python3
"""Open Yorros Reisebüro on Nothing via Settings dock (fixed label match)."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SER = "00143157P001105"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende")
OUT.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", SER, *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    path = OUT / f"{tag}.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(path))
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))
    return path.read_text(encoding="utf-8", errors="ignore")


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


def find(xml: str, *pats: str, require_click: bool = True):
    scored = []
    for n in nodes(xml):
        if require_click and not n["click"]:
            continue
        fields = [f for f in (n["text"].strip(), n["desc"].strip()) if f]
        match_len = None
        for field in fields:
            for pat in pats:
                if re.search(pat, field, re.I):
                    match_len = len(field) if match_len is None else min(match_len, len(field))
        if match_len is not None:
            scored.append((match_len, -n["cy"], n))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]))
    return scored[0][2]


def tap(n, wait=1.5):
    log(f"TAP {n['cx']},{n['cy']} text={n['text'][:40]!r} desc={n['desc'][:60]!r}")
    adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
    time.sleep(wait)


def main() -> int:
    xml = dump("fix-home")
    s = find(xml, r"^einstellungen$", r"^einst\.$")
    if not s:
        log("NO SETTINGS")
        return 2
    tap(s, 2.2)
    xml = dump("fix-settings")
    texts = []
    for n in nodes(xml):
        b = f"{n['text']} | {n['desc']}".strip(" |")
        if b:
            texts.append(b[:120])
    log(f"settings_count={len(texts)}")
    for t in texts[:50]:
        log(f"  {t}")

    found = find(xml, r"yorros?\s*reiseb", r"reiseb[uü]ro")
    if not found:
        for i in range(6):
            log(f"scroll {i}")
            adb("shell", "input", "swipe", "540", "1700", "540", "550", "350")
            time.sleep(0.8)
            xml = dump(f"fix-scroll{i}")
            found = find(xml, r"yorros?\s*reiseb", r"reiseb[uü]ro")
            if found:
                break
    if not found:
        log("REISE NOT FOUND")
        (OUT / "fix-fail-texts.txt").write_text("\n".join(texts), encoding="utf-8")
        return 3
    tap(found, 2.0)
    xml = dump("fix-hub")
    neu = find(xml, r"neue reise planen", r"^neue reise$", r"neue reise")
    if neu:
        tap(neu, 2.0)
        xml = dump("fix-active")
    has_edit = "android.widget.EditText" in xml
    log(f"EditText={has_edit}")
    for n in nodes(xml):
        b = f"{n['text']} {n['desc']}".strip()
        if re.search(r"antwort|suche|mikrofon|tippen|planen|yorro|reise", b, re.I):
            log(f"rb: {b[:110]}")
    return 0 if has_edit else 1


if __name__ == "__main__":
    raise SystemExit(main())
