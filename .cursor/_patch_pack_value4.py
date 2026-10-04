from pathlib import Path
import time

def rewrite(path, transform):
    p = Path(path)
    for attempt in range(12):
        try:
            t = p.read_text(encoding="utf-8")
            nt = transform(t)
            if nt is None:
                print("skip", path)
                return
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text(nt, encoding="utf-8")
            tmp.replace(p)
            print("ok", path)
            return
        except OSError as e:
            print("retry", attempt, e)
            time.sleep(1.5)
    raise SystemExit(f"failed {path}")

def auto(t):
    if "suggestedMinStory" in t and "valueFloor" in t:
        return None
    if "from './placeCategoryPolicy.mjs'" not in t:
        old_imp = """import { runQualityGate } from './qualityGate.mjs';
import { findPending, pendingBriefSection } from './pendingCovers.mjs';"""
        new_imp = """import { runQualityGate } from './qualityGate.mjs';
import { findPending, pendingBriefSection } from './pendingCovers.mjs';
import {
  citySizeHint,
  packStoryBelowValueFloor,
  suggestedMinStory,
  suggestedTargetStory,
} from './placeCategoryPolicy.mjs';"""
        if old_imp not in t:
            raise SystemExit("auto import missing")
        t = t.replace(old_imp, new_imp, 1)

    old_brief = """function writeAgentBrief(pack, cityId) {
  const stories = (pack.spots || [])
    .filter((s) => s.pack_role !== 'directory')
    .sort((a, b) => (a.place_tier ?? 9) - (b.place_tier ?? 9));
  const thin = stories.filter((s) => {
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    return (t?.deep_data_pool || []).length < 6 || (t?.general_info || '').length < 100;
  });
  const md = `# Agent Deep Research — ${pack.name || cityId}

Pipeline \\`city:auto\\` fertig. Für **Wangerooge-Qualität** (tiefe Stories + Offline-QA) Agent-Webresearch auf T1/dünne Orte.

## Regeln
- Nur belegte Fakten; Preise/Öffnung nur \\`LIVE: …\\`
- Keine Dialog-Skripte
- Pack-IDs strikt

## Dünn / Priorität
${
  thin
    .slice(0, 30)
    .map((s) => {
      const t = (pack.trigger_points || []).find((x) => x.id === s.id);
      return `- **${s.name}** (T${s.place_tier}) \\`${s.id}\\` — deep=${(t?.deep_data_pool || []).length} gi=${(t?.general_info || '').length}`;
    })
    .join('\\n') || '- keine'
}

## Alle Stories
${stories.map((s, i) => `${i + 1}. ${s.name} (T${s.place_tier}) \\`${s.id}\\``).join('\\n')}

## Stats
- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}
- Offline-QA: ${(pack._offline_qa || []).length}
- Version: ${pack.data_version}
${pendingBriefSection(cityId)}
`;
  const out = path.join(ROOT, 'data', 'staedte', `${cityId}.agent-brief.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, thinCount: thin.length, storyCount: stories.length };
}"""
    # Use marker-based replace instead - read actual file content
    marker = "function writeAgentBrief(pack, cityId) {"
    if marker not in t:
        raise SystemExit("writeAgentBrief missing")
    if "Value-Floor" in t[t.index(marker):t.index(marker)+800]:
        return t if "suggestedMinStory" in t else None

    # Insert value floor into Stats section
    old_stats = """## Stats
- Spots: ${pack.spots.length} · Story: ${stories.length} · Directory: ${pack.spots.length - stories.length}
- Offline-QA: ${(pack._offline_qa || []).length}
- Version: ${pack.data_version}
${pendingBriefSection(cityId)}
`;
  const out = path.join(ROOT, 'data', 'staedte', `${cityId}.agent-brief.md`);
  fs.writeFileSync(out, md, 'utf8');
  return { out, thinCount: thin.length, storyCount: stories.length };
}"""
    new_stats = """## Value-Floor
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
    if old_stats not in t:
        raise SystemExit("stats block missing")
    t = t.replace(old_stats, new_stats, 1)

    old_done = """  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,
  );"""
    new_done = """  const floorNote = brief.belowFloor
    ? ` UNDER-FLOOR(min=${brief.valueFloor})`
    : brief.storyCount < brief.targetStory
      ? ` soft-target=${brief.targetStory}`
      : '';
  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}${floorNote}`,
  );"""
    if old_done not in t:
        # try without double escape
        old_done = """  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,
  );"""
    # Read raw from file - the \n is actual backslash-n in template? No it's `\\n` in JS string inside template... 
    # Actually in the JS file it's: `\n[auto] DONE ...`
    old_done2 = "  console.log(\n    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}`,\n  );"
    # In Python reading file, `\n` in JS template is: backtick, backslash, n ... wait no.
    # In JS source: console.log(\n    `\n[auto] DONE ...
    # The template literal contains a real newline character after backtick? Looking at the read:
    #   console.log(
    #     `\n[auto] DONE ${id} ...
    # So after backtick comes backslash-n (two chars) for escaped newline in the template string.
    
    needle = "[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}"
    if needle not in t:
        raise SystemExit("DONE log missing")
    if "UNDER-FLOOR" in t:
        return t
    insert = """  const floorNote = brief.belowFloor
    ? ` UNDER-FLOOR(min=${brief.valueFloor})`
    : brief.storyCount < brief.targetStory
      ? ` soft-target=${brief.targetStory}`
      : '';
  console.log(
    `\\n[auto] DONE ${id} v${finalPack.data_version} story=${brief.storyCount} thin=${brief.thinCount} gate=${gate.ok ? 'ok' : 'FAIL'}${floorNote}`,
  );"""
    # Find the console.log block and replace
    start = t.index("  console.log(\n    `\\n[auto] DONE ${id}")
    end = t.index("  );", start) + len("  );")
    # Fix insert: need real \n in the template as two chars \ and n
    insert = insert.replace("\\\\n", "\\n")
    t = t[:start] + insert + t[end:]
    return t

rewrite(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\createCityAuto.mjs", auto)

# city-auto rule
rule = Path(r"c:\Users\larsf\Findus 2.0\.cursor\rules\findus-city-auto.mdc")
for attempt in range(8):
    try:
        rt = rule.read_text(encoding="utf-8")
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
        if "Value-for-Money" in rt:
            print("rule already")
            break
        if old not in rt:
            raise SystemExit("rule block missing")
        tmp = rule.with_suffix(".mdc.tmp")
        tmp.write_text(rt.replace(old, new, 1), encoding="utf-8")
        tmp.replace(rule)
        print("ok rule")
        break
    except OSError as e:
        print("retry rule", e)
        time.sleep(1.2)
