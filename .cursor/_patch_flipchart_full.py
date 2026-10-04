from pathlib import Path
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- flipchartNotes.ts ---
p = ROOT / "src/reisebuero/flipchartNotes.ts"
t = p.read_text(encoding="utf-8")

# whirlpool emoji
if "whirl" not in t:
    t = t.replace(
        "  if (/pool|schwimmen|baden/.test(t)) return '🏊';",
        "  if (/whirl|jacuzzi|whirlpool/.test(t)) return '♨️';\n  if (/pool|schwimmen|baden/.test(t)) return '🏊';",
    )

# Change buildFlipchartNotes signature and add question + coverage
old_sig = "export function buildFlipchartNotes(ledger: ReiseLedger): FlipchartNote[] {\n  const notes: FlipchartNote[] = [];\n\n  pushWhenNotes(notes, ledger);"
new_sig = """export type FlipchartBuildOpts = {
  /** Offene Briefing-Frage — immer als Sticker + Board-Header. */
  openQuestion?: string | null;
  /** Letzte User-Antwort als Sticker, falls noch kein Slot greift. */
  lastUserLine?: string | null;
};

export function buildFlipchartNotes(
  ledger: ReiseLedger,
  opts?: FlipchartBuildOpts,
): FlipchartNote[] {
  const notes: FlipchartNote[] = [];

  const q = (opts?.openQuestion || '').replace(/\\s+/g, ' ').trim();
  if (q) {
    notes.push({
      id: 'openQ',
      tier: 'high',
      emoji: '❓',
      label: compactNoteLabel(q.replace(/\\?+$/, '') + '?', 36),
      hint: 'Offene Frage',
    });
  }

  pushWhenNotes(notes, ledger);"""

if old_sig not in t:
    raise SystemExit("sig missing")
t = t.replace(old_sig, new_sig, 1)

# locationBias catch-all
old_bias = """  if (ledger.locationBias?.source === 'user') {
    const b = ledger.locationBias.value;
    if (b === 'cheap_central') notes.push({ id: 'bias', tier: 'wish', emoji: '🏙️', label: 'zentral' });
    if (b === 'quiet_outskirts') notes.push({ id: 'bias', tier: 'wish', emoji: '🤫', label: 'ruhig' });
    if (b === 'near_activity') notes.push({ id: 'bias', tier: 'wish', emoji: '🚶', label: 'fußläufig' });
  }
"""
new_bias = """  if (ledger.locationBias?.source === 'user') {
    const b = ledger.locationBias.value;
    if (b === 'cheap_central') notes.push({ id: 'bias', tier: 'wish', emoji: '🏙️', label: 'zentral' });
    else if (b === 'quiet_outskirts') notes.push({ id: 'bias', tier: 'wish', emoji: '🤫', label: 'ruhig' });
    else if (b === 'near_activity') notes.push({ id: 'bias', tier: 'wish', emoji: '🚶', label: 'fußläufig' });
    else notes.push({ id: 'bias', tier: 'wish', emoji: '📍', label: `Lage: ${String(b)}`.slice(0, 28) });
  }
"""
if old_bias not in t:
    raise SystemExit("bias missing")
t = t.replace(old_bias, new_bias, 1)

