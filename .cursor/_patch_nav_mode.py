from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\pitchStartNav.ts")
s = p.read_text(encoding="utf-8")
old = """      let preferFootOrBike = false;
      try {
        const { getPreferredTravelMode } = require('../../services/navigation/travelModeContext') as {
          getPreferredTravelMode: () => 'transit' | 'foot' | 'bike' | null;
        };
        const mode = getPreferredTravelMode();
        preferFootOrBike = mode === 'foot' || mode === 'bike';
        if (mode === 'foot') {
          return commitChosenWalkOrBike({ name, lat, lng }, 'foot');
        }
        if (mode === 'bike') {
          return commitChosenWalkOrBike({ name, lat, lng }, 'bike');
        }
      } catch {
        /* soft */
      }
      if (!preferFootOrBike) {"""
new = """      let preferFootOrBike = false;
      try {
        const { resolveActiveTravelMode } = require('../../services/navigation/travelModeContext') as {
          resolveActiveTravelMode: () => {
            mode: 'transit' | 'foot' | 'bike';
            explicit: boolean;
          };
        };
        const { mode, explicit } = resolveActiveTravelMode();
        // Speech/Profil sagt Fuß/Rad → nie still auf ÖPNV umbiegen
        if (explicit && mode === 'foot') {
          return commitChosenWalkOrBike({ name, lat, lng }, 'foot');
        }
        if (explicit && mode === 'bike') {
          return commitChosenWalkOrBike({ name, lat, lng }, 'bike');
        }
        preferFootOrBike = mode === 'foot' || mode === 'bike';
      } catch {
        /* soft */
      }
      if (!preferFootOrBike) {"""
if old not in s:
    raise SystemExit('block missing')
tmp = p.with_suffix('.ts.patching')
tmp.write_text(s.replace(old, new, 1), encoding='utf-8')
tmp.replace(p)
print('ok')
