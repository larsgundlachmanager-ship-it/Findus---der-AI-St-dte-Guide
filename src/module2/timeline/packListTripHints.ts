/**
 * Trip-/Follow-up-Hints für die Packliste (Hochzeit, täglich Tennis, …).
 * Struktur aus Beleg — kein Wortlaut-Skript.
 */

export type PackTripHint = {
  activities: string[];
  /** Extra Labels (category + optional qty) */
  extras: Array<{
    label: string;
    reason: string;
    category: 'formal' | 'activity' | 'clothes' | 'misc';
    qty?: number | null;
    priority?: 'high' | null;
  }>;
  notes: string[];
};

const WEDDING =
  /\b(hochzeit|trauung|heirat|wedding|bräutigam|braeutigam|braut)\b/iu;
const DAILY_SPORT =
  /\b(?:jeden\s+tag|täglich|taeglich|daily)\s+(?:tennis|padel|golf|joggen|laufen|sport)|(?:tennis|padel|golf)\s+(?:jeden\s+tag|täglich|taeglich)\b/iu;
const TENNIS = /\btennis\b/iu;
const PADEL = /\bpadel\b/iu;
const SUIT =
  /\b(anzug|sakko|smoking|dresscode|formell)\b/iu;

/** Follow-up während Packen / Live-Durchgang. */
export function looksLikePackContextFollowUp(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  return (
    WEDDING.test(t) ||
    DAILY_SPORT.test(t) ||
    (TENNIS.test(t) && /\b(spiel|brauch|pack|mitnehm|jeden|täglich)\b/iu.test(t)) ||
    (SUIT.test(t) && /\b(brauch|hochzeit|pack|mitnehm|einladen|eingeladen)\b/iu.test(t)) ||
    /\b(ah\s+ja|ach\s+ja|übrigens|uebrigens)\b/iu.test(t)
  );
}

/**
 * Hints aus User-Text + Ledger/Timeline-Blob (purpose „Hochzeit“, …).
 */
export function extractPackTripHints(opts: {
  userText?: string | null;
  ledgerBlob?: string | null;
  tripDays?: number | null;
}): PackTripHint {
  const t = `${opts.userText || ''} ${opts.ledgerBlob || ''}`;
  const days =
    opts.tripDays != null && opts.tripDays > 0
      ? Math.min(31, Math.round(opts.tripDays))
      : null;
  const activities: string[] = [];
  const extras: PackTripHint['extras'] = [];
  const notes: string[] = [];
  const pushAct = (id: string) => {
    if (!activities.includes(id)) activities.push(id);
  };

  if (WEDDING.test(t) || /\bpurpose[:=\s]+hochzeit\b/iu.test(t)) {
    pushAct('formal');
    pushAct('wedding');
    extras.push({
      label: 'Anzug / formelle Kleidung',
      reason: 'Hochzeit im Trip',
      category: 'formal',
      priority: 'high',
    });
    extras.push({
      label: 'Formelle Schuhe',
      reason: 'Zur Hochzeit',
      category: 'formal',
      priority: 'high',
    });
    notes.push('Hochzeit → Anzug');
  } else if (SUIT.test(t) && /\b(brauch|pack|mitnehm|hochzeit)\b/iu.test(t)) {
    pushAct('formal');
    extras.push({
      label: 'Anzug / formelle Kleidung',
      reason: 'Formeller Anlass belegt',
      category: 'formal',
      priority: 'high',
    });
    extras.push({
      label: 'Formelle Schuhe',
      reason: 'Zum Anzug',
      category: 'formal',
    });
    notes.push('Anzug nachgezogen');
  }

  if (DAILY_SPORT.test(t) || (TENNIS.test(t) && /\b(jeden\s+tag|täglich|taeglich)\b/iu.test(t))) {
    pushAct('sport');
    pushAct('sport_daily');
    const sportQty = days != null ? Math.min(14, Math.max(2, days)) : null;
    const sport = TENNIS.test(t) ? 'Tennis' : PADEL.test(t) ? 'Padel' : 'Sport';
    extras.push({
      label: 'Sportshirt / Sport-Oberteil',
      reason: `${sport} täglich`,
      category: 'activity',
      qty: sportQty,
      priority: 'high',
    });
    extras.push({
      label: 'Sporthose',
      reason: `${sport} täglich`,
      category: 'activity',
      qty: sportQty != null ? Math.max(2, Math.ceil(sportQty / 2)) : null,
    });
    extras.push({
      label: 'Sportschuhe',
      reason: `${sport} täglich`,
      category: 'activity',
      priority: 'high',
    });
    if (TENNIS.test(t) || PADEL.test(t)) {
      extras.push({
        label: `${sport}-Schläger / Griffband (falls eigener)`,
        reason: `${sport} im Plan`,
        category: 'activity',
      });
    }
    notes.push(`${sport} täglich → Sportzeug`);
  } else if (
    TENNIS.test(t) ||
    PADEL.test(t) ||
    /\b(sport|joggen|fitness|gym)\b/iu.test(t)
  ) {
    pushAct('sport');
    extras.push({
      label: 'Sportschuhe + Sportshirt',
      reason: 'Sport im Kontext',
      category: 'activity',
    });
  }

  return { activities, extras, notes };
}

/** Ledger → kompakter Blob für Hints (nur belegte Felder). */
export function ledgerPackBlob(ledger: {
  purpose?: { value?: string } | null;
  highlightWant?: { value?: string } | null;
  destinationHint?: { value?: string } | null;
  extraWishes?: { value?: string } | null;
  dateStart?: { value?: string } | null;
} | null): string {
  if (!ledger) return '';
  return [
    ledger.purpose?.value ? `purpose:${ledger.purpose.value}` : '',
    ledger.highlightWant?.value,
    ledger.destinationHint?.value,
    ledger.extraWishes?.value,
    ledger.dateStart?.value ? `am ${ledger.dateStart.value}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
