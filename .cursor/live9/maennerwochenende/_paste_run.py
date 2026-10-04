#!/usr/bin/env python3
"""Cold open + paste brief (clipboard) + search — Männerwochenende on Nothing."""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende"
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mw)


def cold_open() -> bool:
    r = subprocess.run(
        [sys.executable, str(OUT / "_cold_open.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    mw.log((r.stdout or "")[-400:])
    if r.returncode != 0:
        mw.log(f"cold_open fail rc={r.returncode} {(r.stderr or '')[:200]}")
        return False
    xml = mw.dump()
    return "android.widget.EditText" in xml


def brief_has_stickers(xml: str) -> bool:
    b = mw.ui_blob(xml).lower()
    if "noch nichts angepinnt" in b and "brief 0%" in b:
        return False
    return bool(
        re.search(
            r"brief\s*[1-9]\d*%|sticker|muss|wunsch|personen|budget|wochenende|oktober|€|euro",
            b,
        )
    )


def main() -> int:
    mw.OUT.mkdir(parents=True, exist_ok=True)
    if not cold_open():
        return 2
    mw.shot("paste-before")
    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        mw.log(f"=== chunk {i}/{len(mw.BRIEF_CHUNKS)} ===")
        ok = mw.type_into_reisebuero(chunk)
        mw.log(f"chunk {i} typed={ok}")
        # wait for stickers / score bump
        deadline = time.time() + 45
        while time.time() < deadline:
            xml = mw.dump()
            b = mw.ui_blob(xml).lower()
            if "busy" in b or "activityindicator" in xml.lower():
                time.sleep(1.5)
                continue
            # after first chunk expect stickers
            if i == 1 and brief_has_stickers(xml):
                break
            if i > 1:
                time.sleep(2.5)
                break
            time.sleep(1.5)
        mw.shot(f"paste-chunk-{i}")
        mw.extract(f"paste-chunk-{i}", mw.dump())
        xml = mw.dump()
        mw.log("brief sample: " + mw.ui_blob(xml)[:220].replace("\n", " | "))

    xml = mw.dump()
    if "noch nichts angepinnt" in mw.ui_blob(xml).lower():
        mw.log("FAIL: flipchart still empty after paste chunks")
        mw.shot("paste-empty-fail")
        return 3

    time.sleep(2)
    if not mw.tap_suche_starten(120):
        mw.type_into_reisebuero("Passt, Suche starten")
        time.sleep(3)
        mw.tap_suche_starten(60)

    # Research can take minutes — poll with screencap + short dump timeout feel
    xml, txt = mw.wait_results(600)
    scored = mw.score_results(txt, xml)
    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "open_path": "cold+clipboard",
        "chunks": mw.BRIEF_CHUNKS,
        **scored,
    }
    mw.write_report(report)
    mw.log(f"VERDICT {report['verdict']} {report['score']}")
    mw.log(str(report.get("checks")))
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
