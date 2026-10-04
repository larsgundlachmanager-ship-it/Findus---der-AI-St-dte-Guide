/**
 * Call-1 Referenten — Anaphora/Follow-up Entities (validiert gegen Verlauf).
 */

export type Call1ReferentRole =
  | 'place'
  | 'water'
  | 'venue'
  | 'flight'
  | 'event'
  | 'person';

export type Call1Referent = {
  role: Call1ReferentRole;
  name: string;
  from: 'utterance' | 'prior';
};

const ROLES: Call1ReferentRole[] = [
  'place',
  'water',
  'venue',
  'flight',
  'event',
  'person',
];

function asRole(v: unknown): Call1ReferentRole | null {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  return ROLES.includes(s as Call1ReferentRole)
    ? (s as Call1ReferentRole)
    : null;
}

export function parseCall1Referents(raw: unknown): Call1Referent[] {
  if (!Array.isArray(raw)) return [];
  const out: Call1Referent[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const role = asRole(o.role ?? o.kind ?? o.type);
    const name = String(o.name || o.label || o.entity || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64);
    if (!role || name.length < 2) continue;
    const fromRaw = String(o.from || o.source || 'prior')
      .trim()
      .toLowerCase();
    const from: 'utterance' | 'prior' =
      fromRaw === 'utterance' || fromRaw === 'this' ? 'utterance' : 'prior';
    const key = `${role}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, name, from });
    if (out.length >= 4) break;
  }
  return out;
}

/** Name muss im aktuellen Satz oder in recent Turns vorkommen — nichts erfinden. */
export function validateCall1Referents(
  refs: Call1Referent[],
  opts: {
    userText: string;
    recentTexts?: string[];
  },
): Call1Referent[] {
  if (!refs.length) return [];
  const hay = [
    opts.userText || '',
    ...(opts.recentTexts ?? []),
  ]
    .join('\n')
    .toLowerCase();
  const out: Call1Referent[] = [];
  for (const r of refs) {
    const n = r.name.toLowerCase();
    if (n.length < 2) continue;
    // Teilwort ok (Alster in Außenalster)
    if (!hay.includes(n)) continue;
    out.push(r);
  }
  return out.slice(0, 4);
}

export function formatCall1ReferentsForPrompt(
  refs: Call1Referent[] | null | undefined,
): string {
  if (!refs?.length) return '';
  return [
    '=== CALL1_REFERENTS (Bezug — nicht neu raten) ===',
    ...refs.map((r) => `- ${r.role}: ${r.name} (from=${r.from})`),
    'Follow-up bezieht sich auf diese Entities. Call 2 / Agents: denselben Bezug halten.',
  ].join('\n');
}

/**
 * Wenn LLM keine Referenten liefert: aus Follow-up-Regex ableiten (Backup).
 */
export function referentsFromFollowupBackup(
  userText: string,
  recent: Array<{ role: 'user' | 'assistant'; text: string }>,
): Call1Referent[] {
  try {
    const { resolveFollowupThread } = require('../reboot/pipeline/followupThread') as {
      resolveFollowupThread: (
        t: string,
        r: Array<{ role: 'user' | 'assistant'; text: string }>,
      ) => { thread: string; inherit: string };
    };
    const d = resolveFollowupThread(userText, recent);
    if (d.thread === 'new' || d.inherit === 'none') return [];
    const blob = recent
      .slice(-4)
      .map((x) => x.text)
      .join(' ');
    if (d.inherit === 'water_activity') {
      const m = blob.match(
        /\b(alster|außenalster|aussenalster|innenalster|elbe|see|meer|hafen|bucht|weiher|fluss|teich|lagune)\b/iu,
      );
      if (m?.[1]) {
        return [{ role: 'water', name: m[1], from: 'prior' }];
      }
    }
    if (d.inherit === 'flight') {
      return [{ role: 'flight', name: 'flight', from: 'prior' }];
    }
    if (d.inherit === 'price' || d.inherit === 'fork') {
      // Venue aus letzter Assistant-Zeile — nur wenn klarer Eigenname-artig
      const lastA = [...recent].reverse().find((x) => x.role === 'assistant')?.text || '';
      const venue = lastA.match(
        /\b([A-ZÄÖÜ][\wÄÖÜäöüß'-]{2,}(?:\s+[A-ZÄÖÜa-zäöüß'-]{2,}){0,3})\b/,
      );
      if (venue?.[1] && venue[1].length >= 3) {
        return [{ role: 'venue', name: venue[1].slice(0, 48), from: 'prior' }];
      }
    }
  } catch {
    /* soft */
  }
  return [];
}
