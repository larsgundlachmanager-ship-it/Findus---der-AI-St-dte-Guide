from pathlib import Path
import re

aj = Path("app.json")
text = aj.read_text(encoding="utf-8")
text = re.sub(r'"versionCode":\s*126', '"versionCode": 127', text)
text = re.sub(r'"version":\s*"2\.0\.99"', '"version": "2.0.100"', text)
aj.write_text(text, encoding="utf-8")

bg = Path("android/app/build.gradle")
b = bg.read_text(encoding="utf-8")
b = b.replace("versionCode 126", "versionCode 127")
b = b.replace('versionName "2.0.99"', 'versionName "2.0.100"')
bg.write_text(b, encoding="utf-8")
print("bumped to 2.0.100 / 127")
