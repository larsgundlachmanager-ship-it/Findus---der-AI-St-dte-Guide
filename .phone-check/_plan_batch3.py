# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

LAUT_BLOCK = """
  {
    tag: 'laut',
    re: /\\blaut\\b|\\blärm|\\blaerm|verkehrslärm|durchgangsverkehr|laut(?:er|es)?\\s+hauptstra|hauptstra[ßs]e.{0,24}(?:laut|lärm|nerv)|sehr\\s+laut|zu\\s+laut|lautstarke/,
    negate: /nicht\\s+laut|kein(?:e|en)?\\s+lärm|kein(?:e|en)?\\s+laerm|trotz\\s+hauptstra|trotz\\s+verkehr/i,
  },
  {
    tag: 'all_you_can_eat',
    re: /all\\s*you\\s*can\\s*eat|allyoucaneat|all-you-can-eat|\\bayce\\b|essen\\s+so\\s+viel|unbegrenzt\\s+essen|flatrate\\s+(?:essen|buffet)/i,
  },
"""


def insert_after_ruhig(path: Path) -> None:
    t = path.read_text(encoding="utf-8")
    if "tag: 'laut'" in t:
        print("skip laut already", path.name)
        return
    m = re.search(r"\{\s*tag:\s*'ruhig',[\s\S]*?\},", t)
    if not m:
        raise SystemExit(f"ruhig not found in {path}")
    end = m.end()
    t = t[:end] + LAUT_BLOCK + t[end:]
    path.write_text(t, encoding="utf-8")
    print("ok laut+ayce", path.name)


insert_after_ruhig(ROOT / "src/module2/pitch/gastroFacetTags.ts")
insert_after_ruhig(ROOT / "scripts/cityPack/reviewFacetTags.mjs")

# Dining hard needs: quiet + hitMatches excludes laut
dining = ROOT / "src/module2/agents/localDiningCatalog.ts"
dt = dining.read_text(encoding="utf-8")
old_outdoor = """  if (
    /\\b(draußen|draussen|terrasse|outdoor|außenbereich|aussenbereich|garten|biergarten)\\b/i.test(
      q,
    )
  ) {
    out.push({
      id: 'outdoor',
      label: 'Terrasse/draußen',
      searchBoost: 'Restaurant Terrasse Biergarten outdoor seating',
      evidence:
        /\\b(terrasse|outdoor|biergarten|außenbereich|aussenbereich|gartenwirtschaft|patio|terrace)\\b/i,
    });
  }"""
new_outdoor = """  if (
    /\\b(draußen|draussen|terrasse|outdoor|außenbereich|aussenbereich|garten|biergarten)\\b/i.test(
      q,
    )
  ) {
    out.push({
      id: 'outdoor',
      label: 'Terrasse/draußen',
      searchBoost: 'Restaurant Terrasse Biergarten outdoor seating',
      evidence:
        /\\b(terrasse|outdoor|biergarten|außenbereich|aussenbereich|gartenwirtschaft|patio|terrace)\\b/i,
    });
  }
  if (
    /\\b(ruhig|leise|nicht\\s+laut|ohne\\s+lärm|ohne\\s+laerm|kein\\s+lärm)\\b/i.test(q)
  ) {
    out.push({
      id: 'quiet',
      label: 'ruhig',
      searchBoost: 'ruhig Restaurant leise entspannt',
      evidence: /\\b(ruhig|quiet|leise|nicht\\s+laut|entspannt)\\b/i,
    });
  }
  if (/\\b(all\\s*you\\s*can\\s*eat|allyoucaneat|ayce|unbegrenzt\\s+essen)\\b/i.test(q)) {
    out.push({
      id: 'ayce',
      label: 'All you can eat',
      searchBoost: 'All you can eat Buffet Flatrate',
      evidence: /all\\s*you\\s*can\\s*eat|allyoucaneat|ayce|unbegrenzt|flatrate|buffet/i,
    });
  }"""
