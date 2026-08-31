from pathlib import Path

p = Path("src/services/concierge/speechMemoryBullets.ts")
text = p.read_text(encoding="utf-8")
start = text.find("  const patterns: RegExp[] = [")
end = text.find("  for (let i = 0; i < patterns.length; i++)", start)
if start < 0 or end < 0:
    raise SystemExit(f"block missing {start} {end}")

# File must contain \\b inside `...` template literals.
replacement = (
    "  const patterns: RegExp[] = [\n"
    "    // kein /i — sonst matcht [A-ZÄÖÜ] auch Kleinbuchstaben und frisst Fließtext\n"
    "    new RegExp(\n"
    "      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:[Ii]st|[Ww]ar|[Ll]iegt|[Mm]isst|[Hh]at)\\\\s+(?:ca\\\\.?\\\\s*|[Ee]twa\\\\s*|[Rr]und\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\b`,\n"
    "      'gu',\n"
    "    ),\n"
    "    new RegExp(\n"
    "      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:[Kk]ommt\\\\s+(?:\\\\w+\\\\s+){0,2}auf|[Mm]it)\\\\s+(?:ca\\\\.?\\\\s*|[Ee]twa\\\\s*|[Rr]und\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\b`,\n"
    "      'gu',\n"
    "    ),\n"
    "    new RegExp(\n"
    "      `\\\\b(${PROPER_NAME_RE})\\\\s*[\\\\(–—,:]\\\\s*(?:ca\\\\.?\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter)\\\\b`,\n"
    "      'gu',\n"
    "    ),\n"
    "    new RegExp(\n"
    "      `\\\\b(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\s+(?:hoher?|hohe[rsn]?|[Hh]och)\\\\s+(${PROPER_NAME_RE})\\\\b`,\n"
    "      'gu',\n"
    "    ),\n"
    "  ];\n"
)

tmp = Path("src/services/concierge/speechMemoryBullets.ts.tmp")
tmp.write_text(text[:start] + replacement + "\n" + text[end:], encoding="utf-8")
tmp.replace(p)
t2 = p.read_text(encoding="utf-8")
idx = t2.find("new RegExp(\n      `")
print("after backtick:", repr(t2[idx : idx + 40]))
