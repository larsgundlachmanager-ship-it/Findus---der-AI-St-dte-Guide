from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\slotLedger.ts")
t = p.read_text(encoding="utf-8")
old = """    if (key === 'intentNotes') {
      const prevArr = prev.intentNotes;
      const nextArr = n as ReiseLedger['intentNotes'];
      if (!nextArr) {
        out.intentNotes = prevArr;
        return;
      }
      const merged = [...(prevArr?.value ?? [])];
      for (const line of nextArr.value) {
        const clean = line.replace(/\\s+/g, ' ').trim().slice(0, 160);
        if (!clean || merged.some((x) => x.toLowerCase() === clean.toLowerCase())) continue;
        merged.push(clean);
      }
      out.intentNotes = {
        value: merged.slice(-12),
        source: nextArr.source,
        hardness: 'wish',
      };
      return;
    }
"""
# Use exact content from file
idx = t.find("if (key === 'intentNotes')")
if idx < 0:
    raise SystemExit("intentNotes missing")
# find end of intentNotes block - next "if (key === 'lodgingKind')"
end = t.find("if (key === 'lodgingKind')", idx)
if end < 0:
    raise SystemExit("lodgingKind missing")
block = """    if (key === 'intentNotes') {
      const prevArr = prev.intentNotes;
      const nextArr = n as ReiseLedger['intentNotes'];
      if (!nextArr) {
        out.intentNotes = prevArr;
        return;
      }
      const merged = [...(prevArr?.value ?? [])];
      for (const line of nextArr.value) {
        const clean = line.replace(/\\s+/g, ' ').trim().slice(0, 160);
        if (!clean || merged.some((x) => x.toLowerCase() === clean.toLowerCase())) continue;
        merged.push(clean);
      }
      out.intentNotes = {
        value: merged.slice(-12),
        source: nextArr.source,
        hardness: 'wish',
      };
      return;
    }
    if (key === 'boardPins') {
      const prevArr = prev.boardPins;
      const nextArr = n as ReiseLedger['boardPins'];
      if (!nextArr) {
        out.boardPins = prevArr;
        return;
      }
      const { mergeBoardPinLists } = require('./boardPins') as typeof import('./boardPins');
      out.boardPins = {
        value: mergeBoardPinLists(prevArr?.value, nextArr.value),
        source: nextArr.source,
        hardness: 'wish',
      };
      return;
    }
"""
# Fix escaping - write with actual backslash-s
block = r"""    if (key === 'intentNotes') {
      const prevArr = prev.intentNotes;
      const nextArr = n as ReiseLedger['intentNotes'];
      if (!nextArr) {
        out.intentNotes = prevArr;
        return;
      }
      const merged = [...(prevArr?.value ?? [])];
      for (const line of nextArr.value) {
        const clean = line.replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!clean || merged.some((x) => x.toLowerCase() === clean.toLowerCase())) continue;
        merged.push(clean);
      }
      out.intentNotes = {
        value: merged.slice(-12),
        source: nextArr.source,
        hardness: 'wish',
      };
      return;
    }
    if (key === 'boardPins') {
      const prevArr = prev.boardPins;
      const nextArr = n as ReiseLedger['boardPins'];
      if (!nextArr) {
        out.boardPins = prevArr;
        return;
      }
      const { mergeBoardPinLists } = require('./boardPins') as typeof import('./boardPins');
      out.boardPins = {
        value: mergeBoardPinLists(prevArr?.value, nextArr.value),
        source: nextArr.source,
        hardness: 'wish',
      };
      return;
    }
"""
t2 = t[:idx] + block + t[end:]
# idx points to "if (key" but we need the indent "    if"
# find start of line
line_start = t.rfind("\n", 0, idx) + 1
t2 = t[:line_start] + block + t[end:]
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t2, encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("ok slotLedger")
