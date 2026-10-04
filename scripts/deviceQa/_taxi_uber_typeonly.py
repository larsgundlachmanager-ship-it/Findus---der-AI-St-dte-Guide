#!/usr/bin/env python3
"""Uber live — TYPE ONLY (no Mic/STT). S7 has no speech recognition.

Flow: askServer → baggage via askServer → wait Flughafen-Transfer → tap chip → URL check.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
os.environ.setdefault("FINDUS_QA_SERIAL", "ce12171cccf9c0810c")
os.environ["FINDUS_QA_TYPE_ONLY"] = "1"

from _device_ids import require_qa_serial  # noqa: E402
from _type_only import ask_via_server, dismiss_speech_alert  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *a],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


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


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def quiet_ui() -> None:
    dismiss_speech_alert(dump, nodes, tap)
    xml = dump()
    for n in nodes(xml):
        blob = f"{n['text']} {n['desc']}".lower()
        if not n["click"]:
            continue
        if "karte schließen" in blob or blob.strip() in ("✕", "x"):
            tap(n["cx"], n["cy"])
            time.sleep(0.4)
            return


def ask(text: str) -> None:
    quiet_ui()
    print("TYPE-ASK", text[:80], flush=True)
    print("→", ask_via_server(text)[:80], flush=True)
    time.sleep(1.0)
    quiet_ui()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("TYPE_ONLY=1 serial=", require_qa_serial(), flush=True)
    print("state", (adb("get-state").stdout or "").strip(), flush=True)
    adb("reverse", "tcp:8791", "tcp:8791")
    quiet_ui()
    adb("logcat", "-c")

    ask(
        "Flug morgen 18 Uhr von Hamburg nach Wien, bitte Taxi zum Flughafen vorbestellen"
    )

    bag_sent = False
    for i in range(28):
        time.sleep(4)
        quiet_ui()
        xml = dump()
        if not xml:
            print("poll", i, "empty", flush=True)
            continue
        hits = [
            k
            for k in (
                "Handgepäck",
                "Aufgabegepäck",
                "Flughafen-Transfer",
                "Uber",
                "Taxi",
                "Wann fliegst",
            )
            if k in xml
        ]
        print("poll", i, hits, flush=True)
        # Never tap Handgepäck chip (can trip STT UI) — type the prompt
        if (not bag_sent) and ("Handgepäck" in hits or "Aufgabegepäck" in hits):
            ask("Nur Handgepaeck")
            bag_sent = True
            continue
        if any(k in hits for k in ("Flughafen-Transfer", "Uber", "Taxi")):
            for n in nodes(xml):
                blob = f"{n['text']} {n['desc']}".lower()
                if not n["click"]:
                    continue
                if "spracherkennung" in blob or "einstellungen öffnen" in blob:
                    continue
                if "flughafen-transfer" in blob or (
                    "uber" in blob and "mikrofon" not in blob
                ):
                    print("TAP", n["text"] or n["desc"], flush=True)
                    tap(n["cx"], n["cy"])
                    time.sleep(3)
                    quiet_ui()
                    break
            break

    log = adb("logcat", "-d", "-v", "brief").stdout or ""
    (OUT / "typeonly-log.txt").write_text(log, encoding="utf-8", errors="replace")
    xml = dump()
    (OUT / "typeonly.xml").write_text(xml, encoding="utf-8")
    try:
        shot = subprocess.check_output(
            [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
        )
        (OUT / "typeonly.png").write_bytes(shot)
    except Exception as e:
        print("shot fail", e, flush=True)

    uber = re.findall(r"https?://[^\s\"'<>]*uber[^\s\"'<>]*", log, re.I)
    intents = [
        ln
        for ln in log.splitlines()
        if re.search(r"uber|pickup_time|go/reserve|OPEN_URL|book_uber", ln, re.I)
    ]
    sched = any("pickup_time" in u or "/go/reserve" in u for u in uber) or any(
        "pickup_time" in ln or "/go/reserve" in ln for ln in intents
    )
    report = {
        "type_only": True,
        "scheduled": sched,
        "uber": uber[:8],
        "intents": intents[:15],
        "bag_sent": bag_sent,
    }
    (OUT / "typeonly-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(report, indent=2, ensure_ascii=False)[:1500], flush=True)
    print("PASS_SCHEDULED", sched, flush=True)
    return 0 if sched else 1


if __name__ == "__main__":
    raise SystemExit(main())
