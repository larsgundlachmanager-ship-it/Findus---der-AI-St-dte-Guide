# -*- coding: utf-8 -*-
"""Patch map popup: departures compact, hotel icon, prisdorf spots, smokes."""
from pathlib import Path
import json
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"MISSING in {path.name}: {label}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("ok", label)


# --- 1) departureBulletsCompact in mapPlaceLiveActions.ts ---
live = ROOT / "src/services/homeMap/mapPlaceLiveActions.ts"
live_text = live.read_text(encoding="utf-8")

old_dep = '''export function departureLine(d: {
  line: string;
  direction: string;
  when: Date;
  plannedWhen?: Date | null;
  delaySec: number | null;
  cancelled: boolean;
}): string {
  const live = clock(d.when);
  const dir = d.direction ? ` → ${d.direction}` : '';
  if (d.cancelled) {
    return `${d.line}${dir} fällt aus`.trim();
  }
  const planned = d.plannedWhen instanceof Date ? d.plannedWhen : null;
  const delayed =
    (d.delaySec != null && d.delaySec >= 60) ||
    (planned != null &&
      Math.abs(d.when.getTime() - planned.getTime()) >= 60_000);
  if (delayed && planned) {
    // Unicode-Durchgestrichen für Plan-Zeit (RN Text ohne nested styles).
    const planStruck = [...clock(planned)]
      .map((ch) => `${ch}\\u0336`)
      .join('');
    return `${d.line}${dir} ${planStruck} → ${live}`.trim();
  }
  return `${d.line}${dir} ${live}`.trim();
}'''

# Fix escaping - read actual file content for departureLine
m = re.search(
    r"export function departureLine\(d: \{.*?\n\}\n\n/\*\* Speech nur",
    live_text,
    re.S,
)
if not m:
    raise SystemExit("departureLine block not found")

departure_compact = '''
/** Stichpunkte: Linie+Ziel, dann alle Uhrzeiten in einer Zeile mit Uhr. */
export function departureBulletsCompact(
  rows: Array<{
    line: string;
    direction: string;
    when: Date;
    plannedWhen?: Date | null;
    delaySec: number | null;
    cancelled: boolean;
  }>,
): string[] {
  type Group = {
    line: string;
    direction: string;
    times: string[];
    cancelled: boolean;
  };
  const groups: Group[] = [];
  const index = new Map<string, number>();
  for (const d of rows) {
    const dest = (d.direction || '').trim();
    if (d.cancelled) {
      groups.push({
        line: d.line,
        direction: dest,
        times: [],
        cancelled: true,
      });
      continue;
    }
    const key = `${d.line.trim()}|${dest.toLowerCase()}`;
    let gi = index.get(key);
    if (gi == null) {
      gi = groups.length;
      index.set(key, gi);
      groups.push({
        line: d.line,
        direction: dest,
        times: [],
        cancelled: false,
      });
    }
    const liveT = clock(d.when);
    const planned = d.plannedWhen instanceof Date ? d.plannedWhen : null;
    const delayed =
      (d.delaySec != null && d.delaySec >= 60) ||
      (planned != null &&
        Math.abs(d.when.getTime() - planned.getTime()) >= 60_000);
    if (delayed && planned) {
      const planStruck = [...clock(planned)]
        .map((ch) => `${ch}\\u0336`)
        .join('');
      groups[gi]!.times.push(`${planStruck}→${liveT}`);
    } else {
      groups[gi]!.times.push(liveT);
    }
  }
  const out: string[] = [];
  for (const g of groups) {
    const head = g.direction
      ? `${g.line} nach ${g.direction}`
      : g.line;
    if (g.cancelled) {
      out.push(`${head} fällt aus`);
      continue;
    }
    if (!g.times.length) continue;
    out.push(head);
    out.push(`🕐 ${g.times.join(' · ')}`);
  }
  return out.slice(0, 4);
}

'''

# Insert after departureLine function (before Speech comment)
if "departureBulletsCompact" not in live_text:
    live_text = live_text.replace(
        "/** Speech nur für die nächste Abfahrt — eine flüssige Ansage. */",
        departure_compact
        + "/** Speech nur für die nächste Abfahrt — eine flüssige Ansage. */",
        1,
    )
    live_text = live_text.replace(
        "    const bullets = rows.map(departureLine);",
        "    const bullets = departureBulletsCompact(rows);",
        1,
    )
    live.write_text(live_text, encoding="utf-8")
    print("ok departures compact")
else:
    print("skip departures already patched")