if "id: 'quiet'" not in dt:
    if old_outdoor not in dt:
        raise SystemExit("outdoor block missing")
    dt = dt.replace(old_outdoor, new_outdoor, 1)
    print("ok dining quiet/ayce needs")
else:
    print("skip dining needs")

old_match = """function hitMatchesDiningNeeds(
  hit: { name: string; types?: string[] },
  needs: DiningHardNeed[],
  evidenceExtra?: string,
): boolean {
  if (!needs.length) return true;
  const blob = `${hit.name} ${(hit.types ?? []).join(' ')} ${evidenceExtra ?? ''}`;
  return needs.every((n) => n.evidence.test(blob));
}"""
new_match = """function hitMatchesDiningNeeds(
  hit: { name: string; types?: string[] },
  needs: DiningHardNeed[],
  evidenceExtra?: string,
): boolean {
  if (!needs.length) return true;
  const blob = `${hit.name} ${(hit.types ?? []).join(' ')} ${evidenceExtra ?? ''}`;
  const wantsQuiet = needs.some((n) => n.id === 'quiet');
  const wantsOutdoorCalm =
    needs.some((n) => n.id === 'outdoor') && wantsQuiet;
  // Lärm / Hauptstraße: raus, wenn User Ruhe (ggf. mit Draußen) will.
  if (
    (wantsQuiet || wantsOutdoorCalm) &&
    /\\b(laut)\\b|\\blärm|\\blaerm|verkehrslärm|durchgangsverkehr|lautstarke|hauptstra[ßs]e.{0,20}(?:laut|lärm|nerv)/i.test(
      blob,
    ) &&
    !/nicht\\s+laut|kein(?:e|en)?\\s+lärm/i.test(blob)
  ) {
    return false;
  }
  return needs.every((n) => {
    if (n.id === 'quiet') {
      return (
        n.evidence.test(blob) ||
        /\\bruhig\\b|\\bquiet\\b|\\bleise\\b/.test(blob)
      );
    }
    return n.evidence.test(blob);
  });
}"""
if "wantsQuiet" not in dt:
    if old_match not in dt:
        raise SystemExit("hitMatches missing")
    dt = dt.replace(old_match, new_match, 1)
    print("ok hitMatches laut exclude")
dining.write_text(dt, encoding="utf-8")

# polish wire refresh-all
raf = ROOT / "scripts/cityPack/refreshAllCityPacks.mjs"
rt = raf.read_text(encoding="utf-8")
if "polishMapBullets" not in rt:
    rt = rt.replace(
        "runNode('enrichReviewFacets.mjs', ['--city', id], { fatal: false });\n",
        "runNode('enrichReviewFacets.mjs', ['--city', id], { fatal: false });\n"
        "      runNode('polishMapBullets.mjs', ['--city', id], { fatal: false });\n",
        1,
    )
    raf.write_text(rt, encoding="utf-8")
    print("ok refresh-all polish")
else:
    print("skip refresh polish")

# createCityAuto
auto = ROOT / "scripts/cityPack/createCityAuto.mjs"
at = auto.read_text(encoding="utf-8")
if "polishMapBullets" not in at:
    at = at.replace(
        """  try {
    run('enrichReviewFacets.mjs', ['--city', id], 'review-facets');
  } catch (e) {
    console.warn('[auto] review-facets failed (non-fatal)', e?.message || e);
  }

  run(
    'gpsWegweiserLoop.mjs',""",
        """  try {
    run('enrichReviewFacets.mjs', ['--city', id], 'review-facets');
  } catch (e) {
    console.warn('[auto] review-facets failed (non-fatal)', e?.message || e);
  }

  try {
    run('polishMapBullets.mjs', ['--city', id], 'map-bullets');
  } catch (e) {
    console.warn('[auto] polishMapBullets failed (non-fatal)', e?.message || e);
  }

  run(
    'gpsWegweiserLoop.mjs',""",
        1,
    )
    auto.write_text(at, encoding="utf-8")
    print("ok city:auto polish")
else:
    print("skip auto polish")

print("batch3 done")
