/**
 * Packlisten-Personen — Mama/Papa/Kinder.
 * Alter: soft („ist 11“) ODER optional Monat/Jahr — nie Geburtstag erzwingen.
 */

export type PackPersonRole = 'self' | 'partner' | 'child' | 'other';

export type PackTraveler = {
  id: string;
  name: string;
  role: PackPersonRole;
  /** Soft-Alter in Jahren, wenn genannt („ist 11“) */
  ageYears: number | null;
  /** Wann ageYears genannt wurde */
  ageAsOfMs: number | null;
  /** Optional: Geburtsmonat 1–12 (ohne Tag ok) */
  birthMonth?: number | null;
  /** Optional: Geburtsjahr YYYY */
  birthYear?: number | null;
  updatedAtMs: number;
};

export type PackPersonRef = {
  id: string;
  name: string;
  role: PackPersonRole;
  /** Alter am Reisetag (hochgerechnet) */
  ageAtTrip: number | null;
  /** Wie genau: soft | month | year */
  agePrecision?: 'soft' | 'month' | 'year' | 'none';
};

const YEAR_MS = 365.25 * 86_400_000;

const MONTH_NAME: Record<string, number> = {
  januar: 1,
  jan: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  maer: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function numWord(raw: string): number | null {
  const m = String(raw || '')
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(m)) return Math.min(8, Number(m));
  const map: Record<string, number> = {
    ein: 1,
    eine: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    beide: 2,
  };
  return map[m] ?? null;
}

function parseMonthToken(raw: string): number | null {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/u, '');
  if (/^\d{1,2}$/.test(k)) {
    const n = Number(k);
    return n >= 1 && n <= 12 ? n : null;
  }
  return MONTH_NAME[k] ?? null;
}

/**
 * Alter am Stichtag.
 * Priorität: Jahr(+Monat) → soft ageYears+asOf → nur ageYears.
 * Ohne Geburtstag: Näherung reicht für Pack-Bänder; User wird nie gefragt.
 */
export function ageAtDateMs(
  traveler: Pick<
    PackTraveler,
    'ageYears' | 'ageAsOfMs' | 'birthMonth' | 'birthYear'
  >,
  atMs: number,
): number | null {
  const at = new Date(atMs);
  const atY = at.getUTCFullYear();
  const atM = at.getUTCMonth() + 1;
  const atD = at.getUTCDate();

  if (traveler.birthYear != null && Number.isFinite(traveler.birthYear)) {
    const by = Math.round(traveler.birthYear);
    if (by < 1900 || by > atY) return null;
    // Nur Monat: Tag = 15. Nur Jahr: Monat = Juli (Mitte) — kein Tag erzwingen.
    const bm =
      traveler.birthMonth != null &&
      traveler.birthMonth >= 1 &&
      traveler.birthMonth <= 12
        ? traveler.birthMonth
        : 7;
    const bd = traveler.birthMonth != null ? 15 : 1;
    let age = atY - by;
    if (atM < bm || (atM === bm && atD < bd)) age -= 1;
    return Math.max(0, age);
  }

  if (traveler.ageYears == null || !Number.isFinite(traveler.ageYears)) {
    return null;
  }
  if (traveler.ageAsOfMs == null || !Number.isFinite(traveler.ageAsOfMs)) {
    return Math.max(0, Math.round(traveler.ageYears));
  }
  // Soft: „heute 11“ → nächsten Sommer ≈ 12 (Bruchteil runden)
  const elapsed = Math.max(0, atMs - traveler.ageAsOfMs);
  const years = elapsed / YEAR_MS;
  return Math.max(0, Math.round(Math.round(traveler.ageYears) + years));
}

export function agePrecisionOf(
  t: Pick<PackTraveler, 'ageYears' | 'birthMonth' | 'birthYear'>,
): PackPersonRef['agePrecision'] {
  if (t.birthYear != null && t.birthMonth != null) return 'month';
  if (t.birthYear != null) return 'year';
  if (t.ageYears != null) return 'soft';
  return 'none';
}

