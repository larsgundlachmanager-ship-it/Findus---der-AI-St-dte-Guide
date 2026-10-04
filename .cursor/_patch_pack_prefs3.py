from pathlib import Path

# --- packListBuilder.ts ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\timeline\packListBuilder.ts")
t = p.read_text(encoding="utf-8")

if "packPrefs?" not in t:
    t = t.replace(
        "  /** Explizite Altersangaben in Jahren, wenn belegt */\n  childAgesYears?: number[] | null;\n};",
        "  /** Explizite Altersangaben in Jahren, wenn belegt */\n  childAgesYears?: number[] | null;\n"
        "  /** Persönliche Pack-Prefs (LearnedRule / User-Text) */\n  packPrefs?: {\n    avoid?: string[] | null;\n    prefer?: string[] | null;\n    notes?: string[] | null;\n  } | null;\n};",
        1,
    )

# import apply helpers
if "applyPackListPrefs" not in t:
    t = t.replace(
        "import type { PackListItem } from '../../store/usePackListStore';",
        "import type { PackListItem } from '../../store/usePackListStore';\n"
        "import {\n  applyPackListPrefs,\n  mergePackPrefs,\n  parsePackPrefsFromText,\n  type PackGarmentCanon,\n  type PackListPrefs,\n} from './packListPrefs';",
        1,
    )

# before return — apply prefs
old_ret = """  // —— Schuhe Default ——
  if (tripDays != null && tripDays >= 2 && !seen.has('bequeme stadtschuhe')) {
    pushItem(items, seen, 'Bequeme Alltagsschuhe', 'Reise-Basis', 'clothes');
  }

  return {
    items,
    tripKinds: kinds,
    activities,
    tripDays,
    laundryAccess,
    askLaundry,
    evidenceNotes,
  };
}"""

new_ret = """  // —— Schuhe Default ——
  if (tripDays != null && tripDays >= 2 && !seen.has('bequeme stadtschuhe')) {
    pushItem(items, seen, 'Bequeme Alltagsschuhe', 'Reise-Basis', 'clothes');
  }

  // —— Persönliche Prefs (LearnedRule / „nie Pulli“) ——
  const fromText = parsePackPrefsFromText(t);
  const fromCtx: PackListPrefs = {
    avoid: (ctx.packPrefs?.avoid || []).filter(Boolean) as PackGarmentCanon[],
    prefer: (ctx.packPrefs?.prefer || []).filter(Boolean) as PackGarmentCanon[],
    notes: [...(ctx.packPrefs?.notes || [])],
  };
  const prefs = mergePackPrefs(fromCtx, fromText);
  let finalItems = items;
  if (prefs.avoid.length || prefs.prefer.length) {
    const applied = applyPackListPrefs(items, prefs);
    finalItems = applied.items;
    if (applied.removed.length) {
      evidenceNotes.push(`Prefs weg: ${applied.removed.slice(0, 3).join(', ')}`);
    }
    if (applied.added.length) {
      evidenceNotes.push(`Prefs dazu: ${applied.added.slice(0, 3).join(', ')}`);
    }
    for (const n of prefs.notes.slice(0, 2)) evidenceNotes.push(n);
  }

  return {
    items: finalItems,
    tripKinds: kinds,
    activities,
    tripDays,
    laundryAccess,
    askLaundry,
    evidenceNotes,
  };
}"""

if old_ret not in t:
    raise SystemExit("packListBuilder return block not found")
t = t.replace(old_ret, new_ret, 1)
p.write_text(t, encoding="utf-8")
print("packListBuilder OK")

# --- packListHarden.ts ---
h = Path(r"c:\Users\larsf\Findus 2.0\src\module2\timeline\packListHarden.ts")
ht = h.read_text(encoding="utf-8")

if "prefsFromLearnedRules" not in ht:
    ht = ht.replace(
        "import {\n  buildPackListItems,\n  looksLikePackListAsk,\n  type PackListContext,\n} from './packListBuilder';",
        "import {\n  buildPackListItems,\n  looksLikePackListAsk,\n  type PackListContext,\n} from './packListBuilder';\n"
        "import {\n  draftPackPrefLearnedRule,\n  looksLikePackPreference,\n  mergePackPrefs,\n  parsePackPrefsFromText,\n  prefsFromLearnedRules,\n} from './packListPrefs';",
        1,
    )

# after kidsLed, before ctx
old_ctx = """  const kidsLed = readKidsFromLedger();
  const activityHints = await researchActivityHints({
    userText: text,
    locationHint,
  });

  const ctx: PackListContext = {
    userText: text,
    locationHint,
    tempC: weather.tempC,
    rainLikely: weather.rainLikely,
    sunnyOrWarm: weather.sunnyOrWarm,
    timelineBlob,
    tripDays: ledgerDays,
    activityHints,
    childrenCount: kidsLed.childrenCount,
    childAgesYears: kidsLed.childAgesYears,
  };"""

new_ctx = """  const kidsLed = readKidsFromLedger();
  const activityHints = await researchActivityHints({
    userText: text,
    locationHint,
  });

  let learnedPack = { avoid: [] as string[], prefer: [] as string[], notes: [] as string[] };
  try {
    const { getLearnedRules } = await import('../../services/memory/correctionLearning');
    learnedPack = prefsFromLearnedRules(getLearnedRules());
  } catch {
    /* soft */
  }
  const textPrefs = parsePackPrefsFromText(text);
  const packPrefs = mergePackPrefs(learnedPack as never, textPrefs);

  // Prefs aus diesem Turn dauerhaft lernen („nie Pulli“)
  if (looksLikePackPreference(text) && (textPrefs.avoid.length || textPrefs.prefer.length)) {
    try {
      const draft = draftPackPrefLearnedRule(textPrefs);
      if (draft) {
        const { upsertLearnedRule } = await import('../../services/memory/correctionLearning');
        void upsertLearnedRule(draft);
      }
    } catch {
      /* soft */
    }
  }

  const ctx: PackListContext = {
    userText: text,
    locationHint,
    tempC: weather.tempC,
    rainLikely: weather.rainLikely,
    sunnyOrWarm: weather.sunnyOrWarm,
    timelineBlob,
    tripDays: ledgerDays,
    activityHints,
    childrenCount: kidsLed.childrenCount,
    childAgesYears: kidsLed.childAgesYears,
    packPrefs,
  };"""

if old_ctx not in ht:
    raise SystemExit("harden ctx block not found")
ht = ht.replace(old_ctx, new_ctx, 1)

# soft speech mention
if "packPrefsSpeech" not in ht:
    ht = ht.replace(
        "  const kidsMedSpeech =",
        "  const prefBits = built.evidenceNotes.filter((n) => /prefs|nie |immer /i.test(n)).slice(0, 2);\n"
        "  const packPrefsSpeech = prefBits.length\n"
        "    ? ` Persönliche Prefs sind drin (${prefBits.join('; ')}).`\n"
        "    : '';\n  const kidsMedSpeech =",
        1,
    )
    ht = ht.replace(
        "${laundryAskSpeech}${kidsMedSpeech} Öffnen und abhaken.",
        "${laundryAskSpeech}${kidsMedSpeech}${packPrefsSpeech} Öffnen und abhaken.",
        1,
    )

h.write_text(ht, encoding="utf-8")
print("packListHarden OK")
