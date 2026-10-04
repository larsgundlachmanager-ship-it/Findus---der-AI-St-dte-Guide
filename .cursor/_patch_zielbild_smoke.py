from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\navStartSpeech.smoke.test.ts")
tmp = p.with_suffix(".ts.tmpwrite")
t = p.read_text(encoding="utf-8")
repls = [
    (
        "/starte die Navigation/i.test(bridge), 'Call1 startet Nav'",
        "/navigiere dich zu/i.test(bridge), 'Call1 navigiert zum Ziel'",
    ),
    (
        "/hab ich|Alles klar/i.test(bridge), 'Call1 erkennt Ziel klar'",
        "/Alles klar/i.test(bridge), 'Call1 erkennt Ziel klar'",
    ),
    (
        "/16 Minuten/i.test(shortEta), 'kurze Dauer'",
        "/^Dauert etwa 16 Minuten/i.test(shortEta), 'Call2 nur Dauer'",
    ),
    (
        "/Ankunft|23:/i.test(shortEta), 'keine Ankunft unter 60 Min'",
        "/Ankunft|23:|läufst|radelst/i.test(shortEta), 'keine Ankunft unter 60 Min'",
    ),
    (
        "/navigiere dich|starte die Navigation/i.test(commit), 'commit Call1'",
        "/navigiere dich zu/i.test(commit), 'commit Call1'",
    ),
    (
        "/16 Minuten/i.test(commit), 'commit Call2'",
        "/Dauert etwa 16 Minuten/i.test(commit), 'commit Call2'",
    ),
    (
        "!/navigiere dich|starte die Navigation/i.test(call2Only)",
        "!/navigiere dich|Alles klar/i.test(call2Only)",
    ),
    (
        "/16 Minuten/i.test(call2Only), 'Call2 Dauer'",
        "/^Dauert etwa 16 Minuten/i.test(call2Only), 'Call2 Dauer'",
    ),
]
n = 0
for a, b in repls:
    if a in t:
        t = t.replace(a, b)
        n += 1
tmp.write_text(t, encoding="utf-8")
os.replace(str(tmp), str(p))
print(f"ok replacements={n}")
