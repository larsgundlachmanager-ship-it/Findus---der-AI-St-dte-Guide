/**
 * Detect buy-list + hotel errands („Powerbank laden wenn ich im Hotel bin“).
 */

import type {
  ShoppingPlaceCategory,
  TaskAnchor,
} from '../../store/useShoppingTaskStore';

export type ShoppingTaskIntent = {
  itemLabel: string;
  placeTypes: ShoppingPlaceCategory[];
  anchor: TaskAnchor;
  /** Soft time hint if user said heute Abend / morgen */
  dueAtMs: number | null;
  reply: string;
  /** True when hotel is mentioned but Yorro has no confirmed hotel coords yet */
  needsHotel?: boolean;
};

const BUY_RE =
  /\b(?:ich\s+)?(?:muss|soll|will|möchte|moechte|brauch(?:e)?|benötige|benoetige|hätt?e?\s+gern(?:e)?)\s+(?:noch\s+)?(?:mal\s+)?(?:eine?\s+|einen\s+|ein\s+)?(.{2,48}?)\s+(?:kaufen|besorgen|holen|einkaufen)\b/iu;

const BUY_ALT_RE =
  /\b(?:nicht\s+vergessen|merk\s+dir|erinner\s+mich)(?:\s+bitte)?[,:]?\s+(?:noch\s+)?(?:eine?\s+|einen\s+|ein\s+)?(.{2,48}?)\s+(?:zu\s+)?(?:kaufen|besorgen|holen)\b/iu;

const BUY_NEED_RE =
  /\b(?:ich\s+)?brauch(?:e)?\s+(?:noch\s+)?(?:eine?\s+|einen\s+|ein\s+)?(?:neue[snr]?\s+|frisch(?:e[snr]?)?\s+)?(.{2,40}?)\s*(?:aus\s+der\s+drogerie|beim?\s+dm|bei\s+rossmann)?\s*[.!?]?$/iu;

/** Hotel-anchor phrases */
const HOTEL_WHERE_RE =
  /\b(?:wenn\s+(?:ich\s+)?(?:wieder\s+)?(?:im|ins|zum|beim)\s+hotel|wieder\s+im\s+hotel|(?:zurück|zurueck)\s+im\s+hotel|(?:im|ins|zum|beim)\s+hotel|in\s+der\s+unterkunft)\b/iu;

const HOTEL_REMIND_RE =
  /\b(?:erinner\s+mich|merk\s+dir|denk\s+daran|nicht\s+vergessen|ich\s+muss|ich\s+soll|bitte\s+erinner)\b/iu;

/** „Powerbank laden“ / „meine Powerbank aufladen“ / „Akku laden“ */
const HOTEL_ACTION_RE =
  /\b(?:meine?\s+|die\s+|den\s+|das\s+)([a-zäöüß0-9][\wÄÖÜäöüß\-']{1,30}(?:\s+[a-zäöüß0-9][\wÄÖÜäöüß\-']{1,20}){0,2})\s+(?:zu\s+)?(laden|aufladen|packen|checken|machen)\b/iu;

