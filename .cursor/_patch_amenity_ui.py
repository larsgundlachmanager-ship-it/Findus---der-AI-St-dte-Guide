from pathlib import Path

# amenity icon prefs groups
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapAmenityIconPrefs.ts")
t = p.read_text(encoding="utf-8")
old = """      { id: 'supermarket', label: 'Supermarkt' },
      { id: 'kiosk', label: 'Kiosk' },
      { id: 'bakery', label: 'Bäckerei' },
      { id: 'info', label: 'Info' },
      { id: 'bike', label: 'Mietrad' },
    ],
  },
  {
    title: 'Notfall',
    icons: [
      { id: 'toilet', label: 'WC' },
      { id: 'water', label: 'Wasser' },
    ],
  },"""
new = """      { id: 'supermarket', label: 'Supermarkt' },
      { id: 'kiosk', label: 'Kiosk' },
      { id: 'bakery', label: 'Bäckerei' },
      { id: 'info', label: 'Info' },
      { id: 'bike', label: 'Mietrad' },
      { id: 'laundry', label: 'Waschsalon' },
      { id: 'charging', label: 'E-Laden' },
    ],
  },
  {
    title: 'Notfall',
    icons: [
      { id: 'toilet', label: 'WC' },
      { id: 'water', label: 'Wasser' },
      { id: 'luggage', label: 'Gepäck' },
    ],
  },"""
if old not in t:
    raise SystemExit("prefs groups not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("prefs ok")

# images
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\components\homeMap\homeMapAmenityImages.ts")
t2 = p2.read_text(encoding="utf-8")
old2 = """  'place-ferry': require('../../assets/homeMap/place-ferry.png'),
  'user-arrow': require('../../assets/homeMap/user-arrow.png'),"""
new2 = """  'place-ferry': require('../../assets/homeMap/place-ferry.png'),
  'place-luggage': require('../../assets/homeMap/place-luggage.png'),
  'place-laundry': require('../../assets/homeMap/place-laundry.png'),
  'place-charging': require('../../assets/homeMap/place-charging.png'),
  'user-arrow': require('../../assets/homeMap/user-arrow.png'),"""
if old2 not in t2:
    raise SystemExit("images require not found")
t2 = t2.replace(old2, new2, 1)
old3 = """  activity: 'place-activity',
};"""
new3 = """  activity: 'place-activity',
  luggage: 'place-luggage',
  laundry: 'place-laundry',
  charging: 'place-charging',
};"""
if old3 not in t2:
    raise SystemExit("ICON_TO_IMAGE not found")
t2 = t2.replace(old3, new3, 1)
p2.write_text(t2, encoding="utf-8")
print("images ok")

# writeAmenityIcons — insert before ferry closing
p3 = Path(r"c:\Users\larsf\Findus 2.0\scripts\homeMap\writeAmenityIcons.mjs")
t3 = p3.read_text(encoding="utf-8")
old4 = """  ferry: [
    [0x4a, 0x6a, 0x8a],
    (c) => {
      fillPoly(c, [[16, 50], [48, 22], [80, 50], [72, 70], [24, 70]], W);
    },
  ],
};"""
new4 = """  ferry: [
    [0x4a, 0x6a, 0x8a],
    (c) => {
      fillPoly(c, [[16, 50], [48, 22], [80, 50], [72, 70], [24, 70]], W);
    },
  ],
  luggage: [
    [0x6a, 0x5a, 0x48],
    (c) => {
      rect(c, 28, 34, 68, 78);
      rect(c, 38, 22, 58, 34);
      rect(c, 44, 48, 52, 64);
    },
  ],
  laundry: [
    [0x4a, 0x7a, 0x8a],
    (c) => {
      rect(c, 22, 22, 74, 78);
      fillCircle(c, 48, 52, 16, W);
      fillCircle(c, 48, 52, 8, [0x4a, 0x7a, 0x8a]);
    },
  ],
  charging: [
    [0x2e, 0x8b, 0x57],
    (c) => {
      fillPoly(c, [[52, 16], [34, 48], [48, 48], [40, 78], [66, 42], [52, 42]], W);
    },
  ],
};"""
if old4 not in t3:
    raise SystemExit("writeAmenityIcons ferry not found")
p3.write_text(t3.replace(old4, new4, 1), encoding="utf-8")
print("writeAmenityIcons ok")
