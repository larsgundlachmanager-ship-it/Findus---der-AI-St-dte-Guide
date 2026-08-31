#!/usr/bin/env python3
"""Live: Wochenendurlaub+Flug → Reisebüro (nicht Pitch/Tour/Pool). Tippfeld."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live11\weekend-flight")
OUT.mkdir(parents=True, exist_ok=True)

ASKS = [
    (
        "wknd",
        "Plane mir einen Wochenendurlaub nach Lissabon in zwei Wochen. Flug von Hamburg, Hotel und grobes Programm.",
        55,
    ),
    (
        "flight_only",
        "Suche Fluege Hamburg Lissabon Freitag 11 September hin und Sonntag 13 September zurueck",
        45,
    ),
    ("fu_airport", "Wie komme ich zum Flughafen", 35),
]


def adb(*a: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump(tag: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / f"{tag}.xml"
    r = adb("pull", "/sdcard/Download/ui.xml", str(p))
    if not p.exists():
        p.write_text("<hierarchy/>", encoding="utf-8")
        print("dump_fail", tag, (r.stderr or "")[:120])
    return p.read_text(encoding="utf-8", errors="ignore")


def shot(tag: str) -> None:
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def nodes(xml: str):
    for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
        text = re.search(r'text="([^"]*)"', n)
        desc = re.search(r'content-desc="([^"]*)"', n)
        bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cls = re.search(r'class="([^"]*)"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cls": cls.group(1) if cls else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def ui_blob(xml: str) -> str:
    parts = []
    for n in nodes(xml):
        if n["text"]:
            parts.append(n["text"])
        if n["desc"]:
            parts.append(n["desc"])
    return "\n".join(parts)


def find_fragen(xml: str):
    return next(
        (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
        None,
    )


def dismiss() -> None:
    for _ in range(8):
        xml = dump("dismiss")
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower()
            if any(
                k in blob
                for k in (
                    "tippfeld schließen",
                    "schließen",
                    "schliessen",
                    "abbrechen",
                    "fertig",
                    "bleiben",
                )
            ):
                if "karte schließen" in blob and find_fragen(xml):
                    continue
                hit = n
                break
        if not hit:
            return
        adb("shell", "input", "tap", str(hit["cx"]), str(hit["cy"]))
        time.sleep(0.6)


def open_tippfeld() -> bool:
    xml = dump("pre-mic")
    if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
        return True
    for cy in (1850, 1920, 1980, 2040, 2100):
        adb("shell", "input", "tap", "540", str(cy))
        time.sleep(1.5)
        xml = dump(f"mic-{cy}")
        if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
            return True
    return False


def score(blob: str) -> dict:
    b = blob.lower()
    return {
        "lisbon": bool(re.search(r"lissabon|lisbon|lisboa", b)),
        "flight": bool(re.search(r"flug|flieger|hamburg|ham\b|abflug", b)),
        "hotel": bool(re.search(r"hotel|übernacht|uebernacht|unterkunft", b)),
        "pollution": bool(
            re.search(
                r"mit pool|steak|pannfisch|museum in gehweite|tour ·|mehrere stops",
                b,
            )
        ),
        "airport_nav": bool(re.search(r"flughafen|s-bahn|öpnv|opnv|taxi|leave|los", b)),
        "preview": re.sub(r"\s+", " ", blob)[:280],
    }


def ask(tag: str, text: str, wait_s: float) -> dict:
    dismiss()
    time.sleep(0.3)
    if not open_tippfeld():
        shot(f"{tag}-nomodal")
        dump(f"{tag}-nomodal")
        print("NO_MODAL", tag)
        return {"ok": False, "reason": "no_modal"}
    xml = dump(f"{tag}-open")
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit or not fragen:
        print("NO_EDIT", tag)
        return {"ok": False, "reason": "no_edit"}
    adb("shell", "input", "tap", str(edit["cx"]), str(edit["cy"]))
    time.sleep(0.25)
    adb("shell", "input", "keyevent", "123")  # move end
    # clear roughly
    for _ in range(40):
        adb("shell", "input", "keyevent", "67")  # DEL
    # ADB text: no special chars that break
    safe = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace("'", " ")
        .replace('"', " ")
        .replace(":", " ")
        .replace(",", " ")
        .replace(".", " ")
    )
    adb("shell", "input", "text", safe.replace(" ", "%s"))
    time.sleep(0.4)
    adb("shell", "input", "tap", str(fragen["cx"]), str(fragen["cy"]))
    time.sleep(wait_s)
    dismiss()
    xml = dump(f"{tag}-after")
    shot(f"{tag}-after")
    blob = ui_blob(xml)
    (OUT / f"{tag}-text.txt").write_text(blob, encoding="utf-8")
    s = score(blob)
    print(tag, s)
    return s


def main() -> None:
    print("=== WEEKEND+FLIGHT LIVE ===")
    # Stop sticky tour if any
    dismiss()
    for tag, q, w in ASKS:
        ask(tag, q, w)
        time.sleep(2)


if __name__ == "__main__":
    main()
