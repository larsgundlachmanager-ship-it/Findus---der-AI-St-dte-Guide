# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_rplus(path: Path, text: str) -> None:
    data = text.encode("utf-8")
    with path.open("r+b") as f:
        f.seek(0)
        f.write(data)
        f.truncate()


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing: {label}")
    return text.replace(old, new, 1)


# --- liveHudCards: concrete meal again ---
p = ROOT / "src/services/ui/liveHudCards.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """function dinnerCard(nowMs: number): LiveHudCard | null {
  const slot = resolveMealSlot(nowMs);
  const hour = new Date(nowMs).getHours();
  if (hour >= 19) return null;
  if (slot === 'bakery' && (hour < 6 || hour >= 11)) return null;
  if (slot === 'lunch' && (hour < 11 || hour >= 16)) return null;
  if (slot === 'dinner' && (hour < 16 || hour >= 19)) return null;

  const cached = getMealHudCache();
  if (!cached || cached.slot !== slot || cached.items.length === 0) {
    return null;
  }
  return polishCard({
    id: `meal-${slot}`,
    title: cached.title,
    meta: cached.meta,
    tellMorePrompt: cached.tellMorePrompt,
  });
}""",
    """function dinnerCard(nowMs: number): LiveHudCard | null {
  const slot = resolveMealSlot(nowMs);
  const hour = new Date(nowMs).getHours();
  // Nur mit echtem Nearby-Treffer — nie leere Soft-Frage.
  if (slot === 'bakery' && (hour < 6 || hour >= 11)) return null;
  if (slot === 'lunch' && (hour < 11 || hour >= 16)) return null;
  if (slot === 'dinner' && (hour < 16 || hour >= 22)) return null;

  const cached = getMealHudCache();
  if (!cached || cached.slot !== slot || cached.items.length === 0) {
    return null;
  }
  const primary = cached.items[0];
  const navDest =
    primary &&
    typeof primary.lat === 'number' &&
    typeof primary.lng === 'number' &&
    Number.isFinite(primary.lat) &&
    Number.isFinite(primary.lng)
      ? { name: primary.name, lat: primary.lat, lng: primary.lng }
      : undefined;
  return polishCard({
    id: `meal-${slot}`,
    title: cached.title,
    meta: cached.meta,
    tellMorePrompt: cached.tellMorePrompt,
    navDest,
  });
}""",
    "dinnerCard concrete",
)

text = must_replace(
    text,
    """  if (themes.has('sunset')) push(sunsetCard(nowMs));
  // Soft-Gastro-Theme absichtlich stumm.

  // Pro aktivem Pulse-Thema nur den besten Tipp — kein Durchreichen aller Karten""",
    """  if (themes.has('sunset')) push(sunsetCard(nowMs));
  // Konkrete Gastro nur mit Cache-Treffer (dinnerCard), nie Soft-Placeholder.
  if (themes.has('dinner')) push(dinnerCard(nowMs));

  // Pro aktivem Pulse-Thema nur den besten Tipp — kein Durchreichen aller Karten""",
    "theme dinner",
)

text = must_replace(
    text,
    """  push(parkingCard(nowMs));
  // Konkrete Gastro-Treffer (Cache) — unabhängig vom Theme-Mix
  // Soft-Gastro absichtlich stumm (kein Hunger?/Burger-Pitch).

  // Utility-Tipps zuerst (Wecker, Akku, Bahn, Leave-by, Regen …)""",
    """  push(parkingCard(nowMs));
  // Konkrete Gastro-Treffer (Cache) — unabhängig vom Theme-Mix, nie Soft-Placeholder.
  if (allowActivitySoftTips(nowMs)) push(dinnerCard(nowMs));

  // Utility-Tipps zuerst (Wecker, Akku, Bahn, Leave-by, Regen …)""",
    "idle dinner push",
)
write_rplus(p, text)
print("liveHudCards ok")

