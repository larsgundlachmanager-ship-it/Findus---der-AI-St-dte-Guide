from pathlib import Path
import os, tempfile
p = Path(r"src/components/homeMap/nativeHomeMap.smoke.test.ts")
old = """assert(stt.includes('com.google.android.googlequicksearchbox'), 'STT: Quick Search Box bevorzugt wenn installiert');
assert(stt.includes('com.google.android.tts'), 'STT: Google TTS als Engine wenn QSB fehlt');
"""
new = """assert(
  stt.includes('googlequicksearchbox') && stt.includes('nicht bindbar'),
  'STT: QSB auf Nothing als nicht bindbar dokumentiert',
);
assert(stt.includes('com.google.android.tts'), 'STT: Google TTS Recognition bevorzugt');
"""
text = p.read_text(encoding="utf-8")
if old not in text:
    raise SystemExit("needle missing")
text = text.replace(old, new, 1)
fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=str(p.parent))
os.close(fd)
Path(tmp).write_text(text, encoding="utf-8", newline="\n")
os.replace(tmp, p)
print("patched")
