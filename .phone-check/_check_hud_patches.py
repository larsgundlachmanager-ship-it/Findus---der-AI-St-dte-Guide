# -*- coding: utf-8 -*-
from pathlib import Path

files = {
    "proactive": Path("src/services/ui/proactiveHudEngine.ts"),
    "liveHud": Path("src/services/ui/liveHudCards.ts"),
    "nice": Path("src/services/ui/niceInfoScenarios.ts"),
    "wxSpeech": Path("src/services/ui/weatherDayPlanSpeech.ts"),
    "rain": Path("src/services/weather/rainIncomingPolicy.ts"),
}
checks = {
    "proactive": [
        "Schirm dabei?",
        "Schirm/Indoor?",
        "__WEATHER_DAY_CHECK__",
        "sudden_rain_indoor",
        "profile_burger",
        "isRainHudFallingLine",
    ],
    "liveHud": [
        "Schirm/Jacke oder Indoor",
        "__WEATHER_DAY_CHECK__",
        "dinnerCard(nowMs)",
        "Hunger?",
        "weather-live",
        "Jacke mitnehmen",
    ],
    "nice": [
        "Jacke mitnehmen",
        "Schirm einpacken?",
        "outfitText",
    ],
    "wxSpeech": [
        "Aktuell\\s+",
        "Regen (jetzt|noch |in )",
    ],
    "rain": [
        "Aktuell Regen",
        "rainHudIntensityNoun",
        "Regen jetzt",
    ],
}
for name, path in files.items():
    t = path.read_text(encoding="utf-8")
    print("===", name, "===")
    for c in checks[name]:
        print(f"  {c!r}: {c in t}")
