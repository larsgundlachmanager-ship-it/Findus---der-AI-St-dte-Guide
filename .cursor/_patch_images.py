from pathlib import Path
import time

p = Path(r"c:\Users\larsf\Findus 2.0\src\components\homeMap\homeMapAmenityImages.ts")
for attempt in range(8):
    try:
        t = p.read_text(encoding="utf-8")
        if "place-luggage" not in t:
            t = t.replace(
                "'place-ferry': require('../../assets/homeMap/place-ferry.png'),\n  'user-arrow':",
                "'place-ferry': require('../../assets/homeMap/place-ferry.png'),\n"
                "  'place-luggage': require('../../assets/homeMap/place-luggage.png'),\n"
                "  'place-laundry': require('../../assets/homeMap/place-laundry.png'),\n"
                "  'place-charging': require('../../assets/homeMap/place-charging.png'),\n"
                "  'user-arrow':",
                1,
            )
        if "luggage: 'place-luggage'" not in t:
            t = t.replace(
                "activity: 'place-activity',\n};",
                "activity: 'place-activity',\n"
                "  luggage: 'place-luggage',\n"
                "  laundry: 'place-laundry',\n"
                "  charging: 'place-charging',\n};",
                1,
            )
        tmp = p.with_suffix(".ts.tmp")
        tmp.write_text(t, encoding="utf-8")
        tmp.replace(p)
        print("images patched ok")
        break
    except OSError as e:
        print("retry", attempt, e)
        time.sleep(1.5)
else:
    raise SystemExit("failed to patch images")
