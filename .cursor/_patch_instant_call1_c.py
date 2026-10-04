from pathlib import Path

# Fix local arith ChatLaneResult shape
p = Path("src/module2/router/runConciergeTurn.ts")
t = p.read_text(encoding="utf-8")
old = """      const presented = await presentChatLaneResult({
        turnId,
        result: {
          speech: localArith.speech,
          bullets: localArith.bullets,
          buttons: [],
        },
        bridgeFromRouter: analysis.bridge || localArith.lead,
        userText: rewritten,
      });"""
new = """      const presented = await presentChatLaneResult({
        turnId,
        result: {
          speech: localArith.speech,
          bullets: localArith.bullets,
          buttons: [],
          bridgeSpoken: localArith.lead,
          blueprintId: analysis.blueprintId,
          personaVariant: analysis.personaVariant || 'default',
          needsResearch: 'none',
          celestial: false,
          nextHandoff: null,
        },
        bridgeFromRouter: analysis.bridgeSpokenEarly
          ? null
          : analysis.bridge || localArith.lead,
        userText: rewritten,
      });"""
if old not in t:
    raise SystemExit("local present block missing")
tmp = Path("src/module2/router/_turn2.tmp.ts")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("local result shape ok")

# mic silence - find exact block
p = Path("src/hooks/useVoiceInput.ts")
t = p.read_text(encoding="utf-8")
idx = t.find("Hab dich nicht verstanden")
print("mic idx", idx)
if idx >= 0:
    start = t.rfind("setIsGenerating(false);", 0, idx)
    end = t.find("return;", idx) + len("return;")
    print("slice", repr(t[start:end][:200]))
    replacement = (
        "setIsGenerating(false);\n"
        "          // Leeres Mic: still — kein „Hab dich nicht verstanden“-Spam\n"
        "          return;"
    )
    t = t[:start] + replacement + t[end:]
    tmp = Path("src/hooks/_voice2.tmp.ts")
    tmp.write_text(t, encoding="utf-8")
    p.unlink(missing_ok=True)
    tmp.rename(p)
print("mic gone", "Hab dich nicht verstanden" not in p.read_text(encoding="utf-8"))
