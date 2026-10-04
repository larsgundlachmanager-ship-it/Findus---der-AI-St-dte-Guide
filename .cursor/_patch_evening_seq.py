# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\planning\planUtteranceGate.ts")
text = p.read_text(encoding="utf-8")

HELPER = r'''
const EVENING_MEAL_RE =
  /\b(essen(?:\s+gehen)?|abendessen|dinner|restaurant|mittagessen|frühstück(?:en)?|fruehstueck(?:en)?|café|cafe)\b/i;
const EVENING_CULTURE_RE =
  /\b(theater|kino|cinema|konzert|musical|oper|museum|ausstellung|show|vorstellung)\b/i;

/** Abend-/Sequenz-Multi-Stop: erst Essen dann Theater usw. — immer Planung. */
export function looksLikeSequencedMultiStopPlan(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 12) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  const hasSeq =
    /\b(erst|zuerst|dann|danach|und\s+dann|anschließend|anschliessend|vorher|danach)\b/i.test(
      t,
    );
  if (!hasSeq) return false;
  const meal = EVENING_MEAL_RE.test(t);
  const culture = EVENING_CULTURE_RE.test(t);
  if (meal && culture) return true;
  // Abend + Essen + Sequenz zu zweitem Stop
  if (
    /\b(abend(?:planung)?|heute\s+abend|heute\s+nacht)\b/i.test(t) &&
    meal &&
    /\b(dann|danach|und\s+dann).{0,48}\b(theater|kino|museum|konzert|bar|party|spazier\w*|tour|musical)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // explizit: erst essen … dann …
  if (
    /\b(erst|zuerst).{0,40}\b(essen|restaurant|abendessen).{0,48}\b(dann|danach)\b/i.test(
      t,
    ) &&
    /\b(dann|danach).{0,40}\b([\p{L}]{3,})\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

'''

chaotic_doc = "/**\n * Langer, chaotischer Tageswunsch"
cidx = text.find(chaotic_doc)
if cidx < 0:
    raise SystemExit("chaotic docblock not found")

if "looksLikeSequencedMultiStopPlan" not in text:
    text = text[:cidx] + HELPER + text[cidx:]
    print("inserted helper")
else:
    print("helper already present")

old_chaotic_head = """export function looksLikeChaoticDayPlanUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t || t.length < 40) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;

  const buckets = countNeedBuckets(t);"""

new_chaotic_head = """export function looksLikeChaoticDayPlanUtterance(text: string): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return false;
  if (looksLikeOutfitOrWeatherUtterance(t)) return false;
  if (looksLikeSequencedMultiStopPlan(t)) return true;
  if (t.length < 40) return false;

  const buckets = countNeedBuckets(t);"""

if old_chaotic_head in text:
    text = text.replace(old_chaotic_head, new_chaotic_head, 1)
    print("patched chaotic head")
elif "if (looksLikeSequencedMultiStopPlan(t)) return true;" in text[
    text.find("looksLikeChaoticDayPlanUtterance") : text.find("looksLikeChaoticDayPlanUtterance") + 400
]:
    print("chaotic already patched")
else:
    raise SystemExit("chaotic head not found")

old_jdi = """  if (looksLikeChaoticDayPlanUtterance(t)) return false;

  const hasPlanVerb =
    /\\b(plan(e|en|ung|st)?|einplanen|tagesplan|timeline|kalender|durchplanen|organisiere|orga(nisiere)?\\s+(mir|den)|mach\\s+mir\\s+(einen\\s+)?plan|ganzer\\s+tag|den\\s+tag\\s+(durch)?planen)\\b/i.test(
      t,
    );"""

