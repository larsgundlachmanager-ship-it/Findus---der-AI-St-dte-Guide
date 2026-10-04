/**
 * Persönliche Pack-Prefs → LearnedRule-Tags + Packlisten-Filter.
 * Struktur: pack_avoid:<canon> / pack_prefer:<canon> — kein Wortlaut-Skript.
 */

import type { PackListItem } from '../../store/usePackListStore';
import type { LearnedRule } from '../../types/learnedRules';

export type PackGarmentCanon =
  | 'pulli'
  | 'anzug'
  | 'krawatte'
  | 'regenjacke'
  | 'regenschirm'
  | 'sonnenbrille'
  | 'cap'
  | 'shorts'
  | 'sandalen'
  | 'powerbank'
  | 'bademantel'
  | 'formelle_schuhe';

export type PackListPrefs = {
  avoid: PackGarmentCanon[];
  prefer: PackGarmentCanon[];
  /** Menschenlesbare Evidenz für Notes */
  notes: string[];
};

type GarmentDef = {
  canon: PackGarmentCanon;
  /** Erkennung im User-Text */
  mention: RegExp;
  /** Match gegen Item-Label */
  label: RegExp;
  /** Anzeige für Prefer-Item */
  preferLabel: string;
};

const GARMENTS: GarmentDef[] = [
  {
    canon: 'pulli',
    mention: /\b(pullis?|pullover|sweater|strickjacke|strickware|hoodie|kapuzenpulli)\b/iu,
    label: /pulli|pullover|sweater|strick|hoodie|kapuze/i,
    preferLabel: 'Pulli / Hoodie',
  },
  {
    canon: 'anzug',
    mention: /\b(anzug|sakko|blazer)\b/iu,
    label: /anzug|sakko|blazer|formelle?\s+kleidung/i,
    preferLabel: 'Anzug / formelle Kleidung',
  },
  {
    canon: 'krawatte',
    mention: /\b(krawatte|schlips)\b/iu,
    label: /krawatte|schlips/i,
    preferLabel: 'Krawatte',
  },
  {
    canon: 'regenjacke',
    mention: /\b(regenjacke|regenmantel|hardshell)\b/iu,
    label: /regenjacke|regenmantel|hardshell/i,
    preferLabel: 'Regenjacke',
  },
  {
    canon: 'regenschirm',
    mention: /\b(regenschirm|schirm)\b/iu,
    label: /regenschirm/i,
    preferLabel: 'Regenschirm',
  },
  {
    canon: 'sonnenbrille',
    mention: /\b(sonnenbrille)\b/iu,
    label: /sonnenbrille/i,
    preferLabel: 'Sonnenbrille',
  },
  {
    canon: 'cap',
    mention: /\b(cap|kappe|mütze|muetze|baseballkappe)\b/iu,
    label: /cap|kappe|mütze|muetze|kopfbedeckung/i,
    preferLabel: 'Cap / Kopfbedeckung',
  },
  {
    canon: 'shorts',
    mention: /\b(shorts|kurze\s+hose|kurzen\s+hosen)\b/iu,
    label: /kurze\s+hose|shorts/i,
    preferLabel: 'Kurze Hose',
  },
  {
    canon: 'sandalen',
    mention: /\b(sandalen|flip.?flops?|schlappen)\b/iu,
    label: /sandalen|flip.?flop|schlappen/i,
    preferLabel: 'Sandalen / Flip-Flops',
  },
  {
    canon: 'powerbank',
    mention: /\b(powerbank|akku.?pack)\b/iu,
    label: /powerbank/i,
    preferLabel: 'Powerbank',
  },
  {
    canon: 'bademantel',
    mention: /\b(bademantel)\b/iu,
    label: /bademantel/i,
    preferLabel: 'Bademantel',
  },
  {
    canon: 'formelle_schuhe',
    mention: /\b(formelle\s+schuhe|anzugschuhe|lederschuhe)\b/iu,
    label: /formelle\s+schuhe|anzugschuhe/i,
    preferLabel: 'Formelle Schuhe',
  },
];

const AVOID_TAG = /^pack_avoid:(.+)$/i;
const PREFER_TAG = /^pack_prefer:(.+)$/i;

function uniqCanon(list: PackGarmentCanon[]): PackGarmentCanon[] {
  return [...new Set(list)];
}

