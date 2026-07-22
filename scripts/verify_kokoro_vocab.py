# -*- coding: utf-8 -*-
from pathlib import Path
import re

t = Path(r"C:\Users\larsf\Findus 2.0\src\services\kokoroTtsService.ts").read_text(
    encoding="utf-8"
)
start = t.find("const KOKORO_VOCAB")
end = t.find("};", start)
block = t[start:end]
non = [c for c in block if ord(c) > 127]
print("nonascii_in_vocab", len(non))
if ".replace(//g" in t:
    print("BROKEN_EMPTY_REGEX")
else:
    print("no_broken_empty_regex")
# unquoted non-ascii object keys
bad = []
for i, line in enumerate(t.splitlines(), 1):
    m = re.match(r"^(\s+)([^'\"/\s][^:]*):\s*\d+", line)
    if m and any(ord(c) > 127 for c in m.group(2)):
        bad.append(i)
print("bad_unquoted_keys", bad[:20], "count", len(bad))
# Allowlist must keep ʃ (\u0283) — otherwise sch→ʃ is stripped again
g2p = t[t.find("function roughGermanPhonemes") : t.find("async function getSession")]
allow_keeps_sh = "\\u0283" in g2p and "[^" in g2p and "\\u0283" in g2p[g2p.find("[^") :]
print(
    "roughGerman_ok",
    "function roughGermanPhonemes" in t
    and "\\u0283" in t
    and allow_keeps_sh
    and "phonemizeForKokoro" in t,
)
