# Force-refresh Danzig pack via Settings UI.
# Usage: python .cursor/_force_danzig_refresh_ui.py [serial]
import re
import subprocess
import sys
import time
from pathlib import Path

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "00143157P001105"
ADB = str(Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe")
TMP = Path.home() / "AppData/Local/Temp/findus_force_ui.xml"


def adb(*args):
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dump_nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/uiF.xml")
    adb("pull", "/sdcard/uiF.xml", str(TMP))
    xml = TMP.read_text(encoding="utf-8", errors="replace")
    nodes = []
    for n in re.findall(r"<node [^>]+>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        a, b, c, d = map(int, bounds.groups())
        label = (
            (text.group(1) if text else "")
            or (desc.group(1) if desc else "")
        ).strip()
        nodes.append((label, a, b, c, d, 'clickable="true"' in n))
    return nodes


def tap_center(a, b, c, d):
    adb("shell", "input", "tap", str((a + c) // 2), str((b + d) // 2))


def find_label(nodes, *needles):
    for label, a, b, c, d, click in nodes:
        low = label.lower()
        if all(n.lower() in low for n in needles):
            return label, a, b, c, d, click
    return None


def main():
    adb("shell", "input", "tap", "886", "2262")
    time.sleep(2)
    adb("shell", "input", "swipe", "540", "1700", "540", "800", "350")
    time.sleep(1)
    nodes = dump_nodes()
    row = find_label(nodes, "offline")
    if not row:
        print("no offline row")
        return 1
    print("open", row[0].encode("ascii", "replace").decode())
    tap_center(*row[1:5])
    time.sleep(2)
    nodes = dump_nodes()
    danzig = find_label(nodes, "danzig", "offline")
    if not danzig:
        print("no danzig row")
        for n in nodes:
            if n[0]:
                print(" ", n[0].encode("ascii", "replace").decode()[:80])
        return 2
    print("open", danzig[0].encode("ascii", "replace").decode())
    tap_center(*danzig[1:5])
    time.sleep(1.5)
    adb("shell", "input", "swipe", "540", "1400", "540", "900", "300")
    time.sleep(1)
    nodes = dump_nodes()
    aktual = None
    for label, a, b, c, d, click in nodes:
        if label == "Aktualisieren" and click:
            aktual = (label, a, b, c, d, click)
            break
    if not aktual:
        print("no Aktualisieren")
        for n in nodes:
            low = n[0].lower()
            if "aktual" in low or "danzig" in low or n[0] == "Pack":
                print(" ", n[0].encode("ascii", "replace").decode(), n[1:5])
        return 3
    print("tap", aktual[0], aktual[1:5])
    tap_center(*aktual[1:5])
    print("waiting 70s for download...")
    time.sleep(70)
    nodes = dump_nodes()
    for label, *_rest in nodes:
        low = label.lower()
        if "danzig" in low or ("v" in low and "mb" in low):
            print("STATUS", label.encode("ascii", "replace").decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
