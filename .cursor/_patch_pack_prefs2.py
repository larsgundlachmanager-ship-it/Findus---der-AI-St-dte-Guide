from pathlib import Path

# --- ownerGold.ts ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    "  'booking',\n  'general',\n];",
    "  'booking',\n  'packing',\n  'general',\n];",
    1,
)
t = t.replace(
    "  'complete_sentences',\n];",
    "  'complete_sentences',\n  'pack_prefs',\n];",
    1,
)
t = t.replace(
    "  'essay',\n];",
    "  'essay',\n  'pack_unwanted_items',\n];",
    1,
)
if "'packing'" not in t or "'pack_prefs'" not in t:
    raise SystemExit("ownerGold patch incomplete")
p.write_text(t, encoding="utf-8")
print("ownerGold OK")

# --- correctionLearning.ts ---
c = Path(r"c:\Users\larsf\Findus 2.0\src\services\memory\correctionLearning.ts")
ct = c.read_text(encoding="utf-8")

# arrays
if "'pack_prefs'" not in ct:
    ct = ct.replace(
        "  'complete_sentences',\n];",
        "  'complete_sentences',\n  'pack_prefs',\n];",
        1,
    )
if "'pack_unwanted_items'" not in ct:
    ct = ct.replace(
        "  'essay',\n];",
        "  'essay',\n  'pack_unwanted_items',\n];",
        1,
    )
if "'packing'" not in ct.split("FAMILY_ALL")[1][:400]:
    ct = ct.replace(
        "  'booking',\n  'general',\n];",
        "  'booking',\n  'packing',\n  'general',\n];",
        1,
    )

# import pack helpers near top after learnedRules import — add dynamic require in functions instead

marker = "export function looksLikeSpeechStyleCorrection"
if "looksLikePackPreference" not in ct and marker in ct:
    insert = '''
function tryPackPrefDraft(
  text: string,
): Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null {
  try {
    const {
      looksLikePackPreference,
      parsePackPrefsFromText,
      draftPackPrefLearnedRule,
    } = require('../../module2/timeline/packListPrefs') as {
      looksLikePackPreference: (t: string) => boolean;
      parsePackPrefsFromText: (t: string) => {
        avoid: string[];
        prefer: string[];
        notes: string[];
      };
      draftPackPrefLearnedRule: (p: {
        avoid: string[];
        prefer: string[];
        notes: string[];
      }) => Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null;
    };
    if (!looksLikePackPreference(text)) return null;
    const prefs = parsePackPrefsFromText(text);
    return draftPackPrefLearnedRule(prefs as never);
  } catch {
    return null;
  }
}

'''
    ct = ct.replace(marker, insert + marker, 1)

# inferIntentFamily — packing
if "packliste|packen|einpacken" not in ct:
    ct = ct.replace(
        "if (/\\b(plan|tagesplan|itinerar|vormittag|nachmittag)\\b/u.test(blob)) {\n    return 'planning';\n  }",
        "if (/\\b(packliste|packen|einpacken|packing\\s*list|nie\\s+pulli|kein(?:en)?\\s+anzug)\\b/u.test(blob)) {\n    return 'packing';\n  }\n  if (/\\b(plan|tagesplan|itinerar|vormittag|nachmittag)\\b/u.test(blob)) {\n    return 'planning';\n  }",
        1,
    )

# extractCorrectionFast — early pack pref
old_fast = """export function extractCorrectionFast(
  text: string,
  ctx: { lastUser: string | null; lastAssistant: string | null },
): Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null {
  if (!looksLikeAnswerCorrection(text)) return null;
  const t = text.replace(/\\s+/g, ' ').trim();
"""
new_fast = """export function extractCorrectionFast(
  text: string,
  ctx: { lastUser: string | null; lastAssistant: string | null },
): Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null {
  const packDraft = tryPackPrefDraft(text);
  if (packDraft) return packDraft;
  if (!looksLikeAnswerCorrection(text)) return null;
  const t = text.replace(/\\s+/g, ' ').trim();
"""
if old_fast not in ct:
    raise SystemExit("extractCorrectionFast header missing")
ct = ct.replace(old_fast, new_fast, 1)

# runCorrectionLearningCapture — accept pack prefs without correction hint
old_run = """  const text = userText.replace(/\\s+/g, ' ').trim();
  if (!looksLikeAnswerCorrection(text)) return empty;

  const ctx = getRecentTurnPair();
  let draft = extractCorrectionFast(text, ctx);
  if (!draft || (draft.expect.length + draft.avoid.length < 2 && text.length > 20)) {
"""
new_run = """  const text = userText.replace(/\\s+/g, ' ').trim();
  const packEarly = tryPackPrefDraft(text);
  if (!looksLikeAnswerCorrection(text) && !packEarly) return empty;

  const ctx = getRecentTurnPair();
  let draft = packEarly ?? extractCorrectionFast(text, ctx);
  if (
    !draft ||
    (draft.intentFamily !== 'packing' &&
      draft.expect.length + draft.avoid.length < 2 &&
      text.length > 20)
  ) {
"""
if old_run not in ct:
    raise SystemExit("runCorrectionLearningCapture block missing")
ct = ct.replace(old_run, new_run, 1)

# rulesEqualKey — merge all packing into one
old_eq = """function rulesEqualKey(a: LearnedRule, b: Pick<LearnedRule, 'intentFamily' | 'expect' | 'avoid' | 'tags'>): boolean {
  const tagA = [...a.tags].map((t) => t.toLowerCase()).sort().join('|');
"""
new_eq = """function rulesEqualKey(a: LearnedRule, b: Pick<LearnedRule, 'intentFamily' | 'expect' | 'avoid' | 'tags'>): boolean {
  // Eine Pack-Prefs-Regel pro User — Tags akkumulieren
  if (a.intentFamily === 'packing' && b.intentFamily === 'packing') return true;
  const tagA = [...a.tags].map((t) => t.toLowerCase()).sort().join('|');
"""
if old_eq not in ct:
    raise SystemExit("rulesEqualKey missing")
ct = ct.replace(old_eq, new_eq, 1)

# intentToFamily packlist
if "packlist|pack_list|packen" not in ct:
    ct = ct.replace(
        "if (/day_plan|plan|itinerar|day/.test(i)) return 'planning';",
        "if (/packlist|pack_list|packen|packing/.test(i)) return 'packing';\n  if (/day_plan|plan|itinerar|day/.test(i)) return 'planning';",
        1,
    )

# LLM prompt family list
ct = ct.replace(
    '"intentFamily":"activity_poi|dining|events|hotel|navigation|knowledge|planning|booking|general",',
    '"intentFamily":"activity_poi|dining|events|hotel|navigation|knowledge|planning|booking|packing|general",',
    1,
)

c.write_text(ct, encoding="utf-8")
print("correctionLearning OK")
