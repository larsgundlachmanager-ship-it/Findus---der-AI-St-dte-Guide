from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\g2p\phoneticTransformer.ts")
s = p.read_text(encoding="utf-8")
if "Kleinbuchstaben-Buchstabierfallen" in s:
    print("already present")
    raise SystemExit(0)

marker = "  // Einzelziffern-Ketten:"
idx = s.find(marker)
if idx < 0:
    raise SystemExit("marker missing")

insert = """  // Kleinbuchstaben-Buchstabierfallen: a l l / w o r t -> Wort
  s = s.replace(/\\b(?:[\\p{L}]\\s+){2,}[\\p{L}]\\b/gu, (m) => {
    const letters = m.replace(/\\s+/g, '');
    if (letters.length >= 3 && letters.length <= 24) return letters;
    return ' ';
  });

  // Bindestrich-Buchstabieren: W-o-r-t / A-Y-C-E
  s = s.replace(
    /\\b(?:[\\p{L}]-){2,}[\\p{L}]\\b/gu,
    (m) => m.replace(/-/g, ''),
  );

"""

s2 = s[:idx] + insert + s[idx:]
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s2, encoding="utf-8")
tmp.replace(p)
print("spell ok", "Kleinbuchstaben-Buchstabierfallen" in p.read_text(encoding="utf-8"))
