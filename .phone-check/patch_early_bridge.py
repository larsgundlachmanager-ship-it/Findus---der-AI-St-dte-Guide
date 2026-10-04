# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\runConciergeTurn.ts")
text = path.read_text(encoding="utf-8")

old = """    // Beat-1 sofort mit Call-1: Verstanden+Zusagen, während Gemini streamt — jede Frage.
    beat1Locked = true;
    earlyBridgePromise = (async (): Promise<string | null> => {
      try {
        const { pickFloskelForUserText } = require('../../services/speech/floskelEngine') as {
          pickFloskelForUserText: (t: string) => { phrase: string };
        };
        const phrase = pickFloskelForUserText(rawUserTextForCall1).phrase?.trim();
        if (!phrase) {
          beat1Locked = false;
          return null;
        }
        try {
          const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
            markBridgeFirst: () => void;
          };
          markBridgeFirst();
        } catch {
          /* soft */
        }
        const spoken = await speakModuleWaitBridge(phrase, turnId, {
          userText: rawUserTextForCall1,
        });
        if (spoken) bridgeSpokenDuringAnalyze = true;
        else beat1Locked = false;
        return spoken;
      } catch {
        beat1Locked = false;
        return null;
      }
    })();"""

new = """    // Beat-1 sofort: LLM-Bridge race (~550ms), sonst intent-Floskel — während Gemini streamt.
    beat1Locked = true;
    earlyBridgePromise = (async (): Promise<string | null> => {
      try {
        const { pickFloskelForUserText } = require('../../services/speech/floskelEngine') as {
          pickFloskelForUserText: (t: string) => { phrase: string };
        };
        const floskel = pickFloskelForUserText(rawUserTextForCall1).phrase?.trim() || '';
        let phrase = floskel;
        try {
          const { generateContextualBridge } = require('../../services/speech/contextualBridge') as {
            generateContextualBridge: (o: {
              userText: string;
            }) => Promise<string | null>;
          };
          const llmP = generateContextualBridge({ userText: rawUserTextForCall1 }).catch(
            () => null,
          );
          type Race = { source: 'llm' | 'timeout'; line: string | null };
          const raced = await Promise.race([
            llmP.then((line): Race => ({ source: 'llm', line })),
            new Promise<Race>((resolve) =>
              setTimeout(() => resolve({ source: 'timeout', line: null }), 550),
            ),
          ]);
          if (raced.source === 'llm' && raced.line?.trim()) {
            phrase = raced.line.trim();
          }
        } catch {
          /* soft — Floskel bleibt */
        }
        if (!phrase) {
          beat1Locked = false;
          return null;
        }
        try {
          const { markBridgeFirst } = require('../reboot/pipeline/turnLatencyMetrics') as {
            markBridgeFirst: () => void;
          };
          markBridgeFirst();
        } catch {
          /* soft */
        }
        const spoken = await speakModuleWaitBridge(phrase, turnId, {
          userText: rawUserTextForCall1,
        });
        if (spoken) bridgeSpokenDuringAnalyze = true;
        else beat1Locked = false;
        return spoken;
      } catch {
        beat1Locked = false;
        return null;
      }
    })();"""

if old not in text:
    raise SystemExit("early bridge block not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("early bridge raced")
