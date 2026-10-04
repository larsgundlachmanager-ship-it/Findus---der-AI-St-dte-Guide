from pathlib import Path

p = Path(r"c:/Users/larsf/Findus 2.0/src/module2/router/call1Dispatch.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "AYCE tonight beats weather blueprint" in t:
    print("already")
    raise SystemExit(0)

insert = """
assert.equal(
  finalizeCall1Execution(
    baseAnalysis({
      execution: 'chat_lane',
      chatLane: 'chat',
      session: 'new',
      blueprintId: 'weather',
    }),
    'Wo kann ich heute Abend all you can eat essen gehen?',
  ),
  'pitch_module',
  'AYCE tonight beats weather blueprint',
);

"""

marker = "  'ayce essen gehen: chat soft-nudged to pitch',\n);"
# insert after that assert block
idx = t.find(marker)
if idx < 0:
    raise SystemExit("marker missing")
end = idx + len(marker)
t2 = t[:end] + "\n" + insert + t[end:]
tmp = Path(r"c:/Users/larsf/Findus 2.0/.phone-check/_call1_smoke_out.ts")
tmp.write_text(t2, encoding="utf-8")
tmp.replace(p)
print("ok")
