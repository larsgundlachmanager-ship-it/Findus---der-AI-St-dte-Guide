# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"c:\Users\larsf\Findus 2.0\src\services\speech\floskelEngine.ts")
text = path.read_text(encoding="utf-8")
start = text.index("/** Text-Heuristik")
end = text.index("/** Öffentlich für researchAck-Kompatibilität")

new_fn = Path(r"c:\Users\larsf\Findus 2.0\.phone-check\detectFloskelCategory.ts.snippet").read_text(
    encoding="utf-8"
)
path.write_text(text[:start] + new_fn + text[end:], encoding="utf-8")
print("ok", start, end, "len", len(new_fn))
