from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\phoneChargeDiscovery.ts")
t = p.read_text(encoding="utf-8")

t = t.replace(
"""import {
  acceptChargePlace,
  formatChargeBullet,
  kindLabel,
  kindSpeechHint,
  type ChargeKind,
} from './chargePlacePolicy';""",
"""import {
  acceptChargePlace,
  formatChargeBullet,
  isGuaranteedChargeKind,
  kindLabel,
  kindSpeechHint,
  type ChargeKind,
} from './chargePlacePolicy';""",
)

old_end = """  out.sort((a, b) => a.sortKey - b.sortKey);
  return out.slice(0, 4);
}"""

new_end = """  out.sort((a, b) => a.sortKey - b.sortKey);
  // Belegte Spots zuerst; Soft (Café/Bäckerei) nur auffüllen — nie Soft vor Garantie.
  const hard = out.filter((p) => isGuaranteedChargeKind(p.kind));
  const soft = out.filter((p) => !isGuaranteedChargeKind(p.kind));
  if (hard.length >= 2) return hard.slice(0, 4);
  return [...hard, ...soft].slice(0, 4);
}"""

if old_end not in t:
    raise SystemExit("gather end not found")
t = t.replace(old_end, new_end, 1)

old_speech = """function buildSpeech(ranked: Ranked[]): string {
  if (!ranked.length) {
    return (
      'In der Nähe finde ich gerade keinen glaubwürdigen Powerbank-Automaten, ' +
      'keine Ladestation und kein offenes Café zum Aufladen. ' +
      'Kein Fake-Tipp — tipp „nochmal suchen“, oder sag Hotel/Bahnhof, wenn du da hinwillst.'
    );
  }
  const top = ranked[0]!;
  const far = top.distanceM >= PLACE_FAR_SPEECH_M;
  if (ranked.length === 1) {
    const tip =
      top.kind === 'cafe'
        ? 'Steckdose oft da, aber nicht garantiert'
        : kindSpeechHint(top.kind);
    return far
      ? `${top.name} wäre mein Tipp zum Laden — ${tip}, ca. ${formatDist(top.distanceM)}. Tippe die Route, wenn du willst.`
      : `${top.name} liegt gut — ${tip}, ca. ${formatDist(top.distanceM)}. Route startest du mit dem Button.`;
  }
  const second = ranked[1]!;
  const aTip =
    top.kind === 'cafe'
      ? 'Steckdose oft da, nicht garantiert'
      : kindSpeechHint(top.kind);
  const bTip =
    second.kind === 'cafe'
      ? 'Steckdose oft da, nicht garantiert'
      : kindSpeechHint(second.kind);
  return (
    `Entweder ${top.name} — ${aTip}, ca. ${formatDist(top.distanceM)}. ` +
    `Oder ${second.name} — ${bTip}, ca. ${formatDist(second.distanceM)}. ` +
    `Was passt dir besser?`
  );
}"""

new_speech = """function buildSpeech(ranked: Ranked[]): string {
  if (!ranked.length) {
    return (
      'In der Nähe finde ich gerade keinen glaubwürdigen Powerbank-Automaten, ' +
      'keine Ladestation und keine belegte Steckdose. ' +
      'Kein Fake-Tipp — tipp „nochmal suchen“, oder sag Hotel/Bahnhof, wenn du da hinwillst.'
    );
  }
  const top = ranked[0]!;
  const far = top.distanceM >= PLACE_FAR_SPEECH_M;
  if (ranked.length === 1) {
    const tip = kindSpeechHint(top.kind);
    return far
      ? `${top.name} wäre mein Tipp zum Laden — ${tip}, ca. ${formatDist(top.distanceM)}. Tippe die Route, wenn du willst.`
      : `${top.name} liegt gut — ${tip}, ca. ${formatDist(top.distanceM)}. Route startest du mit dem Button.`;
  }
  const second = ranked[1]!;
  return (
    `Entweder ${top.name} — ${kindSpeechHint(top.kind)}, ca. ${formatDist(top.distanceM)}. ` +
    `Oder ${second.name} — ${kindSpeechHint(second.kind)}, ca. ${formatDist(second.distanceM)}. ` +
    `Was passt dir besser?`
  );
}"""

if old_speech not in t:
    raise SystemExit("buildSpeech not found")
t = t.replace(old_speech, new_speech, 1)

old_bullets = """function chargeOptionBullets(c: Ranked): string[] {
  const dist = formatDist(c.distanceM);
  const lines = [`${kindLabel(c.kind)} · ${dist}`];
  if (c.kind === 'cafe') lines.push('Steckdose nicht garantiert');
  else if (c.kind === 'outlet') lines.push('Steckdose belegt');
  else if (c.kind === 'powerbank') lines.push('Powerbank-Automat');
  else lines.push('Ladestation');
  return lines.slice(0, 3);
}"""

new_bullets = """function chargeOptionBullets(c: Ranked): string[] {
  const dist = formatDist(c.distanceM);
  const lines = [`${kindLabel(c.kind)} · ${dist}`];
  if (c.kind === 'bakery') lines.push('Oft kurz laden, nicht garantiert');
  else if (c.kind === 'cafe') lines.push('Steckdose oft, nicht garantiert');
  else if (c.kind === 'outlet') lines.push('Steckdose belegt');
  else if (c.kind === 'powerbank') lines.push('Powerbank-Automat');
  else lines.push('Ladestation');
  return lines.slice(0, 3);
}"""

if old_bullets not in t:
    raise SystemExit("bullets not found")
t = t.replace(old_bullets, new_bullets, 1)

t = t.replace(
"""        speechPitch:
          c.kind === 'cafe'
            ? `${c.name}: Café, Steckdose oft da, nicht garantiert.`
            : `${c.name}: ${kindSpeechHint(c.kind)}.`,""",
"""        speechPitch: `${c.name}: ${kindSpeechHint(c.kind)}.`,""",
)

p.write_text(t, encoding="utf-8")
print("phoneChargeDiscovery patched")
