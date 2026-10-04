/**
 * Geschlossenes Vokabular für Cartesia-Hash-Cache.
 * Landmark-Zeilen (OSM-Namen) bleiben Live-TTS — die ändern sich zu oft.
 * Nav ohne Landmark, Wetter-Buckets, Wecker-Pacing, Haltestellen: feste Sätze.
 */

function hashPick(seed: string, list: readonly string[]): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[Math.abs(h) % list.length];
}

export function bucketMinutes(n: number): number {
  const m = Math.max(1, Math.round(n));
  if (m <= 3) return 3;
  if (m <= 6) return 5;
  if (m <= 9) return 8;
  if (m <= 12) return 10;
  if (m <= 18) return 15;
  if (m <= 22) return 20;
  if (m <= 28) return 25;
  if (m <= 35) return 30;
  if (m <= 50) return 45;
  return 60;
}

export function bucketTempC(temp: number): number {
  return Math.round(temp / 2) * 2;
}

type TurnKind =
  | 'left'
  | 'right'
  | 'slight_left'
  | 'slight_right'
  | 'uturn'
  | 'roundabout'
  | 'straight';

function classifyTurn(turn: string): TurnKind {
  const t = turn.toLowerCase();
  if (/u-?turn|umkehren|wenden/.test(t)) return 'uturn';
  if (/kreisverkehr|roundabout/.test(t)) return 'roundabout';
  if (/leicht.*links|halb links|slight.*left/.test(t)) return 'slight_left';
  if (/leicht.*rechts|halb rechts|slight.*right/.test(t)) return 'slight_right';
  if (/links|left/.test(t)) return 'left';
  if (/rechts|right/.test(t)) return 'right';
  return 'straight';
}

const TURN_PHRASES: Record<TurnKind, readonly string[]> = {
  right: [
    'Jetzt musst du rechts abbiegen.',
    'Fahr jetzt rechts um die Kurve.',
    'Gleich rechts abbiegen.',
    'Jetzt rechts rum.',
    'Rechts abbiegen, bitte.',
    'Fahr jetzt rechts ab.',
    'Gleich rechts um die Kurve.',
    'Jetzt nach rechts abbiegen.',
    'Rechts um die Kurve, bitte.',
    'Jetzt rechts abbiegen.',
  ],
  left: [
    'Jetzt musst du links abbiegen.',
    'Fahr jetzt links um die Kurve.',
    'Gleich links abbiegen.',
    'Jetzt links rum.',
    'Links abbiegen, bitte.',
    'Fahr jetzt links ab.',
    'Gleich links um die Kurve.',
    'Jetzt nach links abbiegen.',
    'Links um die Kurve, bitte.',
    'Jetzt links abbiegen.',
  ],
  slight_left: [
    'Gleich leicht links.',
    'Ein bisschen nach links.',
    'Leicht links halten.',
    'Nur leicht links.',
    'Gleich halb links.',
  ],
  slight_right: [
    'Gleich leicht rechts.',
    'Ein bisschen nach rechts.',
    'Leicht rechts halten.',
    'Nur leicht rechts.',
    'Gleich halb rechts.',
  ],
  uturn: [
    'Gleich umdrehen, wenn frei ist.',
    'Wir wenden kurz.',
    'Umdrehen, sobald frei.',
  ],
  roundabout: [
    'Gleich der Kreisverkehr.',
    'In den Kreis, ich sag den Abzweig.',
    'Kreisverkehr voraus.',
  ],
  straight: [
    'Weiter geradeaus.',
    'Geradeaus weiter.',
    'Weiter so.',
    'Du bist noch richtig — geradeaus.',
    'Bleib geradeaus.',
  ],
};

const LOOK_LEFT = TURN_PHRASES.left;
const LOOK_RIGHT = TURN_PHRASES.right;

/** Nach ≥5 Min Stille einmal „Hey“ — sonst nie. */
export function heyAfterSilencePhrase(side: 'left' | 'right' | 'straight'): string {
  if (side === 'left') return 'Hey — jetzt musst du links abbiegen.';
  if (side === 'right') return 'Hey — fahr jetzt rechts um die Kurve.';
  return 'Hey — du bist noch richtig, weiter geradeaus.';
}

const ON_ROUTE_OK = [
  'Du bist aktuell noch richtig.',
  'Alles gut — du bist richtig.',
  'Genau, du bist auf dem Weg.',
  'Passt — weiter so.',
  'Du bist richtig unterwegs.',
];

export function confirmOnRoutePhrase(): string {
  return hashPick(`onroute:${Date.now() % 97}`, ON_ROUTE_OK);
}

/** Standard-Abbiegehinweis ohne Meterzahl — damit derselbe WAV wiederkommt. */
export function navTurnPhrase(
  turn: string,
  lookSide?: string | null,
): string {
  const look = (lookSide ?? '').toLowerCase();
  if (look.includes('links')) return hashPick(turn, LOOK_LEFT);
  if (look.includes('rechts')) return hashPick(turn, LOOK_RIGHT);
  const kind = classifyTurn(turn);
  return hashPick(`${kind}|${turn}`, TURN_PHRASES[kind]);
}

