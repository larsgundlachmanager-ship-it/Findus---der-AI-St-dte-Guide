#!/usr/bin/env python3
"""Live QA on the connected phone: yorro://ask, screenshot, UI dump, logcat slice."""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
SERIAL = "00143157P001105"
PKG = "de.findus.app"
OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")
XML = OUT / "ui.xml"


def adb(*args: str, text: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", SERIAL, *args],
        capture_output=True,
        text=text,
    )


def wake() -> None:
    adb("shell", "input", "keyevent", "224")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    time.sleep(4.0)


def dump_ui() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


def visible_text(xml: str) -> list[str]:
    out: list[str] = []
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        t = re.search(r'text="([^"]+)"', n)
        d = re.search(r'content-desc="([^"]+)"', n)
        for raw in (t.group(1) if t else "", d.group(1) if d else ""):
            s = raw.replace("&#10;", " ").replace("&amp;", "&").strip()
            if s and s not in out and s not in (".", " "):
                out.append(s)
    return out


def shot(tag: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output([ADB, "-s", SERIAL, "exec-out", "screencap", "-p"])
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass
    print("shot", dest)
    return dest


def send_ask(text: str) -> None:
    url = "yorro://ask?q=" + quote(text, safe="")
    # Quote for device mksh so `?` is not globbed away.
    cmd = (
        "am start -a android.intent.action.VIEW "
        f"-d '{url}' -n {PKG}/.MainActivity"
    )
    r = adb("shell", cmd)
    print("ask", text)
    err = ((r.stderr or "") + (r.stdout or "")).strip()
    if err:
        print(err[:400])


def logcat_slice(tag: str) -> None:
    r = adb("logcat", "-d", "-t", "400")
    raw = r.stdout or ""
    keys = (
        "TASK",
        "speech",
        "pitch",
        "steak",
        "vegan",
        "Restaurant",
        "Wetter",
        "Hotel",
        "Route",
        "ReactNativeJS",
        "findus",
        "yorro",
        "typed ask",
        "concierge",
        "Speise",
        "Apotheke",
    )
    hits = [
        ln
        for ln in raw.splitlines()
        if any(k.lower() in ln.lower() for k in keys)
    ]
    (OUT / f"{tag}-log.txt").write_text("\n".join(hits[-120:]), encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    args = sys.argv[1:]
    if not args:
        print("usage: wake | shot TAG | ask --tag TAG --wait SEC TEXT")
        return 2
    cmd = args[0]
    if cmd == "wake":
        wake()
        shot("00-home")
        xml = dump_ui()
        (OUT / "00-home.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
        print("home ok", len(visible_text(xml)), "labels")
        return 0
    if cmd == "shot":
        tag = args[1] if len(args) > 1 else "now"
        shot(tag)
        xml = dump_ui()
        (OUT / f"{tag}.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
        print("shot ok", tag, "labels", len(visible_text(xml)))
        return 0
    if cmd == "ask":
        tag = "ask"
        wait = 40.0
        rest: list[str] = []
        i = 1
        while i < len(args):
            if args[i] == "--tag" and i + 1 < len(args):
                tag = args[i + 1]
                i += 2
                continue
            if args[i] == "--wait" and i + 1 < len(args):
                wait = float(args[i + 1])
                i += 2
                continue
            rest.append(args[i])
            i += 1
        q = " ".join(rest).strip()
        if not q:
            print("empty ask")
            return 2
        adb("logcat", "-c")
        send_ask(q)
        time.sleep(wait)
        shot(tag)
        xml = dump_ui()
        (OUT / f"{tag}.txt").write_text("\n".join(visible_text(xml)), encoding="utf-8")
        logcat_slice(tag)
        print("--- UI ---")
        raw = (OUT / f"{tag}.txt").read_text(encoding="utf-8")[:4500]
        sys.stdout.buffer.write(raw.encode("utf-8", "replace"))
        print()
        return 0
    print("usage: wake | shot TAG | ask --tag TAG --wait SEC TEXT")
    return 2


if __name__ == "__main__":
    sys.exit(main())
