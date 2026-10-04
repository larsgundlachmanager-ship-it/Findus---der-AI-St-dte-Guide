from pathlib import Path

app = Path("app.json")
t = app.read_text(encoding="utf-8")
t = t.replace('"version": "2.0.102"', '"version": "2.0.103"', 1)
t = t.replace('"versionCode": 129', '"versionCode": 130', 1)
app.write_text(t, encoding="utf-8")

gradle = Path("android/app/build.gradle")
g = gradle.read_text(encoding="utf-8")
g = g.replace("versionCode 128", "versionCode 130", 1)
g = g.replace('versionName "2.0.101"', 'versionName "2.0.103"', 1)
# also if already partially bumped
g = g.replace("versionCode 129", "versionCode 130", 1)
g = g.replace('versionName "2.0.102"', 'versionName "2.0.103"', 1)
gradle.write_text(g, encoding="utf-8")
print("bumped app.json + android gradle to 2.0.103 / 130")
