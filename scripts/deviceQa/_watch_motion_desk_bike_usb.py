#!/usr/bin/env python3
"""
USB → fresh APK (motion fixes) → Desk-Check (Dock/Mic/Timeline) → Rad-Log armieren.

1. Wait for device (Travel serial or any authorized)
2. Wait for BUILD SUCCESSFUL / fresh app-release.apk (versionCode 104+)
3. install -r, launch
4. Desk-Check: scripts/deviceQa/_perf_chrome_m2.py
5. Clear logcat, stream to bike-ride.log until:
   - device disconnects, or
   - STOP_BIKE file touched, or
   - 25 min timeout
6. Write summary (errors / ANR / JS starvation hints)

Out: .cursor/live9/motion_desk_bike/
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "motion_desk_bike"
LOG = OUT / "watch.log"
PID_FILE = OUT / "watch.pid"
STOP_BIKE = OUT / "STOP_BIKE"
READY = OUT / "READY_FOR_BIKE.txt"
BIKE_LOG = OUT / "bike-ride.log"
DESK_REPORT = OUT / "desk-report.txt"
SUMMARY = OUT / "summary.md"
ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
EXPECTED = "00143157P001105"
APK = ROOT / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
APK_BUILD_LOG = ROOT / ".cursor" / "live9" / "taxi_uber" / "apk-build.log"
PERF = ROOT / "scripts" / "deviceQa" / "_perf_chrome_m2.py"
PERF_OUT = ROOT / ".cursor" / "perf_qa"

os.environ.setdefault("FINDUS_QA_SERIAL", EXPECTED)

# Bike/motion signal patterns in logcat
BIKE_HINTS = re.compile(
    r"ANR|OutOfMemory|JS.?thread|ReactNativeJS.*(Error|Exception)|"
    r"starv|dead.?end|FOG_BIKE|transportMode|bicycle|bike|"
    r"heading|COG|location.*watch|Watchdog|Choreographer.*(skipped|frames)|"
    r"SoftException|Fatal|FATAL EXCEPTION",
    re.I,
)


def serial() -> str:
    return (os.environ.get("FINDUS_QA_SERIAL") or EXPECTED).strip()


def wlog(msg: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def adb_global(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", serial(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def any_device_serial() -> str | None:
    r = adb_global("devices")
    for line in (r.stdout or "").splitlines():
        m = re.match(r"^(\S+)\tdevice\b", line)
        if m:
            return m.group(1)
    return None


def device_online() -> bool:
    ser = serial()
    r = adb_global("devices")
    for line in (r.stdout or "").splitlines():
        if line.startswith(ser + "\t") and "\tdevice" in line:
            return True
    return False


def adopt_device_if_needed() -> None:
    if device_online():
        return
    other = any_device_serial()
    if other:
        os.environ["FINDUS_QA_SERIAL"] = other
        wlog(f"adopt serial={other}")


def wait_for_fresh_apk(timeout_s: float = 1200.0) -> bool:
    """Prefer APK newer than the 11:33 v103 build; wait for gradle success if building."""
    baseline_old = datetime(2026, 9, 12, 11, 40).timestamp()  # anything before bump/build
    deadline = time.time() + timeout_s
    last_note = 0.0
    while time.time() < deadline:
        apk_ok = APK.is_file() and APK.stat().st_mtime > baseline_old
        build_txt = ""
        if APK_BUILD_LOG.is_file():
            build_txt = APK_BUILD_LOG.read_text(encoding="utf-8", errors="replace")
        if "BUILD SUCCESSFUL" in build_txt and apk_ok:
            wlog(f"APK fresh after BUILD SUCCESSFUL size={APK.stat().st_size}")
            return True
        if "BUILD FAILED" in build_txt:
            wlog("BUILD FAILED — abort fresh wait")
            return apk_ok
        if apk_ok and not APK_BUILD_LOG.is_file():
            return True
        if time.time() - last_note > 30:
            mtime = APK.stat().st_mtime if APK.is_file() else 0
            wlog(f"waiting APK… mtime={mtime} building={'yes' if APK_BUILD_LOG.is_file() else 'no'}")
            last_note = time.time()
        time.sleep(6)
    wlog("WARN APK wait timeout")
    return APK.is_file()


def install_apk() -> bool:
    if not APK.is_file():
        wlog(f"APK missing: {APK}")
        return False
    wlog(f"install -r {APK.name} ({APK.stat().st_size} bytes)")
    r = adb("install", "-r", "-d", str(APK))
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    wlog(f"install rc={r.returncode} {out[-300:]}")
    return r.returncode == 0


def launch_app() -> None:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    wlog("app launched")
    time.sleep(8.0)


def verify_version() -> str:
    r = adb("shell", "dumpsys", "package", PKG)
    blob = r.stdout or ""
    vc = re.search(r"versionCode=(\d+)", blob)
    vn = re.search(r"versionName=([^\s]+)", blob)
    s = f"versionName={vn.group(1) if vn else '?'} versionCode={vc.group(1) if vc else '?'}"
    wlog(s)
    return s


def run_desk_check() -> int:
    wlog("DESK-CHECK: _perf_chrome_m2.py (Settings/Timeline/Orte + Mic/ask)")
    env = os.environ.copy()
    env["FINDUS_QA_SERIAL"] = serial()
    env["ANDROID_SERIAL"] = serial()
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"\n--- desk start {datetime.now(timezone.utc).isoformat()} ---\n")
        p = subprocess.Popen(
            [sys.executable, str(PERF)],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert p.stdout is not None
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            f.write(line)
            f.flush()
        rc = p.wait()
        f.write(f"--- desk exit {rc} ---\n")
    # Copy perf report into our out dir
    src = PERF_OUT / "report.txt"
    if src.is_file():
        DESK_REPORT.write_text(src.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
        wlog(f"desk report → {DESK_REPORT}")
    wlog(f"desk exit={rc}")
    return rc


def arm_bike_log(max_s: float = 25 * 60) -> None:
    """Stream logcat until disconnect / STOP_BIKE / timeout."""
    if STOP_BIKE.exists():
        STOP_BIKE.unlink()
    adb("logcat", "-c")
    READY.write_text(
        "\n".join(
            [
                "APK installiert + Desk-Check fertig.",
                "Jetzt: kurze Rad-Runde (2–5 Min) mit App offen / Navigieren oder Free-Roam.",
                "USB darf am Rad bleiben (Log läuft) oder Kabel mitnehmen — bei Disconnect stoppt der Capture.",
                f"Stop manuell: Datei anlegen → {STOP_BIKE}",
                f"Log: {BIKE_LOG}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    wlog("=== READY FOR BIKE RIDE — see READY_FOR_BIKE.txt ===")

    # Prefer ReactNative + Findus tags, but keep broad enough for ANR/frames
    cmd = [
        ADB,
        "-s",
        serial(),
        "logcat",
        "-v",
        "threadtime",
        "ReactNativeJS:V",
        "ReactNative:V",
        "Findus:V",
        "Yorro:V",
        "chromium:W",
        "ActivityManager:I",
        "AndroidRuntime:E",
        "*:S",
    ]
    # Also a parallel unfiltered truncated dump every N min is heavy — stick to filtered.
    with BIKE_LOG.open("w", encoding="utf-8", errors="replace") as out:
        out.write(f"# bike log start {datetime.now(timezone.utc).isoformat()} serial={serial()}\n")
        out.flush()
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert proc.stdout is not None
        start = time.time()
        lines = 0
        hits: list[str] = []
        try:
            while time.time() - start < max_s:
                if STOP_BIKE.exists():
                    wlog("STOP_BIKE seen — end capture")
                    break
                if not device_online() and not any_device_serial():
                    wlog("device offline — end capture")
                    break
                # non-blocking-ish read with short select via timeout on readline using thread? 
                # Use communicate timeout pattern: poll
                if proc.poll() is not None:
                    wlog(f"logcat exited rc={proc.returncode}")
                    break
                # Read available lines with short timeout via communicate not available;
                # use readline with the fact logcat is continuous.
                line = proc.stdout.readline()
                if not line:
                    time.sleep(0.05)
                    continue
                out.write(line)
                lines += 1
                if lines % 200 == 0:
                    out.flush()
                if BIKE_HINTS.search(line):
                    hits.append(line.rstrip()[:240])
                    if len(hits) <= 40:
                        wlog(f"bike-hit: {line.strip()[:160]}")
        finally:
            try:
                proc.terminate()
            except Exception:
                pass
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
            out.write(f"\n# bike log end lines={lines} hits={len(hits)}\n")

    write_summary(hits, lines)
    wlog(f"bike capture done lines={lines} hits={len(hits)} → {SUMMARY}")


def write_summary(hits: list[str], lines: int) -> None:
    desk = DESK_REPORT.read_text(encoding="utf-8", errors="replace") if DESK_REPORT.is_file() else "(no desk report)"
    parts = [
        f"# Motion Desk + Bike — {datetime.now(timezone.utc).isoformat()}",
        "",
        f"- serial: `{serial()}`",
        f"- bike log lines: {lines}",
        f"- hint hits: {len(hits)}",
        "",
        "## Desk-Check",
        "```",
        desk.strip()[:4000],
        "```",
        "",
        "## Bike log highlights",
    ]
    if hits:
        parts.append("```")
        parts.extend(hits[:50])
        parts.append("```")
    else:
        parts.append("_Keine ANR/JS-Error/Bike-Hints im gefilterten Log — gut oder Filter zu eng._")
    parts.append("")
    parts.append(f"Volles Log: `{BIKE_LOG}`")
    SUMMARY.write_text("\n".join(parts), encoding="utf-8")


def once_ready() -> int:
    adopt_device_if_needed()
    wlog(f"device online: {serial()}")
    wlog("wait for APK 2.0.77 / motion build…")
    if not wait_for_fresh_apk(1200):
        wlog("ERROR: no fresh APK")
        return 3
    adb("reverse", "tcp:8791", "tcp:8791")
    if not install_apk():
        return 4
    launch_app()
    ver = verify_version()
    if "versionCode=104" not in ver and "2.0.77" not in ver:
        wlog("WARN: unexpected version — continue anyway")
    desk_rc = run_desk_check()
    arm_bike_log()
    return 0 if desk_rc == 0 else 1


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    wlog(f"pid={os.getpid()} motion desk+bike watching serial={serial()}")
    if device_online() or any_device_serial():
        wlog("device already online — run now")
        return once_ready()
    i = 0
    while True:
        if device_online() or any_device_serial():
            return once_ready()
        i += 1
        if i % 6 == 0:
            r = adb_global("devices", "-l")
            wlog(
                f"still waiting ({i * 5}s) devices={(r.stdout or '').replace(chr(10), ' | ').strip()}"
            )
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        wlog("interrupted")
        raise SystemExit(130)
