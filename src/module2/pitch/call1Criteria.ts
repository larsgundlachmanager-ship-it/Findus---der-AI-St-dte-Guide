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

/** Fallback wenn Call 1 nur mustHaves liefert. Atmosphäre = nice, nie Wipe. */
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
    let atmosphere = false;
    try {
      const { isAtmosphereVibeLabel } = require('./searchBrief') as {
        isAtmosphereVibeLabel: (s: string) => boolean;
      };
      atmosphere = isAtmosphereVibeLabel(key) || isAtmosphereVibeLabel(rawKey);
    } catch {
      atmosphere =
        /terrasse|terrace|aussicht|view|ambiente|flair|ruhig|quiet|gemütlich|gemuetlich/i.test(
          key,
        );
    }
    const role: Call1CriterionRole = atmosphere ? 'nice' : 'must';
    out.push({
      key,
      role,
      weight: ROLE_DEFAULT_WEIGHT[role],
    });
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
  if (isMetaCriterionKey(k)) return true;
  if (isNegativeCriterion(k)) return true;
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

/**
 * Call-1 Meta-Keys (location_hamburg, day_friday, …) — nie Hard-Match-Text.
 */
export function isMetaCriterionKey(key: string): boolean {
  const k = String(key || '').replace(/\s+/g, ' ').trim();
  if (!k) return true;
  if (/^(location|day|date|time|city|when|where|weekday)[_:]/i.test(k)) {
    return true;
  }
  if (
    /^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
      k,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Ablehnung als Must („kein Asiatisch“, avoid_amenity_disco) — nie positiv matchen.
 * Alias: isNegativeCuisineCriterion (historisch; gilt für alle Domains).
 */
export function isNegativeCriterion(key: string): boolean {
  const k = String(key || '').replace(/\s+/g, ' ').trim();
  if (!k) return false;
  if (/cuisine_not_/i.test(k) || /_not_/i.test(k)) return true;
  if (/^(not_|avoid_|ohne_)/i.test(k)) return true;
  if (
    /^kein[e]?n?\s+/iu.test(k) ||
    /^nicht\s+/iu.test(k) ||
    /^ohne\s+/iu.test(k) ||
    /^keine\s+lust\s+auf\s+/iu.test(k)
  ) {
    return true;
  }
  return false;
}

/** @deprecated Alias — nutze isNegativeCriterion */
export function isNegativeCuisineCriterion(key: string): boolean {
  return isNegativeCriterion(key);
}

const ASIA_AVOID = [
  'asiatisch',
  'asian',
  'sushi',
  'thai',
  'chinesisch',
  'japanisch',
  'vietnamesisch',
  'koreanisch',
  'indisch',
  'ramen',
  'dim sum',
  'hotpot',
  'poke',
] as const;

/** Negative Call-1-Keys → Avoid-Tokens für prefs.avoidCategories. */
export function avoidTokensFromNegativeCriterion(key: string): string[] {
  const k = String(key || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!k || !isNegativeCriterion(k)) return [];
  const asia =
    /asia|asiatisch|sushi|thai|chines|japan|vietnam|korea|indisch|ramen|poke|hot.?pot|dim.?sum/.test(
      k,
    ) || /cuisine_not_asian|avoid_cuisine_asian/.test(k);
  if (asia) return [...ASIA_AVOID];

  if (/fleisch|meat|steak/.test(k)) {
    return ['fleisch', 'steak', 'fleischerei'];
  }
  if (/disco|nightclub|club\b|techno/.test(k) || /avoid_amenity_disco/.test(k)) {
    return ['disco', 'nightclub', 'club', 'techno'];
  }
  if (/museum/.test(k) || /avoid_amenity_museum/.test(k)) {
    return ['museum'];
  }
  if (/laut|loud|party|avoid_vibe_loud/.test(k)) {
    return ['laut', 'loud', 'party', 'disco'];
  }
  if (/kinderwagen|stroller|buggy/.test(k)) {
    return ['kinderwagen', 'stroller'];
  }

  // avoid_cuisine_X / avoid_amenity_X / avoid_vibe_X
  const structured = k.match(/^avoid_(?:cuisine|amenity|vibe|diet)_([a-zäöüß0-9]+)/iu);
  if (structured?.[1] && structured[1].length >= 3) {
    return [structured[1]];
  }

  const m = k.match(
    /(?:kein[e]?n?|nicht|ohne|not_|avoid_|cuisine_not_|keine\s+lust\s+auf)\s*([a-zäöüß]+)/iu,
  );
  if (m?.[1] && m[1].length >= 3) return [m[1]];
  return [];
}

/**
 * „kein X“ / „keine Lust auf X“ aus User-Text — Backup wenn Call-1 den Key vergisst.
 * Domain-Liste klein (cuisine/vibe/amenity/diet), kein offenes NLP.
 */
export function negativesFromUserText(userText: string): string[] {
  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  const neg =
    /\b(?:keine\s+lust\s+auf|mag\s+ich\s+(?:kein[e]?n?|nicht)|nicht\s+mehr|kein[e]?n?|nicht|ohne)\s+([a-zäöüß]{3,})/giu;
  let m: RegExpExecArray | null;
  while ((m = neg.exec(t))) {
    const token = (m[1] || '').toLowerCase();
    if (!token) continue;
    if (/^(mehr|mal|so|ganz|richtig|wirklich|lust)$/i.test(token)) continue;
    if (/asia|asiatisch/.test(token)) {
      out.push(...ASIA_AVOID);
      continue;
    }
    if (/fleisch|meat/.test(token)) {
      out.push('fleisch', 'steak', 'fleischerei');
      continue;
    }
    if (/disco|club|techno/.test(token)) {
      out.push('disco', 'nightclub', 'club');
      continue;
    }
    if (/museum/.test(token)) {
      out.push('museum');
      continue;
    }
    if (/laut|party/.test(token)) {
      out.push('laut', 'loud', 'party');
      continue;
    }
    out.push(token);
  }
  // Explizite Asia-/Fleisch-Muster (auch zusammengesetzt)
  if (
    /\bkein[e]?n?\s+asiatisch\b|\bnicht\s+asiatisch\b|\bohne\s+asiatisch\b|\bno\s+asian\b|\bkeine\s+lust\s+auf\s+asiatisch\b/iu.test(
      t,
    )
  ) {
    out.push(...ASIA_AVOID);
  }
  if (/\bkein[e]?n?\s+fleisch\b/iu.test(t)) {
    out.push('fleisch', 'steak', 'fleischerei');
  }
  return [...new Set(out)];
}

/** @deprecated Alias — nutze negativesFromUserText */
export function negativeCuisineAvoidFromUserText(userText: string): string[] {
  return negativesFromUserText(userText);
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
  let cleaned = key
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:am\s+)?beste[rnsm]?\s+/iu, '')
    .replace(/^(?:den|die|das|der|dem)\s+/iu, '')
    .trim();
  if (!cleaned) cleaned = key.trim();
  const aliases = criterionAliasKeys(cleaned);
  if (aliases.includes('wlan')) return 'wlan';
  if (aliases.includes('steckdose')) return 'steckdose';
  if (aliases.includes('ruhig')) return 'ruhig';
  if (/terrasse|terrace/i.test(cleaned)) return 'terrasse';
  if (/aussicht|ausblick|panorama|\bview\b/i.test(cleaned)) return 'aussicht';
  if (/live[\s_-]?musik|live[\s_-]?music/i.test(cleaned)) return 'live_music';
  if (/ambiente|flair/i.test(cleaned)) return 'ambiente';
  return cleaned.slice(0, 48);
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
    // Abend-Label ohne Uhr → 19:00; Essen ohne Uhr ebenfalls Abend-Default
    const label = String(day?.label || clock?.label || '').toLowerCase();
    const hour = /\babend|dinner|tonight|essen\b/.test(label)
      ? 19
      : /\bmittag\b/.test(label)
        ? 12
        : /\bfr[uü]h\b/.test(label)
          ? 9
          : 19;
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
