from pathlib import Path
import re

# 1) runPitchModule — softFailReason ohne km-Prozess-Meta
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\runPitchModule.ts")
s = p.read_text(encoding="utf-8")
old = """        const km = Math.round(ring / 1000);
        ranked = {
          ...next.ranked,
          softFail: true,
          reason:
            next.ranked.reason ||
            `Online erweitert (~${km} km) — nicht nur Datensatz. Distanz ehrlich; fragen ob ok oder weiter.`,
        };"""
new = """        ranked = {
          ...next.ranked,
          // Expand-Radius nur Backend — nie „in 10 km nichts, in 20 km…“ in Speech
          softFail: next.ranked.softFail,
          reason: next.ranked.reason,
        };"""
if old not in s:
    raise SystemExit("runPitch expand reason missing")
s = s.replace(old, new, 1)
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("runPitch ok")

# 2) pitchSpeech prompt + summary sanitize
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\pitchSpeech.ts")
s2 = p2.read_text(encoding="utf-8")
old2 = """WUNSCH NICHT BELEGT (soft_fail / Cascade soft_miss): ehrlich — was fehlt (Preis, Blick, …) und was trotzdem da ist. Eine Perfect-Option reicht. Backtrack + online Places/Web ringweise (nicht nur Datensatz) bis Treffer oder ehrlich Ende. Distanz nennen; fragen ob ok oder weiter — Wortlaut frei. Nie Gegen-Diät."""
new2 = """WUNSCH NICHT BELEGT (soft_fail / Cascade soft_miss): finale Antwort — Top-Option(en) mit Beleg. VERBOTEN in Speech: Such-Prozess („in 10 km nichts“, „in 20 km erweitert“, „ringweise“, „nicht nur Datensatz“, „soll ich weiter suchen?“). Distanz nur als kurze Lage am Ort (z. B. „liegt etwas weiter raus“), nie als Recherche-Log. Nie Gegen-Diät."""
if old2 not in s2:
    raise SystemExit("pitchSpeech prompt missing")
s2 = s2.replace(old2, new2, 1)

# add stripSearchProcessSpeech helper before pitchSpoken or near summary
if "function stripSearchProcessFromSpeech" not in s2:
    helper = '''
/** Such-Prozess-Meta nie vorlesen — nur finale Antwort. */
export function stripSearchProcessFromSpeech(text: string): string {
  let s = String(text || '');
  s = s.replace(/\\bOnline erweitert\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bnicht nur Datensatz\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bringweise\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(
    /\\bin\\s+(?:ca\\.?\\s*)?\\d{1,3}\\s*km\\b[^.!?]{0,40}\\b(?:nichts|kein(?:e|en)?|keine Treffer|leer)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b(?:im Umkreis|innerhalb)\\s+(?:von\\s+)?\\d{1,3}\\s*km\\b[^.!?]{0,40}\\b(?:nichts|kein)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\bsoll(?:en)?\\s+ich\\s+weiter\\s+(?:suchen|gucken|schauen)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(/\\bPerfect-Strang\\b[^.!?]*[.!?]?/giu, ' ');
  return s.replace(/\\s+/g, ' ').trim();
}

'''
    marker = "function fallbackPitch("
    if marker not in s2:
        raise SystemExit("fallbackPitch marker missing")
    s2 = s2.replace(marker, helper + marker, 1)

# wrap spokenText return
old_ret = """  return {
    spokenText: parts.join(' ').replace(/\\s+/g, ' ').trim(),"""
# find actual return at end
if "stripSearchProcessFromSpeech(parts.join" not in s2:
    s2 = s2.replace(
        "spokenText: parts.join(' ').replace(/\\s+/g, ' ').trim(),",
        "spokenText: stripSearchProcessFromSpeech(parts.join(' ').replace(/\\s+/g, ' ').trim()),",
        1,
    )

# summary: don't use expand reasons
old_sum = """  let summary = opts.softFail
    ? opts.softFailReason ||
      'Nichts Perfektes — hier zwei Alternativen mit besseren Chancen.'
    : '';"""
new_sum = """  let summary = opts.softFail
    ? stripSearchProcessFromSpeech(
        opts.softFailReason ||
          'Hier zwei Alternativen, die am besten passen.',
      )
    : '';
  if (/\\b(?:km|ringweise|Datensatz|erweitert|weiter suchen)\\b/iu.test(summary)) {
    summary = 'Hier zwei Alternativen, die am besten passen.';
  }"""
if old_sum not in s2:
    raise SystemExit("summary block missing")
s2 = s2.replace(old_sum, new_sum, 1)

tmp2 = p2.with_suffix(".ts.patching")
tmp2.write_text(s2, encoding="utf-8")
tmp2.replace(p2)
print("pitchSpeech ok")
