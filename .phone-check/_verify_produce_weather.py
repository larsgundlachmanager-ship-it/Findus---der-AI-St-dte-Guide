# -*- coding: utf-8 -*-
from pathlib import Path
t = Path("src/services/ui/proactiveHudEngine.ts").read_text(encoding="utf-8")
# extract produceWeather function roughly
i = t.find("const produceWeather")
j = t.find("const produceBatteryCharge")
chunk = t[i:j]
for s in ["Café oder Indoor", "Schirm", "Jacke", "__WEATHER_DAY_CHECK__", "meta: undefined"]:
    print(s, chunk.count(s))
print("--- soft filter ---")
k = t.find("produceContextMatrix")
print(t[k:k+900])
