#!/usr/bin/env python3
"""
Männerwochenende on S7 QA device — TYPE ONLY (ask server / UI), no speech/mic.
Serial: ce12171cccf9c0810c
"""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Force QA = S7 (explicit override of require_qa_serial)
S7 = "ce12171cccf9c0810c"
os.environ["FINDUS_QA_SERIAL"] = S7
os.environ["ANDROID_SERIAL"] = S7

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende-s7"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
# Patch OUT before exec so dumps go to s7 folder
spec.loader.exec_module(mw)
mw.OUT = OUT
mw.EXPECTED_SERIAL = S7


def log(msg: str) -> None:
    mw.log(msg)


def ask(text: str) -> None:
    data = text.encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=data,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        r.read()
    log(f"ASK: {text[:100]}")


def swipe_tap(x: int, y: int, ms: int = 120) -> None:
    mw.adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(0.35)


def open_settings_reise() -> bool:
    """Dock Einstellungen → Yorros Reisebüro → Neue Reise (type-only path)."""
    xml = mw.dump()
    # already active?
    if "android.widget.EditText" in xml or re.search(
        r"antwort tippen|akt 1", mw.ui_blob(xml), re.I
    ):
        log("already in reise")
        return True

    # find Einstellungen by short desc
    s = None
    for n in mw.nodes(xml):
        if not n["click"]:
            continue
        if n["desc"].strip().lower() == "einstellungen" or n["text"].strip().lower() in (
            "einst.",
            "einstellungen",
        ):
            if s is None or n["cy"] > s["cy"]:
                s = n
    if not s:
        log("no settings dock")
        mw.shot("s7-no-settings")
        return False
    y = max(40, s["cy"] - 25)
    for attempt in range(4):
        swipe_tap(s["cx"], y, 160)
        time.sleep(1.8)
        xml = mw.dump()
        b = mw.ui_blob(xml).lower()
        if re.search(r"stadtauswahl|aktuelle reise|yorros?\s*reise|pers[oö]nliche", b):
            log(f"settings open try={attempt}")
            break
        log(f"settings try {attempt} fail")
    else:
        mw.shot("s7-settings-fail")
        return False

    mw.shot("s7-settings")
    found = None
    for i in range(6):
        for n in mw.nodes(xml):
            blob = f"{n['text']} {n['desc']}"
            if re.search(r"yorros?\s*reiseb|reiseb[uü]ro", blob, re.I) and n["click"]:
                found = n
                break
        if found:
            break
        mw.adb("shell", "input", "swipe", "540", "1500", "540", "500", "350")
        time.sleep(0.8)
        xml = mw.dump()
    if not found:
        log("reise row missing")
        mw.shot("s7-no-reise-row")
        return False
    swipe_tap(found["cx"], found["cy"], 140)
    time.sleep(2.0)
    xml = mw.dump()
    neu = mw.find_click(xml, r"neue reise planen", r"^neue reise$", r"neue reise")
    if neu:
        swipe_tap(neu["cx"], neu["cy"], 140)
        time.sleep(2.0)
        xml = mw.dump()
    ok = "android.widget.EditText" in xml or bool(
        re.search(r"antwort tippen|akt 1", mw.ui_blob(xml), re.I)
    )
    mw.shot("s7-reise-open")
    log(f"reise open={ok}")
    return ok


def wait_stickers(timeout: float = 50) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        xml = mw.dump()
        b = mw.ui_blob(xml).lower()
        if "noch nichts angepinnt" in b and "brief 0%" in b:
            time.sleep(2)
            continue
        if re.search(r"brief\s*[1-9]\d*%|personen|budget|wochenende|€|euro|pool|party", b):
            return True
        time.sleep(2)
    return False


def main() -> int:
    log(f"serial={mw.serial()} (expect {S7})")
    if mw.serial() != S7:
        log("WRONG DEVICE")
        return 9
    mw.ensure_reverse()
    # launch
    mw.adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1.5)
    mw.adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(8)
    mw.wait_app_ready(60)

    if not open_settings_reise():
        # deep link fallback (type path, no mic)
        mw.adb(
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            "findus://reisebuero",
        )
        time.sleep(5)
        xml = mw.dump()
        if "android.widget.EditText" not in xml:
            neu = mw.find_click(xml, r"neue reise")
            if neu:
                swipe_tap(neu["cx"], neu["cy"], 140)
                time.sleep(2)
        if "android.widget.EditText" not in mw.dump():
            log("FAIL open reise")
            return 2

    mw.shot("s7-before-chunks")
    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        ask(chunk)
        # poller ~0.9s + briefing reply TTS — wait for stickers after first
        time.sleep(10 if i == 1 else 7)
        mw.shot(f"s7-chunk-{i}")
        mw.extract(f"s7-chunk-{i}", mw.dump())
        sample = mw.ui_blob(mw.dump())[:280].replace("\n", " | ")
        log(f"chunk{i} ui: {sample}")

    if not wait_stickers(40):
        log("WARN flipchart still thin")

    ask("Passt so, Suche starten")
    time.sleep(6)
    mw.tap_suche_starten(120)

    xml, txt = mw.wait_results(600)
    scored = mw.score_results(txt, xml)
    # try open first option for magazine
    opt = mw.find_click(xml, r"plan öffnen|option|cover|magazin|€", require_click=True)
    if opt:
        swipe_tap(opt["cx"], opt["cy"], 140)
        time.sleep(3)
        xml = mw.dump()
        txt = mw.extract("s7-magazine", xml)
        mw.shot("s7-magazine")
        scored2 = mw.score_results(txt, xml)
        # merge: keep hard checks from best
        for k, v in scored2["checks"].items():
            if v:
                scored["checks"][k] = True
        scored["score"] = f"{sum(1 for v in scored['checks'].values() if v)}/8"
        hard = (
            scored["checks"].get("stay_price_visible")
            and scored["checks"].get("no_ehrlich_als_gap")
            and scored["checks"].get("beats_readable")
            and scored["checks"].get("outbound_visible")
            and scored["checks"].get("transfer_or_rental_visible")
        )
        scored["verdict"] = "PASS" if hard else "FAIL"
        scored["snippet"] = scored2.get("snippet") or scored.get("snippet")

    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "device": "S7",
        "mode": "type_only_ask",
        "chunks": mw.BRIEF_CHUNKS,
        **scored,
    }
    # write into OUT
    (OUT / "report.json").write_text(
        __import__("json").dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    mw.OUT = OUT
    mw.write_report(report)
    log(f"VERDICT {report['verdict']} {report['score']}")
    log(str(report.get("checks")))
    for n in report.get("soft_notes") or []:
        log(f"note: {n}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