const PACING: Record<number, readonly string[]> = {
  3: ['Gleich da — noch ein kurzes Stück.', 'Gleich geschafft.'],
  5: ['Noch so ca. fünf Minuten, entspannt bleiben.', 'Fünf Minuten noch.'],
  8: ['Noch so ca. acht Minuten, alles easy.', 'Acht Minuten noch, passt.'],
  10: ['Noch so ca. zehn Minuten.', 'Zehn Minuten noch, locker.'],
  15: ['Noch so ca. fünfzehn Minuten.', 'Viertelstunde noch.'],
  20: ['Noch so ca. zwanzig Minuten.', 'Zwanzig Minuten noch.'],
  25: ['Noch so ca. fünfundzwanzig Minuten.'],
  30: ['Noch so ca. dreißig Minuten.', 'Eine halbe Stunde noch.'],
  45: ['Noch so ca. dreiviertel Stunde.'],
  60: ['Noch so ca. eine Stunde.'],
};

export function pacingPhrase(etaMin: number): string {
  const b = bucketMinutes(etaMin);
  return hashPick(`pace:${b}`, PACING[b] ?? PACING[30]);
}

export function reassurePhrase(etaMin: number): string {
  const b = bucketMinutes(etaMin);
  if (b <= 3) return 'Alles gut — noch ein kurzes Stück.';
  const bit = pacingPhrase(b).replace(/^(Noch so ca\. |Noch )/i, 'noch ');
  return `Alles gut — ${bit.replace(/\.$/, '')}.`;
}

const STOPS: Record<number, string> = {
  3: 'Noch drei Stationen — langsam bereit machen zum Aussteigen.',
  1: 'Nächste Station müssen wir raus.',
};

export function remainingStopsPhrase(
  n: number,
  targetName?: string | null,
): string {
  if (n === 1) {
    const dest = (targetName ?? '').trim();
    if (dest) return `Nächster Halt müssen wir raus — ${dest}.`;
    return STOPS[1];
  }
  return STOPS[n] ?? `Noch ${Math.round(n)} Stationen.`;
}

export function alightNowPhrase(): string {
  return 'Jetzt müssen wir aussteigen.';
}

export function weatherSpokenLine(opts: {
  tempC: number | null;
  rainProbNext: number;
  gustKmh: number | null;
  rainSoonClock: string | null;
  isHeavyRain: boolean;
}): string {
  const temp =
    opts.tempC == null ? null : bucketTempC(opts.tempC);
  const t =
    temp == null ? 'Wetter gerade unklar' : `So um die ${temp} Grad`;
  if (opts.isHeavyRain) return `${t}, und draußen regnet es stark.`;
  if (opts.rainProbNext >= 40 && opts.rainSoonClock) {
    const clock = opts.rainSoonClock.replace(/:\d{2}$/, (m) =>
      Number(m.slice(1)) >= 30 ? ':30' : ':00',
    );
    return `${t}, und ab ca. ${clock} sieht's nach Regen aus.`;
  }
  if (opts.gustKmh != null && opts.gustKmh >= 40) {
    return `${t}, aber mit ordentlich Wind.`;
  }
  if (opts.rainProbNext >= 20) {
    return `${t}, Schauer möglich — kein sicheres Trocken.`;
  }
  return `${t}, trocken bis zum Abend.`;
}

export function walkToStopPhrase(walkMin: number): string {
  const b = bucketMinutes(walkMin);
  return `du brauchst noch etwa ${b} Minuten zur Haltestelle.`;
}

const ALARM_SOON: Record<number, string> = {
  3: 'Gleich ist Wecken — noch ein kurzes Stück Schlaf.',
  5: 'In fünf Minuten ist Wecken.',
  10: 'In zehn Minuten ist Wecken.',
  15: 'In fünfzehn Minuten ist Wecken.',
};

export function alarmSoonPhrase(minutes: number): string {
  const b = bucketMinutes(minutes);
  return ALARM_SOON[b] ?? `In etwa ${b} Minuten ist Wecken.`;
}

/** Einmalig vorwärmen: häufige Sätze, ohne Landmark-Unikate. */
export function closedVocabWarmList(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(TURN_PHRASES)) {
    for (const p of list) out.add(p);
  }
  for (const p of LOOK_LEFT) out.add(p);
  for (const p of LOOK_RIGHT) out.add(p);
  for (const list of Object.values(PACING)) {
    for (const p of list) out.add(p);
  }
  for (const p of Object.values(STOPS)) out.add(p);
  out.add(alightNowPhrase());
  out.add(confirmOnRoutePhrase());
  out.add('Alles gut — noch ein kurzes Stück.');
  for (const t of [8, 12, 16, 20, 24]) {
    out.add(weatherSpokenLine({
      tempC: t,
      rainProbNext: 10,
      gustKmh: null,
      rainSoonClock: null,
      isHeavyRain: false,
    }));
  }
  out.add(weatherSpokenLine({
    tempC: 14,
    rainProbNext: 50,
    gustKmh: null,
    rainSoonClock: '16:00',
    isHeavyRain: false,
  }));
  out.add(weatherSpokenLine({
    tempC: 12,
    rainProbNext: 80,
    gustKmh: null,
    rainSoonClock: null,
    isHeavyRain: true,
  }));
  for (const m of [5, 10, 15]) out.add(alarmSoonPhrase(m));
  return [...out];
}
