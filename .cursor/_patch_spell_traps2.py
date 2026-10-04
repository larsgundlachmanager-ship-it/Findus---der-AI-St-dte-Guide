from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\g2p\phoneticTransformer.ts")
s = p.read_text(encoding="utf-8")
needle = "  // Einzelziffern-Ketten: „2 6 1\" / „1 2 3 4\" → entfernen (Buchstabier-Falle)\n"
# try alternate quote styles
if needle not in s:
    needle = "  // Einzelziffern-Ketten:"
    idx = s.find(needle)
    if idx < 0:
        raise SystemExit("digit chain comment missing")
    # insert before this line
    insert = """
  // Kleinbuchstaben-Buchstabierfallen: „a l l\" / „w o r t\" → Wort
  s = s.replace(/\\b(?:[\\p{L}]\\s+){2,}[\\p{L}]\\b/gu, (m) => {
    const letters = m.replace(/\\s+/g, '');
    if (letters.length >= 3 && letters.length <= 24) return letters;
    return ' ';
  });

  // Bindestrich-Buchstabieren: „W-o-r-t\" / „A-Y-C-E\"
  s = s.replace(
    /\\b(?:[\\p{L}]-){2,}[\\p{L}]\\b/gu,
    (m) => m.replace(/-/g, ''),
  );

"""
    s = s[:idx] + insert + s[idx:]
else:
    raise SystemExit("unexpected")

if "Kleinbuchstaben-Buchstabierfallen" not in s:
    raise SystemExit("insert failed")
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("spell ok")
