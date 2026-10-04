from pathlib import Path
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\call1Dispatch.ts")
t = p.read_text(encoding="utf-8")
old = '''  // Reines Taxi-Hail (kein Flug, kein Venue-Compound) → Fanout
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const compound = detectMobilityCompoundKind(userText);
    if (
      wantsTaxiRide(userText) &&
      compound === 'taxi_only' &&
      !/\\b(flieg(?:e|st|t)?|fliegen|flugnummer|boarding)\\b/iu.test(userText)
    ) {
      return apply('task_fanout', 'taxi_hail', true);
    }
  } catch {
    /* soft */
  }'''
new = '''  // Reines Taxi-Hail — nur wenn Call-1 kein Backend gesetzt hat (sonst SSOT ehren)
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const compound = detectMobilityCompoundKind(userText);
    if (
      !explicit &&
      wantsTaxiRide(userText) &&
      compound === 'taxi_only' &&
      !/\\b(flieg(?:e|st|t)?|fliegen|flugnummer|boarding)\\b/iu.test(userText)
    ) {
      return apply('task_fanout', 'taxi_hail', true);
    }
  } catch {
    /* soft */
  }'''
if old not in t:
    raise SystemExit("taxi_hail block not found")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("taxi_hail gated OK")
