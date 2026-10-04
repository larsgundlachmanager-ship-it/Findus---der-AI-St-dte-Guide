from pathlib import Path
import time

def rewrite(path, transform):
    p = Path(path)
    for attempt in range(12):
        try:
            t = p.read_text(encoding="utf-8")
            nt = transform(t)
            if nt is None:
                print("skip (already)", path)
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

def qg(t):
    if "packStoryBelowValueFloor(pack)" in t and "value floor:" in t:
        return None
    old = """  const storyCount = spots.filter((s) => !isDirectorySpot(s)).length;
  const directoryCount = spots.filter((s) => isDirectorySpot(s)).length;
  const stats = {
    spots: spots.length,
    storySpots: storyCount,
    directorySpots: directoryCount,"""
    new = """  const storyCount = spots.filter((s) => !isDirectorySpot(s)).length;
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
    sizeHint,"""
    if old not in t:
        raise SystemExit("qualityGate block missing")
    return t.replace(old, new, 1)

def gaps(t):
    if "## Pack unter Value-Floor" in t:
        return None
    old = """  if (stories.length < minStory) {
    lines.push('## Pack zu dünn');
    lines.push('');
    lines.push(
      `Aktuell ${stories.length} Stories, Ziel für diese Stadtgröße ≈ ${minStory}. Bitte weitere Top-Sehenswürdigkeiten / Museen / Theater / Kirchen / Aussichten liefern oder `city:classify --radius ${radius}` mit Google-Discovery laufen lassen.`,
    );
    lines.push('');
  }"""
    # File uses escaped backticks in template literals: \`city:classify...
    marker = "## Pack zu dünn"
    if marker not in t:
        raise SystemExit("gaps marker missing")
    start = t.index("  if (stories.length < minStory) {\n    lines.push('## Pack zu dünn');")
    end = t.index("  if (googleMissing.length) {", start)
    new = """  if (stories.length < minStory) {
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
  }
"""
    # Fix: in the source file we need actual \` not \\`
    new = new.replace("\\\\`", "\\`")
    return t[:start] + new + t[end:]

rewrite(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\qualityGate.mjs", qg)
rewrite(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\reportResearchGaps.mjs", gaps)
