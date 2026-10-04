from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\call1Dispatch.ts")
s = p.read_text(encoding="utf-8")
if "taxi_soft" in s:
    print("taxi soft already")
else:
    needle = """  // package_quick / Pauschal-schnell → Stay22/Hotel-Pitch, kein Reisebüro-Wizard"""
    insert = """  // Taxi/Uber Just-Do-It → Fanout (nicht Events/Chat)
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const { detectTaxiAirportBlocker } = require('./call1TaskBrief') as {
      detectTaxiAirportBlocker: (s: string) => { blocked: boolean };
    };
    if (
      (wantsTaxiRide(userText) || frameHasWorker(analysis.frame, 'taxi' as never)) &&
      !detectTaxiAirportBlocker(userText).blocked
    ) {
      return apply('task_fanout', 'taxi_soft', false);
    }
  } catch {
    /* soft */
  }

"""
    if needle not in s:
        raise SystemExit("needle missing")
    s = s.replace(needle, insert + needle, 1)
    tmp = p.with_suffix(".ts.patching")
    tmp.write_text(s, encoding="utf-8")
    tmp.replace(p)
    print("taxi soft ok")
