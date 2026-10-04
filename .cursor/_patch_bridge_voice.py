from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\persona\matrixSpeechStyle.ts")
t = p.read_text(encoding="utf-8")
old = (
    "return `Bridge-Stimme (Beat 1, 1–2 Sätze): Verstanden + Zusagen MIT Bezug zum konkreten Wunsch "
    "(Job/Thema ansteuern) — mündlich, umgangssprachlich, keine Fakten/Orte/Preise. "
    "VERBOTEN allein: leere 0815-Floskeln ohne Wunsch-Anker. Ton: ${roleLine}.${aristocratGuard}`;"
)
new = (
    "return `Bridge-Stimme (Beat 1): Länge an Wartezeit — instant=Antwort-Einstieg/kurz, "
    "standard=1 Satz Zusage, cover=2–3 Sätze Motiv+Suche. Verstanden + Zusagen MIT Bezug zum Wunsch "
    "— mündlich, umgangssprachlich; keine Fakten/Orte/Preise erfinden. "
    "VERBOTEN allein: leere 0815 ohne Anker. Ton: ${roleLine}.${aristocratGuard}`;"
)
if old not in t:
    raise SystemExit("old not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ok")
