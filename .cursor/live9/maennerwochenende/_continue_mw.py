#!/usr/bin/env python3
"""Continue Männerwochenende test: ensure Reisebüro open, type brief, search, score."""
from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

# Load the live module
spec = importlib.util.spec_from_file_location(
    "mw", ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
)
mw = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mw)


def ensure_open() -> bool:
    xml = mw.dump()
    if "android.widget.EditText" in xml or mw.find_click(
        xml, r"antwort tippen", r"suche starten", require_click=False
    ):
        mw.log("already in reisebuero")
        return True
    # use open_rb2 path inline
    from pathlib import Path as P

    helper = P(r"c:\Users\larsf\Findus 2.0\.cursor\live9\maennerwochenende\_open_rb2.py")
    import subprocess

    r = subprocess.run([sys.executable, str(helper)], cwd=str(ROOT))
    xml = mw.dump()
    return "android.widget.EditText" in xml or bool(
        mw.find_click(xml, r"antwort tippen", r"suche starten", require_click=False)
    )


def main() -> int:
    mw.OUT.mkdir(parents=True, exist_ok=True)
    mw.ensure_reverse()
    mw.log(f"serial={mw.serial()}")
    if not ensure_open():
        mw.log("FAIL open")
        return 2
    mw.shot("before-chunks")
    for i, chunk in enumerate(mw.BRIEF_CHUNKS, 1):
        mw.log(f"=== chunk {i}/{len(mw.BRIEF_CHUNKS)} ===")
        ok = mw.type_into_reisebuero(chunk)
        if not ok:
            time.sleep(2)
            ok = mw.type_into_reisebuero(chunk)
        mw.log(f"chunk {i} ok={ok}")
        mw.wait_thinking_idle(75)
        mw.shot(f"after-chunk-{i}")
        mw.extract(f"after-chunk-{i}", mw.dump())
        time.sleep(2.0)

    time.sleep(3.0)
    if not mw.tap_suche_starten(150):
        mw.type_into_reisebuero("Passt, Suche starten")
        time.sleep(4)
        mw.tap_suche_starten(60)

    xml, txt = mw.wait_results(480)
    scored = mw.score_results(txt, xml)
    from datetime import datetime, timezone
    import json

    report = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "serial": mw.serial(),
        "package": mw.PKG,
        "open_path": "ensure_open",
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
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
