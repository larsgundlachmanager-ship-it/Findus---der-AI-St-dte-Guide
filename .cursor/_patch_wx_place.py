# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\weatherDayPlanSpeech.ts")
text = p.read_text(encoding="utf-8")
old = """  const place =
    opts.namedCity && opts.city
      ? ` in ${opts.city}`
      : '';
"""
new = """  const place =
    opts.city &&
    opts.city.length >= 2 &&
    !/^\\d+$/u.test(opts.city) &&
    !/^(sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|grad)$/iu.test(opts.city)
      ? ` in ${opts.city}`
      : '';
"""
if old not in text:
    raise SystemExit("place block not found")
text = text.replace(old, new, 1)
with p.open("r+", encoding="utf-8", newline="\n") as f:
    f.seek(0)
    f.write(text)
    f.truncate()
print("place fix ok")
