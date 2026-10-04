# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\liveHudCards.ts")
text = p.read_text(encoding="utf-8")

old = """  // Utility-Tipps zuerst (Wecker, Akku, Bahn, Leave-by, Regen …)
  evaluateProactiveHud({ force: false });
  const utilityTips = collectHudTipCandidates({ nowMs })
    .filter(
      (t) =>
        UTILITY_TIP_KINDS.has(t.kind) ||
        (t.score >= 70 && t.kind !== 'weather_summary'),
    )
    .sort((a, b) => b.score - a.score);
  for (const tip of utilityTips) {
    if (tip.id.startsWith('wx-')) continue;
    // Parken schon als parkingCard
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;
    // Wetter-Karte ist SSOT — kein zweites Regen-Banner
    if (tip.kind === 'weather_rain' && seen.has('weather-live')) continue;
    if (
      tip.kind === 'umbrella_day' ||
      /Jacke mitnehmen|Regen möglich|Regen → Indoor|Burger lokal/i.test(tip.text)
    ) {
      continue;
    }
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }

  // Nearby: Klo / Wasser / Eis / Museum / Erholung / Fotospot — nur mit Treffer
  if (allowActivitySoftTips(nowMs)) {
    const amenityCards = getNearbyAmenityHudCards(nowMs).sort(
      (a, b) => b.score - a.score,
    );
    // Max 2 Amenity-Karten, damit es nicht aufdringlich wird
    let amenityPushed = 0;
    for (const a of amenityCards) {
      if (amenityPushed >= 2) break;
      push(
        polishCard({
          id: a.id,
          title: a.title,
          meta: a.meta,
          tellMorePrompt: a.tellMorePrompt,
          navDest: a.navDest,
        }),
      );
      amenityPushed += 1;
    }

    // Eingeklemmte Ideen (Plan/Liste/Wunsch) — eine Karte reicht
    const pinned = pinnedIdeaSoftTips(nowMs).sort((a, b) => b.score - a.score)[0];
    if (pinned) {
      push(
        polishCard({
          id: `${pinned.id}-${hudThemeBucketKey(nowMs)}`,
          title: pinned.title,
          meta: pinned.meta,
          tellMorePrompt: pinned.tellMorePrompt,
        }),
      );
    }
  }
"""

new = """  evaluateProactiveHud({ force: false });
  const utilityTips = collectHudTipCandidates({ nowMs })
    .filter(
      (t) =>
        UTILITY_TIP_KINDS.has(t.kind) ||
        (t.score >= 70 && t.kind !== 'weather_summary'),
    )
    .sort((a, b) => b.score - a.score);
  const skipSoftUtility = (tip: (typeof utilityTips)[number]) => {
    if (tip.id.startsWith('wx-')) return true;
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) return true;
    if (tip.kind === 'weather_rain' && seen.has('weather-live')) return true;
    if (
      tip.kind === 'umbrella_day' ||
      /Jacke mitnehmen|Regen möglich|Regen → Indoor|Burger lokal/i.test(tip.text)
    ) {
      return true;
    }
    return false;
  };
  // 1) Zeitkritisch zuerst: Leave-by / Bahn / Flug / Taxi
  for (const tip of utilityTips) {
    if (skipSoftUtility(tip)) continue;
    const critical =
      tip.score >= 88 &&
      (tip.kind === 'session_deadline' ||
        tip.kind === 'transit_depart' ||
        tip.kind === 'nav_eta');
    if (!critical) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }

  // 2) Nearby-Amenities (Klo/Wasser/Eis…) bevor Soft-Utility die Slots füllt
  if (allowActivitySoftTips(nowMs)) {
    const amenityCards = getNearbyAmenityHudCards(nowMs).sort(
      (a, b) => b.score - a.score,
    );
    let amenityPushed = 0;
    for (const a of amenityCards) {
      if (amenityPushed >= 2) break;
      push(
        polishCard({
          id: a.id,
          title: a.title,
          meta: a.meta,
          tellMorePrompt: a.tellMorePrompt,
          navDest: a.navDest,
        }),
      );
      amenityPushed += 1;
    }
    const pinned = pinnedIdeaSoftTips(nowMs).sort((a, b) => b.score - a.score)[0];
    if (pinned) {
      push(
        polishCard({
          id: `${pinned.id}-${hudThemeBucketKey(nowMs)}`,
          title: pinned.title,
          meta: pinned.meta,
          tellMorePrompt: pinned.tellMorePrompt,
        }),
      );
    }
  }

  // 3) Restliche Utility (Akku, Wecker, Parken …)
  for (const tip of utilityTips) {
    if (skipSoftUtility(tip)) continue;
    const alreadyCritical =
      tip.score >= 88 &&
      (tip.kind === 'session_deadline' ||
        tip.kind === 'transit_depart' ||
        tip.kind === 'nav_eta');
    if (alreadyCritical) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }
"""

if old not in text:
    raise SystemExit("block missing")
text = text.replace(old, new, 1)
data = text.encode("utf-8")
with p.open("r+b") as f:
    f.seek(0)
    f.write(data)
    f.truncate()
print("priority order ok")
