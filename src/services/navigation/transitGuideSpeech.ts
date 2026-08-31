/**
 * Hands-free ÖPNV-Ansagen — Struktur, kein Skript.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe immer dynamisch an Linie, Gleis, Halt und Restfahrt an.
 */

export type TransitVehicleKind = 'Bahn' | 'Bus' | 'ÖPNV';

export type TransitGuideFacts = {
  line: string | null;
  headsign: string | null;
  platform: string | null;
  haltName: string | null;
  alightName: string | null;
  waitMin: number | null;
  remainingStops: number | null;
  rideMin: number | null;
  destWalkM: number | null;
  destName: string | null;
  vehicle: TransitVehicleKind;
};

function pick(seed: string, list: readonly string[]): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[Math.abs(h) % list.length]!;
}

export function platformSpoken(raw: string | null | undefined): string | null {
  const p = String(raw ?? '').trim();
  if (!p) return null;
  if (/gleis|steig|bussteig|kante|gate/i.test(p)) return p;
  return `Gleis ${p}`;
}

export function rideSpoken(facts: Pick<TransitGuideFacts, 'line' | 'headsign' | 'vehicle'>): string {
  const line = (facts.line || '').trim();
  const head = (facts.headsign || '').trim();
  const veh = facts.vehicle || 'ÖPNV';
  if (line && head) return `${line} nach ${head}`;
  if (line) return line;
  if (head) return `${veh} nach ${head}`;
  return veh;
}

function haltLabel(name: string | null | undefined): string {
  const n = (name || '').trim();
  return n || 'der Haltestelle';
}

export function haltArrivedSpeech(facts: TransitGuideFacts): string {
  const ride = rideSpoken(facts);
  const plat = platformSpoken(facts.platform);
  const halt = haltLabel(facts.haltName);
  const wait =
    facts.waitMin != null && facts.waitMin >= 0
      ? facts.waitMin <= 1
        ? `${facts.vehicle} kommt gleich.`
        : `${facts.vehicle} kommt in ${Math.round(facts.waitMin)} Minuten.`
      : '';
  const go = plat
    ? pick(ride, [
        `Wir sind am Halt. Geh zu ${plat} und warte auf ${ride}.`,
        `Halt ${halt} — zu ${plat}, dort ${ride}.`,
      ])
    : pick(ride, [
        `Wir sind am Halt. Warte hier auf ${ride}.`,
        `Halt ${halt} — bleib hier, ${ride} kommt.`,
      ]);
  return [go, wait].filter(Boolean).join(' ');
}

export function vehicleSoonSpeech(facts: TransitGuideFacts): string {
  const ride = rideSpoken(facts);
  const plat = platformSpoken(facts.platform);
  const where = plat ? ` an ${plat}` : '';
  return pick(ride, [
    `${facts.vehicle} fährt gleich ein${where} — steig in ${ride}.`,
    `Gleich kommt ${ride}${where}. Steig ein.`,
  ]);
}

export function onboardSpeech(facts: TransitGuideFacts): string {
  const n = facts.remainingStops;
  const ride = rideSpoken(facts);
  const dest = (facts.alightName || '').trim();
  const mins =
    facts.rideMin != null && facts.rideMin >= 1
      ? `etwa ${Math.round(facts.rideMin)} Minuten`
      : null;
  if (n === 1) {
    const time = mins && facts.rideMin != null && facts.rideMin >= 3 ? `, ${mins}` : '';
    return dest
      ? pick(dest, [
          `Nächste Station ${dest} — da aussteigen${time}.`,
          `Gleich die nächste: ${dest}, da raus${time}.`,
        ])
      : `Nächste Station müssen wir raus${time}.`;
  }
  if (n != null && n >= 2) {
    const stops = dest
      ? `${n} Haltestellen bis ${dest}`
      : `${n} Haltestellen`;
    const time = mins ? `, ${mins} Fahrt` : '';
    return pick(`${n}|${ride}`, [
      `Du bist drin. Noch ${stops}${time}.`,
      `${ride} — noch ${stops}${time}.`,
    ]);
  }
  return dest
    ? `Gute Fahrt. Aussteigen an ${dest}.`
    : `Gute Fahrt mit ${ride} — ich sag Bescheid zum Aussteigen.`;
}

export function remainingStopsSpeech(
  n: number,
  facts: Pick<TransitGuideFacts, 'alightName'>,
): string {
  const dest = (facts.alightName || '').trim();
  if (n === 1) {
    return dest
      ? pick(dest, [
          `Nächste Station ${dest} — da aussteigen.`,
          `Nächster Halt ${dest}, da müssen wir raus.`,
        ])
      : 'Nächste Station müssen wir raus.';
  }
  if (n === 3) {
    return dest
      ? `Noch drei Haltestellen bis ${dest} — noch genug Puffer.`
      : 'Noch drei Haltestellen — noch genug Puffer.';
  }
  if (n === 5) {
    return dest
      ? `Noch fünf Haltestellen bis ${dest}.`
      : 'Noch fünf Haltestellen.';
  }
  return dest
    ? `Noch ${n} Haltestellen bis ${dest}.`
    : `Noch ${n} Haltestellen.`;
}

export function alightNowSpeech(facts: Pick<TransitGuideFacts, 'alightName'>): string {
  const dest = (facts.alightName || '').trim();
  return dest
    ? pick(dest, [
        `Jetzt raus — ${dest}.`,
        `Hier aussteigen, ${dest}.`,
      ])
    : 'Jetzt müssen wir aussteigen.';
}

/** Zeit-Vorlauf vor dem Ausstieg (S-Bahn ~1 Min, ICE ~5 Min). */
export function alightSoonSpeech(
  facts: Pick<TransitGuideFacts, 'alightName'>,
  leadMin: number,
): string {
  const dest = (facts.alightName || '').trim();
  const min = Math.max(1, Math.round(leadMin));
  if (min >= 4 && dest) {
    return pick(dest, [
      `In noch ${min} Minuten erreichen wir ${dest} — da musst du aussteigen.`,
      `Noch ${min} Minuten, dann ${dest}. Dort raus.`,
    ]);
  }
  return alightNowSpeech(facts);
}

export function transferWalkSpeech(facts: TransitGuideFacts): string {
  const ride = rideSpoken(facts);
  const plat = platformSpoken(facts.platform);
  const halt = haltLabel(facts.haltName);
  if (plat) {
    return pick(ride, [
      `Raus und zu ${plat} — dort fährt ${ride}.`,
      `Umsteigen: zu ${plat}, ${ride}.`,
    ]);
  }
  return `Umsteigen zu Fuß Richtung ${halt}, dort ${ride}.`;
}

export function lastWalkSpeech(facts: TransitGuideFacts): string {
  const dest = (facts.destName || 'Ziel').trim();
  const m = facts.destWalkM;
  const dist =
    m != null && m >= 40
      ? m >= 1000
        ? `noch etwa ${(m / 1000).toFixed(1).replace('.', ',')} Kilometer`
        : `noch etwa ${Math.round(m)} Meter`
      : 'ein kurzes Stück';
  return pick(dest, [
    `Wir sind draußen. ${dist} zu ${dest} — raus aus dem Bahnhof, ich führ dich.`,
    `Aus dem Bahnhof raus. ${dist} bis ${dest}.`,
  ]);
}
