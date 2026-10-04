from pathlib import Path
import os
import tempfile


def replace_file(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"{label}: pattern missing")
    t2 = t.replace(old, new, 1)
    tmp = Path(tempfile.gettempdir()) / f"{p.name}.{label}.tmp"
    tmp.write_text(t2, encoding="utf-8")
    bak = p.with_suffix(p.suffix + f".{label}.bak")
    if bak.exists():
        bak.unlink()
    os.replace(p, bak)
    os.replace(tmp, p)
    bak.unlink(missing_ok=True)
    print(label, "ok")


# 1) Lead-Varianten: „5 plus 5 ist“ / „Das Ergebnis ist“
local_path = r"C:\Users\larsf\Findus 2.0\src\services\speech\localInstantAnswer.ts"
local_old = """  return {
    lead: `${aLabel} ${opWord} ${bLabel} ergibt`,
    speech: pretty,
    bullets: [`Ergebnis: ${pretty}`],
  };
}"""
local_new = """  // Struktur-Lead (Wortlaut-Varianten) — Call-2 = nur die Zahl.
  const lead =
    Math.round(Math.abs(a) + Math.abs(b)) % 2 === 0
      ? `${aLabel} ${opWord} ${bLabel} ist`
      : `Das Ergebnis ist`;

  return {
    lead,
    speech: pretty,
    bullets: [`Ergebnis: ${pretty}`],
  };
}"""
replace_file(local_path, local_old, local_new, "lead")

# 2) Early path vor Analyze/Bridge
turn_path = r"C:\Users\larsf\Findus 2.0\src\module2\router\runConciergeTurn.ts"
turn_old = """  } catch (err) {
    console.warn('[runConciergeTurn] early timer/wake failed', err);
  }

  // choiceFast VOR Analyze (kein TDZ). Beat-1 startet mit Call-1 (nicht erst nach JSON).
"""
turn_new = """  } catch (err) {
    console.warn('[runConciergeTurn] early timer/wake failed', err);
  }

  // Instant-Rechnung: Lead sofort + Zahl als Call-2 — kein LLM-Bridge-Warten.
  // Ergebnis steht lokal fest, bevor irgendeine Bridge fertig wäre.
  try {
    const { tryLocalMathAnswer } = require('../../services/speech/localInstantAnswer') as {
      tryLocalMathAnswer: (s: string) => {
        lead: string;
        speech: string;
        bullets: string[];
      } | null;
    };
    const localArithEarly = tryLocalMathAnswer(rawUserTextForCall1);
    if (localArithEarly) {
      const { presentChatLaneResult } = await import('../chat/presentChatLane');
      return await presentChatLaneResult({
        turnId,
        result: {
          speech: localArithEarly.speech,
          bullets: localArithEarly.bullets,
          buttons: [],
          bridgeSpoken: localArithEarly.lead,
          blueprintId: null,
          personaVariant: 'default',
          needsResearch: 'quick',
          celestial: false,
          nextHandoff: null,
        },
        bridgeFromRouter: localArithEarly.lead,
        userText: rewritten,
      });
    }
  } catch (err) {
    if (__DEV__) console.warn('[runConciergeTurn] early local math', err);
  }

  // choiceFast VOR Analyze (kein TDZ). Beat-1 startet mit Call-1 (nicht erst nach JSON).
"""
replace_file(turn_path, turn_old, turn_new, "early-math")

# 3) Späteren Block-Kommentar anpassen (Fallback bleibt)
turn2_old = """  // --- Instant-Rechnung lokal: Bridge = Call-1-LLM; Call-2 = Zahl (kein Code-Lead) ---
"""
turn2_new = """  // --- Instant-Rechnung Fallback (Early-Path oben deckt den Normalfall) ---
"""
replace_file(turn_path, turn2_old, turn2_new, "fallback-comment")

# 4) Smoke: Lead-Assertion
smoke_path = r"C:\Users\larsf\Findus 2.0\src\services\speech\localInstantAnswer.smoke.test.ts"
smoke_old = """const arith = tryLocalMathAnswer('Was ist 5 plus 5?');
assert.ok(arith);
assert.match(arith!.lead, /5 plus 5 ergibt/i);
assert.equal(arith!.speech, '10');
"""
smoke_new = """const arith = tryLocalMathAnswer('Was ist 5 plus 5?');
assert.ok(arith);
assert.match(arith!.lead, /^(5 plus 5 ist|Das Ergebnis ist)$/i);
assert.equal(arith!.speech, '10');

const turnSrc = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert.match(turnSrc, /localArithEarly/, 'early local math before analyze');
assert.match(
  turnSrc,
  /Instant-Rechnung: Lead sofort/,
  'math skips LLM bridge wait',
);
"""
replace_file(smoke_path, smoke_old, smoke_new, "smoke")

print("all patches done")
