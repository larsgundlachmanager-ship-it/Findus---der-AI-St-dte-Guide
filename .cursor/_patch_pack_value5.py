from pathlib import Path
import time

def atomic_write(path: Path, text: str):
    for attempt in range(12):
        try:
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(path)
            return
        except OSError as e:
            print("retry", attempt, e)
            time.sleep(1.5)
    raise SystemExit(f"write failed {path}")

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\createCityAuto.mjs")
t = p.read_text(encoding="utf-8")

if "from './placeCategoryPolicy.mjs'" not in t:
    old = "import { runQualityGate } from './qualityGate.mjs';\nimport { findPending, pendingBriefSection } from './pendingCovers.mjs';"
    new = old + "\nimport {\n  citySizeHint,\n  packStoryBelowValueFloor,\n  suggestedMinStory,\n  suggestedTargetStory,\n} from './placeCategoryPolicy.mjs';"
    if old not in t:
        raise SystemExit("import anchor missing")
    t = t.replace(old, new, 1)

if "## Value-Floor" not in t:
    old = """## Stats
- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}
- Offline-QA: ${(pack._offline_qa || []).length}
- Version: ${pack.data_version}
${pendingBriefSection(cityId)}
`;
  const out = path.join(ROOT, 'data', 'staedte', `${cityId}.agent-brief.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, thinCount: thin.length, storyCount: stories.length };
}"""
    new = """## Value-Floor
- Größe: ${citySizeHint(pack)} · Floor ≥ ${suggestedMinStory(pack)} · Soft-Ziel ≈ ${suggestedTargetStory(pack)} · Ist: ${stories.length}${packStoryBelowValueFloor(pack) ? ' — **UNTER FLOOR**' : ''}

## Stats
- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}
- Offline-QA: ${(pack._offline_qa || []).length}
- Version: ${pack.data_version}
${pendingBriefSection(cityId)}
`;
  const out = path.join(ROOT, 'data', 'staedte', `${cityId}.agent-brief.md`);
  fs.writeFileSync(out, md, 'utf8');
  return {
    out,
    thinCount: thin.length,
    storyCount: stories.length,
    valueFloor: suggestedMinStory(pack),
    targetStory: suggestedTargetStory(pack),
    belowFloor: packStoryBelowValueFloor(pack),
  };
}"""
    if old not in t:
        # show nearby for debug
        i = t.find("## Stats")
        raise SystemExit("stats block missing: " + repr(t[i:i+280]))
    t = t.replace(old, new, 1)

if "UNDER-FLOOR" not in t:
    old = """  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,
  );"""
    # In file the first chars after backtick are \ and n
    old = "  console.log(\n    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,\n  );"
    new = """  const floorNote = brief.belowFloor
    ? ` UNDER-FLOOR(min=${brief.valueFloor})`
    : brief.storyCount < brief.targetStory
      ? ` soft-target=${brief.targetStory}`
      : '';
  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}${floorNote}`,
  );"""
    # Ensure template has \n as two chars
    new = new.replace("\\\\n[auto]", "\\n[auto]")
    if old not in t:
        raise SystemExit("DONE block missing: " + repr(t[t.find("[auto] DONE")-30:t.find("[auto] DONE")+120]))
    t = t.replace(old, new, 1)

atomic_write(p, t)
print("createCityAuto ok")

# rule
rule = Path(r"c:\Users\larsf\Findus 2.0\.cursor\rules\findus-city-auto.mdc")
rt = rule.read_text(encoding="utf-8")
if "Value-for-Money" not in rt:
    old = """## Qualitätsziel (klein/mittel, Wangerooge-Stil)

- Lieber **weniger Stories, tief** (Ziel ≈ 12–25 Stories für kleine Orte) als 70 dünne
- Pro Story-Ort: genug Rohstoff für **~1200 Zeichen** gesprochene Story (`general_info` + `deep_data_pool` Text-Pool **≥ ~1200**, ideal `deep ≥ 12`)
- **Große/Ikonische Orte** (Wahrzeichen, Top-Museen, Schlösser): Text-Pool gerne **≥ ~3000** Zeichen (für Mehr-Historie / Adjustable Depth) — gesprochene Hauptstory bleibt Masterbook-Max (~1200), Pack speichert tiefer
- Noise (Bushaltestellen, Gastro, Hotels) → Directory
- Cover: User-Pending (stylisiert) schlägt Wikipedia; sonst Wikipedia-Wahrzeichen"""
    new = """## Qualitätsziel (Value-for-Money)

User zahlt für Pack-Download — genug **tiefe** Stories, keine Hotel/Shop-Stubs.

SSOT: `STORY_COUNT_GUIDANCE` / `packStoryBelowValueFloor` in `placeCategoryPolicy.mjs` (Gate warnt unter Floor).

| Größe | Floor (min) | Soft-Ziel |
|---|---|---|
| Dorf / klein | 15 | 20 |
| Stadt / Mittel | 28 | 35 |
| Stadt groß | 50 | 60 |
| Insel (Bornholm, Sylt, Rügen…) | 60 | 75 |
| Metro | 80 | 100 |

- Lieber **weniger Stories, tief** als viele dünne — Floor ist Mindestzahl *echter* Stories
- Pro Story-Ort: Text-Pool **≥ ~1200** Zeichen (`general_info` + `deep_data_pool`, ideal `deep ≥ 12`)
- **Große/Ikonische Orte**: Text-Pool gerne **≥ ~3000** (Mehr-Historie); gesprochene Hauptstory bleibt Masterbook-Max (~1200)
- Noise (Bushaltestellen, Gastro, Hotels) → Directory
- Cover: User-Pending (stylisiert) schlägt Wikipedia; sonst Wikipedia-Wahrzeichen
- Vor Upload: Floor erreichen; Soft-Ziel anstreben"""
    if old not in rt:
        raise SystemExit("rule block missing")
    atomic_write(rule, rt.replace(old, new, 1))
    print("rule ok")
else:
    print("rule already")
