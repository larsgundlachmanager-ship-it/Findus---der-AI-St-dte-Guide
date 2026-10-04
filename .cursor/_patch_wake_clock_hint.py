from pathlib import Path
import os, tempfile
p = Path(r"src/services/alarms/wakeIntentDetect.ts")
text = p.read_text(encoding="utf-8")
old = """const HAS_CLOCK =
  /\\b(?:um\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:uhr)?\\b|\\b\\d{1,2}[:.]\\d{2}\\b/i;
"""
new = """const HAS_CLOCK =
  /\\b(?:um\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:uhr)?\\b|\\b\\d{1,2}[:.]\\d{2}\\b|\\bhalb\\s+(?:eins|ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|\\d{1,2})\\b|\\b(?:eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf)\\s*uhr\\b/i;
"""
if old not in text:
    raise SystemExit("HAS_CLOCK needle missing")
text = text.replace(old, new, 1)
fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(text, encoding="utf-8", newline="\n")
os.replace(tmp, p)
print("hasClockHint patched")
