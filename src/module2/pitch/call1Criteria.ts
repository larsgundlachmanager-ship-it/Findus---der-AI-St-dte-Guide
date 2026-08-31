/**
 * Call-1 Such-Auftrag: Kriterien + Gewichte (keine Venue-Scores).
 * Backend rankt damit; Call 1 erfindet keine Restaurant-Punkte.
 */

export type Call1CriterionRole = 'must' | 'nice' | 'soft';

export type Call1Criterion = {
  /** terrasse | steak | naehe_gps | abend_offen | … — nie Ortsname */
  key: string;
  role: Call1CriterionRole;
  /** Relative Wichtigkeit 1–30 (Call 1 setzt, Code rechnet) */
  weight: number;
};

const ROLE_DEFAULT_WEIGHT: Record<Call1CriterionRole, number> = {
  must: 20,
  nice: 12,
  soft: 8,
};

function asRole(raw: unknown): Call1CriterionRole {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'nice' || s === 'soft') return s;
  return 'must';
}

function clampWeight(n: number, role: Call1CriterionRole): number {
  if (!Number.isFinite(n)) return ROLE_DEFAULT_WEIGHT[role];
  return Math.min(30, Math.max(1, Math.round(n)));
}

/** Venue-/Ort-Keys ablehnen — Call 1 darf nur Kriterien. */
export function looksLikeVenueCriterionKey(key: string): boolean {
  const k = key.replace(/\s+/g, ' ').trim();
  if (k.length < 2) return true;
  // Eigennamen mit Großbuchstaben-Mix + Restaurant/Hotel-Hinweis
  if (
    /\b(restaurant|café|cafe|hotel|bar|imbiss|pizzeria|steakhouse)\b/i.test(k) &&
    /[A-ZÄÖÜ][a-zäöü]{2,}/.test(k) &&
    k.split(/\s+/).length >= 2
  ) {
    return true;
  }
  // typische Venue-Muster
  if (/^(zum|zur|hotel|gasthof)\s+/i.test(k)) return true;
  return false;
}

export function parseCall1Criteria(raw: unknown): Call1Criterion[] {
  if (!Array.isArray(raw)) return [];
  const out: Call1Criterion[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const rawKey = String(o.key ?? o.id ?? o.label ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    if (!rawKey || rawKey.length < 2) continue;
    if (looksLikeVenueCriterionKey(rawKey)) continue;
    const key = normalizeAmenityCriterionKey(rawKey);
    const role = asRole(o.role ?? o.hardness);
    const weight = clampWeight(Number(o.weight ?? o.points ?? o.score), role);
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ key, role, weight });
    if (out.length >= 8) break;
  }
  return out;
}

/** Fallback wenn Call 1 nur mustHaves liefert. */
export function criteriaFromMustHaves(
  mustHaves: string[] | null | undefined,
): Call1Criterion[] {
  const out: Call1Criterion[] = [];
  const seen = new Set<string>();
  for (const raw of mustHaves ?? []) {
    const rawKey = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    if (!rawKey || rawKey.length < 2) continue;
    if (looksLikeVenueCriterionKey(rawKey)) continue;
    const key = normalizeAmenityCriterionKey(rawKey);
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ key, role: 'must', weight: ROLE_DEFAULT_WEIGHT.must });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Merge: explizite criteria gewinnen; fehlende mustHaves als must/20 nachziehen.
 */
export function mergeCall1Criteria(opts: {
  criteria?: Call1Criterion[] | null;
  mustHaves?: string[] | null;
}): Call1Criterion[] {
  const primary = opts.criteria?.length
    ? opts.criteria
    : criteriaFromMustHaves(opts.mustHaves);
  if (!primary.length) return [];
  const keys = new Set(primary.map((c) => c.key.toLowerCase()));
  const extra = criteriaFromMustHaves(opts.mustHaves).filter(
    (c) => !keys.has(c.key.toLowerCase()),
  );
  return [...primary, ...extra].slice(0, 8);
}

export function criteriaToMustHaveLabels(
  criteria: Call1Criterion[],
): string[] {
  return criteria
    .filter((c) => c.role === 'must')
    .map((c) => c.key)
    .slice(0, 8);
}

