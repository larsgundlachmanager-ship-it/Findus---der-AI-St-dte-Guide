from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\App.tsx")
text = p.read_text(encoding="utf-8")

old_import = "import { startSurvivalModeMonitor } from './src/services/battery/survivalMode';"
new_import = (
    "import { startSurvivalModeMonitor } from './src/services/battery/survivalMode';\n"
    "import { bootstrapOpenQuietGate } from './src/services/navigation/modulePriorityPolicy';"
)
if "bootstrapOpenQuietGate" not in text:
    if old_import not in text:
        raise SystemExit("import not found")
    text = text.replace(old_import, new_import, 1)
    print("import added")
else:
    print("import already present")

marker = """  useEffect(() => {
    return startSurvivalModeMonitor();
  }, []);"""
insert = """  useEffect(() => {
    bootstrapOpenQuietGate();
  }, []);

  useEffect(() => {
    return startSurvivalModeMonitor();
  }, []);"""
if "bootstrapOpenQuietGate();" in text:
    print("bootstrap call already present")
elif marker not in text:
    raise SystemExit("survival useEffect not found")
else:
    text = text.replace(marker, insert, 1)
    print("bootstrap call added")

p.write_text(text, encoding="utf-8")
print("App.tsx ok")
