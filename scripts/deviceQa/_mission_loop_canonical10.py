#!/usr/bin/env python3
"""Phase 9 — 10 Canonical Live-Asks auf dem QA-Gerät (nie Nothing).

  python scripts/deviceQa/_mission_loop_canonical10.py

Requires: QA serial connected (FINDUS_QA_SERIAL / Galaxy S7).
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _device_ids import QA_SERIAL, TRAVEL_SERIAL, require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live9")
OUT.mkdir(parents=True, exist_ok=True)

CANONICAL = [
    "In Venedig mit der Nusschale fahren — wie teuer ist das?",
    "Wie alt ist der Papst?",
    "Ich möchte in die Hauptstadt der Niederlande und dort mit dem Boot fahren",
    "Wo kann ich Basketball spielen?",
    "Spaghetti-Eis in der Nähe",
    "Hotel in Amsterdam Nähe Hauptbahnhof unter 200 Euro mit Pool",
    "Wann spielen die Hamburg Towers wieder?",
    "Morgen nach Berlin, spätestens 18 Uhr",
    "Wann muss ich am Flughafen sein?",
    "Wo kann ich SUP auf der Alster ausleihen?",
]


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *args],
        capture_output=True,
        text=True,
    )


def devices() -> list[str]:
    r = subprocess.run([ADB, "devices"], capture_output=True, text=True)
    out = []
    for line in (r.stdout or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            out.append(parts[0])
    return out


def main() -> int:
    serial = require_qa_serial()
    connected = devices()
    if serial not in connected:
        print(
            f"[canonical10] QA-Gerät {serial} nicht verbunden. "
            f"Attached: {connected or '—'}. "
            f"Nothing ({TRAVEL_SERIAL}) nicht für Live-QA nutzen."
        )
        return 2

    # Prefer existing ask helper if present
    ask_py = Path(__file__).with_name("_ask.py")
    results = []
    for i, q in enumerate(CANONICAL, 1):
        print(f"[{i}/10] {q}")
        tag = f"c{i:02d}"
        if ask_py.exists():
            r = subprocess.run(
                [sys.executable, str(ask_py), q],
                cwd=str(ask_py.parent),
                capture_output=True,
                text=True,
                timeout=180,
            )
            ok = r.returncode == 0
            results.append({"q": q, "ok": ok, "code": r.returncode})
            (OUT / f"{tag}.log").write_text(
                (r.stdout or "") + "\n" + (r.stderr or ""),
                encoding="utf-8",
            )
        else:
            results.append({"q": q, "ok": False, "error": "no _ask.py"})
        time.sleep(1.5)

    report = {
        "qa_serial": serial,
        "results": results,
        "passed": sum(1 for x in results if x.get("ok")),
        "total": len(results),
    }
    (OUT / "canonical10.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
