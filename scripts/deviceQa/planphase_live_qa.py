#!/usr/bin/env python3
"""Planphase Live-QA checklist — nur QA-Serial (nie Nothing/Travel).

Run (USB QA + Metro + ask-server):
  python scripts/deviceQa/planphase_live_qa.py

Cases:
  A Hamburg-Tagesplan
  B Vertiefen Michel
  C Punkt dazu
  D Löschen
  E Ganzer Plan auf Donnerstag
  F Abendplanung erst essen dann Theater
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _device_ids import QA_SERIAL, TRAVEL_SERIAL, require_qa_serial  # noqa: E402

CASES = [
    (
        "A_hamburg_day",
        "Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, "
        "Michel rauf wie teuer was ist das, zwischendurch eine Tour, Sonnenuntergang — "
        "stell mir den Tag zusammen",
    ),
    ("B_michel_price", "Wie teuer ist der Michel und was ist das genau?"),
    ("C_add_cafe", "Noch dazu ein gutes Café zwischendurch"),
    ("D_delete_cafe", "Lösch das Café wieder raus"),
    ("E_shift_thursday", "Verschieb den ganzen Plan auf Donnerstag"),
    ("F_evening", "Abendplanung erst essen, dann Theater"),
]


def adb(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["adb", "-s", QA_SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def main() -> int:
    serial = require_qa_serial()
    if serial == TRAVEL_SERIAL:
        print("FAIL: Travel/Nothing ist kein QA-Gerät", file=sys.stderr)
        return 2
    st = adb("get-state")
    if st.returncode != 0 or "device" not in (st.stdout or "").lower():
        print(
            f"FAIL: QA {serial} nicht verbunden. Galaxy S7 per USB anschließen.",
            file=sys.stderr,
        )
        return 2

    # Prefer typed ask helper if present
    ask_mod = Path(__file__).resolve().parent / "_type_ask.py"
    if not ask_mod.exists():
        ask_mod = Path(__file__).resolve().parent / "_ask.py"

    print(f"QA serial={serial}")
    fails = 0
    for key, text in CASES:
        print(f"\n=== {key} ===")
        print(text[:120])
        r = subprocess.run(
            [sys.executable, str(ask_mod), text],
            cwd=str(ROOT),
            env={**dict(**{k: v for k, v in __import__("os").environ.items()}), "FINDUS_QA_SERIAL": serial, "ANDROID_SERIAL": serial},
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        out = (r.stdout or "") + (r.stderr or "")
        ok = r.returncode == 0
        print(out[-800:] if len(out) > 800 else out)
        print("PASS" if ok else "FAIL")
        if not ok:
            fails += 1
        time.sleep(2.5)

    print(f"\nDone fails={fails}/{len(CASES)}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
