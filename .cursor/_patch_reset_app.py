from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_three_week_marathon.py")
t = p.read_text(encoding="utf-8")
old = '''def wait_app_ready(timeout_s: float = 45.0) -> bool:
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


def reset_app() -> None:
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
new = '''def wait_app_ready(timeout_s: float = 28.0) -> bool:
    """After cold start: map chrome up (Ask-Server braucht Poller)."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        xml = dump()
        blob = _ui_blob(xml).lower()
        has_chrome = "timeline" in blob and ("orte" in blob or "einst" in blob)
        still_boot = ("lade" in blob and "pack" in blob) or "stadt wird" in blob
        if has_chrome and not still_boot:
            return True
        time.sleep(1.2)
    return False


def reset_app() -> None:
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
    time.sleep(10.0)
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")
    if not wait_app_ready(28.0):
        print("WARN app_ready_timeout", flush=True)
        time.sleep(4.0)
'''
if old not in t:
    raise SystemExit("OLD_BLOCK_NOT_FOUND")
p.write_text(t.replace(old, new), encoding="utf-8")
print("patched ok")
