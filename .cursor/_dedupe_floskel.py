# -*- coding: utf-8 -*-
import json
from pathlib import Path

# Fix duplicate named_schedule in floskel JSON
p = Path("src/assets/data/floskelLibrary.json")
data = json.loads(p.read_text(encoding="utf-8"))
# json.loads keeps last key for duplicates when parsing? Actually JSON doesn't allow duplicates - Python json.loads keeps the last one
# But the file has literal duplicate keys - json.loads will keep last
cats = data["categories"]
# Re-read raw and fix
raw = p.read_text(encoding="utf-8")
# Remove second named_schedule block (lines 88-98)
dup = '''    "named_schedule": {
      "label": "Genannter Termin / Spielplan",
      "phrases": [
        "Alles klar — ich check den Spielplan kurz.",
        "Verstanden, ich hol die nächsten Termine.",
        "Jo, ich schau nach Datum und Anpfiff.",
        "Moment, ich check offizielle Termine und Tickets.",
        "Klar, ich recherchiere den nächsten Termin.",
        "Ich hole Datum, Uhrzeit und Tickets nach."
      ]
    },
'''
if raw.count('"named_schedule"') > 1 and dup in raw:
    raw = raw.replace(dup, "", 1)
    p.write_text(raw, encoding="utf-8")
    print("removed duplicate named_schedule block")
else:
    print("named_schedule count", raw.count('"named_schedule"'))

# Merge best phrases into first block via reload
data = json.loads(p.read_text(encoding="utf-8"))
ns = data["categories"]["named_schedule"]
merged = list(dict.fromkeys(ns["phrases"] + [
    "Alles klar — ich check den Spielplan kurz.",
    "Verstanden, ich hol die nächsten Termine.",
    "Jo, ich schau nach Datum und Anpfiff.",
]))
ns["phrases"] = merged[:8]
ns["label"] = "Genannter Termin / Spielplan"
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("floskel phrases", len(ns["phrases"]))

# Fix duplicate detect in floskelEngine
e = Path("src/services/speech/floskelEngine.ts")
et = e.read_text(encoding="utf-8")
dup_detect = '''  // Genannter Spielplan VOR generischem events — neutrale Cover-Floskel, kein Pitch-Opener
  try {
    const { looksLikeNamedScheduleQuery } = require('../concierge/sportsScheduleQuery') as {
      looksLikeNamedScheduleQuery: (s: string) => boolean;
    };
    if (looksLikeNamedScheduleQuery(userText)) return 'named_schedule';
  } catch {
    /* soft */
  }
  if (/\\b(was\\s+geht|was\\s+heute\\b[\\s\\S]{0,48}?\\bgeht|events?|veranstaltung|heute\\s+abend|konzert)\\b/u.test(t)) {
'''
# Keep early detect; remove second, keep the if for events
replacement = '''  if (/\\b(was\\s+geht|was\\s+heute\\b[\\s\\S]{0,48}?\\bgeht|events?|veranstaltung|heute\\s+abend|konzert)\\b/u.test(t)) {
'''
if et.count("looksLikeNamedScheduleQuery") >= 2 and dup_detect in et:
    et = et.replace(dup_detect, replacement, 1)
    e.write_text(et, encoding="utf-8")
    print("engine dedupe ok, remaining", et.count("looksLikeNamedScheduleQuery"))
else:
    print("engine looksLike count", et.count("looksLikeNamedScheduleQuery"), "dup found", dup_detect in et)
