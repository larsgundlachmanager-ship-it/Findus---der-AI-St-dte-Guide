#!/usr/bin/env python3
"""Assume Reisebüro already open — type Männerwochenende brief, search, score."""
from __future__ import annotations

import importlib.util
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mw)


def main() -> int:
    mw.OUT.mkdir(parents=True, exist_ok=True)
    xml = mw.dump()
    if "android.widget.EditText" not in xml:
        mw.log("Reisebüro not open — run cold_open first")
        return 2
    mw.shot("before-chunks")
    mw.log("reise open — typing brief")
    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        mw.log(f"=== chunk {i}/{len(mw.BRIEF_CHUNKS)} ===")
        ok = mw.type_into_reisebuero(chunk)
        if not ok:
            time.sleep(2)
            ok = mw.type_into_reisebuero(chunk)
        mw.log(f"chunk {i} ok={ok}")
        mw.wait_thinking_idle(90)
        mw.shot(f"after-chunk-{i}")
        mw.extract(f"after-chunk-{i}", mw.dump())
        time.sleep(2.0)

    time.sleep(3.0)
    if not mw.tap_suche_starten(180):
        mw.type_into_reisebuero("Passt, Suche starten")
        time.sleep(4)
        mw.tap_suche_starten(90)

    xml, txt = mw.wait_results(540)
    scored = mw.score_results(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "package": mw.PKG,
        "open_path": "cold_then_brief",
        "ask_server": mw.ask_health(),
        "chunks": mw.BRIEF_CHUNKS,
        **scored,
        "artifacts": {
            "dir": str(mw.OUT),
            "final_png": str(mw.OUT / "final.png"),
            "final_xml": str(mw.OUT / "final.xml"),
            "final_text": str(mw.OUT / "final-text.txt"),
        },
    }
    mw.write_report(report)
    mw.log(f"VERDICT {report['verdict']} {report['score']}")
    mw.log(str(report.get("checks")))
    for n in report.get("soft_notes") or []:
        mw.log(f"note: {n}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
