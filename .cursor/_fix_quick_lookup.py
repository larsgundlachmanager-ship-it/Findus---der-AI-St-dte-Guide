from pathlib import Path

p = Path(r"src/services/concierge/celestialSkyQuery.ts")
text = p.read_text(encoding="utf-8")

# Expand QUICK_LOOKUP_RE
old_re_start = "const QUICK_LOOKUP_RE ="
i = text.find(old_re_start)
j = text.find(";", i)
if i < 0 or j < 0:
    raise SystemExit("QUICK_LOOKUP_RE not found")
new_re = (
    "const QUICK_LOOKUP_RE =\n"
    r"  /\b(wie\s+(?:breit|hoch|alt|tief|groß|gross|viel|viele|heiß|heiss|kalt|heißt|heisst|nennt)|"
    r"was\s+bedeutet|wer\s+(?:ist|war|heißt|heisst)|erkläre?\s+(?:mir\s+)?kurz|"
    r"wann\s+(?:ist|war|sind|wird)\s+(?:die\s+|der\s+|das\s+)?"
    r"(?:sonnenfinsternis|mondfinsternis|teil(?:weise)?e?\s+sonnenfinsternis|eclipse|"
    r"sternschnuppe(?:n)?|nordlicht|polarlicht|meteor)|einwohner(?:zahl)?|"
    r"(?:älteste|aelteste)\s+(?:lebende[rnms]?\s+)?(?:mensch|person))\b/iu"
)
text = text[:i] + new_re + text[j:]

marker = "  if (ARITH_LOOKUP_RE.test(t)) return t.split(/\\s+/).length <= 28;\n  if (!QUICK_LOOKUP_RE.test(t)) return false;"
block = """  if (ARITH_LOOKUP_RE.test(t)) return t.split(/\\s+/).length <= 28;
  // Papst-Follow-ups / aktuelles Amt — auch ohne exaktes \"wer ist\"
  if (
    /\\b(papst|pope)\\b/iu.test(t) &&
    /\\b(aktuell|jetzt|heute|noch|leo|franziskus|oberhaupt|kirche)\\b/iu.test(t) &&
    t.split(/\\s+/).length <= 28
  ) {
    return true;
  }
  if (!QUICK_LOOKUP_RE.test(t)) return false;"""
if marker not in text:
    raise SystemExit("arith marker not found")
text = text.replace(marker, block, 1)

p.write_text(text, encoding="utf-8")
print("ok")