# --- 2) Hotel icon before restaurant ---
ht = ROOT / "src/services/homeMap/homeMapPlaceType.ts"
ht_text = ht.read_text(encoding="utf-8")
old_icon = """  if (BAKERY_RE.test(blob)) return 'bakery';
  if (CAFE_RE.test(blob)) return 'cafe';
  if (BAR_RE.test(blob)) return 'bar';
  if (RESTAURANT_RE.test(blob)) return 'restaurant';
  if (KITA_RE.test(blob)) return null;
  if (CAMPING_RE.test(blob)) return 'camping';
  if (HOSTEL_RE.test(blob)) return 'hostel';
  if (HOTEL_RE.test(blob)) return 'hotel';"""

new_icon = """  if (BAKERY_RE.test(blob)) return 'bakery';
  if (CAFE_RE.test(blob)) return 'cafe';
  if (BAR_RE.test(blob)) return 'bar';
  // Hotel im Namen/Kategorie vor Restaurant-Tags („Fairway Hotel“ + Tag restaurant).
  const nameCat = `${poi.name ?? ''} ${poi.category ?? ''}`;
  if (HOSTEL_RE.test(nameCat)) return 'hostel';
  if (HOTEL_RE.test(nameCat) || /^hotel\\b/i.test(poi.category ?? '')) {
    return 'hotel';
  }
  if (RESTAURANT_RE.test(blob)) return 'restaurant';
  if (KITA_RE.test(blob)) return null;
  if (CAMPING_RE.test(blob)) return 'camping';
  if (HOSTEL_RE.test(blob)) return 'hostel';
  if (HOTEL_RE.test(blob)) return 'hotel';"""

if "Hotel im Namen/Kategorie vor Restaurant-Tags" not in ht_text:
    if old_icon not in ht_text:
        raise SystemExit("hotel/restaurant icon block missing")
    ht.write_text(ht_text.replace(old_icon, new_icon, 1), encoding="utf-8")
    print("ok hotel icon")
else:
    print("skip hotel icon")

# --- 3) Fix city-hardcoded bahnhof fallback ---
bullets = ROOT / "src/services/homeMap/homeMapPlaceBullets.ts"
bt = bullets.read_text(encoding="utf-8")
bt2 = bt.replace(
    """  if (/\\bbahnhof\\b|haltepunkt/.test(blob)) {
    return ['Haltepunkt', 'Regionalzüge Richtung Hamburg und Elmshorn'];
  }""",
    """  if (/\\bbahnhof\\b|haltepunkt/.test(blob)) {
    return ['Haltepunkt', 'Live-Abfahrten über den Button'];
  }""",
)
if bt2 != bt:
    bullets.write_text(bt2, encoding="utf-8")
    print("ok bahnhof fallback")
else:
    print("skip bahnhof fallback")

# --- 4) instantMapPlacePopup: name stub for fallback ---
prev = ROOT / "src/services/homeMap/mapPlacePreview.ts"
pt = prev.read_text(encoding="utf-8")
old_inst = """  const teaser = (poi?.teaser_text || '').trim();
  const facts = teaser
    ? [{ id: 0, poi_id: poi?.id ?? 0, fact_text: teaser }]
    : [];
  const bullets = buildHomeMapPlaceBullets(
    poi ? { ...poi, facts } : null,
    category,
  );"""
new_inst = """  const teaser = (poi?.teaser_text || '').trim();
  const facts = teaser
    ? [{ id: 0, poi_id: poi?.id ?? 0, fact_text: teaser }]
    : [];
  // Auch ohne Teaser/Fakten: Name+Kategorie → Facet-/Fallback-Stichpunkte.
  const bulletPoi = poi
    ? { ...poi, facts }
    : {
        id: opts.id,
        name,
        lat,
        lng,
        radius_meters: 30,
        category: category || null,
        tags_json: null,
        facts: [] as Fact[],
      };
  const bullets = buildHomeMapPlaceBullets(bulletPoi, category);"""
if "Auch ohne Teaser/Fakten" not in pt:
    if old_inst not in pt:
        raise SystemExit("instant bullets block missing")
    # Ensure Fact is imported
    if "Fact[]" in new_inst and "import type { Fact" not in pt and "Fact," not in pt:
        pt = pt.replace(
            "import type { Fact, Poi",
            "import type { Fact, Poi",
        )
    prev.write_text(pt.replace(old_inst, new_inst, 1), encoding="utf-8")
    print("ok instant fallback")
else:
    print("skip instant")

