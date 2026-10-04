from pathlib import Path
import time

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\placeCategoryPolicy.mjs")
for attempt in range(8):
    try:
        t = p.read_text(encoding="utf-8")
        old = """/** Orientierungs-Mindestzahlen Story (nicht hart prune — eher Warnung/Rückfrage). */
export const STORY_COUNT_GUIDANCE = {
  village: { minStory: 12, radiusM: 3500 },
  town: { minStory: 25, radiusM: 6000 },
  city: { minStory: 45, radiusM: 10000 },
  metro: { minStory: 80, radiusM: 15000 },
};"""
        new = """/**
 * Story-Mindestzahlen = Value-for-Money (User zahlt für Pack-Download).
 * Echte Story-Orte (tief), keine Hotel/Shop-Stubs. Vor Upload: minStory erreichen.
 */
export const STORY_COUNT_GUIDANCE = {
  village: { minStory: 15, targetStory: 20, radiusM: 3500 },
  town: { minStory: 28, targetStory: 35, radiusM: 6000 },
  city: { minStory: 50, targetStory: 60, radiusM: 10000 },
  /** Insel / große Fläche (Bornholm, Sylt, Rügen …) */
  island: { minStory: 60, targetStory: 75, radiusM: 22000 },
  metro: { minStory: 80, targetStory: 100, radiusM: 15000 },
};"""
        if old not in t:
            raise SystemExit("guidance block missing")
        t = t.replace(old, new, 1)

        old2 = "  if (/bornholm/i.test(name)) return 'city'; // Insel-Pack, großer Radius\n  if (/wangerooge|prisdorf|tornesch/i.test(name)) return 'town';"
        new2 = """  if (/bornholm|sylt|r[üu]gen|fehmarn|f[öo]hr|amrum|usedom|norderney|juist|langeoog|spiekeroog/i.test(name)) {
    return 'island';
  }
  if (/wangerooge|prisdorf|tornesch/i.test(name)) return 'town';"""
        if old2 not in t:
            raise SystemExit("bornholm size hint missing")
        t = t.replace(old2, new2, 1)

        old3 = """export function suggestedMinStory(packOrName) {
  const size = citySizeHint(packOrName);
  return STORY_COUNT_GUIDANCE[size]?.minStory || 20;
}"""
        new3 = """export function suggestedMinStory(packOrName) {
  const size = citySizeHint(packOrName);
  return STORY_COUNT_GUIDANCE[size]?.minStory || 20;
}

/** Soft-Ziel über minStory — genug Inhalt fürs Geld. */
export function suggestedTargetStory(packOrName) {
  const size = citySizeHint(packOrName);
  return STORY_COUNT_GUIDANCE[size]?.targetStory || suggestedMinStory(packOrName);
}

/** True wenn Pack unter Value-Mindestzahl Stories liegt. */
export function packStoryBelowValueFloor(pack) {
  const stories = (pack?.spots || []).filter((s) => s.pack_role !== 'directory');
  return stories.length < suggestedMinStory(pack);
}"""
        if old3 not in t:
            raise SystemExit("suggestedMinStory missing")
        t = t.replace(old3, new3, 1)

        tmp = p.with_suffix(".mjs.tmp")
        tmp.write_text(t, encoding="utf-8")
        tmp.replace(p)
        print("policy ok")
        break
    except OSError as e:
        print("retry", attempt, e)
        time.sleep(1.2)
else:
    raise SystemExit("failed policy")
