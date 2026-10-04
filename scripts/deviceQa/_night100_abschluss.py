#!/usr/bin/env python3
"""
Night100 Abschluss-Lauf:
- Alle Szenarien (night100 + founder_must, dedupe)
- Pro Frage bis zu 4 Versuche (App-Reset, Retest)
- Schreibt laufend master_status.json
- Am Ende ABSCHLUSSBERICHT.md + master_report.json

Usage:
  python scripts/deviceQa/_night100_abschluss.py
  python scripts/deviceQa/_night100_abschluss.py --only wetter steak
  python scripts/deviceQa/_night100_abschluss.py --max-attempts 4
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

spec_n = importlib.util.spec_from_file_location("n100", ROOT / "scripts" / "deviceQa" / "_night100_bank.py")
n100 = importlib.util.module_from_spec(spec_n)
spec_n.loader.exec_module(n100)

spec_f = importlib.util.spec_from_file_location("fmust", ROOT / "scripts" / "deviceQa" / "_founder_must_bank.py")
fmust = importlib.util.module_from_spec(spec_f)
spec_f.loader.exec_module(fmust)

qa.OUT = OUT
qa.EXTRACT = ROOT / ".cursor" / "extract_ui.py"


def merge_scenarios() -> list[dict]:
    by_id: dict[str, dict] = {}
    for s in n100.SCENARIOS:
        by_id[s["id"]] = s
    for s in fmust.SCENARIOS:
        by_id[s["id"]] = s  # founder overrides if same id
    # Stable: night100 order first, then founder-only
    out: list[dict] = []
    seen = set()
    for s in n100.SCENARIOS:
        out.append(by_id[s["id"]])
        seen.add(s["id"])
    for s in fmust.SCENARIOS:
        if s["id"] not in seen:
            out.append(by_id[s["id"]])
            seen.add(s["id"])
    return out


def write_status(master: dict) -> None:
    passed = [k for k, v in master["by_id"].items() if v.get("final") == "PASS"]
    failed = [k for k, v in master["by_id"].items() if v.get("final") == "FAIL"]
    pending = [k for k, v in master["by_id"].items() if v.get("final") == "PENDING"]
    status = {
        "at": datetime.now(timezone.utc).isoformat(),
        "pass": len(passed),
        "fail": len(failed),
        "pending": len(pending),
        "total": len(master["by_id"]),
        "failed_ids": failed,
        "pass_ids": passed,
        "max_attempts": master.get("max_attempts", 4),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "master_status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "master_report.json").write_text(
        json.dumps(master, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def write_abschluss(master: dict) -> None:
    lines = [
        "# Night100 Abschlussbericht",
        "",
        f"- Zeit (UTC): {datetime.now(timezone.utc).isoformat()}",
        f"- Gerät: {master.get('device')}",
        f"- Szenarien: {len(master['by_id'])}",
        f"- Max. Versuche: {master.get('max_attempts', 4)}",
        "",
    ]
    passed = [(k, v) for k, v in master["by_id"].items() if v.get("final") == "PASS"]
    failed = [(k, v) for k, v in master["by_id"].items() if v.get("final") == "FAIL"]
    lines.append(f"## PASS ({len(passed)})")
    lines.append("")
    for k, v in passed:
        att = len(v.get("attempts") or [])
        lines.append(f"- **{k}** — nach {att} Versuch(en)")
        lines.append(f"  - Q: {v.get('q', '')}")
    lines.append("")
    lines.append(f"## FAIL nach {master.get('max_attempts', 4)} Versuchen ({len(failed)})")
    lines.append("")
    if not failed:
        lines.append("_Keine._")
    for k, v in failed:
        lines.append(f"### {k}")
        lines.append(f"- Q: {v.get('q', '')}")
        lines.append(f"- Family: {v.get('family', '')}")
        lines.append("- Versuche:")
        for i, a in enumerate(v.get("attempts") or [], 1):
            why = ", ".join(a.get("fails") or []) or a.get("error") or "score_fail"
            snip = (a.get("snippet") or "").replace("\n", " ")[:220]
            lines.append(f"  {i}. **{a.get('verdict')}** — warum: `{why}`")
            if snip:
                lines.append(f"     Snippet: {snip}")
        last = (v.get("attempts") or [{}])[-1]
        lines.append(
            f"- **Warum unzufrieden:** nach {len(v.get('attempts') or [])} Versuchen "
            f"weiterhin kein PASS ({', '.join(last.get('fails') or []) or last.get('error') or 'kein Match'})."
        )
        lines.append("")
    path = OUT / "ABSCHLUSSBERICHT.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print("Wrote", path, flush=True)


def score_row(s: dict, txt: str, logs: str) -> dict:
    if not txt or len(txt.strip()) < 40:
        return {
            "verdict": "FAIL",
            "error": "NO_CAPTURE",
            "fails": ["no_capture"],
            "snippet": (txt or "")[:220],
            "log_hits": (logs or "")[:300],
        }
    if not re.search(
        r"(spickzettel|•|•|wecker|gestellt|papst|meter|euro|uhr|route|hotel|"
        r"essen|kino|theater|taxi|uber|flug|ticket|erinner|packliste|timeline|"
        r"grad|°|option|restaurant|speisekarte|michel|bier)",
        txt,
        re.I,
    ):
        return {
            "verdict": "FAIL",
            "error": "NO_SPICKZETTEL",
            "fails": ["no_spickzettel"],
            "snippet": txt[:220],
            "log_hits": (logs or "")[:300],
        }
    sc = qa.score(txt, s.get("checks") or {})
    return {
        "verdict": sc["verdict"],
        "bridge_ok": sc.get("bridge_ok"),
        "call2_ok": sc.get("call2_ok"),
        "bullets_ok": sc.get("bullets_ok"),
        "buttons_ok": sc.get("buttons_ok"),
        "buttons_found": sc.get("buttons_found"),
        "fails": sc.get("fails") or [],
        "snippet": sc.get("snippet"),
        "log_hits": (logs or "")[:300],
    }


def run_one(s: dict) -> tuple[str, dict]:
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
        qa.shot(f"{s['id']}-retrycap")
        txt2 = qa.extract(f"{s['id']}-retrycap", xml)
        if len((txt2 or "").strip()) > len((txt or "").strip()):
            txt = txt2
    return txt or "", score_row(s, txt or "", logs or "")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    max_attempts = 4
    only = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--max-attempts" and i + 1 < len(args):
            max_attempts = int(args[i + 1])
            i += 2
            continue
        if args[i] == "--only":
            only = set()
            i += 1
            while i < len(args) and not args[i].startswith("--"):
                only.add(args[i])
                i += 1
            continue
        # bare ids
        if only is None:
            only = set()
        only.add(args[i])
        i += 1

    if not qa.health():
        print("ERROR: askServer :8791 missing — start node scripts/deviceQa/askServer.mjs")
        return 2

    qa.adb("reverse", f"tcp:{qa.PORT}", f"tcp:{qa.PORT}")
    qa.adb("reverse", "tcp:8081", "tcp:8081")

    scenarios = merge_scenarios()
    if only:
        scenarios = [s for s in scenarios if s["id"] in only]

    master = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "device": qa.adb("get-serialno").stdout.strip(),
        "max_attempts": max_attempts,
        "by_id": {
            s["id"]: {
                "q": s["q"],
                "family": s.get("family"),
                "final": "PENDING",
                "attempts": [],
            }
            for s in scenarios
        },
    }
    write_status(master)

    for s in scenarios:
        print(f"\n######## {s['id']} ########", flush=True)
        print("Q:", s["q"], flush=True)
        entry = master["by_id"][s["id"]]
        for attempt in range(1, max_attempts + 1):
            print(f"-- attempt {attempt}/{max_attempts}", flush=True)
            # Follow-ups after fail: hard reset to avoid stale HUD
            if attempt > 1:
                s = {**s, "reset_before": True}
            txt, row = run_one(s)
            row["attempt"] = attempt
            row["at"] = datetime.now(timezone.utc).isoformat()
            entry["attempts"].append(row)
            print(row["verdict"], row.get("fails"), (row.get("snippet") or "")[:160], flush=True)
            if row["verdict"] == "PASS":
                entry["final"] = "PASS"
                break
            if attempt == max_attempts:
                entry["final"] = "FAIL"
            write_status(master)
        write_status(master)

    master["finished_at"] = datetime.now(timezone.utc).isoformat()
    write_status(master)
    write_abschluss(master)
    status = json.loads((OUT / "master_status.json").read_text(encoding="utf-8"))
    print("\nFINAL", status, flush=True)
    return 0 if status.get("fail", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
