# -*- coding: utf-8 -*-
import json
from pathlib import Path

path = Path(r"c:\Users\larsf\Findus 2.0\src\assets\data\floskelLibrary.json")
data = json.loads(path.read_text(encoding="utf-8"))
cats = data["categories"]

cats["cinema"]["phrases"] = [
    "Ich schau mal, was das aktuelle Kinoprogramm heute Abend anbietet.",
    "Alles klar — ich check kurz Filme und Vorstellungen in der Nähe.",
    "Jo, ich guck, welche Filme heute Abend laufen.",
    "Moment, ich hol das heutige Kinoprogramm.",
    "Ich schau, welche Kinos hier in Frage kommen und was läuft.",
]

cats["accommodation_search"]["phrases"] = [
    "Ich such dir passende Hotels mit deinen Prefs raus.",
    "Alles klar — ich check Hotels mit Pool und Preisrahmen.",
    "Jo, ich filter Lage, Pool und Budget für dich.",
    "Moment, ich guck live nach passenden Unterkünften.",
    "Ich such die besten Hotel-Optionen zu deinen Kriterien.",
]

cats["hotel"]["phrases"] = cats["accommodation_search"]["phrases"][:]

cats["safety"]["phrases"] = [
    "Oh nee, das klingt übel — ich schau sofort, wohin ihr am besten könnt.",
    "Alles klar, ich priorisiere das und finde die nächste sinnvolle Hilfe.",
    "Verstanden — ich check Notdienst und nächste Anlaufstelle für euch.",
    "Moment, ich hol dir den nächsten passenden Ort plus was du jetzt tun kannst.",
    "Ich kümmere mich drum — Hilfe und Weg kommen gleich.",
]

cats["transit"]["phrases"] = [
    "Ich check die schnellste Verbindung für dich.",
    "Alles klar — ich schau kurz Zug und Bus zum Ziel.",
    "Jo, ich hol die beste ÖPNV-Verbindung.",
    "Moment, Fahrplan und Dauer checke ich parallel.",
    "Ich guck, wie du am schnellsten hinkommst.",
]

cats["nav"]["phrases"] = [
    "Alles klar — ich navigiere dich hin.",
    "Jo, ich setz die Route jetzt auf.",
    "Klar, Navigation startet gleich.",
    "Ich führ dich zum Ziel — Route kommt.",
    "Alles klar, ich bring dich hin.",
]

cats["dining"]["phrases"] = [
    "Ich schau, wo das am besten passt.",
    "Alles klar — passende Orte zum Essen kommen gleich.",
    "Jo, ich filter Restaurants in der Nähe nach deinem Wunsch.",
    "Moment, ich guck, was heute Abend offen und passend ist.",
    "Ich such dir die besten Essens-Optionen raus.",
]

cats["food_allergy"]["phrases"] = [
    "Alles klar — ich filter passende Läden zu deiner Ernährung.",
    "Jo, ich schau nach vegetarischen Optionen in der Nähe.",
    "Moment, ich respektiere die Prefs und finde passende Orte.",
    "Ich filter Küchen, die zu dir passen.",
    "Alles klar — passende Gerichte und Läden kommen.",
]

cats["generic"]["phrases"] = [
    "Verstanden — ich setz genau bei deinem Wunsch an.",
    "Passt, ich mach das konkret für dich.",
    "Alles klar, ich geh den Punkt direkt an.",
    "Jo, ich kümmere mich um genau das.",
    "Moment, ich hol die Antwort zu deiner Frage.",
]

cats["events"]["phrases"] = [
    "Ich schau mal, was heute Abend wirklich los ist.",
    "Lass mich prüfen, welche Events heute passen.",
    "Jo, ich guck kurz, wo heute was geht.",
    "Alles klar — ich such dir die Termine raus.",
    "Moment — ich check Flyer und heutige Programme.",
    "Ich recherchiere kurz, was heute wirklich stattfindet.",
]

# recount
research = sum(len(c.get("phrases", [])) for c in cats.values())
action = sum(len(v) for v in data["actionButtons"].values())
data["meta"]["researchPhraseCount"] = research
data["meta"]["actionPhraseCount"] = action
data["meta"]["totalPhrases"] = research + action
data["meta"]["categoryCount"] = len(cats)

path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("phrases updated", research, action)
