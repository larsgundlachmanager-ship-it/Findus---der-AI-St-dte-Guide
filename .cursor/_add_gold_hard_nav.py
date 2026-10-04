# -*- coding: utf-8 -*-
from pathlib import Path
import os
import json

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.pack.json")
data = json.loads(p.read_text(encoding="utf-8"))
situations = data.get("situations") or data.get("entries") or []
# detect key
if isinstance(data, list):
    situations = data
    root = None
else:
    root = data
    for k in ("situations", "entries", "items", "gold"):
        if isinstance(data.get(k), list):
            situations = data[k]
            key = k
            break
    else:
        raise SystemExit("no situations list: " + str(list(data.keys())[:20]))

if any(s.get("situationKey") == "navigation::hard_nav_clean_start_v1" for s in situations):
    print("gold already")
else:
    situations.append(
        {
            "intentFamily": "navigation",
            "expect": [
                "call1_bridge_only_start_nav_with_dest_name",
                "call2_only_eta_minutes_no_second_bridge",
                "no_spickzettel_card_for_hard_nav_eta",
                "hud_shows_eta_and_mode_walk_bike_transit",
                "pack_poi_before_generic_geocode",
                "timeline_only_walk_leg_plus_dest_for_short_hard_nav",
                "pan_unlocks_location_and_heading_follow",
            ],
            "avoid": [
                "sorry_apology_on_nav_start",
                "five_minute_bullet_card_duplicate_of_hud",
                "auto_oepnv_tour_for_short_walk_hard_nav",
                "fake_time_conflict_from_stale_journeys",
                "boot_auto_gps_location_lock",
            ],
            "summary": (
                "Explizite Nav: Call-1 nur Start-Zusagen mit Ziel; Call-2 nur Dauer; "
                "kein Spickzettel/5-Min-Card; HUD zeigt ETA+Modus; Pack-POI vor Geocode; "
                "kurze Hard-Nav Timeline nur Fussbein+Ziel; Pan loest GPS- und Kompass-Follow; "
                "kein GPS-Lock beim App-Start."
            ),
            "situationKey": "navigation::hard_nav_clean_start_v1",
            "tags": ["hard_nav", "hud", "timeline", "pack_poi", "map_boot"],
        }
    )
    if root is not None:
        root[key] = situations
        out = root
    else:
        out = situations
    tmp = p.with_suffix(".json.tmpwrite")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, p)
    print("gold inserted", len(situations))
