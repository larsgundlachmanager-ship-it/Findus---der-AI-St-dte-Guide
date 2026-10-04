#!/usr/bin/env python3
"""Patch wait_app_ready / dump / reset_app in _three_week_marathon.py."""
from __future__ import annotations

from pathlib import Path

SRC = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_three_week_marathon.py")

OLD_DUMP = '''def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")
'''

NEW_DUMP = '''def dump() -> str:
    # Prefer /data/local/tmp — /sdcard dump often fails mid-boot / overlay.
    remote = "/data/local/tmp/findus_ui.xml"
    r = adb("shell", "uiautomator", "dump", remote)
    if r.returncode != 0 or "ERROR" in ((r.stdout or "") + (r.stderr or "")).upper():
        adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
        remote = "/sdcard/Download/ui.xml"
    adb("pull", remote, str(XML))
    try:
        return XML.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""
'''

OLD_READY = '''def wait_app_ready(timeout_s: float = 45.0) -> bool:
    """After cold start: mic visible, map chrome up, Tippfeld not stuck."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        blob = _ui_blob(xml).lower()
        has_mic = any(
            n["click"] and "mikrofon" in (n["desc"] + n["text"]).lower() for n in nodes(xml)
        )
        has_chrome = "timeline" in blob and ("orte" in blob or "einst" in blob)
        still_boot = "lade" in blob and "pack" in blob
        if has_mic and has_chrome and not still_boot:
            return True
        time.sleep(1.5)
    return False
'''

NEW_READY = '''def _looks_like_mic(n: dict) -> bool:
    """Match MicButton a11y across idle/listening/speaking/thinking/locked."""
    if not n.get("click"):
        return False
    blob = f"{n.get('desc', '')} {n.get('text', '')}".lower()
    if re.search(r"\\bmikrofon\\b|\\bmikro\\b|\\bmicrophone\\b|\\bmic button\\b", blob):
        return True
    # Non-idle MicButton labels omit the word Mikrofon
    if re.search(
        r"yorro spricht|yorro denkt|halten zum unterbrechen|halten zum sprechen|"
        r"tippen zum schreiben|tippen zum senden|mikro fixiert|mikro an",
        blob,
    ):
        return True
    return False


def _looks_like_home_chrome(blob: str) -> bool:
    """Dock labels + content-desc (DE/EN) — text or a11y."""
    b = blob.lower()
    has_timeline = bool(re.search(r"\\btimeline\\b|routenplanung|tagesplan", b))
    has_places = bool(re.search(r"\\borte\\b|\\bplaces\\b|orte finden|stempelkarte", b))
    has_settings = bool(re.search(r"\\beinst\\.?\\b|\\beinstellungen\\b|\\bsettings\\b", b))
    if has_timeline and (has_places or has_settings):
        return True
    if "timeline und routenplanung" in b and (
        "orte finden" in b or "einstellungen" in b
    ):
        return True
    return False


def _still_booting(blob: str, xml: str) -> bool:
    b = blob.lower()
    if "lade" in b and "pack" in b:
        return True
    if re.search(r"splash|app wird geladen|yorro startet|initialis", b):
        return True
    if "de.findus.app" not in xml and "findus" not in b:
        return True
    clickable = sum(1 for n in nodes(xml) if n.get("click"))
    if clickable < 2 and ("maplibre" not in b and "mikro" not in b):
        return True
    return False


def wait_app_ready(timeout_s: float = 90.0) -> bool:
    """After cold start: mic visible, map chrome up, Tippfeld not stuck.

    Robust to: MicButton a11y variants, DE/EN dock labels, content-desc,
    splash fade, cold-install lag, and non-Findus overlays (re-launch).
    """
    deadline = time.time() + timeout_s
    last_nudge = 0.0
    while time.time() < deadline:
        xml = dump()
        blob = _ui_blob(xml).lower()
        pkg_ok = "de.findus.app" in xml
        if not pkg_ok:
            now = time.time()
            if now - last_nudge > 4.0:
                adb(
                    "shell",
                    "monkey",
                    "-p",
                    "de.findus.app",
                    "-c",
                    "android.intent.category.LAUNCHER",
                    "1",
                )
                last_nudge = now
            time.sleep(1.5)
            continue
        has_mic = any(_looks_like_mic(n) for n in nodes(xml))
        has_chrome = _looks_like_home_chrome(blob)
        has_map = "maplibre" in blob or "showing a map" in blob
        still_boot = _still_booting(blob, xml)
        tippfeld_stuck = bool(
            re.search(r"frage an yorro|schreib deine frage", blob)
        )
        ready_core = has_mic and (has_chrome or has_map) and not still_boot
        if ready_core and not tippfeld_stuck:
            return True
        if has_mic and has_chrome and not still_boot and not tippfeld_stuck:
            return True
        time.sleep(1.2)
    return False
'''

OLD_RESET = '''def reset_app() -> None:
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1.0)
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(8.0)
    if not wait_app_ready(50.0):
        print("WARN app_ready_timeout", flush=True)
        time.sleep(6.0)
'''

NEW_RESET = '''def reset_app() -> None:
    # Dismiss common overlays that steal uiautomator focus (Assistant etc.)
    adb("shell", "am", "force-stop", "com.google.android.googlequicksearchbox")
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1.2)
    adb(
        "shell",
        "monkey",
        "-p",
        "de.findus.app",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    # Cold install / splash fade needs more than a fixed 8s
    time.sleep(10.0)
    if not wait_app_ready(90.0):
        print("WARN app_ready_timeout", flush=True)
        adb(
            "shell",
            "am",
            "start",
            "-n",
            "de.findus.app/.MainActivity",
        )
        time.sleep(8.0)
        if not wait_app_ready(45.0):
            print("WARN app_ready_timeout_retry", flush=True)
            time.sleep(6.0)
'''


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    for name, old in (
        ("dump", OLD_DUMP),
        ("wait_app_ready", OLD_READY),
        ("reset_app", OLD_RESET),
    ):
        if old not in text:
            raise SystemExit(f"MISSING BLOCK: {name}")
    text2 = (
        text.replace(OLD_DUMP, NEW_DUMP)
        .replace(OLD_READY, NEW_READY)
        .replace(OLD_RESET, NEW_RESET)
    )
    tmp = SRC.with_suffix(".py.tmp")
    tmp.write_text(text2, encoding="utf-8")
    tmp.replace(SRC)
    print("OK patched", SRC, "size", SRC.stat().st_size)


if __name__ == "__main__":
    main()
