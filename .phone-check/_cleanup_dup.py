# -*- coding: utf-8 -*-
from pathlib import Path

p = Path("src/services/ui/proactiveHudEngine.ts")
t = p.read_text(encoding="utf-8")
old = """    // Kein Soft-Pitch oben: Regen→Indoor / Profil-Burger
    if (t.id === 'sudden_rain_indoor' || t.id === 'profile_burger') return false;
    // Kein Soft-Pitch oben: Regen→Indoor / Profil-Burger / Gastro-Fragen
    if (
      t.id === 'sudden_rain_indoor' ||
      t.id === 'profile_burger' ||
      t.id === 'pack_weather'
    ) {
      return false;
    }
"""
new = """    // Kein Soft-Pitch oben: Regen→Indoor / Profil-Burger
    if (t.id === 'sudden_rain_indoor' || t.id === 'profile_burger') return false;
"""
if old not in t:
    raise SystemExit("duplicate filter block missing")
t = t.replace(old, new, 1)
tmp = Path(".phone-check/_proactive_clean.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)

p = Path("src/services/ui/niceInfoScenarios.ts")
t = p.read_text(encoding="utf-8")
old = """        text:
          typeof high === 'number' && high >= 28
            ? '👕 Heiß — luftig + Sonnenschutz'
            : typeof high === 'number' && high <= 10
              ? '🧥 Cooler Tag — Schicht empfohlen'
              : '', // Regen → weatherCard, kein Jacke-Ratschlag
"""
new = """        text:
          typeof high === 'number' && high >= 28
            ? '👕 Heiß — luftig + Sonnenschutz'
            : '🧥 Cooler Tag — Schicht empfohlen',
"""
if old not in t:
    raise SystemExit("outfit ternary missing")
t = t.replace(old, new, 1)
# precip unused now - leave it (might lint) - remove const precip if unused
if "const precip = weather.nextRainProb ?? null;\n" in t:
    # check if precip used elsewhere in function after
    idx = t.find("const precip = weather.nextRainProb")
    # only remove if precip not used after in outfit section
    section = t[idx : idx + 400]
    if section.count("precip") == 1:
        t = t.replace("    const precip = weather.nextRainProb ?? null;\n", "", 1)
tmp = Path(".phone-check/_nice_clean.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("cleaned")