function findGarment(text: string): GarmentDef | null {
  for (const g of GARMENTS) {
    if (g.mention.test(text)) return g;
  }
  return null;
}

/**
 * „nie Pulli“, „keinen Anzug einpacken“, „immer Powerbank“, „Packliste ohne Schirm“.
 */
export function looksLikePackPreference(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 6) return false;
  const hasGarment = GARMENTS.some((g) => g.mention.test(t));
  if (!hasGarment) return false;
  return (
    /\b(nie|niemals|kein(?:en|e|em)?|ohne|nicht\s+(?:den|die|das|einen?|eine)?|vergiss|merke\s*(?:dir)?|pack(?:e|en)?\s+ohne|nie\s+wieder)\b/iu.test(
      t,
    ) ||
    /\b(immer|stets|unbedingt|lieber)\b/iu.test(t) ||
    /\b(pack(?:liste)?|einpacken|mitnehmen)\b/iu.test(t)
  );
}

/** Prefs aus freiem User-Text (ohne Profile). */
export function parsePackPrefsFromText(text: string): PackListPrefs {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const avoid: PackGarmentCanon[] = [];
  const prefer: PackGarmentCanon[] = [];
  const notes: string[] = [];
  if (!t) return { avoid, prefer, notes };

  const avoidHit =
    /\b(?:nie|niemals|kein(?:en|e|em)?|ohne|nicht|vergiss|pack(?:e|en)?\s+ohne|nie\s+wieder)\b/iu.test(
      t,
    );
  const preferHit = /\b(?:immer|stets|unbedingt|lieber)\b/iu.test(t);

  for (const g of GARMENTS) {
    if (!g.mention.test(t)) continue;
    // Nur enges Fenster VOR dem Item — sonst zieht „nie Pulli, immer X“ X mit runter
    const m = t.match(g.mention);
    const idx = m?.index ?? 0;
    const before = t.slice(Math.max(0, idx - 18), idx);
    const localAvoid = /\b(?:nie|niemals|kein(?:en|e|em)?|ohne|nicht|vergiss|pack(?:e|en)?\s+ohne)\b/iu.test(
      before,
    );
    const localPrefer = /\b(?:immer|stets|unbedingt|lieber)\b/iu.test(before);

    if (localAvoid && !localPrefer) {
      avoid.push(g.canon);
      notes.push(`nie ${g.preferLabel}`);
    } else if (localPrefer && !localAvoid) {
      prefer.push(g.canon);
      notes.push(`immer ${g.preferLabel}`);
    } else if (localPrefer && localAvoid) {
      // dichterer Cue gewinnt: letzter Treffer in `before`
      const lastAvoid = Math.max(
        before.toLowerCase().lastIndexOf('nie'),
        before.toLowerCase().lastIndexOf('kein'),
        before.toLowerCase().lastIndexOf('ohne'),
      );
      const lastPrefer = Math.max(
        before.toLowerCase().lastIndexOf('immer'),
        before.toLowerCase().lastIndexOf('stets'),
        before.toLowerCase().lastIndexOf('lieber'),
      );
      if (lastPrefer >= lastAvoid) {
        prefer.push(g.canon);
        notes.push(`immer ${g.preferLabel}`);
      } else {
        avoid.push(g.canon);
        notes.push(`nie ${g.preferLabel}`);
      }
    } else if (avoidHit && !preferHit) {
      avoid.push(g.canon);
      notes.push(`nie ${g.preferLabel}`);
    } else if (preferHit && !avoidHit) {
      prefer.push(g.canon);
      notes.push(`immer ${g.preferLabel}`);
    }
  }

  return {
    avoid: uniqCanon(avoid),
    prefer: uniqCanon(prefer),
    notes,
  };
}

export function prefsFromLearnedRules(rules: LearnedRule[] | null | undefined): PackListPrefs {
  const avoid: PackGarmentCanon[] = [];
  const prefer: PackGarmentCanon[] = [];
  const notes: string[] = [];
  const canons = new Set(GARMENTS.map((g) => g.canon));
  for (const r of rules || []) {
    if (r.intentFamily !== 'packing' && !r.tags.some((t) => /^pack_(avoid|prefer):/i.test(t))) {
      continue;
    }
    for (const tag of r.tags) {
      const a = tag.match(AVOID_TAG);
      if (a && canons.has(a[1]!.toLowerCase() as PackGarmentCanon)) {
        avoid.push(a[1]!.toLowerCase() as PackGarmentCanon);
      }
      const p = tag.match(PREFER_TAG);
      if (p && canons.has(p[1]!.toLowerCase() as PackGarmentCanon)) {
        prefer.push(p[1]!.toLowerCase() as PackGarmentCanon);
      }
    }
    if (r.summary) notes.push(r.summary.slice(0, 80));
  }
  return {
    avoid: uniqCanon(avoid),
    prefer: uniqCanon(prefer),
    notes: [...new Set(notes)].slice(0, 4),
  };
}