# --- 5) Prisdorf pack spot fixes ---
pack_path = ROOT / "data/staedte/prisdorf.json"
pack = json.loads(pack_path.read_text(encoding="utf-8"))
changed = 0
for spot in pack.get("spots") or []:
    name = spot.get("name") or ""
    if name == "Sparkasse Südholstein Geldautomat Meyers Frischecenter":
        spot["name"] = "Sparkasse Südholstein Geldautomat"
        spot["aliases"] = ["Sparkasse-Geldautomat Peiner Hag", "ATM Sparkasse"]
        spot["bullets"] = [
            "Geldautomat der Sparkasse Südholstein",
            "Peiner Hag — praktischer Stopp beim Einkaufen",
        ]
        facts = spot.setdefault("facts", {})
        facts["origin"] = "Geldautomat Sparkasse Südholstein am Peiner Hag."
        facts["now"] = "Oft rund um die Uhr im Foyer des Centers — LIVE Öffnung prüfen."
        # approaches name
        for a in spot.get("approaches") or []:
            if isinstance(a, dict) and "Meyers" in (a.get("name") or ""):
                a["name"] = "Sparkasse Südholstein Geldautomat · Standort"
        changed += 1
    elif name == "Goldschätzchen Wein- & Biergarten by Patrick Diehr":
        tags = [t for t in (spot.get("tags") or []) if t not in (
            "pizza", "asiatisch", "burger", "sushi"
        )]
        for t in ("biergarten", "wein", "afterwork", "gemütlich", "review_facet"):
            if t not in tags:
                tags.append(t)
        spot["tags"] = tags
        spot["bullets"] = [
            "Wein- und Biergarten am Peiner Hof",
            "Gemütliche Stimmung — mittwochs Afterwork",
        ]
        facts = spot.setdefault("facts", {})
        facts["origin"] = "Goldschätzchen: Wein- und Biergarten by Patrick Diehr am Peiner Hof."
        facts["now"] = "Biergarten und Abendküche — mittwochs Afterwork; Reservierung empfohlen."
        changed += 1
    elif name == "Fairway Hotel Peiner Hof":
        tags = spot.get("tags") or []
        # hotel vor restaurant in der Liste
        tags = [t for t in tags if t != "restaurant"]
        if "hotel" not in tags:
            tags.insert(0, "hotel")
        else:
            tags = ["hotel"] + [t for t in tags if t != "hotel"]
        spot["tags"] = tags
        spot["bullets"] = [
            "Hotel am Peiner Hof mit Zimmer und Ferienwohnungen",
            "Rund 0,8 km zum Bahnhof — Golfen und Schlafen ohne Auto",
        ]
        facts = spot.setdefault("facts", {})
        facts["origin"] = "Fairway Hotel Peiner Hof — Übernachtung am Golfplatz."
        facts["now"] = "Zimmer und Ferienwohnungen, rund 0,8 km zum Bahnhof."
        changed += 1
    elif name == "Feuerlöschteich und Gemeindeteich":
        spot["bullets"] = [
            "Löschwasserteich für die Freiwillige Feuerwehr",
            "Jugendfeuerwehr übt hier im Sommer — Stempelstation Stadtradeln",
        ]
        facts = spot.setdefault("facts", {})
        if not (facts.get("origin") or "").strip():
            facts["origin"] = "Feuerlösch- und Gemeindeteich an Hudenbarg/Hauptstraße."
        changed += 1
    elif name in ("Öffentliche Toilette", "Toilette"):
        facts = spot.setdefault("facts", {})
        if re.search(r"\\d{5}|Tornesch|Adresse", facts.get("now") or "", re.I):
            facts["now"] = "Öffentliche Toilette — kurzer Stopp."
        spot["bullets"] = ["Öffentliche Toilette", "Zum kurzen Stopp"]
        changed += 1
    elif name == "Aussichtspunkt Tävsmoor Appen/Heist":
        spot["bullets"] = [
            "Aussichtspunkt am Tävsmoor",
            "Kurzer Stopp mit Blick über die Niederung",
        ]
        facts = spot.setdefault("facts", {})
        facts["now"] = "Aussicht über das Tävsmoor — kurzer Blick-Stopp."
        changed += 1
    elif name == "Bahnhof Prisdorf":
        tags = [t for t in (spot.get("tags") or []) if t not in ("ruhig",)]
        spot["tags"] = tags
        # keep existing good bullets
        changed += 1
    elif "Kindergarten" in name or name.startswith("Alte Schule"):
        # ensure solid bullets
        if not spot.get("bullets") or any("➔" in b for b in spot.get("bullets") or []):
            spot["bullets"] = [
                "1912 Volksschule, seit 1974 Kindergarten",
                "Hofbaum und heller Kita-Bau — früher die Dorfschule",
            ]
            changed += 1