new_jdi = """  if (looksLikeChaoticDayPlanUtterance(t)) return false;
  if (looksLikeSequencedMultiStopPlan(t)) return false;

  const hasPlanVerb =
    /\\b(plan(e|en|ung|st)?|einplanen|tagesplan|timeline|kalender|durchplanen|organisiere|orga(nisiere)?\\s+(mir|den)|mach\\s+mir\\s+(einen\\s+)?plan|ganzer\\s+tag|den\\s+tag\\s+(durch)?planen)\\b/i.test(
      t,
    );"""

jdi_start = text.find("export function looksLikeSingleJustDoItRequest")
jdi_snip = text[jdi_start : jdi_start + 900]
if "if (looksLikeSequencedMultiStopPlan(t)) return false;" in jdi_snip:
    print("jdi already patched")
elif old_jdi in text:
    text = text.replace(old_jdi, new_jdi, 1)
    print("patched jdi")
else:
    raise SystemExit("jdi block not found")

old_m5 = """  // Chaos ZUERST — bevor Single-Just-Do-It den Tag killt
  if (looksLikeChaoticDayPlanUtterance(t)) return true;
  try {"""

new_m5 = """  // Chaos ZUERST — bevor Single-Just-Do-It den Tag killt
  if (looksLikeChaoticDayPlanUtterance(t)) return true;
  if (looksLikeSequencedMultiStopPlan(t)) return true;
  try {"""

m5_start = text.find("export function looksLikeModul5PlanUtterance")
m5_snip = text[m5_start : m5_start + 700]
if "if (looksLikeSequencedMultiStopPlan(t)) return true;" in m5_snip:
    print("m5 early already patched")
elif old_m5 in text:
    text = text.replace(old_m5, new_m5, 1)
    print("patched m5 early")
else:
    raise SystemExit("m5 early not found")

old_multi = """  const hasMultiStop =
    /\\b(und\\s+dann|danach|zuerst|außerdem|ausserdem|vorher).{0,60}\\b(essen|café|cafe|museum|theater|hotel|spazier\\w*|party|frühstück|fruehstueck|erkunden)\\b/i.test(
      t,
    ) ||
    (/\\b(mittag(essen)?|abendessen|frühstück(?:en)?|fruehstueck(?:en)?)\\b/i.test(t) &&
      /\\b(?:(?:um|ab|gegen)\\s+\\d{1,2}|dann|danach|und|meeting|party|erkunden)\\b/i.test(
        t,
      ));"""

new_multi = """  const hasMultiStop =
    /\\b(und\\s+dann|danach|zuerst|erst|außerdem|ausserdem|vorher).{0,60}\\b(essen|café|cafe|museum|theater|hotel|spazier\\w*|party|frühstück|fruehstueck|erkunden)\\b/i.test(
      t,
    ) ||
    /\\b(essen|restaurant|abendessen).{0,40}\\b(dann|danach).{0,40}\\b(theater|kino|museum|konzert)\\b/i.test(
      t,
    ) ||
    (/\\b(mittag(essen)?|abendessen|frühstück(?:en)?|fruehstueck(?:en)?)\\b/i.test(t) &&
      /\\b(?:(?:um|ab|gegen)\\s+\\d{1,2}|dann|danach|und|meeting|party|erkunden)\\b/i.test(
        t,
      ));"""

multi_idx = text.find("const hasMultiStop =")
multi_snip = text[multi_idx : multi_idx + 500]
if "|erst|" in multi_snip:
    print("hasMultiStop already patched")
elif old_multi in text:
    text = text.replace(old_multi, new_multi, 1)
    print("patched hasMultiStop")
else:
    raise SystemExit("hasMultiStop not found")

out = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_planUtteranceGate_patched.ts")
out.write_text(text, encoding="utf-8")
print("OK wrote temp", out, "bytes", out.stat().st_size)
try:
    p.write_text(text, encoding="utf-8")
    print("OK patched", p)
except OSError as e:
    print("direct write failed:", e)
    import shutil
    try:
        shutil.copyfile(out, p)
        print("OK copied via shutil")
    except OSError as e2:
        print("copy failed:", e2)
        raise
