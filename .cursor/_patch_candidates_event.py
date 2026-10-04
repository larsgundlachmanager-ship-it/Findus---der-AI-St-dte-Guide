from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\candidates.ts")
t = p.read_text(encoding="utf-8")
needle = "  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['sea', 'sand', 'warm', 'fly', 'tennis', 'pool', 'villa'], wiki: 'Alcúdia', iata: 'PMI' },\n];"
insert = """  { id: 'alcudia', name: 'Alcúdia', lat: 39.8532, lng: 3.124, tags: ['sea', 'sand', 'warm', 'fly', 'tennis', 'pool', 'villa'], wiki: 'Alcúdia', iata: 'PMI' },
  { id: 'london', name: 'London', lat: 51.5074, lng: -0.1278, tags: ['city', 'fly', 'train', 'tennis', 'event'], wiki: 'London', iata: 'LHR' },
  { id: 'paris', name: 'Paris', lat: 48.8566, lng: 2.3522, tags: ['city', 'fly', 'train', 'tennis', 'event'], wiki: 'Paris', iata: 'CDG' },
  { id: 'madrid', name: 'Madrid', lat: 40.4168, lng: -3.7038, tags: ['city', 'fly', 'tennis', 'event', 'warm'], wiki: 'Madrid', iata: 'MAD' },
  { id: 'muenchen', name: 'München', lat: 48.1351, lng: 11.582, tags: ['city', 'fly', 'train', 'event'], wiki: 'München', iata: 'MUC' },
];"""
if "id: 'london'" in t:
    print("already patched")
elif needle not in t:
    raise SystemExit("anchor missing")
else:
    p.write_text(t.replace(needle, insert), encoding="utf-8")
    print("patched")