/** Anzeige: „11 J. (genannt)“ / „März 2014“ / „Jahrgang 2014“. */
export function formatTravelerAgeHint(
  t: PackTraveler,
  tripAtMs?: number | null,
): string {
  const atTrip =
    tripAtMs != null ? ageAtDateMs(t, tripAtMs) : ageAtDateMs(t, Date.now());
  const bits: string[] = [];
  if (t.birthMonth != null && t.birthYear != null) {
    const names = [
      '',
      'Jan',
      'Feb',
      'Mär',
      'Apr',
      'Mai',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Okt',
      'Nov',
      'Dez',
    ];
    bits.push(`${names[t.birthMonth]} ${t.birthYear}`);
  } else if (t.birthYear != null) {
    bits.push(`Jahrgang ${t.birthYear}`);
  } else if (t.ageYears != null) {
    bits.push(`${Math.round(t.ageYears)} J. genannt`);
  }
  if (atTrip != null) {
    bits.push(`≈ ${atTrip} J. am Trip`);
  }
  return bits.join(' · ') || 'Alter offen';
}

/** „nächsten Sommer“ / ISO → Reisetag für Alter. */
export function guessTripAtMsFromText(
  text: string,
  nowMs = Date.now(),
): number | null {
  const t = String(text || '');
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const ms = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    if (Number.isFinite(ms)) return ms;
  }
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const month = d.getMonth();
  if (/\bn[äa]chsten?\s+sommer/iu.test(t)) {
    const summerY = month < 6 ? y : y + 1;
    return Date.UTC(summerY, 6, 1, 12, 0, 0);
  }
  if (/\bdiesen?\s+sommer/iu.test(t)) {
    return Date.UTC(month < 8 ? y : y + 1, 6, 1, 12, 0, 0);
  }
  if (/\bn[äa]chst(?:es|en)?\s+jahr/iu.test(t)) {
    return Date.UTC(y + 1, 6, 1, 12, 0, 0);
  }
  return null;
}

/**
 * „für Papa und beide Kinder“ → Creator (Mama) nicht auf der Liste,
 * außer „für uns / Familie / auch mich / Mama und Papa“.
 */
export function creatorShouldBeOnList(text: string): boolean {
  const t = String(text || '');
  if (
    /\b(?:für\s+uns|für\s+die\s+familie|ganze\s+familie|uns\s+alle)\b/iu.test(t)
  ) {
    return true;
  }
  if (/\b(?:auch\s+(?:für\s+)?mich|und\s+mich|mich\s+mit)\b/iu.test(t)) {
    return true;
  }
  if (
    /\b(?:mama\s+und\s+papa|papa\s+und\s+mama|für\s+mama\s+und)\b/iu.test(t)
  ) {
    return true;
  }
  // Explizit nur andere: „für Papa und die Kinder“
  if (
    /\bfür\s+(?:papa|vater|die\s+kinder|beide\s+kinder|meine\s+kinder)/iu.test(
      t,
    ) &&
    !/\bfür\s+(?:mama|mich|uns)\b/iu.test(t)
  ) {
    return false;
  }
  return false;
}

function emptyTraveler(
  name: string,
  role: PackPersonRole,
  now: number,
): PackTraveler {
  return {
    id: uid('tr'),
    name,
    role,
    ageYears: null,
    ageAsOfMs: null,
    birthMonth: null,
    birthYear: null,
    updatedAtMs: now,
  };
}

/**
 * „für Papa und beide Kinder“, „Leo ist 11“, „geboren im März 2014“.
 */