# Before sort, add coverage + last user line
old_end = """  const order: Record<NoteTier, number> = { critical: 0, high: 1, wish: 2, optional: 3, nope: 4 };
  notes.sort((a, b) => order[a.tier] - order[b.tier]);
  return notes;
}
"""
new_end = """  // Freitext-Wünsche / Highlight immer sichtbar
  if (
    ledger.extraWishes?.source === 'user' &&
    ledger.extraWishes.value &&
    !looksLikeGarbageFact(ledger.extraWishes.value) &&
    !notes.some((n) => n.id === 'extra' || n.label === compactNoteLabel(ledger.extraWishes!.value, 30))
  ) {
    notes.push({
      id: 'extra',
      tier: ledger.extraWishes.hardness === 'optional' ? 'optional' : 'wish',
      emoji: emojiForWishText(ledger.extraWishes.value, '✨'),
      label: compactNoteLabel(ledger.extraWishes.value, 30),
      hint: 'Wunsch',
    });
  }

  // Letzte User-Antwort anpinnen, wenn noch kein frischer Sticker dazu
  const last = (opts?.lastUserLine || '').replace(/\\s+/g, ' ').trim();
  if (
    last.length >= 4 &&
    last.length <= 80 &&
    !looksLikeGarbageFact(last) &&
    !/^\\?/u.test(last) &&
    !/\\b(was\\s+war\\s+die\\s+frage)\\b/iu.test(last)
  ) {
    const compact = compactNoteLabel(last, 32);
    const already = notes.some(
      (n) =>
        n.id === 'openQ' ||
        n.label.toLowerCase() === compact.toLowerCase() ||
        (compact.length >= 8 && n.label.toLowerCase().includes(compact.toLowerCase().slice(0, 10))),
    );
    if (!already) {
      notes.push({
        id: 'lastAns',
        tier: 'wish',
        emoji: emojiForWishText(last, '📌'),
        label: compact,
        hint: 'Gerade gesagt',
      });
    }
  }

  // Coverage: alle restlichen User-Slots, die noch keinen Sticker haben
  appendMissingUserSlots(notes, ledger);

  const order: Record<NoteTier, number> = { critical: 0, high: 1, wish: 2, optional: 3, nope: 4 };
  // Offene Frage oben halten
  notes.sort((a, b) => {
    if (a.id === 'openQ') return -1;
    if (b.id === 'openQ') return 1;
    return order[a.tier] - order[b.tier];
  });
  return notes;
}

const SKIP_COVERAGE_KEYS = new Set([
  'originLat',
  'originLng',
  'recapDone',
  'searchReady',
  'intentNotes',
  'mustHaves',
  'wishHaves',
  'niceHaves',
  'hardNos',
  'mustActivities',
]);

function formatSlotValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || looksLikeGarbageFact(s)) return null;
    return compactNoteLabel(s, 30);
  }
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (typeof v[0] === 'number') return v.map(String).join('/');
    if (typeof v[0] === 'string') return compactNoteLabel(v.filter(Boolean).join(', '), 30);
    return null;
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      if (s.length > 2 && s.length < 40) return compactNoteLabel(s, 28);
    } catch {
      /* soft */
    }
  }
  return null;
}

function appendMissingUserSlots(notes: FlipchartNote[], ledger: ReiseLedger): void {
  const have = new Set(notes.map((n) => n.id));
  const L = ledger as unknown as Record<string, { value?: unknown; source?: string; hardness?: string } | null>;
  for (const [key, entry] of Object.entries(L)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.source !== 'user' && entry.source !== 'profile') continue;
    if (SKIP_COVERAGE_KEYS.has(key)) continue;
    if (have.has(key) || have.has(`cov:${key}`)) continue;
    // schon durch speziellen Sticker abgedeckt?
    const aliases: Record<string, string[]> = {
      adults: ['people'],
      children: ['kids'],
      budgetEur: ['budget'],
      budgetVibe: ['budgetVibe'],
      originCity: ['origin'],
      originCities: ['origins'],
      destinationHint: ['dest'],
      corridor: ['dest'],
      lodgingKind: ['lodging'],
      lodgingFallback: ['lodging'],
      lodgingOpen: ['lodging'],
      locationBias: ['bias'],
      highlightWant: ['wantH'],
      lastHighlight: ['lastH'],
      dealbreaker: ['nogo'],
      extraWishes: ['extra'],
      purpose: ['purpose'],
      meals: ['meals'],
      weatherWant: ['weather'],
      travelerAges: ['ages'],
      bahncard: ['bahncard'],
      partyStyle: ['party'],
      directFlight: ['directFlight'],
      maxDriveHours: ['drive'],
      departAfterHour: ['window'],
      arriveBeforeHour: ['window'],
    };
    const aliasHit = (aliases[key] || []).some((a) => have.has(a) || [...have].some((id) => id.startsWith(a)));
    if (aliasHit) continue;
    // must/wish ids already as must:pool etc.
    if (key === 'mode' && have.has('mode')) continue;
    const label = formatSlotValue(entry.value);
    if (!label) continue;
    const soft = entry.hardness === 'optional' || entry.hardness === 'wish';
    notes.push({
      id: `cov:${key}`,
      tier: soft ? 'optional' : 'wish',
      emoji: emojiForWishText(label, '📌'),
      label: key === 'directFlight' && entry.value === true ? 'Direktflug' : label,
      hint: 'Brief',
    });
    have.add(`cov:${key}`);
  }
}
"""

if old_end not in t:
    raise SystemExit("end missing")
t = t.replace(old_end, new_end, 1)

# Fix party sticker collision - partyStyle uses id party:0 maybe - check
# extraWishes might already exist - grep
if "id: 'extra'" in t[: t.find("appendMissingUserSlots")]:
    # might duplicate - the new block checks !notes.some id === 'extra'
    pass

p.write_text(t, encoding="utf-8")
print("flipchartNotes patched", len(t))

# --- Modal ---
p = ROOT / "src/components/ReisebueroModal.tsx"
t = p.read_text(encoding="utf-8")
old = """  const notes = useMemo(() => buildFlipchartNotes(trip.ledger), [trip.ledger]);
  const questionHint = trip.questionHint;
"""
new = """  const questionHint = trip.questionHint;
  const lastUserLine = useMemo(() => {
    for (let i = trip.chat.length - 1; i >= 0; i -= 1) {
      if (trip.chat[i]?.role === 'user') return trip.chat[i]!.text;
    }
    return '';
  }, [trip.chat]);
  const openQuestion = useMemo(() => {
    const q = (questionHint || '').trim();
    if (q) return q;
    for (let i = trip.chat.length - 1; i >= 0; i -= 1) {
      const c = trip.chat[i];
      if (c?.role === 'assistant' && /\\?\\s*$/.test(c.text.trim())) {
        const parts = c.text.trim().split(/(?<=[.!])\\s+/);
        return parts[parts.length - 1] || c.text.trim();
      }
    }
    return 'Was soll noch aufs Board?';
  }, [questionHint, trip.chat]);
  const notes = useMemo(
    () =>
      buildFlipchartNotes(trip.ledger, {
        openQuestion: trip.phase === 'recap' ? 'Passt das so?' : openQuestion,
        lastUserLine,
      }),
    [trip.ledger, trip.phase, openQuestion, lastUserLine],
  );
"""
if old not in t:
    raise SystemExit("modal notes missing")
t = t.replace(old, new, 1)
t = t.replace(
    "question={isRecap ? 'Passt das so?' : questionHint}",
    "question={isRecap ? 'Passt das so?' : openQuestion}",
)
# preview flipchart in shelf too if exists
t = t.replace(
    "const preview = buildFlipchartNotes(t.ledger).slice(0, 6);",
    "const preview = buildFlipchartNotes(t.ledger, { openQuestion: t.questionHint }).slice(0, 6);",
)
p.write_text(t, encoding="utf-8")
print("modal ok")
