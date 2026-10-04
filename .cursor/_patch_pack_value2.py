from pathlib import Path
import time

def patch(path, replacements):
    p = Path(path)
    for attempt in range(10):
        try:
            t = p.read_text(encoding="utf-8")
            for old, new in replacements:
                if old not in t:
                    raise SystemExit(f"missing block in {path}:\n{old[:120]}...")
                t = t.replace(old, new, 1)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text(t, encoding="utf-8")
            tmp.replace(p)
            print("ok", path)
            return
        except OSError as e:
            print("retry", attempt, e)
            time.sleep(1.5)
    raise SystemExit(f"failed {path}")

patch(
    r"c:\Users\larsf\Findus 2.0\scripts\cityPack\qualityGate.mjs",
    [
        (
            """  const storyCount = spots.filter((s) => !isDirectorySpot(s)).length;
  const directoryCount = spots.filter((s) => isDirectorySpot(s)).length;
  const stats = {
    spots: spots.length,
    storySpots: storyCount,
    directorySpots: directoryCount,""",
            """  const storyCount = spots.filter((s) => !isDirectorySpot(s)).length;
  const directoryCount = spots.filter((s) => isDirectorySpot(s)).length;
  const minStory = suggestedMinStory(pack);
  const targetStory = suggestedTargetStory(pack);
  const sizeHint = citySizeHint(pack);
  if (packStoryBelowValueFloor(pack)) {
    (strict ? errors : warnings).push(
      `value floor: story=${storyCount} < min ${minStory} (${sizeHint}) — User zahlt für Pack; mehr echte Stories / Research`,
    );
  } else if (storyCount < targetStory) {
    warnings.push(
      `value target: story=${storyCount} < soft-Ziel ${targetStory} (${sizeHint})`,
    );
  }
  const stats = {
    spots: spots.length,
    storySpots: storyCount,
    directorySpots: directoryCount,
    minStory,
    targetStory,
    sizeHint,""",
        )
    ],
)

# report gaps: check if header already updated
rp = Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\reportResearchGaps.mjs")
rt = rp.read_text(encoding="utf-8")
if "Soft-Ziel" not in rt:
    patch(
        str(rp),
        [
            (
                """  const minStory = suggestedMinStory(pack);
  const radius = suggestedDiscoveryRadius(pack);
  const stories = (pack.spots || []).filter((s) => s.pack_role !== 'directory');
  const thin = stories.filter((s) => isThinStory(pack, s));
  const rich = stories.filter((s) => !isThinStory(pack, s));

  let googleMissing = [];
  if (hasFlag('google')) {
    console.log('[gaps] Google-Abgleich…');
    googleMissing = await findGoogleMissing(pack, radius);
  }

  const lines = [];
  lines.push(`# Rückfragen / Research-Lücken — ${pack.name || cityId}`);
  lines.push('');
  lines.push(`Stand: ${new Date().toISOString()}`);
  lines.push(
    `Story: **${stories.length}** (Guidance ≥ **${minStory}**) · Directory: **${pack._pack_index?.directory ?? '—'}** · dünn: **${thin.length}** · angereichert: **${rich.length}**`,
  );""",
                """  const minStory = suggestedMinStory(pack);
  const targetStory = suggestedTargetStory(pack);
  const radius = suggestedDiscoveryRadius(pack);
  const stories = (pack.spots || []).filter((s) => s.pack_role !== 'directory');
  const thin = stories.filter((s) => isThinStory(pack, s));
  const rich = stories.filter((s) => !isThinStory(pack, s));

  let googleMissing = [];
  if (hasFlag('google')) {
    console.log('[gaps] Google-Abgleich…');
    googleMissing = await findGoogleMissing(pack, radius);
  }

  const lines = [];
  lines.push(`# Rückfragen / Research-Lücken — ${pack.name || cityId}`);
  lines.push('');
  lines.push(`Stand: ${new Date().toISOString()}`);
  lines.push(
    `Story: **${stories.length}** (Value-Floor ≥ **${minStory}**, Soft-Ziel ≈ **${targetStory}**) · Directory: **${pack._pack_index?.directory ?? '—'}** · dünn: **${thin.length}** · angereichert: **${rich.length}**`,
  );""",
            )
        ],
    )

