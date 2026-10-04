from pathlib import Path
import time
import re

p = Path(r"c:\Users\larsf\Findus 2.0\src\constants\cityCovers.ts")
for attempt in range(12):
    try:
        t = p.read_text(encoding="utf-8")
        if re.search(r"^\s*roenne\s*:", t, re.M):
            print("roenne already in cityCovers")
            break
        # Insert after danzig block end — find danzig and add after its closing },
        m = re.search(r"(  danzig:\s*\{[\s\S]*?\n  \},)", t)
        if not m:
            raise SystemExit("danzig block not found")
        stub = """  danzig: BLOCK,
  roenne: {
    region: 'Bornholm',
    country: 'Dänemark',
    aliases: ['Rønne', 'Ronne', 'Roenne', 'Bornholm Rønne'],
  },"""
        # simpler: append before closing of CITY_SEARCH_META — find danzig and insert after
        insert = """
  roenne: {
    region: 'Bornholm',
    country: 'Dänemark',
    aliases: ['Rønne', 'Ronne', 'Roenne', 'Bornholm Rønne'],
  },"""
        t2 = t[: m.end()] + insert + t[m.end() :]
        tmp = p.with_suffix(".ts.tmp")
        tmp.write_text(t2, encoding="utf-8")
        tmp.replace(p)
        print("cityCovers patched")
        break
    except OSError as e:
        print("retry", attempt, e)
        time.sleep(1.5)
else:
    raise SystemExit("failed cityCovers")
