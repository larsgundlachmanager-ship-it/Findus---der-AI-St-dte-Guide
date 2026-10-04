from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\planning\planUtteranceGate.ts")
text = p.read_text(encoding="utf-8")

start = text.find("  const buckets = countNeedBuckets(t);")
# Only the one inside looksLikeChaoticDayPlanUtterance — find after that function
fn = text.find("export function looksLikeChaoticDayPlanUtterance")
if fn < 0:
    raise SystemExit("function not found")
start = text.find("  const buckets = countNeedBuckets(t);", fn)
if start < 0:
    raise SystemExit("buckets block not found")

end_marker = "  if (helpPlan && buckets >= 1 && t.length >= 60) return true;"
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("end marker not found")
end = end + len(end_marker)

new = """  const buckets = countNeedBuckets(t);
  const clocks = countClockHints(t);
  const sections =
    t.match(
      /\\b(und\\s+dann|danach|zuerst|außerdem|ausserdem|vormittag|nachmittag|abends|morgens|mittags|später|spaeter|zwischendurch)\\b/gi,
    )?.length ?? 0;
  const helpPlan =
    /\\b(hilf(st)?\\s+mir|organisie|zusammenstell|was\\s+mach\\s+ich|wie\\s+bau|tag\\s+durch|durch den tag|stell\\s+mir\\s+(?:einen\\s+)?(?:tollen\\s+)?tag)\\b/i.test(
      t,
    );

  // 3+ Wunsch-Arten → Chaos-Tag. 2 Arten + andere Stadt auch —
  // sonst wird „Frühstück + Michel in Hamburg“ zum Gastro-Pitch am GPS.
  if (buckets >= 3) return true;
  if (buckets >= 2 && t.length >= 40) {
    try {
      const { destinationCityFromUtterance } = require('./planDestinationCity') as {
        destinationCityFromUtterance: (s: string, gps?: string | null) => string | null;
      };
      if (destinationCityFromUtterance(t, null)) return true;
    } catch {
      /* soft */
    }
  }
  // 2+ Aufgaben + mehrere Zeitabschnitte/Uhrzeiten → Planung (auch lokal)
  if (buckets >= 2 && (clocks >= 1 || sections >= 2) && t.length >= 50) {
    return true;
  }
  // 1 starke Anker-Art + Uhrzeit + weiterer Kontext (lang)
  if (buckets >= 1 && clocks >= 1 && t.length >= 80) return true;
  // 2+ Uhrzeiten im Satz
  if (clocks >= 2) return true;
  // Mehrere Abschnitte + Tour/Orte → Tag, kein Einzel-Pitch
  if (
    sections >= 2 &&
    buckets >= 1 &&
    t.length >= 60 &&
    /\\b(tour|rundgang|must[-\\s]?haves?|mehrere\\s+orte|zwischen)\\b/i.test(t)
  ) {
    return true;
  }
  // Explizite Hilfe bei langem Wunschkatalog
  if (helpPlan && buckets >= 1 && t.length >= 60) return true;"""

p.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("patched", start, "->", end)
