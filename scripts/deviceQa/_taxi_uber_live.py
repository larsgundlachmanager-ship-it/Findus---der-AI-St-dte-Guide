#!/usr/bin/env python3
"""
Live proof: Taxi vor Flug → Timeline + Uber /go/reserve with pickup_time + airport.

Ask: „Flug morgen … Taxi zum Flughafen vorbestellen“
Pass: UI/log shows scheduled Uber (pickup_time) and Flughafen/dropoff; Timeline taxi stop.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))

EXPECTED_SERIAL = "00143157P001105"
os.environ.setdefault("FINDUS_QA_SERIAL", EXPECTED_SERIAL)

from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"
XML = OUT / "ui.xml"
ASK_PORT = 8791
ASK_Q = (
    "Flug morgen nach Wien, bitte Taxi zum Flughafen vorbestellen"
)

UBER_RE = re.compile(
    r"https?://(?:m\.)?uber\.com/[^\s\"'<>]+|uber://[^\s\"'<>]+",
    re.I,
)


def serial() -> str:
    return require_qa_serial()


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", serial(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def ask_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{ASK_PORT}/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def post_ask(text: str) -> str:
    data = text.encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{ASK_PORT}/ask",
        data=data,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        return (r.read() or b"").decode("utf-8", errors="replace")


def dump() -> str:
    OUT.mkdir(parents=True, exist_ok=True)
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


def nodes(xml: str):
    for n in re.findall(r"<node\b[^>]*>", xml):
        text = re.search(r'\btext="([^"]*)"', n)
        desc = re.search(r'\bcontent-desc="([^"]*)"', n)
        bounds = re.search(r'\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        if not bounds:
            continue
        x1, y1, x2, y2 = map(int, bounds.groups())
        yield {
            "text": text.group(1) if text else "",
            "desc": desc.group(1) if desc else "",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "click": 'clickable="true"' in n,
        }


def visible_texts(xml: str) -> list[str]:
    out: list[str] = []
    for n in nodes(xml):
        for s in (n["text"], n["desc"]):
            s = (s or "").replace("&#10;", " ").strip()
            if s and s not in out:
                out.append(s)
    return out


def tap(x: int, y: int, wait: float = 0.55) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def shot(tag: str) -> None:
    dest = OUT / f"{tag}.png"
    data = subprocess.check_output([ADB, "-s", serial(), "exec-out", "screencap", "-p"])
    dest.write_bytes(data)
    try:
        from PIL import Image

        im = Image.open(dest)
        im.thumbnail((540, 960))
        im.save(OUT / f"{tag}-sm.png")
    except Exception:
        pass
    log(f"shot {dest}")


def clear_logcat() -> None:
    adb("logcat", "-c")


def logcat_dump(tag: str) -> str:
    r = adb("logcat", "-d", "-v", "brief", "*:I")
    text = (r.stdout or "") + (r.stderr or "")
    path = OUT / f"{tag}-log.txt"
    path.write_text(text, encoding="utf-8", errors="replace")
    return text


def extract_uber_urls(blob: str) -> list[str]:
    found: list[str] = []
    for m in UBER_RE.finditer(blob):
        u = m.group(0).rstrip(".,);]'\"")
        if u not in found:
            found.append(u)
    # Also unescape common JSON/log encodings
    for m in re.finditer(r"m\.uber\.com[^\\s\"'<>]+", blob, re.I):
        u = "https://" + m.group(0).replace("\\u0026", "&").replace("\\/", "/")
        u = u.rstrip(".,);]'\"")
        if u not in found:
            found.append(u)
    return found


def analyze_uber(url: str) -> dict:
    raw = unquote(url)
    parsed = urlparse(raw if "://" in raw else "https://" + raw)
    qs = parse_qs(parsed.query)
    pickup = (qs.get("pickup_time") or qs.get("pickupTime") or [None])[0]
    drop_lat = (qs.get("drop[latitude]") or qs.get("dropoff[latitude]") or [None])[0]
    drop_lng = (qs.get("drop[longitude]") or qs.get("dropoff[longitude]") or [None])[0]
    drop_nick = (
        qs.get("drop[nickname]")
        or qs.get("dropoff[nickname]")
        or qs.get("drop[formatted_address]")
        or qs.get("dropoff[formatted_address]")
        or [None]
    )[0]
    return {
        "url": url,
        "path": parsed.path,
        "is_reserve": "/go/reserve" in parsed.path.lower() or "pickup_time" in raw.lower(),
        "pickup_time": pickup,
        "drop_nickname": drop_nick,
        "drop_lat": drop_lat,
        "drop_lng": drop_lng,
        "has_airport_hint": bool(
            re.search(r"flughafen|airport|HAM|VIE|Wien|Hamburg", raw, re.I)
        ),
    }


def find_clickable(xml: str, *needles: str):
    low = [n.lower() for n in needles]
    for n in nodes(xml):
        if not n["click"]:
            continue
        blob = f"{n['text']} {n['desc']}".lower()
        if any(k in blob for k in low):
            return n
    return None


def open_timeline(xml: str) -> bool:
    n = find_clickable(xml, "timeline", "plan", "kalender")
    if not n:
        return False
    log(f"tap Timeline/Plan @ {n['cx']},{n['cy']} ({n['text'] or n['desc']})")
    tap(n["cx"], n["cy"], 1.2)
    return True


def tap_uber(xml: str) -> bool:
    n = find_clickable(xml, "uber", "fahrt mit uber", "taxi · los", "taxi vorbestellen")
    if not n:
        return False
    log(f"tap Uber/Taxi @ {n['cx']},{n['cy']} ({n['text'] or n['desc']})")
    tap(n["cx"], n["cy"], 2.0)
    return True


def score_ui(texts: list[str]) -> dict:
    blob = " | ".join(texts).lower()
    return {
        "has_taxi": bool(re.search(r"taxi", blob)),
        "has_uber": bool(re.search(r"uber", blob)),
        "has_timeline_taxi": bool(re.search(r"taxi\s*[·•\-]?\s*los|\blos\s*\d", blob)),
        "has_airport": bool(re.search(r"flughafen|airport", blob)),
        "has_time": bool(re.search(r"\b\d{1,2}:\d{2}\b", blob)),
        "texts_sample": texts[:40],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "started": datetime.now(timezone.utc).isoformat(),
        "serial": serial(),
        "ask": ASK_Q,
        "pass": False,
        "checks": {},
    }

    if not ask_health():
        log("ERROR: askServer not on :8791 — start node scripts/deviceQa/askServer.mjs")
        report["error"] = "askServer missing"
        (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return 2

    adb("reverse", "tcp:8791", "tcp:8791")
    clear_logcat()
    log(f"ASK: {ASK_Q}")
    try:
        resp = post_ask(ASK_Q)
        log(f"askServer: {resp[:200]}")
    except Exception as e:
        log(f"ERROR ask failed: {e}")
        report["error"] = str(e)
        (OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return 2

    # Wait for flight+taxi research
    best_xml = ""
    best_texts: list[str] = []
    for i in range(24):
        time.sleep(4.0)
        xml = dump()
        texts = visible_texts(xml)
        ui = score_ui(texts)
        log(f"poll[{i}] taxi={ui['has_taxi']} uber={ui['has_uber']} airport={ui['has_airport']} time={ui['has_time']}")
        if len(texts) > len(best_texts):
            best_xml, best_texts = xml, texts
        if ui["has_uber"] or ui["has_timeline_taxi"] or (ui["has_taxi"] and ui["has_airport"]):
            best_xml, best_texts = xml, texts
            break

    shot("after-ask")
    (OUT / "after-ask-texts.txt").write_text("\n".join(best_texts), encoding="utf-8")
    if best_xml:
        (OUT / "after-ask.xml").write_text(best_xml, encoding="utf-8")

    ui_score = score_ui(best_texts)
    report["ui"] = ui_score

    # Open timeline if present, then Uber
    xml = best_xml or dump()
    opened_tl = open_timeline(xml)
    if opened_tl:
        time.sleep(1.5)
        xml = dump()
        shot("timeline")
        tl_texts = visible_texts(xml)
        (OUT / "timeline-texts.txt").write_text("\n".join(tl_texts), encoding="utf-8")
        report["timeline"] = score_ui(tl_texts)
        best_texts = tl_texts or best_texts

    tapped = tap_uber(xml)
    report["tapped_uber"] = tapped
    if tapped:
        time.sleep(2.5)
        shot("after-uber-tap")
        # May have left Findus for Chrome/Uber — still harvest logcat

    logs = logcat_dump("post")
    urls = extract_uber_urls(logs + "\n" + "\n".join(best_texts))
    analyzed = [analyze_uber(u) for u in urls]
    report["uber_urls"] = analyzed

    # Prefer reserve URLs
    reserves = [a for a in analyzed if a["is_reserve"]]
    pick = reserves[0] if reserves else (analyzed[0] if analyzed else None)
    report["picked"] = pick

    checks = {
        "uber_url_found": bool(analyzed),
        "is_go_reserve_or_pickup_time": bool(pick and pick["is_reserve"]),
        "has_pickup_time": bool(pick and pick.get("pickup_time")),
        "has_airport_in_url_or_ui": bool(
            (pick and pick.get("has_airport_hint"))
            or ui_score.get("has_airport")
            or (report.get("timeline") or {}).get("has_airport")
        ),
        "ui_taxi_or_uber": bool(ui_score.get("has_taxi") or ui_score.get("has_uber")),
        "timeline_taxi_los": bool(
            ui_score.get("has_timeline_taxi")
            or (report.get("timeline") or {}).get("has_timeline_taxi")
        ),
    }
    report["checks"] = checks
    report["pass"] = bool(
        checks["uber_url_found"]
        and checks["is_go_reserve_or_pickup_time"]
        and checks["has_pickup_time"]
        and checks["has_airport_in_url_or_ui"]
    )
    report["finished"] = datetime.now(timezone.utc).isoformat()

    (OUT / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    log("--- RESULT ---")
    log(json.dumps(checks, indent=2, ensure_ascii=False))
    if pick:
        log(f"picked: {pick.get('url')}")
        log(f"pickup_time={pick.get('pickup_time')} airport_hint={pick.get('has_airport_hint')}")
    log(f"PASS={report['pass']}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
