# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\hooks\useVoiceInput.ts")
t = p.read_text(encoding="utf-8")
old = '''      const spokenUserText = text;
      try {
        const { runCorrectionLearningCapture } = await import(
          '../services/memory/correctionLearning'
        );
        const correction = await runCorrectionLearningCapture(spokenUserText);
        if (correction.isCorrection && correction.effectiveQuestion) {
          text = correction.effectiveQuestion;
        }
      } catch {
        /* soft */
      }'''
new = '''      const spokenUserText = text;
      try {
        let skipCorrectionRewrite = false;
        try {
          const { isTimerIntent } = require('../services/alarms/timerService') as {
            isTimerIntent: (s: string) => boolean;
          };
          skipCorrectionRewrite = isTimerIntent(spokenUserText);
        } catch {
          skipCorrectionRewrite = false;
        }
        if (!skipCorrectionRewrite) {
          const { runCorrectionLearningCapture } = await import(
            '../services/memory/correctionLearning'
          );
          const correction = await runCorrectionLearningCapture(spokenUserText);
          if (correction.isCorrection && correction.effectiveQuestion) {
            text = correction.effectiveQuestion;
          }
        }
      } catch {
        /* soft */
      }'''
if old not in t:
    raise SystemExit('voice correction block not found')
if 'skipCorrectionRewrite' not in t:
    p.write_text(t.replace(old, new, 1), encoding='utf-8')
    print('voice timer guard ok')
else:
    print('already')
