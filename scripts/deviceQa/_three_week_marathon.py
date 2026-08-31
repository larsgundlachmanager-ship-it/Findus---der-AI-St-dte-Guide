#!/usr/bin/env python3
"""
3-Wochen Live-QA Marathon — Bridge / Call2 / Stichpunkte / Buttons / Integration.
Usage: python scripts/deviceQa/_three_week_marathon.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live10"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"
XML = OUT / "ui.xml"

# Kernfragen aus Playbook + scenarios.v1 + overnight (letzte 3 Wochen)
SCENARIOS: list[dict] = [
    # --- Dauerfehler / Overnight ---
    {
        "id": "wetter",
        "q": "Wie ist das Wetter gerade hier?",
        "wait": 22,
        "checks": {
            "need_any": [r"regen|sonne|wolken|grad|°|temperatur|jacke|wind"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "steak",
        "q": "Wo kann ich in der Naehe gut Steak essen?",
        "wait": 32,
        "checks": {
            "need_any": [r"steak|grill|rind|fleisch"],
            "fail_any": [r"\bvegan\b.*house|honest greens"],
            "want_btn": [r"speisekarte|route|maps|web"],
            "want_bulletish": True,
        },
    },
    {
        "id": "vegan",
        "q": "Kein Fleisch bitte, ich will vegan essen",
        "wait": 32,
        "reset_before": True,
        "checks": {
            "need_any": [r"vegan|pflanzlich|honest|grün|green"],
            "fail_any": [r"steakhouse|bulls|rindock|brasa"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "angus",
        "q": "Restaurant mit Angus-Steak in der Naehe",
        "wait": 32,
        "checks": {
            "need_any": [r"angus|steak|grill"],
            "fail_any": [r"pizzeria|vegan corner"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "hotel_pool",
        "q": "Hotel Freitag bis Sonntag mit Pool und Sauna unter 500 Euro",
        "wait": 35,
        "reset_before": True,
        "checks": {
            "need_any": [r"hotel|pool|sauna|stay22|buch"],
            "fail_any": [r"mit pool und$|stadt.?datensatz|hier bleiben"],
            "want_btn": [r"hotel|stay|buch|maps|mehr"],
        },
    },
    {
        "id": "oepnv",
        "q": "Wie komme ich am schnellsten mit oeffentlichen Verkehrsmitteln zum Hauptbahnhof?",
        "wait": 30,
        "checks": {
            "need_any": [r"bahn|bus|s-bahn|u-bahn|hbf|hauptbahnhof|verbindung|min"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|nav|starten|mehr"],
        },
    },
    {
        "id": "flug_wien_taxi",
        "q": "Morgen Flug nach Wien, bitte mit Taxi zum Flughafen",
        "wait": 40,
        "reset_before": True,
        "checks": {
            "need_any": [r"wien|flug|flughafen|leave|taxi|uber|abflug"],
            "fail_any": [r"steakhouse|passende optionen und routen werden"],
            "want_btn": [r"taxi|uber|flug|leave|route"],
        },
    },
    {
        "id": "kino",
        "q": "Welche Filme laufen heute Abend im Kino in der Naehe?",
        "wait": 35,
        "checks": {
            "need_any": [r"kino|film|uhr|vorstellung|ticket"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"ticket|programm|web|maps|kino"],
        },
    },
    {
        "id": "compound_hh",
        "q": "Morgen 9 Uhr los nach Hamburg, fruehstuecken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang",
        "wait": 50,
        "reset_before": True,
        "checks": {
            "need_any": [r"hamburg|frueh|früh|pann|michel|tour|sonnen"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"tagesplan|kalender|plan|route|tour"],
        },
    },
    {
        "id": "tour_1h",
        "q": "Wir haben eine Stunde — was haben wir hier noch nicht gesehen?",
        "wait": 35,
        "reset_before": True,
        "checks": {
            "need_any": [r"tour|stop|minute|gesehen|ort|hafen|route"],
            "fail_any": [r"32 std|via hotels in lissabon"],
            "want_btn": [r"route|starten|tour|nav"],
        },
    },
    {
        "id": "modul1",
        "q": "Wo bin ich hier gerade? Erzaehl mir was Interessantes",
        "wait": 32,
        "reset_before": True,
        "checks": {
            "need_any": [r"prisdorf|pinneberg|hamburg|ort|hier|geschichte|bist"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
            "want_bulletish": True,
        },
    },
    {
        "id": "wangerooge",
        "q": "Wie komme ich nach Wangerooge?",
        "wait": 35,
        "reset_before": True,
        "checks": {
            "need_any": [r"fähre|faehre|flug|insel|wangerooge|siw|frisonaut"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"fähre|faehre|flug|ticket|web|siw"],
        },
    },
    {
        "id": "fuss_notfall",
        "q": "Mein Freund hat den Fuss gebrochen, wo koennen wir hin?",
        "wait": 30,
        "checks": {
            "need_any": [r"notaufnahme|unfall|krankenhaus|ortho|arzt|klinik"],
            "fail_any": [r"zahnarzt"],
            "want_btn": [r"route|anrufen|nav|telefon"],
        },
    },
    {
        "id": "zahn",
        "q": "Ich habe akute Zahnschmerzen, welcher Zahnarzt hat jetzt Notdienst?",
        "wait": 30,
        "checks": {
            "need_any": [r"zahn|notdienst|praxis"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|anrufen|nav|web"],
        },
    },
    {
        "id": "outfit",
        "q": "Was soll ich heute Abend anziehen?",
        "wait": 25,
        "checks": {
            "need_any": [r"jacke|pulli|schicht|hose|kleid|schuhe|wind|regen|warm|kühl|kuehl"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "london",
        "q": "Ich plane ein Wochenende in London — Hotel mit guter Lage und was muss man gesehen haben?",
        "wait": 40,
        "reset_before": True,
        "checks": {
            "need_any": [r"london|hotel|tower|bridge|museum|hyde|covent"],
            "fail_any": [r"steakhouse|prisdorf|passende optionen und routen werden"],
            "want_btn": [r"hotel|maps|web|buch|route"],
        },
    },
    {
        "id": "lisbon",
        "q": "In zwei Wochen Wochenende nach Lissabon: Flug von Hamburg Freitag hin Sonntag zurueck, Hotel und Programm",
        "wait": 45,
        "reset_before": True,
        "checks": {
            "need_any": [r"lissabon|lisbon|flug|ham|lis|hotel|alfama|belem|belém"],
            "fail_any": [r"steakhouse|bulls|rindock|passende optionen und routen werden|mit pool und"],
            "want_btn": [r"flug|hotel|maps|buch|route|programm"],
        },
    },
    {
        "id": "nav_prisdorf",
        "q": "Navigiere mich zum Bahnhof Prisdorf",
        "wait": 28,
        "reset_before": True,
        "checks": {
            "need_any": [r"prisdorf|route|nav|bahn|min|starten"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav"],
        },
    },
    {
        "id": "veg_abend",
        "q": "Ich bin Vegetarier — wo essen wir gut zu Abend?",
        "wait": 32,
        "checks": {
            "need_any": [r"vegetar|vegan|gemüse|gemuese|kitchen|green"],
            "fail_any": [r"steakhouse|bulls|rindock"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "rooftop",
        "q": "Ich moechte heute Abend auf eine Rooftop-Party — welche gibt es und was soll ich anziehen?",
        "wait": 35,
        "checks": {
            "need_any": [r"party|rooftop|club|bar|jacke|outfit|abend"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"maps|web|ticket|route"],
        },
    },
]


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    adb("pull", "/sdcard/Download/ui.xml", str(XML))
    return XML.read_text(encoding="utf-8", errors="ignore")


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


def tap(x: int, y: int, wait: float = 0.4) -> None:
    adb("shell", "input", "tap", str(x), str(y))
    time.sleep(wait)


def shot(tag: str) -> None:
    adb("shell", "screencap", "-p", "/sdcard/Download/findus-now.png")
    adb("pull", "/sdcard/Download/findus-now.png", str(OUT / f"{tag}.png"))


def extract(tag: str, xml: str) -> str:
    path = OUT / f"{tag}.xml"
    path.write_text(xml, encoding="utf-8")
    subprocess.run([sys.executable, str(EXTRACT), str(path)], check=False)
    txt = OUT / f"{tag}-text.txt"
    return txt.read_text(encoding="utf-8", errors="ignore") if txt.exists() else ""


def dismiss() -> None:
    for _ in range(6):
        xml = dump()
        hit = None
        for n in nodes(xml):
            if not n["click"]:
                continue
            blob = (n["desc"] + " " + n["text"]).lower()
            if any(
                k in blob
                for k in (
                    "schließen",
                    "schliessen",
                    "fertig",
                    "timeline schließen",
                    "tippfeld schließen",
                    "abbrechen",
                )
            ) and "karte schließen" not in blob:
                hit = n
                break
        if not hit:
            return
        tap(hit["cx"], hit["cy"], 0.6)


def find_fragen(xml: str):
    return next(
        (n for n in nodes(xml) if n["desc"] == "Fragen" or n["text"] == "Fragen"),
        None,
    )


def tap_mic() -> bool:
    # Empirisch am Gerät (1080x2340): Mic ~500,2080
    for cx, cy in ((500, 2080), (540, 2080), (540, 2050), (540, 1850), (540, 2000)):
        tap(cx, cy, 0.15)
        time.sleep(1.7)
        xml = dump()
        if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
            return True
    xml = dump()
    for n in nodes(xml):
        if n["click"] and "mikrofon" in (n["desc"] + n["text"]).lower():
            tap(n["cx"], n["cy"], 0.2)
            time.sleep(1.5)
            if find_fragen(dump()) or any("EditText" in x["cls"] for x in nodes(dump())):
                return True
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
    time.sleep(14.0)


def ask(tag: str, text: str, wait_s: float) -> str:
    dismiss()
    time.sleep(0.4)
    xml = dump()
    if find_fragen(xml) or any("EditText" in n["cls"] for n in nodes(xml)):
        # tippfeld already open — close first for clean state
        for n in nodes(xml):
            if n["click"] and "tippfeld" in (n["desc"] + n["text"]).lower():
                tap(n["cx"], n["cy"], 0.5)
                break
        else:
            ab = next((n for n in nodes(xml) if n["click"] and "abbrechen" in (n["text"] + n["desc"]).lower()), None)
            if ab:
                tap(ab["cx"], ab["cy"], 0.5)
        time.sleep(0.5)

    if not tap_mic():
        shot(f"{tag}-nomodal")
        extract(f"{tag}-nomodal", dump())
        print("NO_MODAL", tag, flush=True)
        return ""
    xml = dump()
    edit = next((n for n in nodes(xml) if "EditText" in n["cls"]), None)
    fragen = find_fragen(xml)
    if not edit or not fragen:
        shot(f"{tag}-nomodal")
        extract(f"{tag}-nomodal", dump())
        print("NO_MODAL", tag, flush=True)
        return ""
    tap(edit["cx"], edit["cy"], 0.3)
    # clear residual (short)
    adb("shell", "input", "keyevent", "KEYCODE_MOVE_END")
    for _ in range(12):
        adb("shell", "input", "keyevent", "KEYCODE_DEL")
    safe = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
        .replace("ß", "ss")
        .replace("—", "-")
        .replace("–", "-")
        .replace(".", "")
    )
    adb("shell", "input", "text", safe.replace(" ", "%s"))
    time.sleep(0.9)
    # Soft-Keyboard weg, sonst verdeckt „Fragen“
    adb("shell", "input", "keyevent", "4")
    time.sleep(0.7)
    xml = dump()
    fragen = find_fragen(xml)
    if not fragen:
        print("NO_FRAGEN", tag, flush=True)
        shot(f"{tag}-nofragen")
        return ""
    tap(fragen["cx"], fragen["cy"], 1.0)
    # Fallback Enter
    adb("shell", "input", "keyevent", "66")
    time.sleep(0.5)
    print("submitted", tag, safe[:70], flush=True)
    # Wait until tippfeld gone
    deadline = time.time() + min(wait_s, 15.0)
    while time.time() < deadline:
        xml = dump()
        if find_fragen(xml) is None and not any(
            "frage an yorro" in (n["text"] + n["desc"]).lower() for n in nodes(xml)
        ):
            break
        time.sleep(1.0)
    time.sleep(max(8.0, wait_s - 15.0))
    # If tippfeld stuck, force close then capture
    xml = dump()
    if find_fragen(xml):
        ab = next(
            (
                n
                for n in nodes(xml)
                if n["click"]
                and any(k in (n["text"] + n["desc"]).lower() for k in ("abbrechen", "tippfeld"))
            ),
            None,
        )
        if ab:
            tap(ab["cx"], ab["cy"], 0.6)
            time.sleep(1.0)
    shot(tag)
    txt = extract(tag, dump())
    # Tippfeld leftover = failed submit
    if re.search(r"frage an yorro|schreib deine frage", txt, re.I):
        print("TIPPFELD_STUCK", tag, flush=True)
        return "TIPPFELD_STUCK\n" + txt
    return txt


def score(txt: str, checks: dict) -> dict:
    low = (txt or "").lower()
    buttons = re.findall(
        r"(speisekarte|route|maps|web|ticket|taxi|uber|anrufen|nav|starten|"
        r"tagesplan|hotel|stay|buch|flug|fähre|faehre|programm|mehr)",
        low,
        flags=re.I,
    )
    bullet_lines = [
        ln
        for ln in (txt or "").splitlines()
        if re.search(r"^(•|\*|·|- |\d+[.)]|km|uhr|€|euro)", ln.strip().lower())
        or re.search(r"\d+[.,]\d+\s*km|offen|geschlossen|€|\bstern", ln.lower())
    ]
    need_ok = True
    for pat in checks.get("need_any") or []:
        if re.search(pat, low, re.I):
            need_ok = True
            break
    else:
        if checks.get("need_any"):
            need_ok = False

    fails = []
    for pat in checks.get("fail_any") or []:
        if re.search(pat, low, re.I):
            fails.append(pat)

    want_btn = checks.get("want_btn") or []
    btn_ok = True
    if want_btn:
        btn_ok = any(re.search(p, low, re.I) for p in want_btn)

    placeholder = bool(
        re.search(r"passende optionen und routen werden", low)
    )
    emptyish = len((txt or "").strip()) < 80

    # Heuristik Qualität
    call2_ok = need_ok and not placeholder and not emptyish
    bridge_ok = not re.search(
        r"soll ich (die|das|dir).{0,40}(suchen|recherchieren|rausfinden)\?",
        low,
    )
    bullets_ok = True
    if checks.get("want_bulletish"):
        bullets_ok = len(bullet_lines) >= 1 or bool(
            re.search(r"\d+[.,]\d+\s*km|€|uhr|offen", low)
        )
    # Sterne-Spam unerwünscht
    if re.search(r"\d[.,]\d\s*sterne?\s*bei\s*\d+", low):
        bullets_ok = False
        fails.append("star_rating_bullet")

    integration_ok = call2_ok and (btn_ok if want_btn else True) and not fails

    verdict = "PASS" if (call2_ok and bridge_ok and bullets_ok and not fails and (btn_ok or not want_btn)) else "FAIL"
    if re.search(r"TIPPFELD_STUCK|frage an yorro|schreib deine frage", low):
        verdict = "FAIL"
        fails.append("tippfeld_stuck")
        call2_ok = False
        integration_ok = False

    return {
        "verdict": verdict,
        "bridge_ok": bridge_ok,
        "call2_ok": call2_ok,
        "bullets_ok": bullets_ok,
        "buttons_ok": btn_ok if want_btn else None,
        "buttons_found": sorted(set(buttons))[:12],
        "integration_ok": integration_ok,
        "fails": fails,
        "snippet": " | ".join(
            [ln.strip() for ln in (txt or "").splitlines() if ln.strip()][:18]
        )[:500],
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("reverse", "tcp:8791", "tcp:8791")
    reset_app()
    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": adb("get-serialno").stdout.strip(),
        "results": [],
    }

    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None

    for s in SCENARIOS:
        if only and s["id"] not in only:
            continue
        print(f"\n=== {s['id']} ===", flush=True)
        if s.get("reset_before"):
            reset_app()
        txt = ask(s["id"], s["q"], float(s["wait"]))
        if not txt:
            row = {
                "id": s["id"],
                "q": s["q"],
                "verdict": "FAIL",
                "error": "NO_MODAL",
                "bridge_ok": False,
                "call2_ok": False,
                "bullets_ok": False,
                "buttons_ok": False,
                "integration_ok": False,
                "snippet": "",
            }
        else:
            sc = score(txt, s["checks"])
            row = {"id": s["id"], "q": s["q"], **sc}
        report["results"].append(row)
        print(row["verdict"], row.get("fails"), (row.get("snippet") or "")[:120], flush=True)

    passed = sum(1 for r in report["results"] if r["verdict"] == "PASS")
    total = len(report["results"])
    report["summary"] = {"pass": passed, "total": total, "rate": (passed / total) if total else 0}

    out_json = OUT / "three-week-report.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    md = [
        f"# 3-Wochen Live-QA — {report['at'][:19]}Z",
        "",
        f"**Gerät:** `{report['device']}` · **Ergebnis:** {passed}/{total} PASS",
        "",
        "| ID | Verdict | Bridge | Call2 | Stichp. | Buttons | Integration | Hinweis |",
        "|----|---------|--------|-------|---------|---------|-------------|---------|",
    ]
    for r in report["results"]:
        btn = r.get("buttons_ok")
        btn_s = "—" if btn is None else ("✅" if btn else "❌")
        hint = ",".join(r.get("fails") or []) or r.get("error") or ""
        md.append(
            f"| {r['id']} | {r['verdict']} | "
            f"{'✅' if r.get('bridge_ok') else '❌'} | "
            f"{'✅' if r.get('call2_ok') else '❌'} | "
            f"{'✅' if r.get('bullets_ok') else '❌'} | "
            f"{btn_s} | "
            f"{'✅' if r.get('integration_ok') else '❌'} | {hint} |"
        )
    md.append("")
    md.append("Captures: `.cursor/live10/`")
    md_path = ROOT / "data" / "liveQuality" / "three-week-live-report-2026-08-28.md"
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\nReport →", out_json)
    print("Markdown →", md_path)
    print(f"PASS {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
