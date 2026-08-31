#!/usr/bin/env python3
"""
40+ Live-QA (Ask-Server) — Bridge/Call2/Stichpunkte/Buttons.
Usage:
  # Terminal: node scripts/deviceQa/askServer.mjs + adb reverse
  python scripts/deviceQa/_qa40_live.py              # all
  python scripts/deviceQa/_qa40_live.py wetter steak # subset
  python scripts/deviceQa/_qa40_live.py --from oepnv # from id onward
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live12"
EXTRACT = ROOT / ".cursor" / "extract_ui.py"
PKG = "de.findus.app"
PORT = 8791

# 40+ Szenarien aus scenarios.v1 + Playbook + Overnight + Follow-ups
SCENARIOS: list[dict] = [
    # --- Call1/Call2 Kern ---
    {
        "id": "wetter",
        "q": "Wie ist das Wetter gerade hier?",
        "wait": 22,
        "family": "weather",
        "checks": {
            "need_any": [r"regen|sonne|wolken|grad|°|temperatur|jacke|wind|bewölkt|bewoelkt|klar"],
            "fail_any": [r"passende optionen und routen werden", r"steakhouse", r"keine live-wetterdaten", r"wetter in sechzehn"],
            "want_btn": [],
            "bridge_fail": [r"soll ich .{0,40}(suchen|recherchieren)"],
        },
    },
    {
        "id": "outfit",
        "q": "Was soll ich heute Abend anziehen?",
        "wait": 24,
        "family": "weather_outfit",
        "checks": {
            "need_any": [r"jacke|pulli|schicht|hose|kleid|schuhe|wind|regen|warm|kühl|kuehl"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "steak",
        "q": "Wo kann ich in der Naehe gut Steak essen?",
        "wait": 34,
        "reset_before": True,
        "family": "dining",
        "checks": {
            "need_any": [r"steak|grill|rind|fleisch"],
            "fail_any": [r"\bvegan\b.*house|honest greens"],
            "want_btn": [r"speisekarte|route|maps|web|nav"],
            "want_bulletish": True,
        },
    },
    {
        "id": "steak_fu_reject",
        "q": "Nee, mag ich nicht — was noch?",
        "wait": 30,
        "family": "dining_followup",
        "checks": {
            "need_any": [r"steak|grill|rind|restaurant|fleisch"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"speisekarte|route|maps|web"],
        },
    },
    {
        "id": "vegan",
        "q": "Kein Fleisch bitte, ich will vegan essen",
        "wait": 34,
        "reset_before": True,
        "family": "dining_diet",
        "checks": {
            "need_any": [r"vegan|pflanzlich|honest|grün|green"],
            "fail_any": [r"steakhouse|bulls|rindock|brasa"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "veg_abend",
        "q": "Ich bin Vegetarier — wo essen wir gut zu Abend?",
        "wait": 32,
        "family": "dining_diet",
        "checks": {
            "need_any": [r"vegetar|vegan|gemüse|gemuese|kitchen|green"],
            "fail_any": [r"steakhouse|bulls|rindock"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "angus",
        "q": "Restaurant mit Angus-Steak in der Naehe",
        "wait": 34,
        "reset_before": True,
        "family": "dining_hard",
        "checks": {
            "need_any": [r"angus|steak|grill"],
            "fail_any": [r"pizzeria|vegan corner"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "pannfisch",
        "q": "Welches Restaurant bietet Hamburger Pannfisch mit direktem Elbblick?",
        "wait": 36,
        "reset_before": True,
        "family": "dining_hard",
        "checks": {
            "need_any": [r"pann|fisch|elb|blick|restaurant"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"speisekarte|route|maps|web"],
        },
    },
    {
        "id": "fischbroetchen",
        "q": "Wo kriege ich das guenstigste Fischbroetchen in der Naehe und wie teuer ist es?",
        "wait": 32,
        "family": "dining",
        "checks": {
            "need_any": [r"fisch|broetchen|brotchen|imbiss|bude|euro|€"],
            "fail_any": [r"taxi|airbnb"],
            "want_btn": [r"route|maps|nav|starten"],
        },
    },
    # --- Hotel / Stay ---
    {
        "id": "hotel_pool",
        "q": "Hotel Freitag bis Sonntag mit Pool und Sauna unter 500 Euro",
        "wait": 38,
        "reset_before": True,
        "family": "hotel",
        "checks": {
            "need_any": [r"hotel|pool|sauna|stay22|buch"],
            "fail_any": [r"mit pool und$|stadt.?datensatz|hier bleiben"],
            "want_btn": [r"hotel|stay|buch|maps|mehr|web"],
        },
    },
    {
        "id": "hotel_fu_pool",
        "q": "Hat das erste Hotel wirklich einen Pool?",
        "wait": 28,
        "family": "hotel_followup",
        "checks": {
            "need_any": [r"pool|sauna|hotel|ja|nein|beleg"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    # --- Transit / Nav ---
    {
        "id": "oepnv",
        "q": "Wie komme ich am schnellsten mit oeffentlichen Verkehrsmitteln zum Hauptbahnhof?",
        "wait": 32,
        "reset_before": True,
        "family": "transit",
        "checks": {
            "need_any": [r"bahn|bus|s-bahn|u-bahn|hbf|hauptbahnhof|verbindung|min|abfahrt"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|nav|starten|mehr"],
        },
    },
    {
        "id": "nav_prisdorf",
        "q": "Navigiere mich zum Bahnhof Prisdorf",
        "wait": 28,
        "reset_before": True,
        "family": "nav",
        "checks": {
            "need_any": [r"prisdorf|route|nav|bahn|min|starten"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav"],
        },
    },
    {
        "id": "nav_fast_hbf",
        "q": "Bring mich schnell zum Hauptbahnhof",
        "wait": 28,
        "reset_before": True,
        "family": "nav",
        "checks": {
            "need_any": [r"hauptbahnhof|hbf|route|min|nav"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav"],
        },
    },
    {
        "id": "toilet",
        "q": "Wo gibt es hier saubere oeffentliche Toiletten?",
        "wait": 26,
        "family": "friction",
        "checks": {
            "need_any": [r"toilette|wc|sanitär|sanitaer|klo"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav|maps"],
        },
    },
    # --- Flug / Leave-by / Taxi ---
    {
        "id": "flug_wien_taxi",
        "q": "Morgen Flug nach Wien, bitte mit Taxi zum Flughafen",
        "wait": 42,
        "reset_before": True,
        "family": "flight",
        "checks": {
            "need_any": [r"wien|flug|flughafen|leave|taxi|uber|abflug|ham"],
            "fail_any": [r"steakhouse|passende optionen und routen werden"],
            "want_btn": [r"taxi|uber|flug|leave|route|maps"],
        },
    },
    {
        "id": "flug_fu_leaveby",
        "q": "Wann muss ich spaetestens los?",
        "wait": 30,
        "family": "flight_followup",
        "checks": {
            "need_any": [r"uhr|leave|los|min|abflug|spaetestens|spätestens"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "flug_fu_handgepaeck",
        "q": "Wie viel Handgepaeck darf ich mitnehmen?",
        "wait": 28,
        "family": "flight_followup",
        "checks": {
            "need_any": [r"kg|kilo|hand|gepaeck|gepäck|cm|cabin|airline"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "flug_barcelona",
        "q": "Morgen fliege ich nach Barcelona",
        "wait": 36,
        "reset_before": True,
        "family": "flight",
        "checks": {
            "need_any": [r"barcelona|flug|flughafen|leave|abflug"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"flug|leave|route|taxi|uber|esim|web"],
        },
    },
    {
        "id": "wangerooge",
        "q": "Wie komme ich nach Wangerooge?",
        "wait": 36,
        "reset_before": True,
        "family": "island",
        "checks": {
            "need_any": [r"fähre|faehre|flug|insel|wangerooge|siw|frisonaut"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"fähre|faehre|flug|ticket|web|siw|maps"],
        },
    },
    # --- Kino / Events / Nightlife ---
    {
        "id": "kino",
        "q": "Welche Filme laufen heute Abend im Kino in der Naehe?",
        "wait": 36,
        "reset_before": True,
        "family": "cinema",
        "checks": {
            "need_any": [r"kino|film|uhr|vorstellung|ticket"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"ticket|programm|web|maps|kino|route"],
        },
    },
    {
        "id": "kino_fu_spiderman",
        "q": "Gibt es Spider-Man heute?",
        "wait": 30,
        "family": "cinema_followup",
        "checks": {
            "need_any": [r"spider|film|kino|uhr|nein|nicht|heute"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "rooftop",
        "q": "Ich moechte heute Abend auf eine Rooftop-Party — welche gibt es und was soll ich anziehen?",
        "wait": 36,
        "reset_before": True,
        "family": "nightlife",
        "checks": {
            "need_any": [r"party|rooftop|club|bar|jacke|outfit|abend|location"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"maps|web|ticket|route"],
        },
    },
    {
        "id": "kiel_party",
        "q": "Was geht heute Abend noch in Kiel — Party oder Konzert?",
        "wait": 36,
        "reset_before": True,
        "family": "nightlife",
        "checks": {
            "need_any": [r"kiel|party|konzert|club|bar|event|abend"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"maps|web|ticket|route"],
        },
    },
    # --- Compound / Plan / Tour ---
    {
        "id": "compound_hh",
        "q": "Morgen 9 Uhr los nach Hamburg, fruehstuecken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang",
        "wait": 55,
        "reset_before": True,
        "family": "compound",
        "checks": {
            "need_any": [r"hamburg|frueh|früh|pann|michel|tour|sonnen"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"tagesplan|kalender|plan|route|tour"],
        },
    },
    {
        "id": "compound_fu_punkte",
        "q": "Lass uns jeden Punkt durchgehen",
        "wait": 35,
        "family": "plan_walkthrough",
        "checks": {
            "need_any": [r"punkt|frueh|früh|hamburg|erste|als nächstes|naechstes|tour|pann"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "tour_1h",
        "q": "Wir haben eine Stunde — was haben wir hier noch nicht gesehen?",
        "wait": 36,
        "reset_before": True,
        "family": "tour",
        "checks": {
            "need_any": [r"tour|stop|minute|gesehen|ort|hafen|route|noch"],
            "fail_any": [r"32 std|via hotels in lissabon"],
            "want_btn": [r"route|starten|tour|nav"],
        },
    },
    {
        "id": "kiel_combo",
        "q": "Wir wollen nach Kiel: kostenlos parken, Pizza Takeaway mitnehmen und an der Foerde den Sonnenuntergang sehen — beste Kombi?",
        "wait": 42,
        "reset_before": True,
        "family": "compound",
        "checks": {
            "need_any": [r"kiel|park|pizza|förde|foerde|sonnen|sunset"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|maps|nav|starten"],
        },
    },
    {
        "id": "day_budget",
        "q": "Mein Budget fuer heute ist 50 Euro — plane mir Mittagessen, eine Aktivitaet und einen Snack am Abend",
        "wait": 40,
        "reset_before": True,
        "family": "day_plan",
        "checks": {
            "need_any": [r"mittag|essen|aktiv|snack|euro|50|plan"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|maps|plan|starten"],
        },
    },
    # --- Modul 1 / POI ---
    {
        "id": "modul1",
        "q": "Wo bin ich hier gerade? Erzaehl mir was Interessantes",
        "wait": 34,
        "reset_before": True,
        "family": "m1",
        "checks": {
            "need_any": [r"prisdorf|pinneberg|hamburg|ort|hier|geschichte|bist|bist du"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
            "want_bulletish": True,
        },
    },
    {
        "id": "modul1_fu_mehr",
        "q": "Erzaehl mir mehr dazu",
        "wait": 32,
        "family": "m1_followup",
        "checks": {
            "need_any": [r"geschichte|jahr|gebaut|ort|weil|damals|heute"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "elbe_width",
        "q": "Wie breit ist die Elbe hier ungefaehr?",
        "wait": 26,
        "reset_before": True,
        "family": "fact",
        "checks": {
            "need_any": [r"meter|kilometer|breit|m\b|km"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    # --- Notfall ---
    {
        "id": "fuss_notfall",
        "q": "Mein Freund hat den Fuss gebrochen, wo koennen wir hin?",
        "wait": 30,
        "reset_before": True,
        "family": "emergency",
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
        "reset_before": True,
        "family": "emergency",
        "checks": {
            "need_any": [r"zahn|notdienst|praxis"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|anrufen|nav|web"],
        },
    },
    {
        "id": "apotheke",
        "q": "Wo ist die naechste Apotheke, die auch nachts geoeffnet hat?",
        "wait": 28,
        "family": "emergency",
        "checks": {
            "need_any": [r"apotheke|notdienst|nacht|geoeffnet|geöffnet"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|anrufen|nav|maps"],
        },
    },
    # --- Remote cities / Reisebüro ---
    {
        "id": "london",
        "q": "Ich plane ein Wochenende in London — Hotel mit guter Lage und was muss man gesehen haben?",
        "wait": 42,
        "reset_before": True,
        "family": "remote_trip",
        "checks": {
            "need_any": [r"london|hotel|tower|bridge|museum|hyde|covent"],
            "fail_any": [r"steakhouse|prisdorf|passende optionen und routen werden"],
            "want_btn": [r"hotel|maps|web|buch|route"],
        },
    },
    {
        "id": "lisbon",
        "q": "In zwei Wochen Wochenende nach Lissabon: Flug von Hamburg Freitag hin Sonntag zurueck, Hotel und Programm",
        "wait": 48,
        "reset_before": True,
        "family": "remote_trip",
        "checks": {
            "need_any": [r"lissabon|lisbon|flug|ham|lis|hotel|alfama|belem|belém|programm"],
            "fail_any": [r"steakhouse|bulls|rindock|passende optionen und routen werden|mit pool und"],
            "want_btn": [r"flug|hotel|maps|buch|route|programm|web"],
        },
    },
    {
        "id": "scooter",
        "q": "Wo kann ich mir fuer heute einen E-Scooter leihen?",
        "wait": 28,
        "reset_before": True,
        "family": "mobility",
        "checks": {
            "need_any": [r"scooter|lime|tier|voi|leihen|verleih|e-scooter"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"web|maps|app|route"],
        },
    },
    {
        "id": "pass_lost",
        "q": "Ich habe meinen Reisepass verloren, wo ist mein Konsulat?",
        "wait": 30,
        "reset_before": True,
        "family": "safety",
        "checks": {
            "need_any": [r"konsulat|botschaft|pass|ausweis|behörde|behoerde"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|maps|web|anrufen"],
        },
    },
    {
        "id": "spikeball",
        "q": "Wir wollen Spikeball spielen, moeglichst mit kostenlosem Parkplatz",
        "wait": 32,
        "reset_before": True,
        "family": "activity",
        "checks": {
            "need_any": [r"spike|strand|park|sand|platz|spiel"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|maps|starten|nav"],
        },
    },
    {
        "id": "museum_trex",
        "q": "Wo kann ich einen Tyrannosaurus Rex sehen und welches Museum lohnt sich mehr?",
        "wait": 34,
        "reset_before": True,
        "family": "museum",
        "checks": {
            "need_any": [r"museum|dino|rex|saurier|ausstellung"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|maps|ticket|web"],
        },
    },
    {
        "id": "parking_ticket",
        "q": "Das ist mein Parkplatz, Parkticket gilt bis 17:42 Uhr",
        "wait": 24,
        "reset_before": True,
        "family": "parking",
        "checks": {
            "need_any": [r"park|17|42|gemerkt|erinnert|leave|ok|klar"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "aldi",
        "q": "Wo ist der naechste Aldi oder Lidl?",
        "wait": 28,
        "reset_before": True,
        "family": "shopping",
        "checks": {
            "need_any": [r"aldi|lidl|supermarkt|meter|min"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav|maps"],
        },
    },
]


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/Download/ui.xml")
    p = OUT / "ui.xml"
    adb("pull", "/sdcard/Download/ui.xml", str(p))
    return p.read_text(encoding="utf-8", errors="ignore")


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
    for _ in range(5):
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
        tap(hit["cx"], hit["cy"], 0.55)


def reset_app() -> None:
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
    time.sleep(14.0)
    # re-ensure reverse after relaunch
    adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")


def post_ask(q: str) -> str:
    body = json.dumps({"ask": q}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/ask",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as res:
        return res.read().decode("utf-8", errors="ignore")


def health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=3) as res:
            return res.status == 200
    except Exception:
        return False


def grab_logcat(tag: str) -> str:
    r = adb(
        "logcat",
        "-d",
        "-t",
        "400",
        "ReactNativeJS:V",
        "*:S",
    )
    path = OUT / f"{tag}-log.txt"
    path.write_text(r.stdout or "", encoding="utf-8", errors="ignore")
    # Extract useful markers
    lines = []
    for ln in (r.stdout or "").splitlines():
        if any(
            k in ln
            for k in (
                "[call1]",
                "[devAskPoller]",
                "call2",
                "Call2",
                "bridge",
                "execution",
                "flight",
                "pitch",
                "error",
                "Error",
            )
        ):
            lines.append(ln)
    path2 = OUT / f"{tag}-log-hits.txt"
    path2.write_text("\n".join(lines[-80:]), encoding="utf-8")
    return "\n".join(lines[-40:])


def score(txt: str, checks: dict) -> dict:
    low = (txt or "").lower()
    buttons = re.findall(
        r"(speisekarte|route|maps|web|ticket|taxi|uber|anrufen|nav|starten|"
        r"tagesplan|hotel|stay|buch|flug|fähre|faehre|programm|mehr|kalender|"
        r"telefon|esim)",
        low,
        flags=re.I,
    )
    bullet_lines = [
        ln
        for ln in (txt or "").splitlines()
        if re.search(r"^(•|\*|·|- |\d+[.)]|km|uhr|€|euro)", ln.strip().lower())
        or re.search(r"\d+[.,]\d+\s*km|offen|geschlossen|€|\bstern", ln.lower())
    ]
    need_ok = False
    for pat in checks.get("need_any") or []:
        if re.search(pat, low, re.I):
            need_ok = True
            break
    if not checks.get("need_any"):
        need_ok = True

    fails = []
    for pat in checks.get("fail_any") or []:
        if re.search(pat, low, re.I):
            fails.append(pat)

    want_btn = checks.get("want_btn") or []
    btn_ok = True
    if want_btn:
        btn_ok = any(re.search(p, low, re.I) for p in want_btn)

    placeholder = bool(re.search(r"passende optionen und routen werden", low))
    emptyish = len((txt or "").strip()) < 60

    call2_ok = need_ok and not placeholder and not emptyish
    bridge_ok = not any(
        re.search(p, low, re.I) for p in (checks.get("bridge_fail") or [])
    ) and not re.search(
        r"soll ich (die|das|dir).{0,40}(suchen|recherchieren|rausfinden)\?",
        low,
    )
    bullets_ok = True
    if checks.get("want_bulletish"):
        bullets_ok = len(bullet_lines) >= 1 or bool(
            re.search(r"\d+[.,]\d+\s*km|€|uhr|offen", low)
        )
    if re.search(r"\d[.,]\d\s*sterne?\s*bei\s*\d+", low):
        bullets_ok = False
        fails.append("star_rating_bullet")

    integration_ok = call2_ok and (btn_ok if want_btn else True) and not fails
    verdict = (
        "PASS"
        if (call2_ok and bridge_ok and bullets_ok and not fails and (btn_ok or not want_btn))
        else "FAIL"
    )
    if emptyish or placeholder:
        verdict = "FAIL"

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
            [ln.strip() for ln in (txt or "").splitlines() if ln.strip()][:20]
        )[:600],
    }


def ask_and_capture(tag: str, text: str, wait_s: float) -> tuple[str, str]:
    dismiss()
    adb("logcat", "-c")
    try:
        resp = post_ask(text)
        print("queued", tag, resp[:80], flush=True)
    except Exception as e:
        print("ASK_FAIL", tag, e, flush=True)
        return "", f"ask_fail:{e}"
    # Poller ~900ms; wait for answer
    time.sleep(max(10.0, wait_s))
    # Mid capture + final
    shot(f"{tag}-mid")
    time.sleep(min(8.0, max(2.0, wait_s * 0.25)))
    dismiss()  # close overlays that block reading? careful — only if tippfeld
    # Don't dismiss Spickzettel yet — capture first
    xml = dump()
    shot(tag)
    txt = extract(tag, xml)
    logs = grab_logcat(tag)
    return txt, logs


def parse_args(argv: list[str]):
    only = None
    from_id = None
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "--from" and i + 1 < len(argv):
            from_id = argv[i + 1]
            i += 2
            continue
        args.append(argv[i])
        i += 1
    if args:
        only = set(args)
    return only, from_id


def safe_print(*args, **kwargs) -> None:
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        msg = " ".join(str(a) for a in args)
        print(msg.encode("ascii", "replace").decode("ascii"), **kwargs)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    OUT.mkdir(parents=True, exist_ok=True)
    only, from_id = parse_args(sys.argv[1:])

    if not health():
        print("ERROR: askServer not reachable on :8791 — start node scripts/deviceQa/askServer.mjs")
        return 2

    adb("reverse", f"tcp:{PORT}", f"tcp:{PORT}")
    reset_app()

    report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "device": adb("get-serialno").stdout.strip(),
        "apk": "2.0.26",
        "results": [],
    }

    started = from_id is None
    for s in SCENARIOS:
        if only and s["id"] not in only:
            continue
        if from_id and not started:
            if s["id"] == from_id:
                started = True
            else:
                continue

        safe_print(f"\n=== {s['id']} ({s.get('family')}) ===")
        safe_print("Q:", s["q"])
        if s.get("reset_before"):
            reset_app()
        txt, logs = ask_and_capture(s["id"], s["q"], float(s["wait"]))
        sc = score(txt, s["checks"])
        # Poller alive?
        poller_hit = "[devAskPoller]" in logs
        row = {
            "id": s["id"],
            "q": s["q"],
            "family": s.get("family"),
            **sc,
            "poller_hit": poller_hit,
            "log_hits": (logs or "")[:800],
        }
        if not txt.strip():
            row["verdict"] = "FAIL"
            row["error"] = "EMPTY_UI"
        if not poller_hit and "ask_fail" in (logs or ""):
            row["error"] = logs
        report["results"].append(row)
        snip = (row.get("snippet") or "")[:140]
        safe_print(row["verdict"], "poller=" + str(poller_hit), row.get("fails"), snip)

    passed = sum(1 for r in report["results"] if r["verdict"] == "PASS")
    total = len(report["results"])
    report["summary"] = {
        "pass": passed,
        "total": total,
        "rate": (passed / total) if total else 0,
    }

    out_json = OUT / "qa40-report.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    md = [
        f"# QA40 Live — {report['at'][:19]}Z",
        "",
        f"**Gerät:** `{report['device']}` · **APK:** {report.get('apk')} · **Ergebnis:** {passed}/{total} PASS",
        "",
        "| ID | Family | Verdict | Bridge | Call2 | Stichp. | Buttons | Poller | Hinweis |",
        "|----|--------|---------|--------|-------|---------|---------|--------|---------|",
    ]
    for r in report["results"]:
        btn = r.get("buttons_ok")
        btn_s = "—" if btn is None else ("✅" if btn else "❌")
        hint = ",".join(r.get("fails") or []) or r.get("error") or ""
        md.append(
            f"| {r['id']} | {r.get('family','')} | {r['verdict']} | "
            f"{'✅' if r.get('bridge_ok') else '❌'} | "
            f"{'✅' if r.get('call2_ok') else '❌'} | "
            f"{'✅' if r.get('bullets_ok') else '❌'} | "
            f"{btn_s} | "
            f"{'✅' if r.get('poller_hit') else '❌'} | {hint} |"
        )
    md.append("")
    md.append("Captures: `.cursor/live12/`")
    md_path = ROOT / "data" / "liveQuality" / "qa40-live-report.md"
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\nReport →", out_json)
    print("Markdown →", md_path)
    print(f"PASS {passed}/{total}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
