#!/usr/bin/env python3
"""Probe UI ready, ensure ask server + reverse, restart six_week_live suite."""
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
SERIAL = "00143157P001105"
OUT = ROOT / ".cursor" / "live6w"
LOG = OUT / "full-run-110.log"
PID_FILE = OUT / "suite.pid"
ASK = ROOT / "scripts" / "deviceQa" / "askServer.mjs"
SUITE = ROOT / "scripts" / "deviceQa" / "_six_week_live.py"


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, text=True)


def kill_old_suite() -> None:
    # Kill by pid file + command-line scan
    killed = []
    if PID_FILE.exists():
        try:
            old = int(PID_FILE.read_text(encoding="utf-8").strip().split()[0])
            os.kill(old, signal.SIGTERM)
            killed.append(old)
            time.sleep(1.5)
            try:
                os.kill(old, signal.SIGKILL)
            except OSError:
                pass
        except Exception as e:
            print("pidfile kill:", e)
    # Windows: wmic / taskkill by command line
    try:
        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
                "Where-Object { $_.CommandLine -match '_six_week_live' } | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        print("taskkill out:", (r.stdout or "").strip(), (r.stderr or "").strip())
    except Exception as e:
        print("taskkill err", e)
    print("killed", killed)


def ensure_ask_server() -> None:
    ok = False
    try:
        with urllib.request.urlopen("http://127.0.0.1:8791/health", timeout=2) as res:
            ok = res.status == 200
    except Exception:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8791/", timeout=2) as res:
                ok = True
        except Exception:
            ok = False
    if ok:
        print("ask_server: already up")
        return
    log = OUT / "ask-server-110.log"
    creationflags = 0
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS  # type: ignore
    with open(log, "ab") as lf:
        p = subprocess.Popen(
            ["node", str(ASK)],
            cwd=str(ROOT),
            stdout=lf,
            stderr=lf,
            creationflags=creationflags,
            close_fds=True,
        )
    print("ask_server started pid", p.pid)
    for _ in range(20):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8791/health", timeout=1) as res:
                if res.status == 200:
                    print("ask_server health OK")
                    return
        except Exception:
            try:
                urllib.request.urlopen("http://127.0.0.1:8791/", timeout=1)
                print("ask_server root OK")
                return
            except Exception:
                time.sleep(0.4)
    print("WARN ask_server may not be healthy yet")


def dump_ui() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    remote = "/data/local/tmp/findus_ui.xml"
    r = adb("shell", "uiautomator", "dump", remote)
    print("dump rc", r.returncode, (r.stdout or "")[:120], (r.stderr or "")[:120])
    if r.returncode != 0:
        remote = "/sdcard/Download/ui.xml"
        adb("shell", "uiautomator", "dump", remote)
    local = OUT / "ui_ready_dump.xml"
    adb("pull", remote, str(local))
    xml = local.read_text(encoding="utf-8", errors="ignore") if local.exists() else ""
    return xml


def analyze(xml: str) -> None:
    import re

    # import patched helpers
    sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "tw", ROOT / "scripts" / "deviceQa" / "_three_week_marathon.py"
    )
    tw = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    # Override OUT so dump writes into live6w
    spec.loader.exec_module(tw)
    tw.OUT = OUT
    tw.XML = OUT / "ui.xml"

    # Force serial on adb used by marathon (no -s by default)
    orig_adb = tw.adb

    def adb_serial(*args: str):
        return subprocess.run(
            [ADB, "-s", SERIAL, *args], capture_output=True, text=True
        )

    tw.adb = adb_serial  # type: ignore

    blob = tw._ui_blob(xml).lower()
    print("--- UI BLOB (first 1500) ---")
    print(tw._ui_blob(xml)[:1500])
    print("--- ANALYSIS ---")
    print("pkg", "de.findus.app" in xml)
    print("has_mic", any(tw._looks_like_mic(n) for n in tw.nodes(xml)))
    print("has_chrome", tw._looks_like_home_chrome(blob))
    print("has_map", "maplibre" in blob or "showing a map" in blob)
    print("still_boot", tw._still_booting(blob, xml))
    # list clickable a11y
    for n in tw.nodes(xml):
        if n["click"]:
            lab = (n["desc"] or n["text"] or "")[:90]
            if lab:
                print("CLICK", lab)

    # quick wait_app_ready smoke (short)
    print("--- wait_app_ready(25s) ---")
    t0 = time.time()
    ok = tw.wait_app_ready(25.0)
    print("ready", ok, "elapsed", round(time.time() - t0, 1))


def start_suite() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    # truncate log atomically
    LOG.write_text("", encoding="utf-8")
    env = os.environ.copy()
    env["ANDROID_SERIAL"] = SERIAL
    creationflags = 0
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore
    lf = open(LOG, "a", encoding="utf-8", errors="replace")
    p = subprocess.Popen(
        [sys.executable, "-u", str(SUITE)],
        cwd=str(ROOT),
        stdout=lf,
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=creationflags,
    )
    PID_FILE.write_text(str(p.pid), encoding="utf-8")
    print("SUITE_PID", p.pid)
    return p.pid


def watch_first(timeout_s: float = 180.0) -> None:
    deadline = time.time() + timeout_s
    saw_scenario = False
    while time.time() < deadline:
        if not LOG.exists():
            time.sleep(1)
            continue
        text = LOG.read_text(encoding="utf-8", errors="ignore")
        if "=== " in text:
            saw_scenario = True
        if "WARN app_ready_timeout" in text:
            # show but keep watching — may recover on retry
            pass
        # Progress past ready: poller / ASK / Spickzettel / PASS / FAIL for first id
        if re_search_progress(text):
            print("--- EARLY LOG ---")
            print(text[-2500:])
            return
        time.sleep(2)
    print("--- TIMEOUT watching; log tail ---")
    print(LOG.read_text(encoding="utf-8", errors="ignore")[-2500:] if LOG.exists() else "no log")


def re_search_progress(text: str) -> bool:
    import re

    # After first === id ===, either ready warning loop OR real progress
    if not re.search(r"=== \w+", text):
        return False
    # Immediate timeout loop without progress
    timeouts = len(re.findall(r"WARN app_ready_timeout", text))
    if timeouts >= 2 and not re.search(
        r"poller|ASK_|Spickzettel|PASS|FAIL|Q:|devAskPoller|waiting", text, re.I
    ):
        print("STUCK in app_ready_timeout loop")
        print(text[-2000:])
        return True
    if re.search(
        r"WARN poller_not_seen|poller|PASS|FAIL|ASK_|Spickzettel|Q:|waiting_spick|spick",
        text,
        re.I,
    ):
        return True
    # First scenario line + no timeout after reset
    if "Q:" in text and "WARN app_ready_timeout" not in text.split("Q:")[0].split("===")[-1]:
        return True
    return False


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("=== bring app foreground ===")
    adb("shell", "am", "force-stop", "com.google.android.googlequicksearchbox")
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(6)
    print("=== dump UI ===")
    xml = dump_ui()
    print("xml bytes", len(xml))
    analyze(xml)
    print("=== ask server + reverse ===")
    ensure_ask_server()
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")
    print("reverse:", adb("reverse", "--list").stdout)
    print("=== kill old suite ===")
    kill_old_suite()
    time.sleep(1)
    print("=== start suite ===")
    pid = start_suite()
    print("=== watch first scenario ===")
    watch_first(200.0)
    print("DONE suite_pid", pid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
