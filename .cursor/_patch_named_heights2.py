from pathlib import Path

p = Path("src/services/concierge/speechMemoryBullets.ts")
text = p.read_text(encoding="utf-8")
start = text.find("const NAME_HEIGHT_STOP =")
end = text.find("/** Orte / Themen als Eckpunkte")
if start < 0 or end < 0:
    raise SystemExit(f"markers missing {start} {end}")

replacement = r'''const NAME_HEIGHT_STOP =
  /^(?:Der|Die|Das|Ein|Eine|Mit|Und|Oder|Dann|Auch|Noch|Heute|Morgen|Ca|Etwa|Rund|Hoch|Hoehe|Höhe|Meter|Turm|Gebäude|Gebaeude|Stadt|Hamburg|Berlin|Nikolai)$/iu;

/** Eigenname: Großstart + Partikel/weitere Großwörter — kein Fließtext. */
const PROPER_NAME_RE =
  '(?:St\\.?\\s+)?[A-ZÄÖÜ][\\wÄÖÜäöüß\\-]+(?:(?:\\s+|-)(?:de[rsn]?|von|vom|am|im|und|&|St\\.?|[A-ZÄÖÜ][\\wÄÖÜäöüß\\-]+))*';

/**
 * Genannte Gebäude/Türme mit Höhe — Spickzettel "Name · Xm" (nicht nackte Meter).
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
    if (!name || name.length < 3 || name.length > 42) return;
    if (NAME_HEIGHT_STOP.test(name)) return;
    if (/\b(?:ist|war|liegt|kommt|höchste|hoehe|höhe|gebäude|gebaeude)\b/iu.test(name)) {
      return;
    }
    if (!/^[A-ZÄÖÜ]/.test(name) && !/^St\./i.test(name)) return;
    const num = numRaw.replace(',', '.');
    const nVal = Number(num);
    if (!Number.isFinite(nVal) || nVal < 20 || nVal > 2000) return;
    const key = `${name.toLowerCase()}|${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`${name} · ${num.replace(/\.0$/, '')} m`);
  };

  const patterns: RegExp[] = [
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s+(?:ist|war|liegt|misst|hat)\\s+(?:ca\\.?\\s*|etwa\\s*|rund\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:m|meter|metern)\\b`,
      'giu',
    ),
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s+(?:kommt\\s+(?:\\w+\\s+){0,2}auf|mit)\\s+(?:ca\\.?\\s*|etwa\\s*|rund\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:m|meter|metern)\\b`,
      'giu',
    ),
    new RegExp(
      `\\b(${PROPER_NAME_RE})\\s*[\\(–—,:]\\s*(?:ca\\.?\\s*)?(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:m|meter)\\b`,
      'giu',
    ),
    new RegExp(
      `\\b(\\d{2,4}(?:[.,]\\d+)?)\\s*(?:m|meter|metern)\\s+(?:hoher?|hohe[rsn]?)\\s+(${PROPER_NAME_RE})\\b`,
      'giu',
    ),
  ];

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i]!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (i === 3) push(m[2]!, m[1]!);
      else push(m[1]!, m[2]!);
    }
  }
  return out;
}

'''

tmp = Path("src/services/concierge/speechMemoryBullets.ts.tmp")
tmp.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
tmp.replace(p)
print("rewrote extractNamedHeights ok")
