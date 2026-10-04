# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\package.json")
t = p.read_text(encoding="utf-8")
needle = '"city:review-facets": "node scripts/cityPack/enrichReviewFacets.mjs",'
insert = needle + '\n    "city:enrich-facets-budget": "node scripts/cityPack/enrichFacetsBudgetPass.mjs",'
if "city:enrich-facets-budget" not in t:
    if needle not in t:
        raise SystemExit("needle missing")
    p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    print("ok")
else:
    print("skip")
