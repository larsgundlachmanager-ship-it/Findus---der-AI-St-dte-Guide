import json
from pathlib import Path

OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live13")
r = json.loads((OUT / "full-3week-report.json").read_text(encoding="utf-8"))

# Manual content review heuristics
manual = {}
for x in r["results"]:
    tid = x["id"]
    txt = ""
    p = OUT / f"{tid}-text.txt"
    if p.exists():
        txt = p.read_text(encoding="utf-8", errors="ignore")
    low = txt.lower()
    notes = []
    ok = x["verdict"] == "PASS"

    # Content rules
    if "frage an yorro" in low or "schreib deine frage" in low:
        ok = False
        notes.append("tippfeld_stuck")
    if tid == "wetter":
        if "hotel" in low or "pool" in low or "stay22" in low:
            ok = False
            notes.append("stale_hotel_not_weather")
        elif "wetter in prisdorf" in low or ("grad" in low and "bewölkt" in low) or "°" in txt:
            if "wetter in" in low and "hotel" not in low:
                ok = True
                notes.append("title_ok_check_speech")
    if tid == "steak" and "rindock" in low:
        ok = True
        if "cuisine_" in low:
            notes.append("raw_facet_leak")
    if tid == "oepnv" and low.count("bahnhof") and "abfahrt" not in low and "min" not in low and "s-bahn" not in low:
        ok = False
        notes.append("too_thin_no_connection")
    if tid == "nav_fast_hbf" and "prisdorf" in low and "hamburg" not in low:
        ok = False
        notes.append("wrong_dest_prisdorf_not_hbf")
    if tid == "pass_lost" and "heimatverein" in low:
        ok = False
        notes.append("wrong_venue_heimatverein")
    if tid == "kino_fu_spiderman" and "spider" not in low and ("club" in low or "konzert" in low):
        ok = False
        notes.append("ignored_spiderman")
    if tid == "flug_fu_leaveby" and "touren suchen" in low and "uhr" not in low and "leave" not in low:
        ok = False
        notes.append("not_leaveby")
    if tid == "outfit" and ("teich" in low or "feuer" in low) and "jacke" not in low:
        ok = False
        notes.append("wrong_pitch_not_outfit")
    if tid == "hotel_fu_pool" and "datensatz" in low:
        ok = False
        notes.append("soft_city_switch_noise")
    if tid == "museum_trex" and low.strip().count("museum") <= 2 and "dino" not in low and "rex" not in low:
        ok = False
        notes.append("too_thin_museum")
    if tid == "toilet" and low.count("toilet") >= 1 and len(low) < 200:
        notes.append("thin_but_okish")
    if tid == "modul1_fu_mehr" and len(txt.strip()) < 80:
        ok = False
        notes.append("empty_followup")

    manual[tid] = {
        "auto": x["verdict"],
        "manual": "PASS" if ok else "FAIL",
        "notes": notes,
        "snip": " | ".join([ln.strip() for ln in txt.splitlines() if ln.strip()][:8])[:180],
    }

mp = sum(1 for v in manual.values() if v["manual"] == "PASS")
print(f"MANUAL {mp}/{len(manual)}")
for tid, v in manual.items():
    flag = "" if v["auto"] == v["manual"] else " REGRADE"
    print(f"{v['manual']:4} auto={v['auto']:4} {tid:22} {','.join(v['notes']) or '-'}{flag}")
    print(f"     {v['snip'][:140]}")

Path(r"c:\Users\larsf\Findus 2.0\data\liveQuality\full-3week-manual-review.json").write_text(
    json.dumps({"manual_pass": mp, "total": len(manual), "items": manual}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
