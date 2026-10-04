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


# Resolve generic drop name before nav commit
patch(
    "src/services/homeMap/homeMapNavStart.ts",
    """export async function startHomeMapNavigation(
  target: HomeMapNavTarget,
  _profile?: UserProfile | null,
  opts?: HomeMapNavStartOpts,
): Promise<HomeMapNavResult> {
  const dest = resolveDest(target);
  if (!isUsableHomeMapNavCoord(dest.lat, dest.lng) || !dest.name.trim()) {
    return { ok: false, reason: 'bad_dest' };
  }""",
    """export async function startHomeMapNavigation(
  target: HomeMapNavTarget,
  _profile?: UserProfile | null,
  opts?: HomeMapNavStartOpts,
): Promise<HomeMapNavResult> {
  let dest = resolveDest(target);
  if (!isUsableHomeMapNavCoord(dest.lat, dest.lng) || !dest.name.trim()) {
    return { ok: false, reason: 'bad_dest' };
  }
  // Gebäude-Tap oft noch „Punkt auf der Karte“ — Name vor Route nachziehen.
  try {
    const { isGenericMapPointLabel } = require('../navigation/streetAddressQuery') as {
      isGenericMapPointLabel: (s: string) => boolean;
    };
    if (isGenericMapPointLabel(dest.name)) {
      const { resolveMapDropName } = require('./snapMapDrop') as {
        resolveMapDropName: (lat: number, lng: number) => Promise<string | null>;
      };
      const named = await resolveMapDropName(dest.lat, dest.lng);
      if (named) dest = { ...dest, name: named };
    }
  } catch {
    /* soft */
  }""",
    "resolve name before nav",
)

patch(
    "src/services/homeMap/homeMapNavStart.smoke.test.ts",
    """assert(
  navStart.includes('skipMobilityAsk: false') ||
    navStart.includes('const skipMobilityAsk = false'),
  'Kurze Luftlinie: Live-Guard nach Route-ETA falls OSRM länger ist',
);""",
    """assert(
  navStart.includes('skipMobilityAsk: true'),
  'Karten-Navigation: explizit, kein zweites Mobility-Ask',
);
assert(
  navStart.includes('setNavRouteLoading(false)') &&
    navStart.includes('setIsGenerating(false)'),
  'Loading/Busy nach Nav-Start immer freigeben',
);
assert(
  navStart.includes('resolveMapDropName') || navStart.includes('isGenericMapPointLabel'),
  'Gebäude-Name statt Punkt auf der Karte',
);""",
    "smoke navStart",
)

patch(
    "src/services/navigation/navRouteMapPayload.smoke.test.ts",
    """assert(payloadSrc.includes('chipForTourStop'), 'Pin-Chips für Bahn/Umstieg');
assert(payloadSrc.includes('Ausstieg'), 'Chip nennt Ausstieg');
assert(payloadSrc.includes('delayBit'), 'Verspätung im Chip');""",
    """assert(payloadSrc.includes('chipForTourStop'), 'Pin-Chips für Bahn/Umstieg');
assert(payloadSrc.includes('Aussteigen'), 'Chip nennt Aussteigen am Halt');
assert(payloadSrc.includes('Abfahrt'), 'Chip: Abfahrt HH:MM getrennt von Delay');
assert(payloadSrc.includes('delayBit'), 'Verspätung im Chip');
assert(payloadSrc.includes('isBusVehicle') || payloadSrc.includes('Abfahrtsbereich'), 'Bus ohne Fake-Gleis');""",
    "smoke chip",
)

# Also strip accordion in top strip if present with same pattern
patch(
    "src/components/PlanCalendarModal.tsx",
    """                  {collapsedGroups.live_journey ? '▸' : '▾'}{' '}
                  {liveLeaveArrive ? '⏰ Erinnerung · ÖPNV' : liveRouteLabel.startsWith('Fahrt') || liveRouteLabel.startsWith('Reise') ? 'Fahrt' : 'Aktive Route'}""",
    """                  <Text style={{ fontSize: 16, fontWeight: '900' }}>
                    {collapsedGroups.live_journey ? '▸' : '▾'}
                  </Text>{' '}
                  {liveLeaveArrive ? '⏰ Erinnerung · ÖPNV' : liveRouteLabel.startsWith('Fahrt') || liveRouteLabel.startsWith('Reise') ? 'Fahrt' : 'Aktive Route'}""",
    "top strip chevron",
)

# Fahrt zu in planLiveEdits if present
p = ROOT / "src/module2/timeline/planLiveEdits.ts"
t = p.read_text(encoding="utf-8")
if "`Fahrt nach ${titleBase}`" in t:
    write_atomic(p, t.replace("`Fahrt nach ${titleBase}`", "`Fahrt zu ${titleBase}`", 1))
    print("ok planLiveEdits Fahrt zu")

print("batch D done")
