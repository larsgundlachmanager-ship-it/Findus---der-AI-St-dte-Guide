#!/usr/bin/env python3
"""Full 3-week + qa40 live suite via Tippfeld (reliable on device)."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live13"
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

# Load tippfeld helpers from three_week marathon
spec = importlib.util.spec_from_file_location(
    "tw", ROOT / "scripts" / "deviceQa" / "_three_week_marathon.py"
)
tw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tw)

# Load qa40 scenarios
spec2 = importlib.util.spec_from_file_location(
    "qa", ROOT / "scripts" / "deviceQa" / "_qa40_live.py"
)
qa = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(qa)

# qa40 is SSOT for order (steak→steak_fu, hotel→hotel_fu, …). Merge tw-only extras after.
by_id = {s["id"]: s for s in tw.SCENARIOS}
for s in qa.SCENARIOS:
    by_id[s["id"]] = s
seen = set()
SCENARIOS = []
for s in qa.SCENARIOS:
    SCENARIOS.append(by_id[s["id"]])
    seen.add(s["id"])
for s in tw.SCENARIOS:
    if s["id"] not in seen:
        SCENARIOS.append(by_id[s["id"]])
        seen.add(s["id"])

# Redirect marathon OUT
tw.OUT = OUT
tw.XML = OUT / "ui.xml"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    from_id = None
    args = []
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == "--from" and i + 1 < len(sys.argv):
            from_id = sys.argv[i + 1]
            i += 2
            continue
        args.append(sys.argv[i])
        i += 1
    if args:
        only = set(args)

    tw.adb("reverse", "tcp:8791", "tcp:8791")
    tw.reset_app()

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": tw.adb("get-serialno").stdout.strip(),
        "apk": "2.0.26+fixes",
        "results": [],
    }

    # Longer waits help slow Call-2; do NOT force reset on follow-ups (_fu_) —
    # those need prior turn context (hotel pool, leave-by, Spider-Man, …).
    for s in SCENARIOS:
        s["wait"] = max(float(s.get("wait") or 32), 38.0)

    started = from_id is None
    for s in SCENARIOS:
        if only and s["id"] not in only:
            continue
        if from_id and not started:
            if s["id"] == from_id:
                started = True
            else:
                continue
        print(f"\n=== {s['id']} ===", flush=True)
        print("Q:", s["q"], flush=True)
        if s.get("reset_before"):
            tw.reset_app()
        else:
            tw.dismiss()
            time.sleep(0.8)
        txt = tw.ask(s["id"], s["q"], float(s.get("wait", 38)))
        # Ambient-only home = no Spickzettel → hard FAIL (auto-PASS was lying).
        if txt and not re.search(
            r"(spickzettel|•|alternativen|reiseb[uü]ro|wann flieg|route|bahnhof|"
            r"hotel|essen|programm|ticket|wetter in|grad|zwei option|"
            r"cineplex|stay|maps|anrufen|notdienst|konsulat|apotheke)",
            txt,
            re.I,
        ):
            row = {
                "id": s["id"],
                "q": s["q"],
                "verdict": "FAIL",
                "error": "NO_SPICKZETTEL",
                "bridge_ok": False,
                "call2_ok": False,
                "bullets_ok": False,
                "buttons_ok": False,
                "integration_ok": False,
                "snippet": txt[:220],
                "fails": ["no_spickzettel"],
            }
            report["results"].append(row)
            print("FAIL", ["no_spickzettel"], (txt[:160]).encode("ascii", "replace").decode("ascii"), flush=True)
            continue
        if not txt:
            row = {
                "id": s["id"],
                "q": s["q"],
                "verdict": "FAIL",
                "error": "NO_MODAL",
                "bridge_ok": False,
                "call2_ok": False,
                "bullets_ok": False,
                "buttons_ok": False,
                "integration_ok": False,
                "snippet": "",
            }
        else:
            sc = tw.score(txt, s.get("checks") or {})
            # Extra content fails
            low = txt.lower()
            content_fails = list(sc.get("fails") or [])
            if "tippfeld_stuck" in low or "frage an yorro" in low:
                content_fails.append("tippfeld_stuck")
                sc["verdict"] = "FAIL"
                sc["call2_ok"] = False
            if re.search(r"wetter in sechzehn|keine live-wetterdaten", low):
                content_fails.append("weather_bug")
                sc["verdict"] = "FAIL"
            if s["id"] == "hotel_pool" and re.search(r"von wo aus reist", low):
                content_fails.append("hotel_reisebuero")
                sc["verdict"] = "FAIL"
            if s["id"] == "wetter" and re.search(
                r"goldschätzchen|goldschaetzchen|bier-?\s*und\s*weingarten", low
            ):
                content_fails.append("weather_pollution")
                sc["verdict"] = "FAIL"
            sc["fails"] = content_fails
            row = {"id": s["id"], "q": s["q"], "family": s.get("family"), **sc}
        report["results"].append(row)
        snip = (row.get("snippet") or "")[:160].encode("ascii", "replace").decode("ascii")
        print(row["verdict"], row.get("fails"), snip, flush=True)

    passed = sum(1 for r in report["results"] if r["verdict"] == "PASS")
    total = len(report["results"])
    report["summary"] = {"pass": passed, "total": total, "rate": passed / total if total else 0}
    out_json = OUT / "full-3week-report.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    md = [
        f"# Full 3-Wochen Live-QA — {report['at'][:19]}Z",
        "",
        f"**Gerät:** `{report['device']}` · **Ergebnis:** {passed}/{total} PASS",
        "",
        "| ID | Verdict | Call2 | Buttons | Hinweis |",
        "|----|---------|-------|---------|---------|",
    ]
    for r in report["results"]:
        btn = r.get("buttons_ok")
        btn_s = "—" if btn is None else ("OK" if btn else "NO")
        hint = ",".join(r.get("fails") or []) or r.get("error") or ""
        md.append(
            f"| {r['id']} | {r['verdict']} | "
            f"{'OK' if r.get('call2_ok') else 'NO'} | {btn_s} | {hint} |"
        )
    md.append("")
    md.append("Captures: `.cursor/live13/`")
    md_path = ROOT / "data" / "liveQuality" / "full-3week-live-report.md"
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\nReport →", out_json)
    print("Markdown →", md_path)
    print(f"PASS {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
