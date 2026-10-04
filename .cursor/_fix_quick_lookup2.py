from pathlib import Path

bak = Path(".cursor/_celestial_bak.ts")
src = Path("src/services/concierge/celestialSkyQuery.ts")
if not bak.exists():
    bak.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
text = bak.read_text(encoding="utf-8")

i = text.find("const QUICK_LOOKUP_RE =")
j = text.find(";", i)
if i < 0 or j < 0:
    raise SystemExit("QUICK_LOOKUP_RE not found")

new_re = (
    "const QUICK_LOOKUP_RE =\n"
    "  /\\b(wie\\s+(?:breit|hoch|alt|tief|groß|gross|viel|viele|heiß|heiss|kalt|heißt|heisst|nennt)|"
    "was\\s+bedeutet|wer\\s+(?:ist|war|heißt|heisst)|erkläre?\\s+(?:mir\\s+)?kurz|"
    "wann\\s+(?:ist|war|sind|wird)\\s+(?:die\\s+|der\\s+|das\\s+)?"
    "(?:sonnenfinsternis|mondfinsternis|teil(?:weise)?e?\\s+sonnenfinsternis|eclipse|"
    "sternschnuppe(?:n)?|nordlicht|polarlicht|meteor)|einwohner(?:zahl)?|"
    "(?:älteste|aelteste)\\s+(?:lebende[rnms]?\\s+)?(?:mensch|person))\\b/iu"
)
text = text[:i] + new_re + text[j:]

marker = (
    "  if (ARITH_LOOKUP_RE.test(t)) return t.split(/\\s+/).length <= 28;\n"
    "  if (!QUICK_LOOKUP_RE.test(t)) return false;"
)
block = (
    "  if (ARITH_LOOKUP_RE.test(t)) return t.split(/\\s+/).length <= 28;\n"
    "  if (\n"
    "    /\\b(papst|pope)\\b/iu.test(t) &&\n"
    "    /\\b(aktuell|jetzt|heute|noch|leo|franziskus|oberhaupt|kirche)\\b/iu.test(t) &&\n"
    "    t.split(/\\s+/).length <= 28\n"
    "  ) {\n"
    "    return true;\n"
    "  }\n"
    "  if (!QUICK_LOOKUP_RE.test(t)) return false;"
)
if marker not in text:
    raise SystemExit("arith marker not found: " + repr(text[text.find("ARITH_LOOKUP") : text.find("ARITH_LOOKUP") + 160]))
text = text.replace(marker, block, 1)

out = Path(".cursor/_celestial_new.ts")
out.write_text(text, encoding="utf-8")
print("patched ok", len(text))
