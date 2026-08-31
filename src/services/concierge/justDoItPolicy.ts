/**
 * Just-Do-It: Yorro fragt nicht „Soll ich das heraussuchen?“ —
 * er hat es schon getan und liefert Ergebnis + Buttons.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from './actionLabelShorten';

const PERMISSION_LOOKUP_RE =
  /\bsoll\s+ich\b[^.?!]{0,120}\b(heraussuch|raussuch|nachschau|nachseh|telefon|nummer|party|locations?|orte|webseite|speisekarte|öffnungs|oeffnungs|vergleich|buch|such|recherch|verbind|fähr|faehr|buslinie|linien)\b/iu;

const PHONE_RE =
  /(?:\+|00)?(?:49|43|41)?[\s./\-]*(?:\(?0?\d{2,5}\)?[\s./\-]*)?\d{2,4}[\s./\-]*\d{2,4}[\s./\-]*\d{0,4}/g;

/** Soft Live-Vertiefung (News/nachgucken) — für Button „schau nach“. */
const SOFT_LOOKUP_SIGNAL_RE =
  /\b(?:aktuell(?:e|en)?\s+(?:meldungen|news)|nachschauen|nachgucken|mehr\s+dazu|was\s+(?:gerade\s+)?los\s+ist|live\s+nach|kurz\s+(?:live\s+)?nach)\b/iu;

const SOFT_LOOKUP_PERMISSION_RE =
  /\b(?:kann|soll)\s+ich\b.{0,100}\b(?:meldungen|news|sagen|nachschau|nachguck|recherch|erzähl|erzaehl)\b/iu;

/** Weiches Angebot statt steifer Permission (Persona färbt; Fallback-Satz). */
export const SOFT_LOOKUP_OFFER_TAIL =
  'Wenn du magst, schau ich kurz live nach, was dazu gerade los ist.';

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

/** True wenn Speech Live-Vertiefung anbietet (auch Permission-Form). */
export function detectSoftLookupOffer(speech: string): boolean {
  const t = (speech || '').trim();
  if (!t) return false;
  return SOFT_LOOKUP_SIGNAL_RE.test(t) || SOFT_LOOKUP_PERMISSION_RE.test(t);
}

/**
 * Höflichkeits-Sie → Du. Nur klare Verb+Sie-Muster — kein „sie“ (Person).
 */
