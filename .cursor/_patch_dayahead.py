from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\planning\planUtteranceGate.ts")
text = p.read_text(encoding="utf-8")
start = text.index("export function weatherAskIsTodayDayAhead")
# include preceding comment block
cmt = text.rfind("/**", 0, start)
end = text.index("/** Morgen/Übermorgen", start)

new = '''/**
 * Frühmorgens „heute“ = Tagesprognose, nicht 03-Uhr-Nachtmodus (außer „jetzt/gerade“).
 * Nicht bei „Wetter in Athen“ ohne heute — sonst fehlt der Ortsbezug.
 */
export function weatherAskIsTodayDayAhead(text: string, hour?: number): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return false;
  const h = hour ?? new Date().getHours();
  if (h > 5) return false;
  if (weatherAskIsFutureDay(t)) return false;
  if (weatherAskIsImmediateNow(t)) return false;
  if (/\\bheut(?:e|en)\\b/i.test(t)) return true;
  // Allgemeine Tagesfrage ohne Zielort — „wie wird das Wetter?“ um 4 Uhr
  if (
    /\\b(wie wird|wie sieht)\\b.{0,24}\\bwetter\\b/i.test(t) &&
    !/\\bin\\s+[\\p{L}]{2,}/u.test(t)
  ) {
    return true;
  }
  return false;
}

'''

p.write_text(text[:cmt] + new + text[end:], encoding="utf-8")
print("patched", cmt, end)
