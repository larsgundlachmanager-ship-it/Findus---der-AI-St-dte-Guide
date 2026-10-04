# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"src/module2/pitch/hardMatchVerify.ts")
t = path.read_text(encoding="utf-8")

old = """function scoreAmenityEvidence(blob: string, wish: PitchWish): number {
  if (/zugrestaurant|speisewagen|dining/.test(wish.text.toLowerCase())) {
    const spec = scoreSpecializedFoodWish(blob, wish);
    if (spec >= 0) return spec;
  }
  if (/all_you_can_eat|ayce|buffet|schlemmer/i.test(wish.text)) {
    return scoreAyceEvidence(blob);
  }
  return amenityNeedle(wish).test(blob) ? 3 : 0;
}"""

new = """function scoreAmenityEvidence(blob: string, wish: PitchWish): number {
  if (/zugrestaurant|speisewagen|dining/.test(wish.text.toLowerCase())) {
    const spec = scoreSpecializedFoodWish(blob, wish);
    if (spec >= 0) return spec;
  }
  if (isAyceWishText(wish.text)) {
    return scoreAyceEvidence(blob);
  }
  return amenityNeedle(wish).test(blob) ? 3 : 0;
}

/** AYCE-Must unabhaengig von kind (Call-1 mapped oft faelschlich -> dish). */
function isAyceWishText(text: string): boolean {
  const t = String(text || '');
  if (/all_you_can_eat|\\bayce\\b|must_ayce|schlemmer|buffet/i.test(t)) return true;
  try {
    const { looksLikeAyceQuery } = require('./ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    return looksLikeAyceQuery(t);
  } catch {
    return /all[\\s_-]*(?:you|xou)[\\s_-]*can[\\s_-]*eat/i.test(t);
  }
}

function requestLooksLikeAyce(req: PitchRequest): boolean {
  if (req.wishes.some((w) => w.hardness === 'must' && isAyceWishText(w.text))) {
    return true;
  }
  try {
    const { looksLikeAyceQuery } = require('./ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    return looksLikeAyceQuery(`${req.title} ${req.context}`);
  } catch {
    return /all[\\s_-]*(?:you|xou)[\\s_-]*can[\\s_-]*eat|\\bayce\\b/i.test(
      `${req.title} ${req.context}`,
    );
  }
}"""

if old not in t:
    raise SystemExit("block1 missing")
t = t.replace(old, new, 1)

# min score for AYCE — match by marker lines without special unicode
marker = "w.kind === 'amenity' &&\n        /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text)\n          ? 2"
if marker not in t:
    raise SystemExit("block2 missing")
t = t.replace(
    marker,
    "isAyceWishText(w.text)\n        ? 2",
    1,
)

old3 = """    const ayceMust = musts.some(
      (w) =>
        w.kind === 'amenity' &&
        /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
    );
    // AYCE: nie Soft-Fill mit"""
if old3 not in t:
    raise SystemExit("block3 missing")
t = t.replace(
    old3,
    """    const ayceMust = requestLooksLikeAyce(opts.req);
    // AYCE: nie Soft-Fill mit""",
    1,
)

old4 = """  if (wish.kind === 'dish') return scoreDishEvidence(blob, wish);
  if (wish.kind === 'amenity' || wish.kind === 'vibe') {"""
new4 = """  if (isAyceWishText(wish.text)) return scoreAyceEvidence(blob);
  if (wish.kind === 'dish') return scoreDishEvidence(blob, wish);
  if (wish.kind === 'amenity' || wish.kind === 'vibe') {"""
if old4 not in t:
    raise SystemExit("block4 missing")
t = t.replace(old4, new4, 1)

path.write_text(t, encoding="utf-8")
print("hardMatchVerify patched ok")
