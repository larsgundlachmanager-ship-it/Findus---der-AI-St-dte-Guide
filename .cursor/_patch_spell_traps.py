from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\g2p\phoneticTransformer.ts")
s = p.read_text(encoding="utf-8")
old = """  // Einzelbuchstaben-Ketten: „V I N" / „A B C D" (≥3 mit Leerzeichen)
  s = s.replace(
    /\\b(?:[A-ZÄÖÜ]\\s+){2,}[A-ZÄÖÜ]\\b/g,
    (m) => {
      const letters = m.replace(/\\s+/g, '');
      // Kurze sinnvolle Wörter (VIN etc.) als Wort belassen; längere Ketten killen
      if (letters.length <= 4 && /[AEIOUÄÖÜ]/i.test(letters)) {
        return toTitleCaseDe(letters);
      }
      return ' ';
    },
  );

  // Einzelziffern-Ketten: „2 6 1" / „1 2 3 4" → entfernen (Buchstabier-Falle)
  s = s.replace(/\\b(?:\\d\\s+){2,}\\d\\b/g, ' ');"""
new = """  // Einzelbuchstaben-Ketten: „V I N" / „A B C D" (≥3 mit Leerzeichen)
  s = s.replace(
    /\\b(?:[A-ZÄÖÜ]\\s+){2,}[A-ZÄÖÜ]\\b/g,
    (m) => {
      const letters = m.replace(/\\s+/g, '');
      // Kurze sinnvolle Wörter (VIN etc.) als Wort belassen; längere Ketten killen
      if (letters.length <= 4 && /[AEIOUÄÖÜ]/i.test(letters)) {
        return toTitleCaseDe(letters);
      }
      return ' ';
    },
  );

  // Kleinbuchstaben-Buchstabierfallen: „a l l" / „w o r t" → Wort
  s = s.replace(/\\b(?:[\\p{L}]\\s+){2,}[\\p{L}]\\b/gu, (m) => {
    const letters = m.replace(/\\s+/g, '');
    if (letters.length >= 3 && letters.length <= 24) return letters;
    return ' ';
  });

  // Bindestrich-Buchstabieren: „W-o-r-t" / „A-Y-C-E"
  s = s.replace(
    /\\b(?:[\\p{L}]-){2,}[\\p{L}]\\b/gu,
    (m) => m.replace(/-/g, ''),
  );

  // Einzelziffern-Ketten: „2 6 1" / „1 2 3 4" → entfernen (Buchstabier-Falle)
  s = s.replace(/\\b(?:\\d\\s+){2,}\\d\\b/g, ' ');"""
if old not in s:
    # try without fancy quotes
    print("exact old missing, searching...")
    idx = s.find("Einzelbuchstaben-Ketten")
    print(repr(s[idx:idx+200]))
    raise SystemExit(1)
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s.replace(old, new, 1), encoding="utf-8")
tmp.replace(p)
print("spell traps ok")