export function parsePackPersonsFromText(
  text: string,
  opts?: {
    nowMs?: number;
    existing?: PackTraveler[] | null;
  },
): PackTraveler[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const now = opts?.nowMs ?? Date.now();
  const existing = opts?.existing || [];
  const byKey = new Map<string, PackTraveler>();

  const put = (p: PackTraveler) => {
    const key = `${p.role}:${p.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, {
        ...prev,
        ageYears: p.ageYears ?? prev.ageYears,
        ageAsOfMs: p.ageYears != null ? p.ageAsOfMs : prev.ageAsOfMs,
        birthMonth: p.birthMonth ?? prev.birthMonth,
        birthYear: p.birthYear ?? prev.birthYear,
        updatedAtMs: now,
      });
    } else {
      byKey.set(key, p);
    }
  };

  // Bestehende nur mergen wenn dieser Turn Personen anspricht
  const wantsPeople =
    /\b(?:für|packliste\s+für|packen\s+für)\b/iu.test(t) ||
    /\b(papa|mama|vater|mutter|kinder|kind|sohn|tochter|partner)\b/iu.test(t) ||
    /\b(?:geboren|geburtstag|jahrgang|jahre?\s+alt)\b/iu.test(t);

  if (!wantsPeople && byKey.size === 0 && existing.length === 0) return [];

  // Named soft age: „Leo ist 11“, „meine Tochter 8 Jahre“
  for (const m of t.matchAll(
    /\b([A-ZÄÖÜ][a-zäöüß]{1,20}|(?:mein(?:e)?\s+)?(?:sohn|tochter|kind))\s+(?:ist\s+)?(\d{1,2})\s*(?:jahre?(?:\s+alt)?|jährig|jaehrig)?\b/giu,
  )) {
    const rawName = m[1]!.replace(/^mein(?:e)?\s+/iu, '').trim();
    const age = Number(m[2]);
    if (!(age >= 0 && age <= 17)) continue;
    const isRel = /^(sohn|tochter|kind)$/i.test(rawName);
    const name = isRel
      ? age < 3
        ? 'Kleinkind'
        : `Kind (${age})`
      : rawName;
    put({
      ...emptyTraveler(name, 'child', now),
      ageYears: age,
      ageAsOfMs: now,
    });
  }

  // „Kind ist heute 11“
  const plainKidAge = t.match(
    /\b(?:das\s+)?kind\s+(?:ist\s+)?(?:heute\s+)?(\d{1,2})\s*(?:jahre?(?:\s+alt)?|jährig)?\b/iu,
  );
  if (plainKidAge) {
    const age = Number(plainKidAge[1]);
    if (age >= 0 && age <= 17) {
      put({
        ...emptyTraveler(`Kind (${age})`, 'child', now),
        ageYears: age,
        ageAsOfMs: now,
      });
    }
  }

  // „2 und 8 Jahre“ / „Kinder 8 und 11“
  const multiAges = [
    ...t.matchAll(
      /\b(?:kinder(?:n)?\s+)?(\d{1,2})\s*(?:und|,|\/)\s*(\d{1,2})(?:\s*(?:und|,|\/)\s*(\d{1,2}))?\s*jahre?\b/giu,
    ),
  ];
  for (const m of multiAges) {
    const ages = [m[1], m[2], m[3]]
      .filter(Boolean)
      .map(Number)
      .filter((n) => n >= 0 && n <= 17);
    ages.forEach((age, i) => {
      put({
        ...emptyTraveler(`Kind (${age})`, 'child', now),
        ageYears: age,
        ageAsOfMs: now,
      });
      void i;
    });
  }

  // Optional Geburt: „geboren im März“, „März 2014“, „Jahrgang 2014“, „Geburtstag März“
  const birthHits = [
    ...t.matchAll(
      /\b(?:geboren|geb\.?|geburtstag|jahrgang)\s*(?:im\s+|in\s+)?([A-Za-zäöüÄÖÜß.]{3,12}|\d{1,2})(?:\s+(\d{4}))?\b/giu,
    ),
    ...t.matchAll(
      /\b([A-Za-zäöüÄÖÜß.]{3,12})\s+(\d{4})\s*(?:geboren|geb\.?)?\b/giu,
    ),
  ];
  for (const m of birthHits) {
    const month = parseMonthToken(m[1] || '');
    const yearRaw = m[2] ? Number(m[2]) : /^\d{4}$/.test(m[1] || '') ? Number(m[1]) : null;
    const year =
      yearRaw != null && yearRaw >= 1990 && yearRaw <= new Date(now).getFullYear()
        ? yearRaw
        : null;
    if (month == null && year == null) continue;
    // An jüngstes Kind ohne birthYear hängen, sonst neues Kind
    const kids = [...byKey.values()].filter((p) => p.role === 'child');
    const target =
      kids.find((k) => k.birthYear == null && k.birthMonth == null) ||
      kids[kids.length - 1];
    if (target) {
      put({
        ...target,
        birthMonth: month ?? target.birthMonth ?? null,
        birthYear: year ?? target.birthYear ?? null,
        updatedAtMs: now,
      });
    } else {
      put({
        ...emptyTraveler('Kind', 'child', now),
        birthMonth: month,
        birthYear: year,
      });
    }
  }

  if (/\b(papa|vater|dad|vati)\b/iu.test(t)) {
    put(emptyTraveler('Papa', 'partner', now));
  }
  if (
    /\b(mama|mutter|mum|mutti)\b/iu.test(t) &&
    !/\bfür\s+(?:papa|vater|die\s+kinder|beide)/iu.test(t)
  ) {
    // „Mama“ als Empfänger — nicht wenn nur Creator-Kontext „für Papa…“
    put(emptyTraveler('Mama', 'self', now));
  }
  if (creatorShouldBeOnList(t)) {
    put(emptyTraveler('Ich', 'self', now));
  }

  const kidsN =
    t.match(/\b(beide|zwei|drei|vier|\d)\s+kinder(?:n)?\b/iu) ||
    t.match(/\b(?:die\s+)?kinder\b/iu);
  if (kidsN) {
    const n = kidsN[1] ? numWord(kidsN[1]) || 2 : 2;
    const childEntries = [...byKey.values()].filter((p) => p.role === 'child');
    const existingKids = existing.filter((e) => e.role === 'child');
    for (let i = childEntries.length; i < Math.min(4, n); i++) {
      const reuse = existingKids[i];
      if (reuse) {
        put({ ...reuse, updatedAtMs: now });
      } else {
        put(emptyTraveler(`Kind ${i + 1}`, 'child', now));
      }
    }
  }

  let list = [...byKey.values()];

  // „für Papa und Kinder“ → self/Ich/Mama raus, außer explizit mit drauf
  if (!creatorShouldBeOnList(t) && /\bfür\s+/iu.test(t)) {
    list = list.filter((p) => {
      if (p.role !== 'self') return true;
      // Nur behalten wenn Text Mama als Empfänger nennt und nicht nur „für Papa…“
      return (
        /\bfür\s+(?:mama|mich|uns)\b/iu.test(t) ||
        /\bmama\s+und\s+papa\b/iu.test(t)
      );
    });
  }

  // Mit bestehenden IDs mergen
  return list.map((p) => {
    const hit = existing.find(
      (e) =>
        e.id === p.id ||
        (e.name.toLowerCase() === p.name.toLowerCase() && e.role === p.role) ||
        (e.role === p.role &&
          p.role !== 'child' &&
          e.role === p.role &&
          e.name.toLowerCase() === p.name.toLowerCase()),
    );
    if (!hit) return p;
    return {
      ...hit,
      name: p.name || hit.name,
      ageYears: p.ageYears ?? hit.ageYears,
      ageAsOfMs: p.ageYears != null ? p.ageAsOfMs : hit.ageAsOfMs,
      birthMonth: p.birthMonth ?? hit.birthMonth ?? null,
      birthYear: p.birthYear ?? hit.birthYear ?? null,
      updatedAtMs: now,
    };
  });
}

export function toPersonRefs(
  travelers: PackTraveler[],
  tripAtMs: number | null,
): PackPersonRef[] {
  const at = tripAtMs ?? Date.now();
  return travelers.map((t) => ({
    id: t.id,
    name: t.name,
    role: t.role,
    ageAtTrip: ageAtDateMs(t, at),
    agePrecision: agePrecisionOf(t),
  }));
}

export function looksLikeMultiPersonPack(text: string): boolean {
  const t = String(text || '');
  return (
    /\bpackliste\s+für\b/iu.test(t) ||
    /\b(?:für|packen\s+für)\s+(?:papa|mama|die\s+kinder|beide\s+kinder|uns|die\s+familie)/iu.test(
      t,
    ) ||
    (/\b(papa|mama|vater|mutter)\b/iu.test(t) &&
      /\b(kind|kinder|packliste|packen)\b/iu.test(t))
  );
}
