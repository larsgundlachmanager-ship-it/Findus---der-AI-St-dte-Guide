from pathlib import Path

app = Path("app.json")
t = app.read_text(encoding="utf-8")
t = t.replace('"version": "2.0.104"', '"version": "2.0.105"', 1)
t = t.replace('"versionCode": 131', '"versionCode": 132', 1)
app.write_text(t, encoding="utf-8")

g = Path("android/app/build.gradle")
gg = g.read_text(encoding="utf-8")
gg = gg.replace("versionCode 131", "versionCode 132", 1)
gg = gg.replace('versionName "2.0.104"', 'versionName "2.0.105"', 1)
g.write_text(gg, encoding="utf-8")
print("bumped 2.0.105 / 132")
