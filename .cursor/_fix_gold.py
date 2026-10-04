from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\m2IdealRefresh.smoke.test.ts")
text = p.read_text(encoding="utf-8")
old = "resolveLocalAnchor('Fahr mich zum Goldschaetzchen')"
new = "resolveLocalAnchor('Fahr mich zum Goldschätzchen')"
if old not in text:
    raise SystemExit("old string missing: " + repr([line for line in text.splitlines() if "Goldsch" in line]))
text = text.replace(old, new)
text = text.replace("named Goldschaetzchen still resolves", "named Goldschätzchen still resolves")
text = text.replace("AYCE does not soft-fill Goldschaetzchen", "AYCE does not soft-fill Goldschätzchen")
tmp = p.with_suffix(".ts.tmp")
tmp.write_text(text, encoding="utf-8")
tmp.replace(p)
print("fixed")
