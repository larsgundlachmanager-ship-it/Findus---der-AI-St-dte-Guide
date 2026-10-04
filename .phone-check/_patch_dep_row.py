from pathlib import Path

p = Path(r"src/services/homeMap/mapPlaceLiveActions.ts")
t = p.read_text(encoding="utf-8")
old_start = "/** Stichpunkte: Linie+Ziel, dann alle Uhrzeiten in einer Zeile mit Uhr. */"
old_end = "/** Speech nur für die nächste Abfahrt — eine flüssige Ansage. */"
i = t.find(old_start)
j = t.find(old_end)
if i < 0 or j < 0:
    raise SystemExit(f"block missing {i=} {j=}")
new = '''/** Stichpunkte: eine Zeile pro Abfahrt — Linie → Ziel  🕐 Uhrzeit. */
export function departureBulletsCompact(
  rows: Array<{
    line: string;
    direction: string;
    when: Date;
    plannedWhen?: Date | null;
    delaySec: number | null;
    cancelled: boolean;
  }>,
): string[] {
  const out: string[] = [];
  for (const d of rows) {
    const dest = (d.direction || '').trim();
    const head = dest ? `${d.line} → ${dest}` : d.line;
    if (d.cancelled) {
      out.push(`${head}  fällt aus`);
      continue;
    }
    const liveT = clock(d.when);
    const planned = d.plannedWhen instanceof Date ? d.plannedWhen : null;
    const delayed =
      (d.delaySec != null && d.delaySec >= 60) ||
      (planned != null &&
        Math.abs(d.when.getTime() - planned.getTime()) >= 60_000);
    if (delayed && planned) {
      const planStruck = [...clock(planned)]
        .map((ch) => `${ch}\\u0336`)
        .join('');
      out.push(`${head}  🕐 ${planStruck} → ${liveT}`);
    } else {
      out.push(`${head}  🕐 ${liveT}`);
    }
  }
  return out.slice(0, 3);
}

'''
# Fix unicode escape for JS file
new = new.replace('\\\\u0336', '\\u0336')
p.write_text(t[:i] + new + t[j:], encoding='utf-8')
print('ok live actions')

s = Path(r"src/services/homeMap/mapPlaceLiveActions.smoke.test.ts")
st = s.read_text(encoding='utf-8')
old = '''{
  const { departureBulletsCompact } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const compact = departureBulletsCompact([
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 48, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 48, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 11, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 11, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
  ]);
  assert(compact.length === 2, 'Abfahrten: Ziel + Zeitenzeile');
  assert(/nach Pinneberg/.test(compact[0]!), 'Ziel Pinneberg in Stichpunkt');
  assert(/🕐/.test(compact[1]!), 'Uhr-Symbol in Zeitenzeile');
  assert(/10:18 · 10:48 · 11:18/.test(compact[1]!), 'Zeiten in einer Reihe');
  assert(!compact.some((b) => b.split('\\n').length > 1), 'keine Mehrzeilen-Bullets');
}'''
new_smoke = '''{
  const { departureBulletsCompact } = require('./mapPlaceLiveActions') as typeof import('./mapPlaceLiveActions');
  const compact = departureBulletsCompact([
    {
      line: 'RB 61',
      direction: 'Pinneberg',
      when: new Date(2026, 8, 3, 10, 18, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 18, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 71',
      direction: 'Wrist',
      when: new Date(2026, 8, 3, 10, 22, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 22, 0),
      delaySec: 0,
      cancelled: false,
    },
    {
      line: 'RB 61',
      direction: 'Hamburg Altona',
      when: new Date(2026, 8, 3, 10, 28, 0),
      plannedWhen: new Date(2026, 8, 3, 10, 28, 0),
      delaySec: 0,
      cancelled: false,
    },
  ]);
  assert(compact.length === 3, 'Abfahrten: eine Zeile pro Verbindung');
  assert(compact[0] === 'RB 61 → Pinneberg  🕐 10:18', `Zeile1: ${compact[0]}`);
  assert(compact[1] === 'RB 71 → Wrist  🕐 10:22', `Zeile2: ${compact[1]}`);
  assert(compact[2] === 'RB 61 → Hamburg Altona  🕐 10:28', `Zeile3: ${compact[2]}`);
}'''
if old not in st:
    raise SystemExit('smoke block missing')
s.write_text(st.replace(old, new_smoke, 1), encoding='utf-8')
print('ok smoke')
