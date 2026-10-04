from pathlib import Path
import re

# --- prepareDisplayText letter-digit ---
p = Path("src/services/AudioVoiceService.ts")
t = p.read_text(encoding="utf-8")
needle = """  // Font/Cartesia: € → Latein-O — Untertitel immer „Euro“
  out = expandEuroCurrencySymbols(out);"""
insert = """  // Font/Cartesia: € → Latein-O — Untertitel immer „Euro“
  out = expandEuroCurrencySymbols(out);
  // Call-1 Lead + Call-2 Zahl: nie „ist40“ / „ergibt10“
  out = out.replace(/([A-Za-zÄÖÜäöüß])(\\d)/gu, '$1 $2');
  out = out.replace(/(\\d)([A-Za-zÄÖÜäöüß])/gu, '$1 $2');
  out = out.replace(/\\s{2,}/g, ' ').trim();"""
if needle not in t:
    raise SystemExit("prepareDisplayText needle missing")
if "ist40" not in t and "Call-1 Lead + Call-2 Zahl" not in t:
    t = t.replace(needle, insert, 1)
tmp = Path("src/services/_avs.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("avs ok")

# --- mergeSubtitleCarry ---
p = Path("src/utils/subtitleWholeWords.ts")
t = p.read_text(encoding="utf-8")
old = """export function mergeSubtitleCarry(
  prior: string | null | undefined,
  current: string | null,
): string | null {
  if (current == null) return current;
  const cur = current.replace(/\\s+/g, ' ').trim();
  if (!cur) return cur;
  const prev = (prior ?? '').replace(/\\s+/g, ' ').trim();
  if (!prev) return cur;
  return `${prev} ${cur}`;
}"""
new = """export function mergeSubtitleCarry(
  prior: string | null | undefined,
  current: string | null,
): string | null {
  if (current == null) return current;
  const glue = (s: string) =>
    s
      .replace(/([A-Za-zÄÖÜäöüß])(\\d)/gu, '$1 $2')
      .replace(/(\\d)([A-Za-zÄÖÜäöüß])/gu, '$1 $2')
      .replace(/\\s+/g, ' ')
      .trim();
  const cur = glue(current);
  if (!cur) return cur;
  const prev = glue(prior ?? '');
  if (!prev) return cur;
  return glue(`${prev} ${cur}`);
}"""
if old not in t:
    raise SystemExit("mergeSubtitleCarry missing")
tmp = Path("src/utils/_sub.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("subtitle ok")

# --- answerLeadBridge: better peeks, no Kurz dazu ---
p = Path("src/services/speech/answerLeadBridge.ts")
t = p.read_text(encoding="utf-8")
# insert size/area before trivia try
marker = "  try {\n    const { looksLikeNamedTriviaSubject }"
extra = """  if (
    /\\b(wie\\s+(?:groß|gross|viel)|wieviele|wie\\s+viele|quadrat|hektar|fläche|flaeche|umfang)\\b/iu.test(
      t,
    )
  ) {
    const named = t.match(
      /\\b(?:wie\\s+(?:groß|gross|viel)|wieviele|wie\\s+viele).{0,40}?\\b(?:die|der|das)?\\s*([A-ZÄÖÜ][\\p{L}'-]{2,40})/iu,
    );
    if (named?.[1]) return `${named[1]} misst`;
    return 'Die Fläche:';
  }

  if (/\\bquadratwurzel\\b/iu.test(t)) {
    const n = t.match(/\\b(?:aus|von)\\s+(\\d+(?:[.,]\\d+)?)/iu)?.[1];
    return n ? `Die Quadratwurzel aus ${n} liegt bei` : 'Die Quadratwurzel liegt bei';
  }

"""
if "Die Fläche:" not in t:
    if marker not in t:
        raise SystemExit("answerLead marker missing")
    t = t.replace(marker, extra + marker, 1)

t = t.replace(
    "return peekAnswerLeadBridge(userText) || 'Kurz dazu:';",
    "return peekAnswerLeadBridge(userText) || 'Alles klar —';",
)
# "Alles klar —" may be floskel-scrubbed - use better:
t = t.replace(
    "return peekAnswerLeadBridge(userText) || 'Alles klar —';",
    "return peekAnswerLeadBridge(userText) || 'Kurz nachgeschaut —';",
)
tmp = Path("src/services/speech/_lead.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("lead ok")

# --- localInstantAnswer expand ---
p = Path("src/services/speech/localInstantAnswer.ts")
t = p.read_text(encoding="utf-8")
# add sqrt before return null at end of tryLocalArithmeticAnswer - actually new function section
if "quadratwurzel" not in t.lower():
    t = t.replace(
        "  return {\n    lead: `${aLabel} ${opWord} ${bLabel} ergibt`,\n    speech: pretty,\n    bullets: [`${aLabel} ${opWord} ${bLabel} = ${pretty}`],\n  };\n}",
        """  return {
    lead: `${aLabel} ${opWord} ${bLabel} ergibt`,
    speech: pretty,
    bullets: [`Ergebnis: ${pretty}`],
  };
}

/** Wurzel / einfache Instant-Mathe darüber hinaus. */
export function tryLocalMathAnswer(userText: string): LocalInstantAnswer | null {
  const arith = tryLocalArithmeticAnswer(userText);
  if (arith) return arith;
  const t = (userText || '').replace(/\\s+/g, ' ').trim();
  const sqrt = t.match(/\\bquadratwurzel\\s+(?:aus\\s+|von\\s+)?(\\d+(?:[.,]\\d+)?)/iu);
  if (sqrt) {
    const n = Number(String(sqrt[1]).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    const r = Math.sqrt(n);
    const pretty =
      Number.isInteger(r) || Math.abs(r - Math.round(r * 100) / 100) < 1e-9
        ? String(Math.round(r * 100) / 100).replace('.', ',')
        : (Math.round(r * 100) / 100).toFixed(2).replace('.', ',');
    const nLabel = String(sqrt[1]).replace('.', ',');
    return {
      lead: `Die Quadratwurzel aus ${nLabel} liegt bei`,
      speech: `etwa ${pretty}`,
      bullets: [`Ergebnis: ≈ ${pretty}`],
    };
  }
  return null;
}""",
    )
    # also update isInstantFastAsk to use tryLocalMathAnswer
    t = t.replace(
        "if (tryLocalArithmeticAnswer(t)) return true;",
        "if (tryLocalMathAnswer(t) || tryLocalArithmeticAnswer(t)) return true;",
    )
    t = t.replace(
        "/\\b(dollar|euro|pfund|yen)\\b/iu.test(t) && /\\b(in|umrechnen|wert)\\b/iu.test(t)",
        "/\\b(dollar|euro|pfund|yen|quadratwurzel|hektar|quadratmeter)\\b/iu.test(t)",
    )
tmp = Path("src/services/speech/_local.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("local math ok")

# --- runConciergeTurn: use tryLocalMathAnswer ---
p = Path("src/module2/router/runConciergeTurn.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("tryLocalArithmeticAnswer", "tryLocalMathAnswer")
# Beat-1: for weak leads speak commit immediately (0ms), don't wait 400ms first
old_b1 = """        const strongLead = peekAnswerLeadBridge(rawUserTextForCall1)?.trim() || null;
        let phrase = strongLead;
        if (!phrase) {
          const llmP = generateContextualBridge({ userText: rawUserTextForCall1 });
          phrase = await Promise.race([
            llmP.then((s) => s?.trim() || null),
            new Promise<string | null>((resolve) => {
              setTimeout(() => resolve(null), 400);
            }),
          ]);
          if (!phrase) {
            phrase = peekAnswerLeadBridgeOrCommit(rawUserTextForCall1);
            void llmP;
          }
        }"""
new_b1 = """        const strongLead = peekAnswerLeadBridge(rawUserTextForCall1)?.trim() || null;
        let phrase = strongLead;
        if (!phrase) {
          // Sofort Commit — nie auf Bridge-LLM warten (sonst Call-1 zu spät / „Kurz dazu“)
          phrase = peekAnswerLeadBridgeOrCommit(rawUserTextForCall1);
        }"""
if old_b1 not in t:
    raise SystemExit("beat1 block missing")
t = t.replace(old_b1, new_b1, 1)
tmp = Path("src/module2/router/_turn_b1.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("turn beat1/math ok")