export function rewriteSiezenToDu(speech: string): string {
  let s = (speech || '').trim();
  if (!s) return s;
  s = s.replace(/\b[Mm]öchten\s+Sie\b/g, 'Möchtest du');
  s = s.replace(/\b[Kk]önnen\s+Sie\b/g, 'Kannst du');
  s = s.replace(/\b[Ww]ollen\s+Sie\b/g, 'Willst du');
  s = s.replace(/\b[Hh]aben\s+Sie\b/g, 'Hast du');
  s = s.replace(/\b[Ww]ürden\s+Sie\b/g, 'Würdest du');
  s = s.replace(/\b[Ss]ind\s+Sie\b/g, 'Bist du');
  s = s.replace(/\b[Ww]aren\s+Sie\b/g, 'Warst du');
  s = s.replace(/\b[Ww]issen\s+Sie\b/g, 'Weißt du');
  s = s.replace(/\bIhnen\b/g, 'dir');
  s = s.replace(/\bIhre([rnms]?)\b/g, (_m, end: string) => {
    const map: Record<string, string> = {
      '': 'dein',
      e: 'deine',
      r: 'deiner',
      m: 'deinem',
      n: 'deinen',
      s: 'deines',
    };
    return map[end] ?? `dein${end}`;
  });
  s = s.replace(
    /(^|[.!?]\s+)Sie\s+(?=sind|haben|möchten|können|wollen|würden|waren|wissen)/giu,
    '$1Du ',
  );
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Permission-Lookup streichen bzw. News-Permission → weiches Du-Angebot.
 * (Auch ohne fertige Buttons, sonst bleibt „Soll ich Verbindungen raussuchen?“)
 */
export function stripPermissionLookupAsks(speech: string): string {
  let s = (speech || '').trim();
  if (!s) return s;
  const hadSoftLookup = detectSoftLookupOffer(s);

  // Steife News-/Meldungen-Permission zuerst → weiches Angebot (Du)
  s = s.replace(
    /[^.?!]*\b(?:kann|soll)\s+ich\b[^.?!]*(meldungen|news|nachschau|nachguck|sagen|erzähl|erzaehl|recherch)\b[^.?!]*[.?!]\s*/giu,
    ` ${SOFT_LOOKUP_OFFER_TAIL} `,
  );
  s = s.replace(
    /[^.?!]*\b(?:möchten|moechten)\s+(?:Sie|sie|wir)\b[^.?!]*(meldungen|news|nachschau|nachguck|sagen|recherch)\b[^.?!]*[.?!]\s*/giu,
    ` ${SOFT_LOOKUP_OFFER_TAIL} `,
  );
  s = s.replace(
    /[^.?!]*\bwenn\s+du\s+(?:möchtest|moechtest|willst)\b[^.?!]*(?:kann\s+ich\b)?[^.?!]*(nachschau|nachguck|recherch|meldungen|sagen)\b[^.?!]*[.?!]\s*/giu,
    ` ${SOFT_LOOKUP_OFFER_TAIL} `,
  );

  s = s.replace(
    /[^.?!]*\bsoll\s+ich\b[^.?!]*(heraussuch|raussuch|nachschau|nachseh|vergleich|buch|such|recherch|verbind|fähr|faehr|buslinie|linien|locations?|orte|vorschlagen|erklär|erzähl|erzaehl)[^.?!]*[.?!]\s*/giu,
    '',
  );
  // „Kann/Möchtest du, dass ich …?“ / Permission-Floskeln
  s = s.replace(
    /[^.?!]*\b(?:möchtest|moechtest|willst|kannst)\s+du(?:\s+dass\s+ich)?\b[^.?!]*(heraussuch|raussuch|nachschau|buch|reserv|such|recherch|verbind)[^.?!]*[.?!]\s*/giu,
    '',
  );
  s = s.replace(
    /[^.?!]*\b(?:soll|kann)\s+ich\s+(?:dir\s+)?(?:das\s+)?(?:noch\s+)?(?:mal\s+)?(?:kurz\s+)?(?:nachschauen|rausuchen|heraussuchen|suchen)\b[^.?!]*[.?!]\s*/giu,
    '',
  );

  s = rewriteSiezenToDu(s).replace(/\s+/g, ' ').trim();

  if (
    hadSoftLookup &&
    !/\b(schau ich|nachschauen|nachgucken|live nach|was dazu gerade)\b/iu.test(s)
  ) {
    s = `${s} ${SOFT_LOOKUP_OFFER_TAIL}`.replace(/\s+/g, ' ').trim();
  }
  return s;
}

/**
 * Wenn Speech noch „Soll ich …?“ fragt, die Aktion aber schon da ist → Satz raus.
 */
export function stripPermissionAsksWhenActionsReady(
  speech: string,
  actions: QuickAction[],
): string {
  let s = stripPermissionLookupAsks(speech);
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
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(party|nachtleben|locations?|orte|heraussuch|raussuch|vorschlagen|die\s+route)[^.?!]*[.?!]\s*/giu,
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

  const hasWake = actions.some((a) => a.type === 'SET_WAKE_ALARM');
  if (hasWake) {
    s = s.replace(
      /[^.?!]*\bsoll\s+ich\b[^.?!]*wecker[^.?!]*[.?!]\s*/giu,
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
      /[^.?!]*\bsoll\s+ich\b[^.?!]*(heraussuch|raussuch|nachschau|nachseh|vergleich|buch|such|recherch)[^.?!]*[.?!]\s*/giu,
      '',
    );
  }

  // „Ich schau mal / ich vergleiche gleich“ ohne Ergebnis-Buttons → ehrlich kürzen
  const hasWorkResult =
    hasUrl ||
    navCount >= 1 ||
    hasDial ||
    actions.some(
      (a) =>
        a.type === 'BOOK_STAY22' ||
        a.type === 'OPEN_GYG_WIDGET' ||
        a.type === 'SET_DEPARTURE_REMINDER' ||
        a.type === 'SET_WAKE_ALARM' ||
        a.type === 'SET_TIMER',
    );
  if (!hasWorkResult) {
    s = s.replace(
      /[^.?!]*\b(?:soll\s+ich\s+(?:das\s+)?(?:vergleich|buch|such)|ich\s+(?:schau|suche|vergleiche)\s+(?:mal|gleich|kurz))[^.?!]*[.?!]\s*/giu,
      '',
    );
  }

  return rewriteSiezenToDu(s.replace(/\s+/g, ' ').trim());
}

/** Vague „Mehr“-Labels → „schau nach“, wenn LOOKUP-Prompt. */
export function normalizeLookupShowMoreLabel(
  label: string,
  textPrompt?: string | null,
): string {
  const lab = (label || '').trim();
  const tp = (textPrompt || '').trim();
  const cleaned = lab.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const vague =
    /^(?:mehr(?:\s+(?:dazu|informationen|infos?))?|nachschauen|recherchieren|tiefer)$/iu.test(
      cleaned,
    );
  const lookupPrompt =
    /\b(live|aktuell|meldungen|nachschau|recherch|vertief|was\s+.*\s+los)\b/iu.test(
      tp,
    );
  if (vague || lookupPrompt) {
    if (/schau\s*nach/i.test(lab) && lab.length <= 20) return lab;
    return 'schau nach';
  }
  return lab;
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