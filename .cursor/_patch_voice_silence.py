from pathlib import Path

p = Path("src/hooks/useVoiceInput.ts")
t = p.read_text(encoding="utf-8")

# Silence empty mic (calendar + main)
old = """          setIsGenerating(false);
          if (calendarOpen) {
            try {
              const { enqueueSpeech } = require('../module2/speech/speechQueue') as {
                enqueueSpeech: (o: {
                  kind: string;
                  text: string;
                  turnId: string;
                }) => void;
              };
              enqueueSpeech({
                kind: 'main',
                text: 'Hab dich nicht verstanden — nochmal kurz halten und sprechen.',
                turnId: `mic_empty_${Date.now()}`,
              });
            } catch {
              /* soft */
            }
          }
          return;"""
# Handle encoding of emdash
idx = t.find("Hab dich nicht verstanden")
if idx < 0:
    raise SystemExit("phrase missing")
start = t.rfind("setIsGenerating(false);", 0, idx)
end = t.find("return;", idx) + len("return;")
replacement = (
    "setIsGenerating(false);\n"
    "          // Leeres Mic: still — kein „nicht verstanden“-Spam\n"
    "          return;"
)
t = t[:start] + replacement + t[end:]

# Restore faster voice hold from live QA
t = t.replace(
    "const MIN_VOICE_MS = 2_000;",
    "const MIN_VOICE_MS = 700;",
    1,
)

tmp = Path("src/hooks/_voice_fix.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("voice ok", "Hab dich nicht verstanden" not in p.read_text(encoding="utf-8"), "MIN", "700" in p.read_text(encoding="utf-8"))

# fix needsResearch
p2 = Path("src/module2/router/runConciergeTurn.ts")
t2 = p2.read_text(encoding="utf-8")
t2 = t2.replace("needsResearch: 'none',", "needsResearch: 'quick',", 1)
# personaVariant fallback - check type
t2 = t2.replace(
    "personaVariant: analysis.personaVariant || 'default',",
    "personaVariant: analysis.personaVariant || 'default',",
    1,
)
tmp2 = Path("src/module2/router/_turn3.tmp.ts")
tmp2.write_text(t2, encoding="utf-8")
p2.unlink(missing_ok=True)
tmp2.rename(p2)
print("turn fields ok")
