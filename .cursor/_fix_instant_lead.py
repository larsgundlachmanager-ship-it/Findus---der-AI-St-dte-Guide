from pathlib import Path
import os, tempfile

p = Path(r"src/module2/kernel/instantAnswerLeadQuery.ts")
text = """/**
 * Schnell-Fakt / Peek-Struktur-Kandidaten (Hauptstadt & Co.).
 * Ergänzt isQuickLookupQuery — RN-frei.
 *
 * Wichtig: Pfad = services/concierge (nicht module2/concierge) —
 * falscher require → Metro dependencyMap undefined →
 * \"Requiring unknown module undefined\" bei Topic-Cut / Pitch-Gate.
 */
import { isQuickLookupQuery } from '../../services/concierge/celestialSkyQuery';

export function looksLikeCapitalOrGeoFactQuery(text: string): boolean {
  const t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t || t.length < 6) return false;
  if (
    /\\b(was\\s+ist\\s+(?:die\\s+)?hauptstadt|hauptstadt\\s+(?:von|von\\s+der|von\\s+dem))\\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Kurze Was-ist-die/der-X-von-Y (Land/Staat), kein Gastro
  if (
    /\\bwas\\s+ist\\s+(?:die|der|das)\\s+\\w{3,24}\\s+von\\b/iu.test(t) &&
    !/\\b(restaurant|essen|gericht|speise|hotel|route|navig)\\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

/** Quick-Lookup ODER Hauptstadt/Geo-Fakt → Instant Answer-Lead. */
export function looksLikeInstantAnswerLeadQuery(text: string): boolean {
  if (looksLikeCapitalOrGeoFactQuery(text)) return true;
  return isQuickLookupQuery(text);
}
"""
fd, tmp = tempfile.mkstemp(suffix=".ts", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(text, encoding="utf-8", newline="\n")
os.replace(tmp, p)
print("wrote", p, p.stat().st_size)