# always patch the thin section if still old
rt = rp.read_text(encoding="utf-8")
if "## Pack zu dünn" in rt:
    patch(
        str(rp),
        [
            (
                """  if (stories.length < minStory) {
    lines.push('## Pack zu dünn');
    lines.push('');
    lines.push(
      `Aktuell ${stories.length} Stories, Ziel für diese Stadtgröße ≈ ${minStory}. Bitte weitere Top-Sehenswürdigkeiten / Museen / Theater / Kirchen / Aussichten liefern oder \\`city:classify --radius ${radius}\\` mit Google-Discovery laufen lassen.`,
    );
    lines.push('');
  }""",
                """  if (stories.length < minStory) {
    lines.push('## Pack unter Value-Floor');
    lines.push('');
    lines.push(
      `Aktuell ${stories.length} Stories — Mindestzahl fürs Geld ≈ **${minStory}**, Soft-Ziel ≈ **${targetStory}**. Weitere Top-Sehenswürdigkeiten / Museen / Theater / Kirchen / Aussichten oder \\`city:classify --radius ${radius}\\` mit Google-Discovery.`,
    );
    lines.push('');
  } else if (stories.length < targetStory) {
    lines.push('## Soft-Ziel noch offen');
    lines.push('');
    lines.push(
      `Floor erreicht (${stories.length} ≥ ${minStory}), Soft-Ziel ≈ **${targetStory}** — optional mehr Landmarken für dickeren Pack-Wert.`,
    );
    lines.push('');
  }""",
            )
        ],
    )

cp = Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\classifyPackCategories.mjs")
ct = cp.read_text(encoding="utf-8")
if "value-floor" not in ct:
    patch(
        str(cp),
        [
            (
                """  const radius = radiusM || suggestedDiscoveryRadius(pack);
  const minStory = suggestedMinStory(pack);
  console.log(`[classify] ${cityId} radius=${radius}m minStory≈${minStory}`);
  const recl = reclassifyExisting(pack);
  refreshIndex(pack);
  const skipDiscover =
    hasFlag('skip-discover') ||
    (!hasFlag('force-discover') && (pack._pack_index?.story || 0) >= minStory);
  let disc = { added: 0, near: 0 };
  if (skipDiscover) {
    console.log(
      `[classify] skip Places discovery (story=${pack._pack_index.story} ≥ ${minStory}; --force-discover zum Erzwingen)`,
    );
  } else {
    disc = await discoverStoryCategories(pack, radius);
    refreshIndex(pack);
  }
  const gate = runQualityGate(pack, { strict: false });
  if (pack._pack_index.story < minStory) {
    console.warn(
      `[classify] WARN story=${pack._pack_index.story} < guidance ${minStory} — Discovery verbreitern / Research-Rückfragen`,
    );
  }""",
                """  const radius = radiusM || suggestedDiscoveryRadius(pack);
  const minStory = suggestedMinStory(pack);
  const targetStory = suggestedTargetStory(pack);
  console.log(
    `[classify] ${cityId} radius=${radius}m minStory≈${minStory} target≈${targetStory}`,
  );
  const recl = reclassifyExisting(pack);
  refreshIndex(pack);
  // Discovery bis Soft-Ziel — Value-for-Money, keine Stub-Hotels.
  const skipDiscover =
    hasFlag('skip-discover') ||
    (!hasFlag('force-discover') && (pack._pack_index?.story || 0) >= targetStory);
  let disc = { added: 0, near: 0 };
  if (skipDiscover) {
    console.log(
      `[classify] skip Places discovery (story=${pack._pack_index.story} ≥ target ${targetStory}; --force-discover zum Erzwingen)`,
    );
  } else {
    disc = await discoverStoryCategories(pack, radius);
    refreshIndex(pack);
  }
  const gate = runQualityGate(pack, { strict: false });
  if (pack._pack_index.story < minStory) {
    console.warn(
      `[classify] WARN value-floor story=${pack._pack_index.story} < min ${minStory} (Ziel ${targetStory}) — Discovery / Research`,
    );
  } else if (pack._pack_index.story < targetStory) {
    console.warn(
      `[classify] WARN soft-target story=${pack._pack_index.story} < ${targetStory} — optional mehr Landmarken`,
    );
  }""",
            )
        ],
    )
else:
    print("classify already patched")
