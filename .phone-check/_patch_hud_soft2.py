# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(".")


def atomic_write(rel: str, text: str):
    path = ROOT / rel
    tmp = ROOT / ".phone-check" / f"_w_{path.name}"
    tmp.write_text(text, encoding="utf-8")
    path.unlink(missing_ok=True)
    tmp.replace(path)
    print("wrote", rel)


# --- proactive: ensure soft-pitch filter ---
p = ROOT / "src/services/ui/proactiveHudEngine.ts"
t = p.read_text(encoding="utf-8")
needle = "if (t.id === 'lunch_nearby' || t.id === 'dinner_reservation') return false;"
if "sudden_rain_indoor" not in t[t.find("produceContextMatrix") : t.find("produceContextMatrix") + 800]:
    # check around needle
    pass
if "if (t.id === 'sudden_rain_indoor' || t.id === 'profile_burger') return false;" not in t:
    if needle not in t:
        raise SystemExit("needle lunch_nearby missing")
    t = t.replace(
        needle,
        needle
        + "\n    // Kein Soft-Pitch oben: Regen→Indoor / Profil-Burger\n"
        + "    if (t.id === 'sudden_rain_indoor' || t.id === 'profile_burger') return false;",
        1,
    )
    atomic_write("src/services/ui/proactiveHudEngine.ts", t)
else:
    print("proactive filter already ok")

# --- liveHudCards ---
p = ROOT / "src/services/ui/liveHudCards.ts"
t = p.read_text(encoding="utf-8")
old = "Regen-Hinweis: Schirm/Jacke oder Indoor/Café mit Route — was hilft mir jetzt?"
if old in t:
    t = t.replace(old, "__WEATHER_DAY_CHECK__", 1)
    print("tipToCard fixed")
else:
    print("tipToCard already")

old_d = "  if (allowActivitySoftTips(nowMs)) push(dinnerCard(nowMs));\n"
# may appear twice - idle + maybe elsewhere
count = t.count(old_d)
print("dinner pushes", count)
t = t.replace(old_d, "  // Soft-Gastro absichtlich stumm (kein Hunger?/Burger-Pitch).\n")

theme = "  if (themes.has('dinner')) push(dinnerCard(nowMs));\n"
if theme in t:
    t = t.replace(theme, "  // Soft-Gastro-Theme absichtlich stumm.\n", 1)
    print("theme dinner removed")

marker = "if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;"
insert = """if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;
    // Wetter-Karte ist SSOT — kein zweites Regen-Banner
    if (tip.kind === 'weather_rain' && seen.has('weather-live')) continue;
    if (
      tip.kind === 'umbrella_day' ||
      /Jacke mitnehmen|Regen möglich|Regen → Indoor|Burger lokal/i.test(tip.text)
    ) {
      continue;
    }"""
if "weather-live')) continue" not in t and marker in t:
    t = t.replace(marker, insert, 1)
    print("utility filter added")
elif "weather-live')) continue" in t:
    print("utility filter already")
else:
    raise SystemExit("parking marker missing")

atomic_write("src/services/ui/liveHudCards.ts", t)

# --- niceInfoScenarios ---
p = ROOT / "src/services/ui/niceInfoScenarios.ts"
t = p.read_text(encoding="utf-8")
t = t.replace("meta: 'Schirm einpacken?',", "meta: undefined,", 1)
t = t.replace(
    """        tellMorePrompt:
          'Später Regen möglich — kurz sagen ob Schirm/Jacke sinnvoll ist, ohne Panik.',""",
    "        tellMorePrompt: '__WEATHER_DAY_CHECK__',",
    1,
)
old_outfit = """              ? '🧥 Regen möglich — Jacke mitnehmen'
              : '🧥 Cooler Tag — Schicht empfohlen',"""
# Replace entire outfit if-block via markers
start = t.find("  // --- 6) Outfit / Kleidung wenn Wetterwechsel ---")
end = t.find("  // --- 7)", start)
if start < 0:
    # find differently
    start = t.find("Outfit / Kleidung")
    print("outfit start alt", start)
if "Jacke mitnehmen" in t:
    # simpler: change jacket line to never fire for precip
    t2 = t.replace(
        "            : typeof precip === 'number' && precip >= 45\n"
        "              ? '🧥 Regen möglich — Jacke mitnehmen'\n"
        "              : '🧥 Cooler Tag — Schicht empfohlen',",
        "            : typeof high === 'number' && high <= 10\n"
        "              ? '🧥 Cooler Tag — Schicht empfohlen'\n"
        "              : '', // Regen → weatherCard, kein Jacke-Ratschlag",
        1,
    )
    if t2 == t:
        raise SystemExit("outfit jacket replace failed")
    t = t2
    # Also avoid pushing empty text — wrap push condition
    if "if (outfitText)" not in t:
        # after tips.push for outfit, add filter by changing condition of outer if
        t = t.replace(
            "    if (\n"
            "      (typeof precip === 'number' && precip >= 45) ||\n"
            "      (typeof high === 'number' && (high <= 10 || high >= 28))\n"
            "    ) {",
            "    if (typeof high === 'number' && (high <= 10 || high >= 28)) {",
            1,
        )
atomic_write("src/services/ui/niceInfoScenarios.ts", t)

# --- weatherDayPlanSpeech ---
p = ROOT / "src/services/ui/weatherDayPlanSpeech.ts"
t = p.read_text(encoding="utf-8")
old = "(!rainHud || !/^Regen (jetzt|noch |in )/i.test(rainHud))"
new = "(!rainHud || !/^(Aktuell\\s+)?(Starker\\s+|Leichter\\s+)?Regen(\\s+(jetzt|noch |in |bis )|$)/i.test(rainHud))"
if old not in t:
    raise SystemExit("wxSpeech regex missing")
t = t.replace(old, new, 1)
atomic_write("src/services/ui/weatherDayPlanSpeech.ts", t)

print("DONE")