/** Soft/proximity/open/time Keys — nicht als Hard-Match-Dish. */
export function isStructuralCriterionKey(key: string): boolean {
  const k = String(key || '').replace(/\s+/g, ' ').trim();
  if (!k) return true;
  if (
    /^(heute|morgen|tonight|abend|evening|dinner|mittag|lunch|now|jetzt)$/i.test(
      k,
    )
  ) {
    return true;
  }
  return /\b(naehe|nähe|nahe|gps|anker|proximity|fuss|fu[sß]|spaziergang|walk|distanz|offen|open|abend_offen|besuchszeit|heute\s*abend|heute\s*mittag|tonight|this\s*evening|abendessen|dinner\s*time|besuch\s*um)\b/i.test(
    k,
  );
}

/** wifi/WLAN/Steckdose-Aliasse → kanonische Soft-Tags für Ranking. */
export function criterionAliasKeys(key: string): string[] {
  const k = key.toLowerCase().trim();
  if (!k) return [];
  if (/\b(wlan|wifi|wi-?fi|internet)\b/.test(k) || /^(wlan|wifi|internet)$/.test(k)) {
    return ['wlan', 'wifi', 'internet'];
  }
  if (
    /\b(steckdose|socket|power_outlet|strom)\b/.test(k) ||
    /^(steckdose|socket|power_outlet)$/.test(k)
  ) {
    return ['steckdose', 'socket', 'outlet', 'power_outlet'];
  }
  if (/\b(ruhig|quiet|ruhe)\b/.test(k) || /^(ruhig|quiet)$/.test(k)) {
    return ['ruhig', 'quiet'];
  }
  return [k];
}

/** Call-1-Keys auf Pack-Facetten normalisieren (wifi→wlan). */
export function normalizeAmenityCriterionKey(key: string): string {
  const aliases = criterionAliasKeys(key);
  if (aliases.includes('wlan')) return 'wlan';
  if (aliases.includes('steckdose')) return 'steckdose';
  if (aliases.includes('ruhig')) return 'ruhig';
  return key.trim().slice(0, 48);
}

/**
 * visitAtMs aus Call-1 when-Slots (dateKey + at). Null wenn unbrauchbar.
 */
export function visitAtMsFromCall1When(
  when:
    | Array<{
        kind?: string;
        at?: string | null;
        dateKey?: string | null;
        label?: string | null;
      }>
    | null
    | undefined,
  nowMs = Date.now(),
): number | null {
  if (!when?.length) return null;
  const clock = when.find((w) => w.at && /^\d{1,2}:\d{2}$/.test(String(w.at)));
  const day = when.find((w) => w.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(String(w.dateKey)));
  const at = clock?.at ? String(clock.at) : null;
  const dateKey = day?.dateKey
    ? String(day.dateKey)
    : clock?.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(String(clock.dateKey))
      ? String(clock.dateKey)
      : null;

  if (at && dateKey) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    const [h, m] = at.split(':').map(Number);
    const ms = new Date(y!, mo! - 1, d!, h!, m!, 0, 0).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (at) {
    const [h, m] = at.split(':').map(Number);
    const d = new Date(nowMs);
    d.setHours(h!, m!, 0, 0);
    if (d.getTime() < nowMs - 60_000) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (dateKey) {
    const [y, mo, d] = dateKey.split('-').map(Number);
    // Abend-Label ohne Uhr → 19:00
    const label = String(day?.label || clock?.label || '').toLowerCase();
    const hour = /\babend|dinner|tonight\b/.test(label)
      ? 19
      : /\bmittag\b/.test(label)
        ? 12
        : /\bfr[uü]h\b/.test(label)
          ? 9
          : 12;
    return new Date(y!, mo! - 1, d!, hour, 0, 0, 0).getTime();
  }
  // nur „Abend“ / now
  const soft = when.find((w) => w.kind === 'now' || /abend|dinner/i.test(String(w.label || '')));
  if (soft && /abend|dinner/i.test(String(soft.label || ''))) {
    const d = new Date(nowMs);
    d.setHours(19, 0, 0, 0);
    if (d.getTime() < nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}

/** Prompt-Block für Call 2 / Pitch — verbindlicher Auftrag. */
export function formatCall1CriteriaForPrompt(
  criteria: Call1Criterion[],
): string {
  if (!criteria.length) return '';
  return [
    '=== CALL1_CRITERIA (Ranking-Gewichte — keine Venue-Namen) ===',
    ...criteria.map(
      (c) => `- ${c.key}: role=${c.role} weight=${c.weight}`,
    ),
    'Backend filtert/rankt nur danach. Call 2 erfindet keine Orte.',
    'Shortlist: Top-5 → Speak Top-2.',
  ].join('\n');
}
