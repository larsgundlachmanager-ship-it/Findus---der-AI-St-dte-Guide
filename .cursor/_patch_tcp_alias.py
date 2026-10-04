from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\landmarkAliases.ts")
tmp = p.with_suffix(".ts.tmpwrite")
t = p.read_text(encoding="utf-8")
old = """  // Tennisclub Prisdorf — STT oft „Priester“ / „Priesdorf“ / „Tennisclub Priester“
  if (
    /\\btennis(?:[-\\s]?club|club|platz|anlage)?\\b/iu.test(t) &&
    /\\b(prisdorf|priester|priesdorf|priestorf|tcp)\\b/iu.test(t)
  ) {
    return {
      query: 'Tennis-Club Prisdorf TCP',
      preferredCityId: 'prisdorf',
      matchedLandmark: true,
    };
  }

  return { query: t, preferredCityId: null, matchedLandmark: false };
"""
new = """  // Tennisclub Prisdorf — STT oft „Priester“ / „Priesdorf“ / „prsidorf“ / „Tennisclub Priester“
  if (
    /\\btennis(?:[-\\s]?club|club|platz|anlage)?\\b/iu.test(t) &&
    /\\b(prisdorf|prsidorf|prisodrf|priester|priesdorf|priestorf|tcp)\\b/iu.test(t)
  ) {
    return {
      query: 'Tennis-Club Prisdorf TCP',
      preferredCityId: 'prisdorf',
      matchedLandmark: true,
    };
  }
  // „zum Tennis Club“ ohne Stadt — in Prisdorf-Kontext trotzdem TCP
  if (
    /\\btennis(?:[-\\s]?club|club)\\b/iu.test(t) &&
    !/\\b(hamburg|berlin|l[uü]beck|pinneberg)\\b/iu.test(t)
  ) {
    return {
      query: 'Tennis-Club Prisdorf TCP',
      preferredCityId: 'prisdorf',
      matchedLandmark: true,
    };
  }

  return { query: t, preferredCityId: null, matchedLandmark: false };
"""
if old not in t:
    raise SystemExit('OLD NOT FOUND')
tmp.write_text(t.replace(old, new), encoding='utf-8')
os.replace(str(tmp), str(p))
print('ok')
