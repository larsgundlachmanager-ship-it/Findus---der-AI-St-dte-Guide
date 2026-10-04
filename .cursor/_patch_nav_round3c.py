# -*- coding: utf-8 -*-
from pathlib import Path
import os
import json

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


p = ROOT / "src/services/navigation/handsFreeNav/cueTiming.smoke.test.ts"
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    "assert(FINISH_BEFORE_TURN_SEC === 2.5, 'Ziel: ~2,5 s vor Kurve fertig');",
    "assert(FINISH_BEFORE_TURN_SEC === 4.0, 'Ziel: ~4 s vor Kurve fertig');",
)
t2 = t2.replace(
    "assert(walk4s === 65, `4s speech @ 10 m/s → 65 m, war ${walk4s}`);",
    "assert(walk4s === 80, `4s speech @ 10 m/s → 80 m, war ${walk4s}`);",
)
t2 = t2.replace(
    "assert(walk5s === 9, `5s speech @ 1.25 m/s → 9 m, war ${walk5s}`);",
    "assert(walk5s === 12, `5s speech @ 1.25 m/s → 12 m floor, war ${walk5s}`);",
)
if t2 == t:
    raise SystemExit("cueTiming: no changes applied")
write_text(p, t2)
print("cueTiming smoke updated")

gold = ROOT / "src/module2/blueprints/ownerGold.pack.json"
data = json.loads(gold.read_text(encoding="utf-8"))
marker = "navigation::handsfree_pocket_guide_v1"
key = "blueprints" if "blueprints" in data else None
if key is None:
    for k, v in data.items():
        if isinstance(v, list) and v and isinstance(v[0], dict) and ("id" in v[0] or "intentFamily" in v[0]):
            key = k
            break
if not key:
    print("gold structure unknown:", list(data.keys())[:12])
elif any((x.get("id") == marker) for x in data[key] if isinstance(x, dict)):
    print("gold already has pocket guide")
else:
    data[key].append(
        {
            "id": marker,
            "intentFamily": "navigation",
            "expect": [
                "turn_cues_with_screen_off_or_pocket",
                "haptic_right_short_left_short_long",
                "arrival_speech_always",
                "landmarks_only_visually_obvious_outdoors",
                "prefer_street_or_allee_over_mailbox_shop",
                "on_track_reassure_only_after_5min_silence_walk_bike",
                "no_confirm_immediately_after_turn",
                "recenter_location_separate_from_compass_heading",
                "address_dest_keeps_house_number_on_button",
            ],
            "avoid": [
                "fake_schild_from_destination_name",
                "brochure_or_mailbox_as_turn_landmark",
                "du_bist_richtig_right_after_turn",
                "couple_recenter_lock_with_heading_follow",
                "strip_house_number_from_street_dest_label",
            ],
            "summary": "Hands-free Fuß/Rad: Ansagen+Haptik auch bei Standby/Hosentasche; Abbiegungen früher; Ziel erreicht immer; Landmarken nur optisch klar (sonst Straße/Allee); On-Track-Reassure erst nach ~5 Min Stille; Recenter und Kompass getrennt; Adress-Ziel behält Hausnummer am Button.",
        }
    )
    write_text(gold, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("gold appended")
