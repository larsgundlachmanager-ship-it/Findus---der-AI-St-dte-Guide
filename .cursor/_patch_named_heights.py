from pathlib import Path

p = Path("src/services/concierge/speechMemoryBullets.ts")
text = p.read_text(encoding="utf-8")
if "export function extractNamedHeights" in text:
    print("already has extractNamedHeights")
    raise SystemExit(0)

marker = "/** Orte / Themen als Eckpunkte (Proper Names + bekannte Labels) */"
fn = r'''const NAME_HEIGHT_STOP =
  /^(?:Der|Die|Das|Ein|Eine|Mit|Und|Oder|Dann|Auch|Noch|Heute|Morgen|Ca|Etwa|Rund|Hoch|Hoehe|Höhe|Meter|Turm|Gebäude|Gebaeude|Stadt|Hamburg|Berlin)$/iu;

/**
 * Genannte Gebaeude/Tuerme mit Hoehe — Spickzettel "Name · Xm" (nicht nackte Meter).
 */
export function extractNamedHeights(speech: string): string[] {
  const s = (speech || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (nameRaw: string, numRaw: string) => {
    let name = clean(nameRaw)
      .replace(/^(?:der|die|das|dem|den)\s+/iu, '')
      .replace(/[,:;–—\-]+$/u, '')
      .trim();
    if (!name || name.length < 3 || NAME_HEIGHT_STOP.test(name)) return;
    if (/^(?:dann|auch|noch|dabei|sowie)\b/iu.test(name)) {
      name = name.replace(/^(?:dann|auch|noch|dabei|sowie)\s+/iu, '').trim();
    }
    if (!name || NAME_HEIGHT_STOP.test(name.split(/\s+/)[0] || '')) return;
    const num = numRaw.replace(',', '.');
    const key = `${name.toLowerCase()}|${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`${name} · ${num.replace(/\.0$/, '')} m`);
  };

  const patterns: RegExp[] = [
    /\b((?:[A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:[\s-][A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]*){0,4}))\s+(?:ist|war|liegt|misst|hat|kommt\s+(?:\w+\s+){0,3}auf|mit|auf)\s+(?:ca\.?\s*|etwa\s*|rund\s*)?(\d{2,4}(?:[.,]\d+)?)\s*(?:m|meter|metern)\b/giu,
    /\b((?:[A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:[\s-][A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]*){0,3}))\s*[\(–—,:]\s*(?:ca\.?\s*)?(\d{2,4}(?:[.,]\d+)?)\s*(?:m|meter)\b/giu,
    /\b(\d{2,4}(?:[.,]\d+)?)\s*(?:m|meter|metern)\s+(?:hoher?|hohe[rsn]?)\s+((?:[A-ZÄÖÜ][\wÄÖÜäöüß\-]+(?:[\s-][A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-]*){0,3}))\b/giu,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i]!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (i === 2) push(m[2]!, m[1]!);
      else push(m[1]!, m[2]!);
    }
  }
  return out;
}

'''
if marker not in text:
    raise SystemExit("marker missing")
text2 = text.replace(marker, fn + marker, 1)
tmp = Path("src/services/concierge/speechMemoryBullets.ts.tmp")
tmp.write_text(text2, encoding="utf-8")
tmp.replace(p)
print("inserted extractNamedHeights")
