from pathlib import Path

src = Path(r"C:\Users\larsf\Findus 2.0\src\module2\router\managerWarmup.ts")
text = src.read_text(encoding="utf-8")

start = text.index("/** Match-Normalisierung:")
end = text.index("function pickMatchingEntry")
text = text[:start] + text[end:]
text = text.replace("isTrivialRevision(", "isTrivialWarmupRevision(")

tmp = src.with_suffix(".ts.new")
tmp.write_text(text, encoding="utf-8", newline="\n")
tmp.replace(src)
body = src.read_text(encoding="utf-8")
assert "export function normalizeWarmupText" not in body
assert "isTrivialWarmupRevision(" in body
assert "isTrivialWarmupWarmup" not in body
assert body.count("isTrivialWarmupRevision") >= 2
print("ok", src.stat().st_size)
