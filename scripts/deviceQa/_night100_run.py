#!/usr/bin/env python3
"""
Night-100 Live-QA: Ask-Server → Handy → Capture → Score.
Usage:
  node scripts/deviceQa/askServer.mjs   # already running ok
  python scripts/deviceQa/_night100_run.py
  python scripts/deviceQa/_night100_run.py wetter steak wecker_930
  python scripts/deviceQa/_night100_run.py --from papst_alter
  python scripts/deviceQa/_night100_run.py --batch 0 --size 10
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "night100"
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

spec_q = importlib.util.spec_from_file_location("qa", ROOT / "scripts" / "deviceQa" / "_qa40_live.py")
qa = importlib.util.module_from_spec(spec_q)
spec_q.loader.exec_module(qa)

spec_b = importlib.util.spec_from_file_location("bank", ROOT / "scripts" / "deviceQa" / "_night100_bank.py")
bank = importlib.util.module_from_spec(spec_b)
spec_b.loader.exec_module(bank)

qa.OUT = OUT
qa.EXTRACT = ROOT / ".cursor" / "extract_ui.py"
SCENARIOS = bank.SCENARIOS


def parse_args(argv: list[str]):
    only = None
    from_id = None
    batch = None
    size = 10
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "--from" and i + 1 < len(argv):
            from_id = argv[i + 1]
            i += 2
            continue
        if argv[i] == "--batch" and i + 1 < len(argv):
            batch = int(argv[i + 1])
            i += 2
            continue
        if argv[i] == "--size" and i + 1 < len(argv):
            size = int(argv[i + 1])
            i += 2
            continue
        args.append(argv[i])
        i += 1
    if args:
        only = set(args)
    return only, from_id, batch, size


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    only, from_id, batch, size = parse_args(sys.argv[1:])

    if not qa.health():
        print("ERROR: askServer not on :8791")
        return 2

    qa.adb("reverse", f"tcp:{qa.PORT}", f"tcp:{qa.PORT}")
    qa.adb("reverse", "tcp:8081", "tcp:8081")

    scenarios = list(SCENARIOS)
    if batch is not None:
        start = batch * size
        scenarios = scenarios[start : start + size]
        print(f"BATCH {batch} size={len(scenarios)} start={start}", flush=True)

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": qa.adb("get-serialno").stdout.strip(),
        "apk": "2.0.71-dev",
        "n": len(scenarios),
        "results": [],
    }

    started = from_id is None
    for s in scenarios:
        if only and s["id"] not in only:
            continue
        if from_id and not started:
            if s["id"] == from_id:
                started = True
            else:
                continue
        print(f"\n=== {s['id']} ===", flush=True)
        print("Q:", s["q"], flush=True)
        is_fu = ("_fu_" in s["id"]) or s["id"].endswith("_fu") or s.get("chain")
        if s.get("reset_before") or not is_fu:
            qa.reset_app()
        else:
            qa.dismiss()
            time.sleep(0.8)

        txt, logs = qa.ask_and_capture(s["id"], s["q"], float(s.get("wait", 32)))
        if not txt or len(txt.strip()) < 40:
            # retry once with longer wait
            time.sleep(8)
            xml = qa.dump()
            qa.shot(f"{s['id']}-retry")
            txt2 = qa.extract(f"{s['id']}-retry", xml)
            if len((txt2 or "").strip()) > len((txt or "").strip()):
                txt = txt2

        # Ambient-only = fail
        if txt and not re.search(
            r"(spickzettel|•|•|alternativen|reiseb|wann flieg|route|bahnhof|"
            r"hotel|essen|programm|ticket|wetter|grad|option|cineplex|"
            r"stay|maps|anrufen|wecker|gestellt|papst|meter|euro|uhr)",
            txt,
            re.I,
        ):
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": "FAIL",
                "error": "NO_SPICKZETTEL",
                "snippet": (txt or "")[:220],
                "fails": ["no_spickzettel"],
                "attempt": 1,
            }
        elif not txt:
            row = {
                "id": s["id"],
                "q": s["q"],
                "family": s.get("family"),
                "verdict": "FAIL",
                "error": "NO_MODAL",
                "snippet": "",
                "fails": ["no_capture"],
                "attempt": 1,
            }
        else:
            sc = qa.score(txt, s.get("checks") or {})
            low = txt.lower()
            fails = list(sc.get("fails") or [])
            if "tippfeld" in low and "frage an yorro" in low and "spickzettel" not in low:
                fails.append("tippfeld_stuck")
                sc["verdict"] = "FAIL"
            # Truncated bullets / garbage
            if re.search(r"emoji\s*\d+|wecker emoji|\b39\b.*wecker", low):
                fails.append("garbage_bullet")
                sc["verdict"] = "FAIL"
            if re.search(r"erinnere mich um", low) and s.get("family") == "wake":
                fails.append("wake_reminder_dup")
                sc["verdict"] = "FAIL"
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
                "fails": fails,
                "snippet": sc.get("snippet"),
                "log_hits": (logs or "")[:500],
                "attempt": 1,
            }

        report["results"].append(row)
        print(row["verdict"], row.get("fails"), (row.get("snippet") or "")[:160], flush=True)

        # Persist incrementally
        (OUT / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    passed = sum(1 for r in report["results"] if r["verdict"] == "PASS")
    failed = [r["id"] for r in report["results"] if r["verdict"] != "PASS"]
    summary = {
        "pass": passed,
        "fail": len(failed),
        "failed_ids": failed,
        "at": report["at"],
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\nSUMMARY", summary, flush=True)
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
