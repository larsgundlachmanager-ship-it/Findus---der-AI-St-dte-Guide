#!/usr/bin/env python3
"""Wait for adb device, dump UI, restart suite if needed."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live6w"
LOG = OUT / "full-run-110.log"
PID_FILE = OUT / "suite.pid"
ASK = ROOT / "scripts" / "deviceQa" / "askServer.mjs"
SUITE = ROOT / "scripts" / "deviceQa" / "_six_week_live.py"
PREFERRED = "00143157P001105"


def adb_raw(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def list_devices() -> list[str]:
    r = adb_raw("devices")
    out = []
    for ln in (r.stdout or "").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("List"):
            continue
        parts = ln.split()
        if len(parts) >= 2 and parts[1] == "device":
            out.append(parts[0])
    return out


def wait_device(timeout_s: float = 300.0) -> str | None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        devs = list_devices()
        if PREFERRED in devs:
            return PREFERRED
        if devs:
            print("using first device", devs[0])
            return devs[0]
        print("waiting for device…", round(deadline - time.time()), "s left")
        time.sleep(3)
    return None


def ensure_ask() -> None:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8791/health", timeout=2) as res:
            if res.status == 200:
                print("ask ok")
                return
    except Exception:
        pass
    log = OUT / "ask-server-110.log"
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
        subprocess, "DETACHED_PROCESS", 0
    )
    with open(log, "ab") as lf:
        subprocess.Popen(
            ["node", str(ASK)],
            cwd=str(ROOT),
            stdout=lf,
            stderr=lf,
            creationflags=flags,
            close_fds=True,
        )
    time.sleep(1.5)
    print("ask started")


def kill_suite() -> None:
    try:
        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" |"
                " Where-Object { $_.CommandLine -match '_six_week_live' } |"
                " ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        print("killed", (r.stdout or "").strip())
    except Exception as e:
        print("kill err", e)


def dump_and_analyze(serial: str) -> None:
    import importlib.util

    os.environ["ANDROID_SERIAL"] = serial
    remote = "/data/local/tmp/findus_ui.xml"
    subprocess.run(
        [ADB, "-s", serial, "shell", "am", "force-stop", "com.google.android.googlequicksearchbox"],
        capture_output=True,
    )
    subprocess.run(
        [
            ADB,
            "-s",
            serial,
            "shell",
            "monkey",
            "-p",
            "de.findus.app",
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        capture_output=True,
    )
    time.sleep(8)
    r = subprocess.run(
        [ADB, "-s", serial, "shell", "uiautomator", "dump", remote],
        capture_output=True,
        text=True,
    )
    print("dump", r.returncode, (r.stdout or "")[:100], (r.stderr or "")[:100])
    local = OUT / "ui_ready_dump.xml"
    subprocess.run([ADB, "-s", serial, "pull", remote, str(local)], capture_output=True)
    if not local.exists() or local.stat().st_size < 50:
        remote = "/sdcard/Download/ui.xml"
        subprocess.run(
            [ADB, "-s", serial, "shell", "uiautomator", "dump", remote],
            capture_output=True,
        )
        subprocess.run([ADB, "-s", serial, "pull", remote, str(local)], capture_output=True)
    xml = local.read_text(encoding="utf-8", errors="ignore") if local.exists() else ""
    print("xml_bytes", len(xml))
    spec = importlib.util.spec_from_file_location(
        "tw", ROOT / "scripts" / "deviceQa" / "_three_week_marathon.py"
    )
    tw = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(tw)
    tw.OUT = OUT
    tw.XML = OUT / "ui.xml"
    blob = tw._ui_blob(xml)
    print("BLOB_HEAD:\n", blob[:1200])
    print(
        "mic",
        any(tw._looks_like_mic(n) for n in tw.nodes(xml)),
        "chrome",
        tw._looks_like_home_chrome(blob.lower()),
        "map",
        "maplibre" in blob.lower() or "showing a map" in blob.lower(),
    )
    t0 = time.time()
    ok = tw.wait_app_ready(40.0)
    print("wait_app_ready", ok, "in", round(time.time() - t0, 1), "s")


def start_suite(serial: str) -> int:
    kill_suite()
    time.sleep(1)
    LOG.write_text("", encoding="utf-8")
    env = os.environ.copy()
    env["ANDROID_SERIAL"] = serial
    # Explicit QA serial wins in _device_ids.require_qa_serial()
    env["FINDUS_QA_SERIAL"] = serial
    lf = open(LOG, "a", encoding="utf-8", errors="replace")
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    p = subprocess.Popen(
        [sys.executable, "-u", str(SUITE)],
        cwd=str(ROOT),
        stdout=lf,
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=flags,
    )
    PID_FILE.write_text(str(p.pid), encoding="utf-8")
    print("SUITE_PID", p.pid)
    return p.pid


def watch(timeout_s: float = 220.0) -> None:
    import re

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        text = LOG.read_text(encoding="utf-8", errors="ignore") if LOG.exists() else ""
        # Progress: Q printed before reset; look for post-reset signals
        if re.search(r"WARN poller_not_seen|PASS|FAIL|ASK_|Spickzettel|NO_MODAL", text, re.I):
            # Ensure we didn't only get ready timeout without further progress
            if "WARN app_ready_timeout" in text and not re.search(
                r"poller|PASS|FAIL|ASK_|Spickzettel|NO_MODAL", text, re.I
            ):
                pass
            else:
                print("EARLY_LOG:\n", text[-2500:])
                return
        if text.count("WARN app_ready_timeout") >= 1 and re.search(
            r"poller_not_seen|PASS|FAIL|Q:", text
        ):
            # After timeout_retry, suite continues to poller wait — look for that
            if "poller" in text.lower() or "PASS" in text or "FAIL" in text:
                print("EARLY_LOG:\n", text[-2500:])
                return
        # After ready warnings, next interesting line often poller or ask
        lines = text.strip().splitlines()
        if len(lines) >= 8 and not lines[-1].startswith("WARN app_ready"):
            print("EARLY_LOG:\n", text[-2500:])
            return
        time.sleep(2)
    print("WATCH_TIMEOUT:\n", LOG.read_text(encoding="utf-8", errors="ignore")[-2500:])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ensure_ask()
    print("waiting for adb device (up to 5 min)…")
    serial = wait_device(300.0)
    if not serial:
        print("NO_DEVICE — suite left running if any; cannot confirm ready")
        # keep existing suite? kill stuck one
        print("current log:\n", LOG.read_text(encoding="utf-8", errors="ignore") if LOG.exists() else "")
        return 2
    print("DEVICE", serial)
    adb_raw("-s", serial, "reverse", "tcp:8791", "tcp:8791")
    adb_raw("-s", serial, "reverse", "tcp:8081", "tcp:8081")
    print("reverse", adb_raw("-s", serial, "reverse", "--list").stdout)
    dump_and_analyze(serial)
    pid = start_suite(serial)
    watch(240.0)
    print("FINAL_PID", pid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
