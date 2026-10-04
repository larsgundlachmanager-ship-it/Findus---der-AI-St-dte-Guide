from pathlib import Path
import json

p = Path("src/module2/blueprints/ownerGold.pack.json")
data = json.loads(p.read_text(encoding="utf-8"))
for b in data.get("blueprints", []):
    if b.get("situationKey") == "general::wake_alarm_confirm_v1":
        b["summary"] = (
            "Wecker mit klarer Uhrzeit: sofort Native/Clock stellen. "
            "Bestätigung max. 1–2 Sätze; ein Stichpunkt; Titel Wecker. "
            "Kein Reminder-Button, kein Zweitbutton, kein Wetter-Offer, keine Dreifach-Wiederholung."
        )
        print("updated gold")
        break
else:
    raise SystemExit("wake gold missing")
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

p2 = Path("src/services/alarmService.ts")
t2 = p2.read_text(encoding="utf-8")
t2 = t2.replace("  const t2 = clockSync;\n\n  // Tier 3", "  // Tier 3", 1)
t2 = t2.replace(
    "reason: t3.reason || t1.detail || t2.detail || 'permission',",
    "reason: t3.reason || t1.detail || clockSync.detail || 'permission',",
    1,
)
t2 = t2.replace(
    "detail: [t1.detail, t2.detail, t3.detail].filter(Boolean).join(' | '),",
    "detail: [t1.detail, clockSync.detail, t3.detail].filter(Boolean).join(' | '),",
    1,
)
out = Path(".phone-check/_alarmService_out2.ts")
out.write_text(t2, encoding="utf-8")
out.replace(p2)
print("alarm cleanup ok")
