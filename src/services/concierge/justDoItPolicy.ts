/**
 * Just-Do-It: Findus fragt nicht „Soll ich das heraussuchen?“ —
 * er hat es schon getan und liefert Ergebnis + Buttons.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from './actionLabelShorten';

const PERMISSION_LOOKUP_RE =
  /\bsoll\s+ich\b[^.?!]{0,80}\b(heraussuch|raussuch|nachschau|nachseh|telefon|nummer|party|locations?|orte|webseite|speisekarte|öffnungs|oeffnungs)\b/iu;

const PHONE_RE =
  /(?:\+|00)?(?:49|43|41)?[\s./\-]*(?:\(?0?\d{2,5}\)?[\s./\-]*)?\d{2,4}[\s./\-]*\d{2,4}[\s./\-]*\d{0,4}/g;

/** Erlaubte Rückfrage nur bei echter Blockade (nicht recherchierbar). */
export function isGenuineBlockerClarification(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // „Soll ich nachschauen?“ ist KEIN Blocker
  if (PERMISSION_LOOKUP_RE.test(t)) return false;
  if (/\b(heraussuch|raussuch|nachschau|recherch)\b/iu.test(t)) return false;
  // Echte Lücken: Personenanzahl, Datum, welches von mehreren Hotels ohne Kontext
  return /\b(wie\s+viele|für\s+wen|welches\s+hotel|welche\s+nacht|bis\s+wann|budget\s+genau|vegetarisch\s+oder)\b/iu.test(
    t,
  );
}

export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.length < 8) return null;
  let n = digits;
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (n.startsWith('0') && !n.startsWith('+')) n = `+49${n.slice(1)}`;
  if (!n.startsWith('+') && n.length >= 10) n = `+${n}`;
  if (n.replace(/\D/g, '').length < 8) return null;
  return n;
}

/** Telefonnummern aus Speech/Research-Text ziehen. */
export function extractPhoneNumbers(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const matches = text.match(PHONE_RE) ?? [];
  for (const m of matches) {
    const n = normalizePhoneNumber(m);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 3);
}

/**
 * Wenn Speech noch „Soll ich …?“ fragt, die Aktion aber schon da ist → Satz raus.
 */
export function stripPermissionAsksWhenActionsReady(
  speech: string,
  actions: QuickAction[],
): string {
  let s = speech.trim();
  if (!s) return s;

  const hasDial = actions.some((a) => a.type === 'DIAL_PHONE' && a.payload.phoneNumber);
  const navCount = actions.filter((a) => a.type === 'START_NAVIGATION').length;
  const hasUrl = actions.some((a) => a.type === 'OPEN_URL' && a.payload.url);

  if (hasDial) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(telefon|nummer|anruf)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }
  if (navCount >= 1) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(party|nachtleben|locations?|orte|heraussuch|raussuch|vorschlagen)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }
  if (hasUrl) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(webseite|seite|speisekarte|link|pdf)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }
  // Bäckerei / Orte: Permission-Frage weg, wenn Nav/URL schon da
  if (navCount >= 1 || hasUrl) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(bäckerei|baeckerei|heraussuch|raussuch|nachschau)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }

  const hasReserve = actions.some(
    (a) =>
      a.type === 'CONFIRM_API_RESERVATION' ||
      a.type === 'SEND_RESERVATION_EMAIL' ||
      a.type === 'TRIGGER_AI_CALL',
  );
  if (hasReserve) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(vorbereiten|reservier|buch|tisch|anfrag)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }

  // Generische Permission-Lookup-Sätze entfernen, wenn wir überhaupt Actions haben
  if (actions.length > 0 && PERMISSION_LOOKUP_RE.test(s)) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(heraussuch|raussuch|nachschau|nachseh)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }

  return s.replace(/\s+/g, ' ').trim();
}

/** DIAL_PHONE-Actions aus erkannten Nummern bauen. */
export function dialActionsFromPhones(
  phones: string[],
  labelHint?: string | null,
): QuickAction[] {
  return phones.slice(0, 2).map((phoneNumber, i) => ({
    type: 'DIAL_PHONE' as const,
    label: shortenActionLabel(
      i === 0
        ? labelHint
          ? `📞 ${labelHint}`
          : '📞 Call'
        : `📞 Call ${i + 1}`,
    ),
    payload: { phoneNumber },
  }));
}
