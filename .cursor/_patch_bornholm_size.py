from pathlib import Path
import time

# Force bornholm as city-size island pack in placeCategoryPolicy
p = Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\placeCategoryPolicy.mjs")
for attempt in range(8):
    try:
        t = p.read_text(encoding="utf-8")
        old = "  if (/wangerooge|prisdorf|tornesch/i.test(name)) return 'town';"
        new = (
            "  if (/bornholm/i.test(name)) return 'city'; // Insel-Pack, großer Radius\n"
            "  if (/wangerooge|prisdorf|tornesch/i.test(name)) return 'town';"
        )
        if "bornholm/i.test(name)" not in t:
            if old not in t:
                raise SystemExit("size hint anchor missing")
            t = t.replace(old, new, 1)
            tmp = p.with_suffix(".mjs.tmp")
            tmp.write_text(t, encoding="utf-8")
            tmp.replace(p)
            print("size hint ok")
        else:
            print("size hint already set")
        break
    except OSError as e:
        print("retry", attempt, e)
        time.sleep(1.2)

# OSM admin name
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\discovery\nominatimCityLocale.ts")
for attempt in range(8):
    try:
        t = p2.read_text(encoding="utf-8")
        if "bornholm: 'Bornholm'" not in t:
            t = t.replace(
                "  roenne: 'Rønne',\n  ronne: 'Rønne',",
                "  roenne: 'Rønne',\n  ronne: 'Rønne',\n  bornholm: 'Bornholm',",
                1,
            )
            tmp = p2.with_suffix(".ts.tmp")
            tmp.write_text(t, encoding="utf-8")
            tmp.replace(p2)
            print("admin name ok")
        else:
            print("admin name already")
        break
    except OSError as e:
        print("retry locale", attempt, e)
        time.sleep(1.2)
