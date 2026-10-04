#!/usr/bin/env python3
"""Continue from Reisebüro hub on S7: Neue Reise → Ask chunks → search."""
from __future__ import annotations

import importlib.util
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

S7 = "ce12171cccf9c0810c"
os.environ["FINDUS_QA_SERIAL"] = S7
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende-s7"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mw)
mw.OUT = OUT


def log(m: str) -> None:
    mw.log(m)


def ask(text: str) -> None:
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=text.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        r.read()
    log(f"ASK: {text[:100]}")


def swipe_tap(x, y, ms=140):
    mw.adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    time.sleep(0.4)


def ensure_active() -> bool:
    xml = mw.dump()
    if "android.widget.EditText" in xml:
        return True
    # hub: Neue Reise
    for n in mw.nodes(xml):
        blob = f"{n['text']} {n['desc']}"
        if re.search(r"neue reise", blob, re.I) and n["click"]:
            log(f"tap neue reise @ {n['cx']},{n['cy']} :: {blob[:60]}")
            swipe_tap(n["cx"], n["cy"], 160)
            time.sleep(2.5)
            xml = mw.dump()
            mw.shot("s7-after-neue")
            break
    return "android.widget.EditText" in xml or bool(
        re.search(r"antwort tippen|akt 1", mw.ui_blob(xml), re.I)
    )


def main() -> int:
    mw.ensure_reverse()
    log(f"serial={mw.serial()}")
    if not ensure_active():
        log("FAIL no active briefing")
        mw.shot("s7-no-active")
        (OUT / "fail-texts.txt").write_text(mw.ui_blob(mw.dump()), encoding="utf-8")
        return 2
    mw.shot("s7-active")
    log("active ok — typing brief via ask (no mic)")

    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        ask(chunk)
        time.sleep(12 if i == 1 else 8)
        mw.shot(f"s7-chunk-{i}")
        mw.extract(f"s7-chunk-{i}", mw.dump())
        log("ui: " + mw.ui_blob(mw.dump())[:260].replace("\n", " | "))

    ask("Passt so, Suche starten")
    time.sleep(6)
    if not mw.tap_suche_starten(150):
        ask("Suche starten")
        time.sleep(4)
        mw.tap_suche_starten(60)

    xml, txt = mw.wait_results(600)
    scored = mw.score_results(txt, xml)

    # open first option if cards visible
    for n in mw.nodes(xml):
        if not n["click"]:
            continue
        blob = f"{n['text']} {n['desc']}".lower()
        if re.search(r"plan öffnen|€|eur|option|all.?inclusive|apartment|resort", blob):
            swipe_tap(n["cx"], n["cy"], 140)
            time.sleep(3)
            xml = mw.dump()
            txt = mw.extract("s7-magazine", xml)
            mw.shot("s7-magazine")
            scored2 = mw.score_results(txt, xml)
            for k, v in scored2["checks"].items():
                if v:
                    scored["checks"][k] = True
            scored["snippet"] = scored2.get("snippet") or scored.get("snippet")
            break

    hard = all(
        scored["checks"].get(k)
        for k in (
            "stay_price_visible",
            "no_ehrlich_als_gap",
            "beats_readable",
            "outbound_visible",
            "transfer_or_rental_visible",
        )
    )
    scored["verdict"] = "PASS" if hard else "FAIL"
    scored["score"] = f"{sum(1 for v in scored['checks'].values() if v)}/8"
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "device": "S7",
        "mode": "type_only_ask",
        "chunks": mw.BRIEF_CHUNKS,
        **scored,
    }
    mw.write_report(report)
    log(f"VERDICT {report['verdict']} {report['score']}")
    log(str(report["checks"]))
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
