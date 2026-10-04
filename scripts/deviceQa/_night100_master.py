#!/usr/bin/env python3
"""Run remaining night100 batches sequentially, append master report."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "night100"
MASTER = OUT / "master_report.json"
PY = sys.executable
RUN = ROOT / "scripts" / "deviceQa" / "_night100_run.py"


def load_master() -> dict:
    if MASTER.exists():
        return json.loads(MASTER.read_text(encoding="utf-8"))
    return {"runs": [], "by_id": {}}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    master = load_master()
    # batches 0..7 cover ~80
    for b in range(0, 8):
        print(f"\n######## MASTER BATCH {b} ########", flush=True)
        r = subprocess.run(
            [PY, str(RUN), "--batch", str(b), "--size", "10"],
            cwd=str(ROOT),
        )
        summary_path = OUT / "summary.json"
        report_path = OUT / "report.json"
        summary = (
            json.loads(summary_path.read_text(encoding="utf-8"))
            if summary_path.exists()
            else {}
        )
        report = (
            json.loads(report_path.read_text(encoding="utf-8"))
            if report_path.exists()
            else {}
        )
        master["runs"].append(
            {
                "batch": b,
                "at": datetime.now(timezone.utc).isoformat(),
                "exit": r.returncode,
                "summary": summary,
            }
        )
        for row in report.get("results") or []:
            rid = row.get("id")
            if not rid:
                continue
            prev = master["by_id"].get(rid, {"attempts": []})
            prev["attempts"].append(
                {
                    "at": datetime.now(timezone.utc).isoformat(),
                    "verdict": row.get("verdict"),
                    "fails": row.get("fails"),
                    "snippet": (row.get("snippet") or "")[:300],
                }
            )
            prev["latest"] = row.get("verdict")
            master["by_id"][rid] = prev
        MASTER.write_text(json.dumps(master, ensure_ascii=False, indent=2), encoding="utf-8")
        # also write human status
        passed = sum(1 for v in master["by_id"].values() if v.get("latest") == "PASS")
        failed = [k for k, v in master["by_id"].items() if v.get("latest") != "PASS"]
        status = {
            "pass": passed,
            "fail": len(failed),
            "failed_ids": failed,
            "total_tracked": len(master["by_id"]),
        }
        (OUT / "master_status.json").write_text(
            json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("MASTER STATUS", status, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