export function mergePackPrefs(...parts: PackListPrefs[]): PackListPrefs {
  const avoid: PackGarmentCanon[] = [];
  const prefer: PackGarmentCanon[] = [];
  const notes: string[] = [];
  for (const p of parts) {
    avoid.push(...p.avoid);
    prefer.push(...p.prefer);
    notes.push(...p.notes);
  }
  // Prefer schlägt Avoid nicht — Avoid gewinnt bei Konflikt
  const avoidSet = new Set(uniqCanon(avoid));
  return {
    avoid: [...avoidSet],
    prefer: uniqCanon(prefer).filter((c) => !avoidSet.has(c)),
    notes: [...new Set(notes)].slice(0, 6),
  };
}

export function packPrefsToLearnedTags(prefs: PackListPrefs): string[] {
  return [
    ...prefs.avoid.map((c) => `pack_avoid:${c}`),
    ...prefs.prefer.map((c) => `pack_prefer:${c}`),
    'packing',
  ].slice(0, 8);
}

export function draftPackPrefLearnedRule(prefs: PackListPrefs): {
  intentFamily: 'packing';
  tags: string[];
  expect: ['pack_prefs'];
  avoid: ['pack_unwanted_items'];
  summary: string;
  strength: number;
  evidenceDigest: string;
  scope: 'user';
} | null {
  if (!prefs.avoid.length && !prefs.prefer.length) return null;
  const bits = [
    ...prefs.avoid.map((c) => `nie ${c}`),
    ...prefs.prefer.map((c) => `immer ${c}`),
  ];
  return {
    scope: 'user',
    intentFamily: 'packing',
    tags: packPrefsToLearnedTags(prefs),
    expect: ['pack_prefs'],
    avoid: ['pack_unwanted_items'],
    summary: `Pack-Prefs: ${bits.join(', ')}`.slice(0, 200),
    strength: 0.65,
    evidenceDigest: bits.join('|').slice(0, 160),
  };
}

function garmentByCanon(canon: PackGarmentCanon): GarmentDef | undefined {
  return GARMENTS.find((g) => g.canon === canon);
}

/**
 * Items filtern (Avoid) + Prefer nachziehen.
 * Pure — kein Store.
 */
export function applyPackListPrefs(
  items: PackListItem[],
  prefs: PackListPrefs,
): { items: PackListItem[]; removed: string[]; added: string[] } {
  if (!prefs.avoid.length && !prefs.prefer.length) {
    return { items, removed: [], added: [] };
  }
  const removed: string[] = [];
  let next = items.filter((it) => {
    for (const c of prefs.avoid) {
      const g = garmentByCanon(c);
      if (g && g.label.test(it.label)) {
        removed.push(it.label);
        return false;
      }
    }
    return true;
  });

  const added: string[] = [];
  const seen = new Set(next.map((i) => i.label.toLowerCase()));
  for (const c of prefs.prefer) {
    const g = garmentByCanon(c);
    if (!g) continue;
    if ([...seen].some((l) => g.label.test(l))) continue;
    const id = `pref_${c}_${Math.random().toString(36).slice(2, 6)}`;
    next = [
      ...next,
      {
        id,
        label: g.preferLabel,
        reason: 'Persönliche Pref (gelernt)',
        done: false,
        category: c === 'powerbank' ? 'tech' : 'clothes',
      },
    ];
    seen.add(g.preferLabel.toLowerCase());
    added.push(g.preferLabel);
  }

  return { items: next, removed, added };
}

/** Dev/smoke: Garment-Lookup */
export function packGarmentCanons(): PackGarmentCanon[] {
  return GARMENTS.map((g) => g.canon);
}

export function mentionLooksLikeGarment(text: string): boolean {
  return findGarment(text) != null;
}