# --- proactiveHudEngine: logistics leave-by / taxi ---
p = ROOT / "src/services/ui/proactiveHudEngine.ts"
text = p.read_text(encoding="utf-8")
producer = r'''
const produceLogisticsDeadlines: TipProducer = (ctx) => {
  try {
    const { useLogisticsTriggerStore } = require('../../store/useLogisticsTriggerStore') as {
      useLogisticsTriggerStore: {
        getState: () => {
          getActiveEvents: () => Array<{
            id: string;
            kind: string;
            title: string;
            atMs: number | null;
            meta?: Record<string, string | number | boolean | null>;
          }>;
          triggers: Array<{
            eventId: string;
            leaveByMs: number | null;
            status: string;
            mode: string | null;
          }>;
        };
      };
    };
    const st = useLogisticsTriggerStore.getState();
    const tips: HudTipCandidate[] = [];
    for (const ev of st.getActiveEvents()) {
      if (
        ev.kind !== 'flight' &&
        ev.kind !== 'train' &&
        ev.kind !== 'bus' &&
        ev.kind !== 'session' &&
        ev.kind !== 'reminder'
      ) {
        continue;
      }
      const metaLeave =
        typeof ev.meta?.leaveByMs === 'number' && Number.isFinite(ev.meta.leaveByMs)
          ? ev.meta.leaveByMs
          : null;
      const trigLeave =
        st.triggers.find(
          (t) =>
            t.eventId === ev.id &&
            t.leaveByMs != null &&
            (t.status === 'scheduled' || t.status === 'due'),
        )?.leaveByMs ?? null;
      const leaveBy = metaLeave ?? trigLeave;
      const taxiStatus = String(ev.meta?.taxiStatus ?? '').toLowerCase();
      if (taxiStatus === 'en_route' || taxiStatus === 'arriving' || taxiStatus === 'arrived') {
        const etaMs =
          typeof ev.meta?.taxiEtaMs === 'number' ? ev.meta.taxiEtaMs : null;
        const etaLabel =
          etaMs != null && etaMs > ctx.nowMs
            ? ` · ca. ${formatClock(etaMs)}`
            : taxiStatus === 'arrived'
              ? ' · ist da'
              : taxiStatus === 'arriving'
                ? ' · kommt gleich'
                : ' · unterwegs';
        tips.push({
          id: `taxi-${ev.id}`,
          kind: 'session_deadline',
          text: `🚕 Taxi${etaLabel}`,
          meta: ev.title || 'Taxi',
          tellMorePrompt: `Mein Taxi (${ev.title || 'Taxi'})${etaLabel} — Status und nächster Schritt.`,
          score: taxiStatus === 'arrived' || taxiStatus === 'arriving' ? 97 : 90,
        });
      }
      if (leaveBy == null || !Number.isFinite(leaveBy)) continue;
      const delta = leaveBy - ctx.nowMs;
      if (delta <= 0 || delta > 3 * 60 * 60_000) continue;
      const mins = Math.max(1, Math.round(delta / 60_000));
      const score =
        delta <= 20 * 60_000
          ? 97
          : delta <= 45 * 60_000
            ? 90
            : delta <= 90 * 60_000
              ? 80
              : 70;
      const icon =
        ev.kind === 'flight' ? '✈️' : ev.kind === 'train' ? '🚆' : ev.kind === 'bus' ? '🚌' : '⏱️';
      const countdown =
        mins <= 90
          ? `${icon} In ${mins} Min los`
          : `${icon} Los ${formatClock(leaveBy)}`;
      tips.push({
        id: `logistics-leave-${ev.id}-${leaveBy}`,
        kind: 'session_deadline',
        text: countdown,
        meta: `${ev.title} · Leave-by ${formatClock(leaveBy)}`,
        tellMorePrompt: `Leave-by ${formatClock(leaveBy)} für „${ev.title}“ — Route und was ich jetzt tun soll.`,
        score,
      });
    }
    return tips;
  } catch {
    return [];
  }
};

'''
text = must_replace(
    text,
    "const produceNiceInfoScenarios: TipProducer = () => {",
    producer + "const produceNiceInfoScenarios: TipProducer = () => {",
    "insert logistics producer",
)
text = must_replace(
    text,
    """  produceSessionDeadline,
  produceWeather,""",
    """  produceSessionDeadline,
  produceLogisticsDeadlines,
  produceWeather,""",
    "register producer",
)
write_rplus(p, text)
print("proactiveHudEngine ok")

# --- smoke: allow concrete dinnerCard push, still forbid soft-only ---
for smoke_name, old, new in [
    (
        "liveHudRainFact.smoke.test.ts",
        "assert(!/push\\(dinnerCard/.test(cards), 'kein dinner Soft-Push');",
        "assert(/push\\(dinnerCard\\(nowMs\\)\\)/.test(cards), 'konkrete Meal-Karte wieder aktiv');\nassert(!/Mittagessen nah\\?/.test(cards), 'kein Soft-Placeholder-Mittag');",
    ),
    (
        "liveHudPlacePin.smoke.test.ts",
        "assert(!/push\\(dinnerCard/.test(cardsSrc), 'kein dinnerCard Soft-Pitch im Idle-HUD');\nassert(!/themes\\.has\\('dinner'\\)\\) push\\(dinnerCard/.test(cardsSrc), 'kein dinner Theme-Pitch');",
        "assert(/push\\(dinnerCard\\(nowMs\\)\\)/.test(cardsSrc), 'konkrete Meal-Karte im Idle-HUD');\nassert(/themes\\.has\\('dinner'\\)\\) push\\(dinnerCard/.test(cardsSrc), 'dinner Theme mit Cache-Treffer');",
    ),
]:
    sp = ROOT / "src/services/ui" / smoke_name
    st = sp.read_text(encoding="utf-8")
    if old not in st:
        raise SystemExit(f"smoke missing in {smoke_name}")
    st = st.replace(old, new, 1)
    write_rplus(sp, st)
    print(smoke_name, "ok")

print("done")
