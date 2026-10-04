# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def patch(path: str, old: str, new: str, label: str) -> None:
    p = ROOT / path
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"FAIL {label}: old block not found in {path}")
    write_atomic(p, t.replace(old, new, 1))
    print(f"ok {label}")


# snapMapDrop radii + resolveMapDropName (from previous incomplete script)
p = ROOT / "src/services/homeMap/snapMapDrop.ts"
t = p.read_text(encoding="utf-8")
if "PLACE_SNAP_M = 95" in t:
    t = t.replace("const PLACE_SNAP_M = 95;", "const PLACE_SNAP_M = 140;", 1)
    t = t.replace("const ADDRESS_SNAP_M = 48;", "const ADDRESS_SNAP_M = 55;", 1)
    print("ok snap radii")
if "resolveMapDropName" not in t:
    t = t.rstrip() + """

/**
 * Long-Press ohne Pack-Ort: Gebäude-/Ladenname aus Nominatim (z. B. Edeka Böge).
 * Kein Hardcode — nur was reverse liefert.
 */
export async function resolveMapDropName(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lng));
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('zoom', '18');
      u.searchParams.set('namedetails', '1');
      const res = await fetch(u.toString(), {
        signal: ctrl.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        name?: string;
        namedetails?: { name?: string; 'name:de'?: string };
        address?: Record<string, string | undefined>;
        display_name?: string;
      };
      const addr = data.address || {};
      const named =
        (data.namedetails?.['name:de'] || data.namedetails?.name || data.name || '').trim() ||
        (
          addr.amenity ||
          addr.shop ||
          addr.tourism ||
          addr.leisure ||
          addr.building ||
          addr.office ||
          ''
        ).trim();
      if (named && named.length >= 2 && !/^\\d+$/.test(named)) {
        return named.slice(0, 64);
      }
      const road = (addr.road || addr.pedestrian || '').trim();
      const house = (addr.house_number || '').trim();
      if (road && house) return `${road} ${house}`.slice(0, 64);
      if (road) return road.slice(0, 64);
      const first = data.display_name?.split(',')[0]?.trim();
      if (first && first.length >= 3 && !/^punkt/i.test(first)) return first.slice(0, 64);
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
"""
    write_atomic(p, t + "\n")
    print("ok resolveMapDropName")
else:
    write_atomic(p, t) if "PLACE_SNAP_M = 140" in t else None
    if "PLACE_SNAP_M = 140" in p.read_text(encoding="utf-8"):
        print("snap already patched")

patch(
    "src/components/homeMap/HomePresenceMap.tsx",
    "import { snapMapLongPress } from '../../services/homeMap/snapMapDrop';",
    "import { snapMapLongPress, resolveMapDropName } from '../../services/homeMap/snapMapDrop';",
    "import resolveMapDropName",
)

patch(
    "src/components/homeMap/HomePresenceMap.tsx",
    """      setDropPin({ lat, lng });
      useHomeMapUiStore.getState().setPlacePopup(
        instantMapPlacePopup({
          id: MAP_DROP_PIN_ID,
          name,
          category,
          lat,
          lng,
        }),
      );
    },
    [mapExtract, mapPlaces, onNativePlaceTap, yorroContentAt, maybePromptPackAt],
  );""",
    """      setDropPin({ lat, lng });
      useHomeMapUiStore.getState().setPlacePopup(
        instantMapPlacePopup({
          id: MAP_DROP_PIN_ID,
          name,
          category,
          lat,
          lng,
        }),
      );
      // Gebäude-Tap: echten Namen nachziehen (Edeka …), nicht „Punkt auf der Karte“.
      if (snap.kind === 'point') {
        const dropLat = lat;
        const dropLng = lng;
        void resolveMapDropName(dropLat, dropLng).then((resolved) => {
          if (!resolved) return;
          const ui = useHomeMapUiStore.getState();
          const cur = ui.placePopup;
          if (!cur || cur.id !== MAP_DROP_PIN_ID) return;
          if (Math.abs(cur.lat - dropLat) > 1e-5 || Math.abs(cur.lng - dropLng) > 1e-5) {
            return;
          }
          ui.setPlacePopup({ ...cur, name: resolved, category: cur.category || 'Ort' });
        });
      }
    },
    [mapExtract, mapPlaces, onNativePlaceTap, yorroContentAt, maybePromptPackAt],
  );""",
    "enrich drop name",
)

# chip wrap 2 lines
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """                  <Text style={styles.navChipSub} numberOfLines={1}>
                    {pin.chip.sub}
                  </Text>""",
    """                  <Text style={styles.navChipSub} numberOfLines={2}>
                    {pin.chip.sub}
                  </Text>""",
    "chip sub 2 lines",
)

# bigger accordion chevron
patch(
    "src/components/PlanCalendarModal.tsx",
    """  routeStripKicker: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },""",
    """  routeStripKicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },""",
    "kicker size",
)

# Make chevron more visible in live journey header text
patch(
    "src/components/PlanCalendarModal.tsx",
    """                                {collapsed ? '▸' : '▾'}{' '}
                                {liveLeaveArrive
                                  ? 'Erinnerung · ÖPNV'
                                  : liveRouteLabel.startsWith('Fahrt') ||
                                      liveRouteLabel.startsWith('Reise')
                                    ? 'Fahrt'
                                    : 'Aktive Route'}""",
    """                                <Text style={{ fontSize: 16, fontWeight: '900' }}>
                                  {collapsed ? '▸' : '▾'}
                                </Text>{' '}
                                {liveLeaveArrive
                                  ? 'Erinnerung · ÖPNV'
                                  : liveRouteLabel.startsWith('Fahrt') ||
                                      liveRouteLabel.startsWith('Reise')
                                    ? 'Fahrt'
                                    : 'Aktive Route'}""",
    "bigger chevron live",
)

print("batch C done")
