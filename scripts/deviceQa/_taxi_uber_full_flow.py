#!/usr/bin/env python3
"""Full taxi-before-flight live: ask → baggage via ask → wait transfer → tap → URL check."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
os.environ.setdefault("FINDUS_QA_SERIAL", "ce12171cccf9c0810c")
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"
PKG = "de.findus.app"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def ask(text: str) -> None:
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=text.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        print("ask:", text[:80], "→", r.read().decode()[:80], flush=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/data/local/tmp/ui.xml")
    return adb("shell", "cat", "/data/local/tmp/ui.xml").stdout or ""


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        t = re.search(r'text="([^"]*)"', n)
        d = re.search(r'content-desc="([^"]*)"', n)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not b:
            continue
        x1, y1, x2, y2 = map(int, b.groups())
        yield {
            "text": t.group(1) if t else "",
            "desc": d.group(1) if d else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def dismiss_noise() -> None:
    for _ in range(3):
        xml = dump()
        for n in nodes(xml):
            blob = (n["text"] + " " + n["desc"]).lower()
            if n["click"] and (
                blob.strip() == "später"
                or "karte schließen" in blob
                or blob.strip() in ("✕", "x")
            ):
                adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
                time.sleep(0.6)
                break
        else:
            break


def tap_chip(*needles: str) -> bool:
    xml = dump()
    for n in nodes(xml):
        if not n["click"]:
            continue
        blob = (n["text"] + " " + n["desc"]).lower()
        if "spracherkennung" in blob or "einstellungen öffnen" in blob:
            continue
        if any(x.lower() in blob for x in needles):
            print("TAP", n["text"] or n["desc"], flush=True)
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(2.0)
            return True
    return False


def harvest() -> dict:
    log = adb("logcat", "-d", "-v", "brief").stdout or ""
    urls = re.findall(r"https?://[^\s\"'<>]+", log)
    uber = [u for u in urls if "uber" in u.lower()]
    intents = [
        ln
        for ln in log.splitlines()
        if re.search(r"uber|pickup_time|go/reserve|OPEN_URL|book_uber|Flughafen", ln, re.I)
    ]
    return {"uber": uber[:10], "intents": intents[:25], "log": log}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1)
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(12)
    dismiss_noise()
    adb("logcat", "-c")

    ask(
        "Mein Flug morgen nach Wien geht um 18 Uhr von Hamburg, "
        "bitte Taxi zum Flughafen vorbestellen"
    )
    # wait for baggage or transfer
    for i in range(16):
        time.sleep(4)
        dismiss_noise()
        xml = dump()
        hits = [
            k
            for k in (
                "Aufgabegepäck",
                "Handgepäck",
                "Flughafen-Transfer",
                "Uber",
                "Taxi",
                "Wann fliegst",
            )
            if k in xml
        ]
        print(f"pollA[{i}] {hits}", flush=True)
        if "Handgepäck" in hits or "Aufgabegepäck" in hits:
            break
        if "Flughafen-Transfer" in hits or "Uber" in hits:
            break

    # continue baggage via ask (reliable vs UI speech dialog)
    ask("Nur Handgepäck")
    for i in range(20):
        time.sleep(4)
        dismiss_noise()
        xml = dump()
        hits = [
            k
            for k in ("Flughafen-Transfer", "Uber", "Taxi", "Los ", "vorbestellen")
            if k in xml
        ]
        print(f"pollB[{i}] {hits}", flush=True)
        if hits:
            break

    xml = dump()
    (OUT / "full-flow.xml").write_text(xml, encoding="utf-8")
    texts = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            if s and len(s) > 1 and s not in texts:
                texts.append(s)
    (OUT / "full-flow-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    data = subprocess.check_output(
        [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
    )
    (OUT / "full-flow.png").write_bytes(data)
    print("--- UI ---", flush=True)
    print("\n".join(texts[:40]), flush=True)

    adb("logcat", "-c")
    tapped = tap_chip("Flughafen-Transfer", "Uber", "Taxi ·", "Fahrt mit Uber", "Partnerlink")
    time.sleep(3)
    h = harvest()
    (OUT / "full-flow-log.txt").write_text(h["log"], encoding="utf-8", errors="replace")
    print("--- UBER ---", flush=True)
    for u in h["uber"]:
        print(u[:220], flush=True)
    print("--- INTENT HITS ---", flush=True)
    for ln in h["intents"][:15]:
        print(ln[:220], flush=True)

    scheduled = any(
        "pickup_time" in u or "/go/reserve" in u for u in h["uber"]
    ) or any("pickup_time" in ln or "/go/reserve" in ln for ln in h["intents"])
    ui_transfer = any(
        re.search(r"Flughafen-Transfer|Uber|Taxi", t, re.I) for t in texts
    )
    print(
        f"tapped={tapped} scheduled_uber={scheduled} ui_transfer={ui_transfer}",
        flush=True,
    )
    # return home
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.5)
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")

    report = {
        "tapped": tapped,
        "scheduled_uber": scheduled,
        "ui_transfer": ui_transfer,
        "uber_urls": h["uber"][:5],
    }
    (OUT / "full-flow-report.json").write_text(
        __import__("json").dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return 0 if scheduled or (tapped and ui_transfer) else 1


if __name__ == "__main__":
    raise SystemExit(main())
