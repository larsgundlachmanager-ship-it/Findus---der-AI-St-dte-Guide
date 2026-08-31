/**
 * Welche Abflughäfen eine öffentliche FIDS-Tafel (JSON) haben —
 * und wie weit Gate/Check-in typischerweise vorausliegen.
 *
 * JSON-GET zur Flughafen-Website = kein AeroAPI-Credit.
 * Fehlt JSON: Website per Wikidata finden, Widget/HTML nur für den
 * gebuchten Ident (max. eine Detailseite) — kein Puppeteer, kein Voll-Dump.
 */

type HorizonRow = {
  dateKey: string;
  gate: string | null;
  checkinDesk: string | null;
};

export type AirportBoardKind = 'json' | 'html' | 'none';

export type AirportBoardProfile = {
  iata: string;
  kind: AirportBoardKind;
  /** Belegter Ops-Horizont (Gate), null = unbekannt / keine Tafel. */
  gateHorizonDays: number | null;
  checkinHorizonDays: number | null;
  observedAtMs: number | null;
};

/** Nur IATA mit nachgewiesenem öffentlichem JSON. */
const JSON_SEEDS: Record<
  string,
  { gateHorizonDays: number; checkinHorizonDays: number | null }
> = {
  HAM: { gateHorizonDays: 7, checkinHorizonDays: null },
  FRA: { gateHorizonDays: 3, checkinHorizonDays: 3 },
  BER: { gateHorizonDays: 1, checkinHorizonDays: 3 },
  LIS: { gateHorizonDays: null, checkinHorizonDays: null },
  OPO: { gateHorizonDays: null, checkinHorizonDays: null },
  FAO: { gateHorizonDays: null, checkinHorizonDays: null },
};

const observed = new Map<string, AirportBoardProfile>();
const FILE = 'findus-airport-board-horizon.json';

function seedProfile(iata: string): AirportBoardProfile {
  const id = iata.trim().toUpperCase();
  const seed = JSON_SEEDS[id];
  if (!seed) {
    return {
      iata: id,
      kind: 'none',
      gateHorizonDays: null,
      checkinHorizonDays: null,
      observedAtMs: null,
    };
  }
  return {
    iata: id,
    kind: 'json',
    gateHorizonDays: seed.gateHorizonDays,
    checkinHorizonDays: seed.checkinHorizonDays,
    observedAtMs: null,
  };
}

export function hasJsonOriginBoard(iata: string | null | undefined): boolean {
  return getAirportBoardProfile(iata).kind === 'json';
}

export function hasPublicOriginBoard(iata: string | null | undefined): boolean {
  const kind = getAirportBoardProfile(iata).kind;
  return kind === 'json' || kind === 'html';
}

export function noteDiscoveredBoard(iata: string, kind: 'json' | 'html'): void {
  const id = iata.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(id)) return;
  const seed = seedProfile(id);
  if (seed.kind === 'json') return;
  const prev = getAirportBoardProfile(id);
  observed.set(id, {
    ...prev,
    iata: id,
    kind,
    observedAtMs: Date.now(),
  });
  persistSoft();
}

export function getAirportBoardProfile(
  iata: string | null | undefined,
): AirportBoardProfile {
  const id = (iata || '').trim().toUpperCase();
  if (!id) {
    return {
      iata: '',
      kind: 'none',
      gateHorizonDays: null,
      checkinHorizonDays: null,
      observedAtMs: null,
    };
  }
  return observed.get(id) ?? seedProfile(id);
}

export function dateKeyDiffDays(fromKey: string, toKey: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromKey.trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toKey.trim());
  if (!a || !b) return null;
  const da = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const db = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((db - da) / 86_400_000);
}

export function horizonDaysFromRows(
  rows: HorizonRow[],
  _nowMs: number,
  field: 'gate' | 'checkinDesk',
  todayKey: string,
): number | null {
  let max = -1;
  for (const r of rows) {
    if (!r.dateKey || r.dateKey < todayKey) continue;
    if (field === 'gate' && !r.gate) continue;
    if (field === 'checkinDesk' && !r.checkinDesk) continue;
    const d = dateKeyDiffDays(todayKey, r.dateKey);
    if (d == null || d < 0) continue;
    if (d > max) max = d;
  }
  return max < 0 ? null : max;
}

export function mergeObservedHorizon(
  prev: AirportBoardProfile,
  next: { gateHorizonDays: number | null; checkinHorizonDays: number | null; atMs: number },
): AirportBoardProfile {
  if (prev.kind === 'none') return prev;
  const gate =
    next.gateHorizonDays == null
      ? prev.gateHorizonDays
      : Math.max(prev.gateHorizonDays ?? 0, next.gateHorizonDays);
  const checkin =
    next.checkinHorizonDays == null
      ? prev.checkinHorizonDays
      : Math.max(prev.checkinHorizonDays ?? 0, next.checkinHorizonDays);
  return {
    ...prev,
    gateHorizonDays: gate,
    checkinHorizonDays: checkin,
    observedAtMs: next.atMs,
  };
}

export function noteBoardHorizonFromRows(
  iata: string,
  rows: HorizonRow[],
  nowMs: number,
  todayKey: string,
): AirportBoardProfile {
  const prev = getAirportBoardProfile(iata);
  if ((prev.kind !== 'json' && prev.kind !== 'html') || rows.length === 0) return prev;
  const next = mergeObservedHorizon(prev, {
    gateHorizonDays: horizonDaysFromRows(rows, nowMs, 'gate', todayKey),
    checkinHorizonDays: horizonDaysFromRows(rows, nowMs, 'checkinDesk', todayKey),
    atMs: nowMs,
  });
  observed.set(prev.iata, next);
  persistSoft();
  return next;
}

export function resetAirportBoardCatalogForTests(): void {
  observed.clear();
}

function persistSoft(): void {
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      writeAsStringAsync: (p: string, s: string) => Promise<void>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    void FS.writeAsStringAsync(
      `${dir}${FILE}`,
      JSON.stringify({ profiles: [...observed.values()] }),
    );
  } catch {
    /* node / tests */
  }
}

export async function hydrateAirportBoardCatalog(): Promise<void> {
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      getInfoAsync: (p: string) => Promise<{ exists: boolean }>;
      readAsStringAsync: (p: string) => Promise<string>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    const path = `${dir}${FILE}`;
    const info = await FS.getInfoAsync(path);
    if (!info.exists) return;
    const raw = JSON.parse(await FS.readAsStringAsync(path)) as {
      profiles?: AirportBoardProfile[];
    };
    if (!Array.isArray(raw.profiles)) return;
    for (const p of raw.profiles) {
      if (!p?.iata || (p.kind !== 'json' && p.kind !== 'html')) continue;
      const seed = seedProfile(p.iata);
      observed.set(p.iata, {
        ...seed,
        ...p,
        kind: seed.kind === 'json' ? 'json' : p.kind,
      });
    }
  } catch {
    /* soft */
  }
}
