from pathlib import Path

p = Path("src/services/speech/localInstantAnswer.smoke.test.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("tryLocalArithmeticAnswer", "tryLocalMathAnswer")
tmp = Path("src/services/speech/_lis.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)

p = Path("src/services/speech/answerLeadBridge.smoke.test.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("/Kurz dazu/i", "/Kurz nachgeschaut/i")
tmp = Path("src/services/speech/_als.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("patched")