const HOTEL_ACTION_ALT_RE =
  /\b(?:zu\s+)?(laden|aufladen|packen|checken)\b.{0,8}\b(?:meine?\s+|die\s+|den\s+|das\s+)?([a-zäöüß0-9][\wÄÖÜäöüß\-']{1,30})\b/iu;

const DONE_RE =
  /\b(?:habe?\s+(?:die\s+|das\s+|den\s+|meine?\s+)?(.{2,40}?)\s+)?(?:schon\s+)?(?:gekauft|besorgt|geholt|geladen|aufgeladen|erledigt|gefunden)\b/iu;

const DONE_HAVE_FOUND_RE =
  /\b(?:die\s+|das\s+|den\s+|meine?\s+)?(.{2,40}?)\s+(?:habe?\s+ich\s+)?(?:schon\s+)?gefunden\b/iu;

const DONE_SIMPLE_RE =
  /\b(?:ist\s+erledigt|aufgabe\s+(?:löschen|loeschen|weg)|erinnerung\s+(?:löschen|loeschen|weg)|brauch\s+(?:ich\s+)?nicht\s+mehr|ist\s+dran|hab(?:e)?\s+(?:sie|ihn|es)\s+geladen|hab(?:e)?\s+(?:sie|ihn|es|die)\s+gefunden)\b/iu;

const NOISE =
  /^(noch|mal|bitte|einfach|schnell|kurz|heute|morgen|eine|einen|ein|die|der|das|mir|uns|meine|mein|wieder|hotel)$/i;

/** Item → preferred store types (best UX: drugstore before supermarket). */
function categorizeItem(item: string): ShoppingPlaceCategory[] {
  const t = item.toLowerCase();
  if (
    /\b(medikament|rezept|ibuprofen|aspirin|pflaster|verband|apotheke)\b/i.test(
      t,
    )
  ) {
    return ['pharmacy', 'drugstore'];
  }
  if (
    /\b(zahnbürste|zahnbuerste|zahncreme|zahnpasta|shampoo|deo|duschgel|watte|make.?up|hygiene|slipeinlage|binden|tampon|sonnencreme|creme|lotion|rasierer|nagellack|wattepads|drogerie)\b/i.test(
      t,
    )
  ) {
    return ['drugstore', 'supermarket'];
  }
  if (
    /\b(milch|brot|butter|eier|käse|kaese|obst|gemüse|gemuese|wasser|cola|chips|nudeln|reis|joghurt)\b/i.test(
      t,
    )
  ) {
    return ['supermarket', 'convenience_store'];
  }
  return ['drugstore', 'supermarket'];
}

function cleanItem(raw: string): string | null {
  let s = raw
    .replace(/^(eine?|einen|ein|noch|mal|bitte|meine?|die|den|das)\s+/iu, '')
    .replace(/\s+(bitte|noch|mal)$/iu, '')
    .replace(/^(bitte\s+)?(noch\s+)?/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 2 || s.length > 48) return null;
  if (NOISE.test(s)) return null;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function parseDueAt(text: string): number | null {
  const now = Date.now();
  const t = text.toLowerCase();
  if (/\bheute\s+abend\b/i.test(t) || /\bheute\s+nacht\b/i.test(t)) {
    const d = new Date();
    d.setHours(19, 0, 0, 0);
    if (d.getTime() < now) d.setHours(21, 0, 0, 0);
    return d.getTime();
  }
  if (/\bmorgen\b/i.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  if (/\bin\s+(\d+)\s*stunden?\b/i.test(t)) {
    const m = t.match(/\bin\s+(\d+)\s*stunden?\b/i);
    const h = Number(m?.[1] ?? 0);
    if (h > 0 && h < 48) return now + h * 3600_000;
  }
  return null;
}

function isEveningSensitiveItem(item: string): boolean {
  return /\b(zahnbürste|zahnbuerste|zahncreme|zahnpasta|deo|duschgel|shampoo|rasierer|kontaktlinsen|abschminktücher|abschminktuecher|haarbürste|haarbuerste)\b/i.test(
    item,
  );
}

function nextEveningReminderAt(hour = 18): number {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function extractHotelActionLabel(text: string): string | null {
  // Prefer known devices — avoids matching „bin die Powerbank“
  const known = text.match(
    /\b(powerbank|akku|handy|smartphone|laptop|tablet|kopfhörer|kopfhoerer|rasierer|zahnbürste|zahnbuerste)\b/iu,
  );
  if (known?.[1]) {
    const obj = cleanItem(known[1]);
    if (obj) {
      if (/\b(auf)?laden\b/i.test(text)) return `${obj} laden`;
      if (/\bpacken\b/i.test(text)) return `${obj} packen`;
      if (/\bchecken\b/i.test(text)) return `${obj} checken`;
      return obj;
    }
  }

  const m1 = text.match(HOTEL_ACTION_RE);
  if (m1?.[1] && m1[2]) {
    let obj = cleanItem(m1[1]);
    if (obj) {
      obj = obj
        .replace(/^(Bin|Bist|War|Wenn|Wieder|Noch|Im)\s+/u, '')
        .replace(/^(Die|Den|Das|Meine?)\s+/u, '')
        .trim();
      if (obj.length >= 2 && !NOISE.test(obj)) {
        const verb = m1[2].toLowerCase().startsWith('auf')
          ? 'aufladen'
          : m1[2].toLowerCase();
        return `${obj.charAt(0).toUpperCase()}${obj.slice(1)} ${verb}`;
      }
    }
  }
  const m2 = text.match(HOTEL_ACTION_ALT_RE);
  if (m2?.[2] && m2[1]) {
    const obj = cleanItem(m2[2]);
    if (obj) {
      const verb = m2[1].toLowerCase().startsWith('auf')
        ? 'aufladen'
        : m2[1].toLowerCase();
      return `${obj} ${verb}`;
    }
  }
  return null;
}

/**
 * „Erinner mich, wenn ich im Hotel bin, die Powerbank zu laden“
 */
export function detectHotelTaskIntent(
  text: string,
  opts?: { hasHotelWithCoords?: boolean; hotelName?: string | null },
): ShoppingTaskIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 10) return null;
  if (!HOTEL_WHERE_RE.test(t)) return null;
  // Prefer explicit remind / must — or hotel + action verb alone
  const hasRemind = HOTEL_REMIND_RE.test(t);
  const hasAction =
    /\b(laden|aufladen|packen|checken|nicht\s+vergessen)\b/i.test(t);
  if (!hasRemind && !hasAction) return null;

  // Don't steal pure buy intents that also say hotel
  if (/\b(kaufen|besorgen|holen|einkaufen)\b/i.test(t) && !hasAction) {
    return null;
  }

  const itemLabel = extractHotelActionLabel(t);
  if (!itemLabel) return null;

  const dueAtMs = parseDueAt(t);
  const hasCoords = opts?.hasHotelWithCoords === true;
  const hotelName = opts?.hotelName?.trim() || null;
  const needsHotel = !hasCoords;

  let reply: string;
  if (hasCoords) {
    const where = hotelName ? `im ${hotelName}` : 'im Hotel';
    reply =
      `Alles klar — sobald du wieder ${where} bist, erinnere ich dich: ${itemLabel}.`;
  } else if (hotelName) {
    reply =
      `Alles klar — ${itemLabel} fürs Hotel. ` +
      `Sobald ich den Standort von ${hotelName} habe (einmal hinlaufen oder bestätigen), melde ich mich dort.`;
  } else {
    reply =
      `Alles klar — ${itemLabel} fürs Hotel. ` +
      `Welches ist dein Hotel? Dann weiß ich, wo ich dich erinnern soll.`;
  }

  if (dueAtMs) {
    reply += ' Zeit halte ich zusätzlich im Blick.';
  }

  return {
    itemLabel,
    placeTypes: [],
    anchor: 'hotel',
    dueAtMs,
    reply,
    needsHotel,
  };
}

/**
 * „… und danach eine Zahnbürste kaufen“ — follow-up store task after another task.
 */
export function detectFollowUpBuyIntent(
  text: string,
): ShoppingTaskIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(
    /\b(?:danach|und\s+dann|anschlie[sß]end|später\s+noch|danach\s+noch)\b.{0,80}?(?:eine?\s+|einen\s+|ein\s+)?(.{2,40}?)\s+(?:kaufen|besorgen|holen|einkaufen)\b/iu,
  );
  if (!m?.[1]) return null;
  const itemLabel = cleanItem(m[1]);
  if (!itemLabel) return null;
  const placeTypes = categorizeItem(itemLabel);
  return {
    itemLabel,
    placeTypes,
    anchor: 'store',
    dueAtMs: parseDueAt(t),
    reply: `${itemLabel} kommt danach auf die Liste — ich melde mich am passenden Laden.`,
  };
}

export function detectShoppingTaskIntent(
  text: string,
): ShoppingTaskIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return null;

  // Hotel intents are handled separately (caller should try hotel first)
  if (HOTEL_WHERE_RE.test(t) && /\b(laden|aufladen|packen|checken)\b/i.test(t)) {
    return null;
  }

  let rawItem: string | null = null;
  const m1 = t.match(BUY_RE);
  if (m1?.[1]) rawItem = m1[1];
  if (!rawItem) {
    const m2 = t.match(BUY_ALT_RE);
    if (m2?.[1]) rawItem = m2[1];
  }
  if (!rawItem) {
    const m3 = t.match(BUY_NEED_RE);
    if (m3?.[1]) {
      const candidate = cleanItem(m3[1]);
      // „Ich brauche eine Zahnbürste“ auch ohne „DM/Rossmann“ im Satz
      if (
        candidate &&
        (/\b(drogerie|dm|rossmann)\b/i.test(t) ||
          categorizeItem(candidate)[0] === 'drugstore' ||
          categorizeItem(candidate)[0] === 'pharmacy')
      ) {
        rawItem = m3[1];
      }
    }
  }
  if (!rawItem) return null;

  const itemLabel = cleanItem(rawItem);
  if (!itemLabel) return null;

  const placeTypes = categorizeItem(itemLabel);
  const explicitDueAt = parseDueAt(t);
  const dueAtMs =
    explicitDueAt ?? (isEveningSensitiveItem(itemLabel) ? nextEveningReminderAt() : null);
  const storeHint =
    placeTypes[0] === 'drugstore'
      ? 'Drogerie wie DM oder Rossmann'
      : placeTypes[0] === 'pharmacy'
        ? 'Apotheke'
        : 'Supermarkt';

  const timeHint = explicitDueAt
    ? ' Ich halte auch die Zeit im Blick.'
    : dueAtMs
      ? ' Wenn du sie bis heute Abend noch nicht gekauft hast, erinnere ich dich gegen 18 Uhr nochmal.'
      : '';

  return {
    itemLabel,
    placeTypes,
    anchor: 'store',
    dueAtMs,
    reply:
      `Alles klar — ${itemLabel} steht auf der Liste. ` +
      `Wenn wir an einem ${storeHint} vorbeikommen, melde ich mich.` +
      timeHint,
  };
}

/** „Beim Café noch 5 € Verzehrgutscheine einlösen“ → Fact + Erinnerungs-Task */
export function detectVenueVoucherIntent(
  text: string,
): { placeHint: string; amountLabel: string | null; reply: string } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!/\b(gutschein|verzehrgutschein|wertgutschein)\b/iu.test(t)) return null;
  if (!/\b(erinner|merk|vergiss|brauch|muss|noch|einl[öo]s)\b/iu.test(t)) {
    return null;
  }
  const amountM = t.match(/\b(\d+[.,]?\d*)\s*(?:€|euro)\b/iu);
  const amount = amountM?.[1] ?? null;
  const place =
    t.match(
      /\b(?:bei|beim|im|in|am)\s+(?:der\s+|dem\s+|die\s+)?([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-&.']+){0,3})/u,
    )?.[1] ?? null;
  const placeHint = (place ?? '')
    .replace(/\b(gutschein|verzehr|euro|noch)\b/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (placeHint.length < 2) return null;
  const amountLabel = amount ? `${amount.replace('.', ',')} €` : null;
  return {
    placeHint,
    amountLabel,
    reply: amountLabel
      ? `Merke ich mir: ${amountLabel} Verzehrgutschein bei ${placeHint} — ich erinnere dich, wenn wir in der Nähe sind oder du den Ort planst.`
      : `Merke ich mir: Verzehrgutschein bei ${placeHint} — ich erinnere dich rechtzeitig.`,
  };
}

/** „Hab die Zahnbürste gekauft/gefunden“ / „Powerbank geladen“ / „erledigt“ */
export function detectShoppingTaskDoneIntent(
  text: string,
): { itemHint: string | null; clearAll: boolean } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (DONE_SIMPLE_RE.test(t)) {
    return { itemHint: null, clearAll: false };
  }
  const found = t.match(DONE_HAVE_FOUND_RE);
  if (found?.[1]) {
    const hint = cleanItem(found[1]);
    if (hint) return { itemHint: hint, clearAll: false };
  }
  const m = t.match(DONE_RE);
  if (!m) return null;
  const hint = m[1] ? cleanItem(m[1]) : null;
  return { itemHint: hint, clearAll: false };
}

export function categoryLabelDe(cat: ShoppingPlaceCategory): string {
  switch (cat) {
    case 'drugstore':
      return 'Drogerie';
    case 'supermarket':
      return 'Supermarkt';
    case 'pharmacy':
      return 'Apotheke';
    case 'convenience_store':
      return 'Laden';
    default:
      return 'Laden';
  }
}
