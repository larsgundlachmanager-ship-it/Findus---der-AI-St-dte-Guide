from pathlib import Path

sp = Path(
    r"c:\Users\larsf\Findus 2.0\src\services\navigation\transitGuideSpeech.smoke.test.ts"
)
st = sp.read_text(encoding="utf-8")
if "Bus ohne Platform" not in st:
    extra = """
assert(platformSpoken('2', 'Bus') === 'Steig 2', 'Bus → Steig');
assert(platformSpoken(null, 'Bus') == null, 'ohne Platform → null');

const busFacts = {
  ...facts,
  line: 'Bus 745',
  headsign: 'Renningen',
  platform: null,
  vehicle: 'Bus' as const,
  waitMin: 3,
};
const busHalt = haltArrivedSpeech(busFacts);
assert(!/Gleis/i.test(busHalt), `Bus ohne Platform kein Gleis: ${busHalt}`);
assert(/Bus 745|745/.test(busHalt), `Bus nennt Linie: ${busHalt}`);

"""
    needle = "console.log('transitGuideSpeech.smoke.test.ts OK');"
    st = st.replace(needle, extra + needle)
    sp.write_text(st, encoding="utf-8", newline="\n")
    print("speech smoke")

bp = Path(
    r"c:\Users\larsf\Findus 2.0\src\services\transit\lookupBoardDeparture.smoke.test.ts"
)
bt = bp.read_text(encoding="utf-8")
if "ohne Platform" not in bt:
    extra2 = """
const thin = pickBoardDeparture({
  line: 'Bus 745',
  depMs: dep,
  candidates: [
    {
      line: 'Bus 745',
      whenMs: dep + 240_000,
      plannedWhenMs: dep,
      delaySec: 240,
      platform: null,
      cancelled: false,
      direction: null,
    },
  ],
});
assert(thin != null && thin.delaySec === 240, 'dünner Feed: Delay ohne Platform');
assert(thin!.platform == null, 'kein erfundenes Gleis');

const thinCancel = pickBoardDeparture({
  line: 'Bus 745',
  depMs: dep,
  candidates: [
    {
      line: 'Bus 745',
      whenMs: dep,
      plannedWhenMs: dep,
      delaySec: null,
      platform: null,
      cancelled: true,
      direction: null,
    },
  ],
});
assert(thinCancel?.cancelled === true, 'Cancel ohne Platform');

"""
    needle2 = "console.log('lookupBoardDeparture.smoke.test.ts OK');"
    bt = bt.replace(needle2, extra2 + needle2)
    bp.write_text(bt, encoding="utf-8", newline="\n")
    print("board smoke")