pack_path.write_text(
    json.dumps(pack, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("ok prisdorf spots", changed)

# --- 6) Smoke tests ---
smoke_live = ROOT / "src/services/homeMap/mapPlaceLiveActions.smoke.test.ts"
st = smoke_live.read_text(encoding="utf-8")
if "departureBulletsCompact" not in st:
    insert = '''
{
  const { departureBulletsCompact } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const compact = departureBulletsCompact([
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 48, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 48, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 11, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 11, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
  ]);
  assert(compact.length === 2, 'Abfahrten: Ziel + Zeitenzeile');
  assert(/nach Pinneberg/.test(compact[0]!), 'Ziel Pinneberg in Stichpunkt');
  assert(/🕐/.test(compact[1]!), 'Uhr-Symbol in Zeitenzeile');
  assert(/10:18 · 10:48 · 11:18/.test(compact[1]!), 'Zeiten in einer Reihe');
  assert(!compact.some((b) => b.split('\\n').length > 1), 'keine Mehrzeilen-Bullets');
}
'''
    st = st.replace(
        "console.log('mapPlaceLiveActions.smoke.test.ts OK');",
        insert + "\nconsole.log('mapPlaceLiveActions.smoke.test.ts OK');",
        1,
    )
    smoke_live.write_text(st, encoding="utf-8")
    print("ok live smoke")

smoke_bullets = ROOT / "src/services/homeMap/homeMapPlaceBullets.smoke.test.ts"
sb = smoke_bullets.read_text(encoding="utf-8")
if "Gäste nennen oft" not in sb:
    extra = '''
{
  const toilet = buildHomeMapPlaceBullets(
    {
      id: 9,
      name: 'Toilette',
      lat: 53.67,
      lng: 9.76,
      radius_meters: 20,
      category: 'toilette',
      tags_json: '["toilette"]',
      facts: [{ id: 1, poi_id: 9, fact_text: '25436 Tornesch' }],
    },
    'toilette',
  );
  assert(toilet.length >= 1, 'Toilette: Fallback-Stichpunkt');
  assert(!/25436|Tornesch|Gäste nennen/i.test(toilet.join(' ')), 'Toilette: keine PLZ/Gäste-Floskel');
}

{
  const gold = buildHomeMapPlaceBullets(
    {
      id: 10,
      name: 'Goldschätzchen Wein- & Biergarten',
      lat: 53.67,
      lng: 9.76,
      radius_meters: 40,
      category: 'restaurant',
      tags_json: '["review_facet","pizza","asiatisch","biergarten","afterwork","gemütlich"]',
      facts: [
        { id: 1, poi_id: 10, fact_text: 'Wein- und Biergarten am Peiner Hof' },
        { id: 2, poi_id: 10, fact_text: 'Gemütliche Stimmung — mittwochs Afterwork' },
      ],
    },
    'restaurant',
  );
  const blob = gold.join(' | ');
  assert(!/Gäste nennen oft/i.test(blob), 'kein Gäste-nennen-oft');
  assert(!/pizza|asiatisch/i.test(blob), 'Biergarten: keine Pizza/Asiatisch-Facets');
  assert(/biergarten|afterwork|gemütlich|wein/i.test(blob), 'klare Gastro-Stichpunkte');
}
'''
    sb = sb.replace(
        "console.log('homeMapPlaceBullets.smoke.test.ts OK');",
        extra + "\nconsole.log('homeMapPlaceBullets.smoke.test.ts OK');",
        1,
    )
    smoke_bullets.write_text(sb, encoding="utf-8")
    print("ok bullets smoke")

# hotel icon smoke
filt = ROOT / "src/services/homeMap/homeMapPlaceFilter.smoke.test.ts"
ft = filt.read_text(encoding="utf-8")
if "Fairway Hotel" not in ft:
    ft = ft.replace(
        "console.log('homeMapPlaceFilter.smoke.test.ts OK');",
        """
{
  const hotel = poi({
    id: 9001,
    name: 'Fairway Hotel Peiner Hof',
    lat: 53.67,
    lng: 9.76,
    category: 'hotel',
    tags_json: '["restaurant","hotel","directory"]',
  });
  assert(placeMapIcon(hotel) === 'hotel', 'Fairway Hotel = Hotel-Icon trotz Restaurant-Tag');
}

console.log('homeMapPlaceFilter.smoke.test.ts OK');
""",
        1,
    )
    filt.write_text(ft, encoding="utf-8")
    print("ok filter smoke")

print("DONE")
