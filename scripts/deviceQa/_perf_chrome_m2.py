#!/usr/bin/env python3
"""
Phone latency QA — Chrome instant + Modul-2 bridge.

Measures tap→overlay visible for Settings / Timeline / Orte,
then one short ask via yorro://ask and scans logcat for bridge/latency.

Run: python scripts/deviceQa/_perf_chrome_m2.py
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path
from _device_ids import require_qa_serial
from urllib.parse import quote

# Windows consoles often default to cp1252 — force UTF-8 everywhere.
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = require_qa_serial()
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\perf_qa")
XML = OUT / "ui.xml"
REMOTE_XML = "/sdcard/Download/perf_ui.xml"

HOME_MARKER = "Einstellungen"
HOME_WAIT_S = 45.0

# Dock a11y from HomeDockBar.tsx (not Header.tsx triangle labels).
# open_any + close_any must be UNIQUE to that overlay (never dock-only words).
CHROME = [
    (
        "settings",
        ["Einstellungen"],
        # Must see settings body + Schließen (not Timeline schließen / Fertig alone).
        ["Allgemeine Einstellungen", "Stadtauswahl"],
        ["Schließen"],
        "settings",  # exclusive: blob must NOT contain Timeline schließen / Fertig as primary
    ),
    (
        "timeline",
        ["Timeline und Routenplanung", "Planung und Zeitachse"],
        ["Heute"],
        ["Timeline schließen"],
        "timeline",
    ),
    (
        "orte",
        ["Orte finden", "Orte und Stempelkarte"],
        ["Besucht", "Geplant"],
        ["Fertig"],
        "orte",
    ),
]

CLOSE_KEYS = (
    "schließen",
    "schliessen",
    "karte schließen",
    "timeline schließen",
    "fertig",
    "abbrechen",
)


def adb(*args: str, text: bool = True, timeout: float | None = 90.0) -> subprocess.CompletedProcess:
    kw: dict = {
        "capture_output": True,
        "timeout": timeout,
    }
    if text:
        kw["text"] = True
        kw["encoding"] = "utf-8"
        kw["errors"] = "replace"
    return subprocess.run([ADB, "-s", SERIAL, *args], **kw)


def cold_start() -> None:
    adb("shell", "input", "keyevent", "224")  # WAKEUP
    adb("shell", "input", "keyevent", "82")  # unlock nudge
    adb("shell", "am", "force-stop", PKG)
    time.sleep(0.6)
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(1.0)


def dump_ui(retries: int = 3) -> str:
    """uiautomator dump with idle-retry + compressed fallback."""
    OUT.mkdir(parents=True, exist_ok=True)
    last_err = ""
    for attempt in range(retries):
        for mode in ("compressed", "plain"):
            try:
                if mode == "compressed":
                    r = adb(
                        "shell",
                        "uiautomator",
                        "dump",
                        "--compressed",
                        REMOTE_XML,
                        timeout=25.0,
                    )
                else:
                    r = adb("shell", "uiautomator", "dump", REMOTE_XML, timeout=25.0)
            except subprocess.TimeoutExpired:
                last_err = "dump timeout"
                time.sleep(0.35)
                continue
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            if "ERROR" in out.upper() or "could not get idle" in out.lower():
                last_err = out
                time.sleep(0.35 + attempt * 0.2)
                continue
            pull = adb("pull", REMOTE_XML, str(XML), timeout=20.0)
            pull_msg = ((pull.stdout or "") + (pull.stderr or "")).lower()
            if XML.exists() and XML.stat().st_size > 80 and "error" not in pull_msg:
                return XML.read_text(encoding="utf-8", errors="replace")
            last_err = pull_msg or out or "pull failed"
            time.sleep(0.25)
        time.sleep(0.4)
    if XML.exists() and XML.stat().st_size > 80:
        return XML.read_text(encoding="utf-8", errors="replace")
    print(f"  dump_ui FAILED after retries: {last_err[:200]}")
    return ""


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": (text.group(1) if text else "").replace("&#10;", " "),
            "desc": (desc.group(1) if desc else "").replace("&#10;", " "),
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def visible_blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        if n["text"]:
            parts.append(n["text"])
        if n["desc"]:
            parts.append(n["desc"])
    return " | ".join(parts).lower()


def has_home_chrome(xml: str) -> bool:
    blob = visible_blob(xml)
    # Dock ready: Einstellungen a11y + Timeline dock present
    return "einstellungen" in blob and (
        "timeline und routenplanung" in blob or "timeline" in blob
    )


def find_by_labels(xml: str, labels: list[str]):
    for label in labels:
        nlow = label.lower()
        # Prefer clickable
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower()
            if nlow in blob or blob.strip() == nlow:
                return n
        # Fallback: any node (tap center of label)
        for n in nodes(xml):
            blob = (n["desc"] + " " + n["text"]).lower()
            if nlow in blob:
                return n
    return None


def find_close(xml: str):
    # Prefer sheet dismissals: Fertig / Timeline schließen / Schließen (not Karte schließen).
    ranked: list[tuple[int, dict]] = []
    for n in nodes(xml):
        if not n["click"]:
            continue
        blob = (n["desc"] + " " + n["text"]).lower().strip()
        if blob in ("fertig",):
            ranked.append((0, n))
        elif "timeline schließen" in blob or "timeline schliessen" in blob:
            ranked.append((1, n))
        elif blob in ("schließen", "schliessen") or blob.startswith("schließen"):
            ranked.append((2, n))
        elif "karte schließen" in blob or "karte schliessen" in blob:
            ranked.append((9, n))
        elif any(k in blob for k in CLOSE_KEYS):
            ranked.append((5, n))
    if not ranked:
        return None
    ranked.sort(key=lambda x: x[0])
    return ranked[0][1]


def shot(tag: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output(
        [ADB, "-s", SERIAL, "exec-out", "screencap", "-p"],
    )
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass
    return dest


def wait_home_ready(max_s: float = HOME_WAIT_S) -> bool:
    print(f"wait home chrome (max {max_s:.0f}s)…")
    t_start = time.time()
    deadline = t_start + max_s
    attempt = 0
    last_blob = ""
    while time.time() < deadline:
        attempt += 1
        # First dismiss leftover overlays, then check chrome
        xml = dump_ui()
        if xml:
            c = find_close(xml)
            # Only auto-dismiss if Orte/Settings leftover (Fertig/Schließen), not map chrome
            if c:
                blob = (c["desc"] + " " + c["text"]).lower()
                if "fertig" in blob or "schließen" in blob or "schliessen" in blob:
                    if "karte schließen" not in blob:
                        adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
                        time.sleep(0.45)
                        continue
            if has_home_chrome(xml):
                shot("home")
                print(f"  HOME ready after ~{time.time() - t_start:.1f}s (dump #{attempt})")
                return True
            last_blob = visible_blob(xml)[:180]
            print(f"  dump#{attempt}: not ready — {last_blob[:100]!r}")
        time.sleep(1.0)
    shot("home-TIMEOUT")
    xml = dump_ui()
    last_blob = visible_blob(xml)[:240] if xml else last_blob
    print(f"  HOME TIMEOUT — last blob: {last_blob[:200]!r}")
    (OUT / "home-timeout-blob.txt").write_text(last_blob, encoding="utf-8")
    return False


def dismiss_overlays(max_rounds: int = 6) -> None:
    """Tap close/Fertig only — NEVER keyevent BACK (exits app)."""
    for _ in range(max_rounds):
        xml = dump_ui()
        if not xml:
            return
        if has_home_chrome(xml):
            # Still dismiss Fertig/Schließen if an overlay sits on home chrome
            c = find_close(xml)
            if not c:
                return
            blob = (c["desc"] + " " + c["text"]).lower()
            if "karte schließen" in blob and "fertig" not in visible_blob(xml):
                return
        c = find_close(xml)
        if not c:
            return
        blob = (c["desc"] + " " + c["text"]).lower()
        if "karte schließen" in blob and "fertig" not in visible_blob(xml) and "allgemeine" not in visible_blob(xml):
            return
        adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
        time.sleep(0.45)


def overlay_open(tag: str, blob: str, open_markers: list[str], close_markers: list[str]) -> bool:
    """True only with strong overlay evidence (avoids false PASS on dock / wrong sheet)."""
    has_open = any(m.lower() in blob for m in open_markers)
    has_close = any(m.lower() in blob for m in close_markers)
    if not (has_open and has_close):
        return False
    # Cross-sheet guards
    if tag == "settings":
        if "timeline schließen" in blob or "fertig" in blob:
            return False
        # Generic "schließen" ok; must not be only timeline close
        if "schließen" not in blob and "schliessen" not in blob:
            return False
    if tag == "timeline":
        if "allgemeine einstellungen" in blob or "stadtauswahl" in blob:
            return False
        if "fertig" in blob and "timeline schließen" not in blob:
            return False
    if tag == "orte":
        if "allgemeine einstellungen" in blob or "timeline schließen" in blob:
            return False
    return True


def ensure_home(max_rounds: int = 8) -> bool:
    """Dismiss overlays until dock chrome is free of Fertig/Schließen sheets."""
    for _ in range(max_rounds):
        dismiss_overlays()
        xml = dump_ui()
        if not xml:
            return False
        blob = visible_blob(xml)
        if not has_home_chrome(xml):
            continue
        # Home dock visible and no sheet dismissals lingering
        if "fertig" in blob:
            c = find_close(xml)
            if c:
                adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
                time.sleep(0.4)
                continue
        if "timeline schließen" in blob:
            c = find_close(xml)
            if c:
                adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
                time.sleep(0.4)
                continue
        if "allgemeine einstellungen" in blob or (
            "stadtauswahl" in blob and "schließen" in blob
        ):
            c = find_close(xml)
            if c:
                adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
                time.sleep(0.4)
                continue
        return True
    return has_home_chrome(dump_ui() or "")


def measure_chrome_open(
    tag: str,
    labels: list[str],
    open_markers: list[str],
    close_markers: list[str],
) -> dict:
    if not ensure_home():
        shot(f"{tag}-not-home")
        return {
            "tag": tag,
            "ok": False,
            "ms": None,
            "err": "not on home before tap",
            "sample": "",
        }

    xml = dump_ui()
    btn = find_by_labels(xml, labels) if xml else None
    if not btn:
        shot(f"{tag}-miss")
        return {"tag": tag, "ok": False, "ms": None, "err": f"button not found: {labels}"}

    # Dump once for coords → tap → capped poll dumps for overlay
    t0 = time.perf_counter()
    adb("shell", "input", "tap", str(btn["cx"]), str(btn["cy"]))

    hit_ms = None
    last_xml = ""
    max_polls = 8
    for i in range(max_polls):
        last_xml = dump_ui()
        blob = visible_blob(last_xml)
        if overlay_open(tag, blob, open_markers, close_markers):
            hit_ms = int((time.perf_counter() - t0) * 1000)
            break
        time.sleep(0.05 if i < 2 else 0.1)

    shot(f"{tag}-open")
    if hit_ms is None:
        ensure_home()
        return {
            "tag": tag,
            "ok": False,
            "ms": int((time.perf_counter() - t0) * 1000),
            "err": "overlay markers not seen",
            "sample": visible_blob(last_xml)[:240],
        }

    c = find_close(last_xml)
    if c:
        adb("shell", "input", "tap", str(c["cx"]), str(c["cy"]))
        time.sleep(0.5)
    ensure_home()
    return {"tag": tag, "ok": True, "ms": hit_ms, "err": None}


def ask_and_bridge(q: str, wait_s: float = 20.0) -> dict:
    dismiss_overlays()
    # Ensure home before ask
    xml = dump_ui()
    if xml and not has_home_chrome(xml):
        dismiss_overlays()

    adb("logcat", "-c")
    time.sleep(0.25)
    url = "yorro://ask?q=" + quote(q, safe="")
    cmd = (
        "am start -a android.intent.action.VIEW "
        f"-d '{url}' -n {PKG}/.MainActivity"
    )
    t0 = time.perf_counter()
    r = adb("shell", cmd)
    start_msg = ((r.stdout or "") + (r.stderr or "")).strip()
    if start_msg:
        print(f"  ask start: {start_msg[:220]}")

    # Real app marks only — never match adbd shell lines that contain yorro://ask.
    pattern = re.compile(
        r"(markBridgeFirst|\[latency\]|bridge_stream|bridgeSpoken|onBridge|"
        r"Beat-1|Beat\s*1|ack floskel|bridgeSpokenEarly|floskelEngine|"
        r"typed ask|researchAck|startLiveSpeech|speakSentence)",
        re.I,
    )
    noise = re.compile(r"\badbd\b|am start -a android", re.I)
    bridge_ms = None
    hit_line = ""
    tts_ms = None
    deadline = time.time() + wait_s
    while time.time() < deadline:
        log_rn = adb("logcat", "-d", "-t", "400", "-s", "ReactNativeJS:V").stdout or ""
        log_all = adb("logcat", "-d", "-t", "300").stdout or ""
        log = log_rn + "\n" + log_all
        for ln in log.splitlines():
            if noise.search(ln):
                continue
            if pattern.search(ln):
                bridge_ms = int((time.perf_counter() - t0) * 1000)
                hit_line = ln.strip()[:280]
                break
            if tts_ms is None and re.search(
                r"TextToSpeech.*(Connected|bound|Sucessfully bound)", ln, re.I
            ):
                tts_ms = int((time.perf_counter() - t0) * 1000)
        if bridge_ms is not None:
            break
        time.sleep(0.35)

    time.sleep(1.2)
    shot("ask-bridge")

    full_rn = adb("logcat", "-d", "-t", "800", "-s", "ReactNativeJS:V").stdout or ""
    full = adb("logcat", "-d", "-t", "400").stdout or ""
    keys = (
        "markBridgeFirst",
        "[latency]",
        "bridge",
        "Beat",
        "floskel",
        "ask",
        "concierge",
        "speech",
    )
    hits = []
    for ln in (full_rn + "\n" + full).splitlines():
        low = ln.lower()
        if any(k.lower() in low for k in keys):
            hits.append(ln)
    (OUT / "ask-log-hits.txt").write_text("\n".join(hits[-100:]), encoding="utf-8")
    (OUT / "ask-log-rn.txt").write_text(full_rn[-12000:], encoding="utf-8")

    xml = dump_ui()
    texts = [n["text"] for n in nodes(xml) if n["text"]][:40]
    blob = visible_blob(xml) if xml else ""
    # Functional proof when RN console is stripped in release builds
    strong_ui = "uhrzeit" in blob or any(
        (t or "").strip().lower() == "uhrzeit" for t in texts
    )
    ui_answered = strong_ui or any(
        re.search(r"^\s*•?\s*\d{1,2}:\d{2}\s*$", t or "") for t in texts
    )
    return {
        "ok": bridge_ms is not None or strong_ui or (tts_ms is not None and ui_answered),
        "bridge_ms": bridge_ms,
        "tts_ms": tts_ms,
        "ui_answered": ui_answered or strong_ui,
        "total_ms": int((time.perf_counter() - t0) * 1000),
        "hit_line": hit_line,
        "ui_sample": texts[:12],
    }


def status_label(r: dict) -> str:
    if not r.get("ok") or r.get("ms") is None:
        return "FAIL"
    ms = r["ms"]
    if ms < 350:
        return "PASS-INSTANT"
    if ms < 800:
        return "PASS"
    return "PASS-SLOW"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("=== PERF QA phone ===")
    print(f"serial={SERIAL} pkg={PKG}")
    print("cold start…")
    cold_start()

    if not wait_home_ready(HOME_WAIT_S):
        report = OUT / "report.txt"
        lines = [
            "PERF QA Chrome + M2",
            "BLOCKED: home chrome never appeared (splash hang or launcher)",
            f"evidence: {OUT / 'home-TIMEOUT-sm.png'}",
            f"blob: see {OUT / 'home-timeout-blob.txt'}",
        ]
        report.write_text("\n".join(lines), encoding="utf-8")
        print("\nBLOCKED — abort measurements")
        print("report", report)
        return 2

    results = []
    for tag, labels, open_m, close_m, _kind in CHROME:
        print(f"\n-- chrome {tag} --")
        r = measure_chrome_open(tag, labels, open_m, close_m)
        results.append(r)
        st = status_label(r)
        print(f"{st}  {tag}: {r.get('ms')} ms  {r.get('err') or ''}")
        if r.get("sample"):
            print(f"  sample: {r['sample'][:160]}")
        time.sleep(0.35)

    print("\n-- modul2 ask --")
    ask = ask_and_bridge("Wie spaet ist es", wait_s=20.0)
    print(
        f"{'PASS' if ask['ok'] else 'FAIL'}  bridge~{ask.get('bridge_ms')} ms  "
        f"tts~{ask.get('tts_ms')} ms  ui_answered={ask.get('ui_answered')}  "
        f"total={ask.get('total_ms')} ms"
    )
    if ask.get("hit_line"):
        print(f"  hit: {ask['hit_line'][:160]}")
    print("ui:", " | ".join(ask.get("ui_sample") or [])[:200])

    report = OUT / "report.txt"
    lines = [
        "PERF QA Chrome + M2",
        "Note: chrome ms = tap→first uiautomator dump with overlay markers (dump overhead dominates).",
        "",
    ]
    for r in results:
        st = status_label(r)
        lines.append(
            f"{st}  {r['tag']}: ok={r['ok']} ms={r.get('ms')} err={r.get('err')}"
        )
        if r.get("sample"):
            lines.append(f"  sample: {r['sample'][:180]}")
    lines.append("")
    lines.append(
        f"{'PASS' if ask['ok'] else 'FAIL'}  ask: bridge_ms={ask.get('bridge_ms')} "
        f"tts_ms={ask.get('tts_ms')} ui_answered={ask.get('ui_answered')} "
        f"total={ask.get('total_ms')}"
    )
    if ask.get("hit_line"):
        lines.append(f"  hit: {ask['hit_line']}")
    lines.append(f"  ui: {' | '.join(ask.get('ui_sample') or [])[:200]}")
    lines.append("")
    lines.append(f"shots: {OUT}")
    report.write_text("\n".join(lines), encoding="utf-8")
    print("\nreport", report)

    chrome_ok = all(r["ok"] for r in results)
    return 0 if chrome_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
