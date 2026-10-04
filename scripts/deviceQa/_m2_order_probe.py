/**
 * Modul-2 Order-Ticket Probe — Nothing (manuell) + optional S7 Ask.
 * Run S7 batch: FINDUS_QA_SERIAL=ce12171cccf9c0810c python scripts/deviceQa/_m2_order_probe.py
 */
from __future__ import annotations

# Nothing: tippen/sprechen. S7: Ask-Server / dieses Script.
PROBES = [
    {
        "id": "ayce_no_asia",
        "q": "Freitag Abend all you can eat in Hamburg, aber bitte kein Asiatisch",
        "expect": "Pitch AYCE; kein Goldschätzchen; Avoid Asia; Soft-Fill verboten",
    },
    {
        "id": "weather_cut",
        "q": "Regnet es gleich?",
        "expect": "Wetter/Chat — kein Gastro-Pitch, Topic-Cut",
    },
    {
        "id": "nav_start",
        "q": "Navigiere mich zum Michel in Hamburg",
        "expect": "nav_execute / Route startet",
    },
    {
        "id": "followup_ja",
        "setup": "Zuerst: Gibt es heute Abend Live-Musik in Hamburg?",
        "q": "Ja, such mir zwei Optionen raus",
        "expect": "session continue; Events vertiefen, kein Themen-Sprung",
    },
    {
        "id": "taxi_airport_blocker",
        "q": "Bestell mir ein Taxi zum Flughafen",
        "expect": "Klärfrage Flug/Uhr ODER askBack — keine blinde Nav",
    },
    {
        "id": "compound_essen_taxi",
        "q": "Such mir ein Steak-Restaurant und danach ein Taxi dahin",
        "expect": "work dining→taxi; kein dünner Transit-Einzeiler",
    },
    {
        "id": "flight_leaveby",
        "q": "Ich fliege heute um 20 Uhr nach Athen — wann muss ich los?",
        "expect": "flight_advisor / Leave-by",
    },
    {
        "id": "timer",
        "q": "Stell einen Timer auf 7 Minuten",
        "expect": "Timer setzt; kein Nav/Pitch",
    },
    {
        "id": "plan_hamburg",
        "q": "Mach mir jetzt einen guten Plan für heute in Hamburg",
        "expect": "plan_module / Timeline — nicht Reisebüro-Trip",
    },
    {
        "id": "novel_desk",
        "q": "Wir brauchen was Ruhiges mit Wifi und Steckdose zum Arbeiten eine Stunde",
        "expect": "Auftrag erfinden + Suche; keine Fake-Cafés ohne Beleg",
    },
]

REISEBUERO_S7 = [
    "Plane mir ein Wochenende in Lissabon: Flug ab Hamburg und Hotel",
    "In zwei Wochen für ein Wochenende nach London — was schickst du mir vorher?",
    "Ich überlege nach Barcelona zu fliegen, was sollte ich davor wissen?",
]

if __name__ == "__main__":
    print("Nothing probes:", len(PROBES))
    for p in PROBES:
        print(f"- {p['id']}: {p.get('setup') or ''} {p['q']}".strip())
    print("Reisebüro S7:", len(REISEBUERO_S7))
