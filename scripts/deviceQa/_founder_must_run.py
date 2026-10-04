#!/usr/bin/env python3
"""Run founder-must Live-QA on device."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "night100" / "founder_must"
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec_q = importlib.util.spec_from_file_location("qa", ROOT / "scripts" / "deviceQa" / "_qa40_live.py")
qa = importlib.util.module_from_spec(spec_q)
spec_q.loader.exec_module(qa)

spec_b = importlib.util.spec_from_file_location(
    "bank", ROOT / "scripts" / "deviceQa" / "_founder_must_bank.py"
)
bank = importlib.util.module_from_spec(spec_b)
spec_b.loader.exec_module(bank)

qa.OUT = OUT
qa.EXTRACT = ROOT / ".cursor" / "extract_ui.py"
SCENARIOS = bank.SCENARIOS


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None

    if not qa.health():
        print("ERROR: askServer not on :8791")
        return 2

    qa.adb("reverse", f"tcp:{qa.PORT}", f"tcp:{qa.PORT}")
    qa.adb("reverse", "tcp:8081", "tcp:8081")

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": qa.adb("get-serialno").stdout.strip(),
        "label": "founder_must",
        "results": [],
    }

    for s in SCENARIOS:
        if only and s["id"] not in only:
            continue
        print(f"\n=== {s['id']} ===", flush=True)
        print("Q:", s["q"], flush=True)
        is_fu = ("_fu_" in s["id"]) or s["id"].endswith("_fu")
        if s.get("reset_before") or not is_fu:
            qa.reset_app()
        else:
            qa.dismiss()
            time.sleep(0.8)

        txt, logs = qa.ask_and_capture(s["id"], s["q"], float(s.get("wait", 34)))
        if not txt or len(txt.strip()) < 40:
            time.sleep(8)
            xml = qa.dump()
            qa.shot(f"{s['id']}-retry")
            txt2 = qa.extract(f"{s['id']}-retry", xml)
            if len((txt2 or "").strip()) > len((txt or "").strip()):
                txt = txt2

        if not txt:
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": "FAIL",
                "error": "NO_CAPTURE",
                "fails": ["no_capture"],
                "snippet": "",
            }
        else:
            sc = qa.score(txt, s.get("checks") or {})
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": sc["verdict"],
                "bridge_ok": sc.get("bridge_ok"),
                "call2_ok": sc.get("call2_ok"),
                "bullets_ok": sc.get("bullets_ok"),
                "buttons_ok": sc.get("buttons_ok"),
                "buttons_found": sc.get("buttons_found"),
                "fails": sc.get("fails") or [],
                "snippet": sc.get("snippet"),
                "log_hits": (logs or "")[:400],
            }
        report["results"].append(row)
        print(row["verdict"], row.get("fails"), (row.get("snippet") or "")[:180], flush=True)
        (OUT / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    failed = [r["id"] for r in report["results"] if r["verdict"] != "PASS"]
    summary = {
        "pass": sum(1 for r in report["results"] if r["verdict"] == "PASS"),
        "fail": len(failed),
        "failed_ids": failed,
        "at": report["at"],
        "n": len(report["results"]),
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\nSUMMARY", summary, flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
