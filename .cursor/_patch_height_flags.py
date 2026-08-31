from pathlib import Path

p = Path("src/services/concierge/speechMemoryBullets.ts")
text = p.read_text(encoding="utf-8")
# Fix: named-height regexes must NOT use /i — otherwise [A-Z] matches lowercase.
old = """  const patterns: RegExp[] = [
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:ist|war|liegt|misst|hat)\\\\s+(?:ca\\\\.?\\\\s*|etwa\\\\s*|rund\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:m|meter|metern)\\\\b`,
      'giu',
    ),
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:kommt\\\\s+(?:\\\\w+\\\\s+){0,2}auf|mit)\\\\s+(?:ca\\\\.?\\\\s*|etwa\\\\s*|rund\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:m|meter|metern)\\\\b`,
      'giu',
    ),
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s*[\\\\(–—,:]\\\\s*(?:ca\\\\.?\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:m|meter)\\\\b`,
      'giu',
    ),
    new RegExp(
      `\\\\b(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:m|meter|metern)\\\\s+(?:hoher?|hohe[rsn]?)\\\\s+(${PROPER_NAME_RE})\\\\b`,
      'giu',
    ),
  ];"""

new = """  const patterns: RegExp[] = [
    // kein /i — sonst matcht [A-ZÄÖÜ] auch Kleinbuchstaben und frisst Fließtext
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:[Ii]st|[Ww]ar|[Ll]iegt|[Mm]isst|[Hh]at)\\\\s+(?:ca\\\\.?\\\\s*|[Ee]twa\\\\s*|[Rr]und\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\b`,
      'gu',
    ),
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s+(?:[Kk]ommt\\\\s+(?:\\\\w+\\\\s+){0,2}auf|[Mm]it)\\\\s+(?:ca\\\\.?\\\\s*|[Ee]twa\\\\s*|[Rr]und\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\b`,
      'gu',
    ),
    new RegExp(
      `\\\\b(${PROPER_NAME_RE})\\\\s*[\\\\(–—,:]\\\\s*(?:ca\\\\.?\\\\s*)?(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter)\\\\b`,
      'gu',
    ),
    new RegExp(
      `\\\\b(\\\\d{2,4}(?:[.,]\\\\d+)?)\\\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\\\s+(?:hoher?|hohe[rsn]?|Hoch)\\\\s+(${PROPER_NAME_RE})\\\\b`,
      'gu',
    ),
  ];"""

# The escaping in old is wrong for reading the file - read actual content from file
start = text.find("  const patterns: RegExp[] = [")
end = text.find("  for (let i = 0; i < patterns.length; i++)", start)
if start < 0 or end < 0:
    raise SystemExit(f"block missing {start} {end}")

replacement = """  const patterns: RegExp[] = [
    // kein /i — sonst matcht [A-ZÄÖÜ] auch Kleinbuchstaben und frisst Fließtext
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s+(?:[Ii]st|[Ww]ar|[Ll]iegt|[Mm]isst|[Hh]at)\\s+(?:ca\\.?\\s*|[Ee]twa\\s*|[Rr]und\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\b`,
      'gu',
    ),
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s+(?:[Kk]ommt\\s+(?:\\w+\\s+){0,2}auf|[Mm]it)\\s+(?:ca\\.?\\s*|[Ee]twa\\s*|[Rr]und\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\b`,
      'gu',
    ),
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s*[\\(–—,:]\\s*(?:ca\\.?\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:[Mm]|[Mm]eter)\\b`,
      'gu',
    ),
    new RegExp(
      `\\b(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:[Mm]|[Mm]eter|[Mm]etern)\\s+(?:hoher?|hohe[rsn]?|[Hh]och)\\s+(${PROPER_NAME_RE})\\b`,
      'gu',
    ),
  ];
"""

tmp = Path("src/services/concierge/speechMemoryBullets.ts.tmp")
tmp.write_text(text[:start] + replacement + "\n" + text[end:], encoding="utf-8")
tmp.replace(p)
print("fixed regex flags")
