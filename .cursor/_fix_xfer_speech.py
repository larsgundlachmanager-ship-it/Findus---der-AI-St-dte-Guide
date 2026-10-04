# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\journeyLeaveBy.ts")
t = p.read_text(encoding="utf-8")
needle = "speakRisk &&\n      link.tip &&"
if needle not in t:
    raise SystemExit("needle missing")
t = t.replace(needle, "speakRisk &&", 1)

old2 = """      let text = link.tip;
      if (kind === 'live_delay' && match.delaySec != null && match.delaySec >= 180) {
        const delayMin = Math.max(3, Math.round(match.delaySec / 60));
        text = `${nextLineHint || 'Anschluss'} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr. ${link.tip}`;
      }
      enqueueSpeech({
        kind: 'main',
        text: text.slice(0, 320),
        turnId: `journey_xfer_${Date.now()}`,
      });"""

new2 = """      let text = link.tip;
      if (kind === 'live_delay' && match.delaySec != null && match.delaySec >= 180) {
        const delayMin = Math.max(3, Math.round(match.delaySec / 60));
        const delayBit = `${nextLineHint || 'Anschluss'} hat etwa ${delayMin} Minuten Verspätung — Abfahrt um ${clockHm(nextDep)} Uhr.`;
        text = link.tip ? `${delayBit} ${link.tip}` : delayBit;
      }
      if (text) {
        enqueueSpeech({
          kind: 'main',
          text: text.slice(0, 320),
          turnId: `journey_xfer_${Date.now()}`,
        });
      }"""

if old2 not in t:
    raise SystemExit("old2 missing")
t = t.replace(old2, new2, 1)

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_jlb_work.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
print("work ok", "delayBit" in t)
