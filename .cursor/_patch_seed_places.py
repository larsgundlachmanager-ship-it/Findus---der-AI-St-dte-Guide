from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\candidates.ts")
t = p.read_text(encoding="utf-8")
needle = "  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['sea', 'sand', 'warm', 'fly', 'tennis', 'pool', 'villa'], wiki: 'Alcúdia', iata: 'PMI' },\n];"
insert = """  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['sea', 'sand', 'warm', 'fly', 'tennis', 'pool', 'villa'], wiki: 'Alcúdia', iata: 'PMI' },
  { id: 'bukarest', name: 'Bukarest', lat: 44.4268, lng: 26.1025, tags: ['city', 'party', 'fly', 'spa'], wiki: 'Bukarest', iata: 'OTP' },
  { id: 'rugen', name: 'Rügen', lat: 54.4167, lng: 13.4, tags: ['ostsee', 'sand', 'sea', 'drive'], wiki: 'Rügen' },
  { id: 'allgau', name: 'Allgäu', lat: 47.55, lng: 10.25, tags: ['hike', 'alpen', 'drive', 'train'], wiki: 'Allgäu' },
  { id: 'albufeira', name: 'Albufeira', lat: 37.0889, lng: -8.245, tags: ['sea', 'sand', 'warm', 'fly', 'party'], wiki: 'Albufeira', iata: 'FAO' },
  { id: 'stjulians', name: "St. Julian's", lat: 35.9182, lng: 14.4898, tags: ['sea', 'party', 'warm', 'fly'], wiki: "St. Julian's (Malta)", iata: 'MLA' },
  { id: 'prisdorf', name: 'Prisdorf', lat: 53.6833, lng: 9.7667, tags: ['home', 'daytrip'], wiki: 'Prisdorf' },
];"""
if needle not in t:
    raise SystemExit("anchor missing")
p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
print("ok")
