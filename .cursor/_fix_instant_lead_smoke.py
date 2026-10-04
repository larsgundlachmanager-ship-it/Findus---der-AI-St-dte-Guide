from pathlib import Path
import os, tempfile

p = Path(r"src/module2/kernel/instantAnswerLeadQuery.smoke.test.ts")
old = p.read_text(encoding="utf-8")
needle = """assert.equal(
  looksLikeInstantAnswerLeadQuery('Was ist die Hauptstadt von Italien?'),
  true,
);

console.log('instantAnswerLeadQuery.smoke.test.ts: ok');
"""
repl = """assert.equal(
  looksLikeInstantAnswerLeadQuery('Was ist die Hauptstadt von Italien?'),
  true,
);
assert.equal(
  looksLikeInstantAnswerLeadQuery('Wie alt ist Mark Forster?'),
  true,
  'quick-lookup path must resolve (not require undefined module)',
);
assert.equal(
  looksLikeInstantAnswerLeadQuery('navigiere mich zum Bahnhof'),
  false,
);

console.log('instantAnswerLeadQuery.smoke.test.ts: ok');
"""
if needle not in old:
    raise SystemExit("needle not found")
text = old.replace(needle, repl)
fd, tmp = tempfile.mkstemp(suffix=".ts", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(text, encoding="utf-8", newline="\n")
os.replace(tmp, p)
print("smoke patched")
