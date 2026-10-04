/**
 * Live-Durchgang der Packliste — Handy auf dem Tisch, Yorro führt durch.
 * Reine Befehle, kein Store.
 */

export type PackWalkItem = {
  id: string;
  label: string;
  done: boolean;
  qty?: number | null;
  priority?: 'high' | 'normal' | null;
  later?: boolean;
};

export type PackWalkCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'missing' }
  | { type: 'later'; query: string | null }
  | { type: 'enough'; qty: number; query: string | null }
  | { type: 'priority'; query: string | null; leadMin: number }
  | { type: 'done'; query: string | null }
  | { type: 'next' };

const START =
  /\b(packliste\s+durch|durch\s+die\s+packliste|führ(?:e)?\s+mich\s+durch|lass\s+uns\s+packen|packliste\s+live|geh(?:en)?\s+wir\s+die\s+packliste)\b/iu;

export function looksLikePackWalkStart(text: string): boolean {
  return START.test(String(text || ''));
}

export function looksLikePackWalkReply(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 180) return false;
  return (
    /\b(später|spaeter|danach|mach\s+ich\s+später)\b/iu.test(t) ||
    /\b(langt|reicht|genug)\b/iu.test(t) ||
    /\b(wichtig|priorit)/iu.test(t) ||
    /\b(was\s+fehlt|fehlt\s+noch|was\s+ist\s+noch\s+offen)\b/iu.test(t) ||
    /\b(hab\s+ich|ist\s+drin|erledigt|passt|ja|weiter|nächste[rs]?|naechste[rs]?)\b/iu.test(
      t,
    ) ||
    /\b(stopp|fertig|pause|reicht\s+jetzt)\b/iu.test(t) ||
    /\b(erinner\w*)\b/iu.test(t) ||
    /\b(hochzeit|trauung|anzug|tennis|jeden\s+tag|täglich|taeglich|ah\s+ja|ach\s+ja)\b/iu.test(t)
  );
}

function cleanQuery(raw: string | undefined | null): string | null {
  const s = String(raw || '')
    .replace(/\b(die|den|das|der|meine?|meine)\b/giu, ' ')
    .replace(/\bpackliste\b/giu, ' ')
    .replace(/[?.!]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 3 ? s.slice(0, 60) : null;
}

export function parsePackWalkTurn(
  text: string,
  opts: { walking: boolean },
): PackWalkCommand | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (looksLikePackWalkStart(t)) return { type: 'start' };
  const armed = opts.walking || /\bpackliste\b/iu.test(t);
  if (!armed || !looksLikePackWalkReply(t)) return null;

  if (/\b(stopp|fertig|pause|reicht\s+jetzt|hör\s+auf|hoer\s+auf)\b/iu.test(t)) {
    return { type: 'stop' };
  }
  if (/\b(was\s+fehlt|fehlt\s+noch|was\s+ist\s+noch\s+offen)\b/iu.test(t)) {
    return { type: 'missing' };
  }

  const enough = t.match(
    /\b(?:habe?|hab)\s+(\d{1,2})\s+(.+?)(?:\s*[,.]|\s+das\s+(?:langt|reicht)|\s+reicht|\s+langt|\s+genug|$)/iu,
  );
  if (enough && /\b(langt|reicht|genug)\b/iu.test(t)) {
    const qty = Math.max(1, Math.min(30, Number(enough[1])));
    return { type: 'enough', qty, query: cleanQuery(enough[2]) };
  }

  if (/\b(wichtig|priorit|erinner)/iu.test(t)) {
    const named =
      t.match(/\b(?:an\s+)?(.+?)\s+ist\s+wichtig\b/iu)?.[1] ||
      t.match(/\berinner\w*\s+(?:mich\s+)?(?:an\s+)?(.+?)(?:\s+drin|\s*$)/iu)?.[1] ||
      null;
    const lead = t.match(/\b(\d{1,3})\s*min/iu);
    return {
      type: 'priority',
      query: cleanQuery(named),
      leadMin: lead ? Math.max(5, Math.min(180, Number(lead[1]))) : 30,
    };
  }

  if (/\b(später|spaeter|danach|mach\s+ich\s+später)\b/iu.test(t)) {
    const named = t.match(/\b(.+?)\s+(?:mach\s+ich\s+)?später\b/iu)?.[1];
    return { type: 'later', query: cleanQuery(named) };
  }

  if (/\b(weiter|nächste[rs]?|naechste[rs]?|überspring|ueberspring)\b/iu.test(t)) {
    return { type: 'next' };
  }

  if (/\b(hab\s+ich|ist\s+drin|erledigt|passt|ja\b|done)\b/iu.test(t)) {
    const named = t.match(/\b(.+?)\s+(?:hab\s+ich|ist\s+drin|erledigt)\b/iu)?.[1];
    return { type: 'done', query: cleanQuery(named) };
  }

  return null;
}

export function nextOpenIndex(items: PackWalkItem[], from: number): number {
  if (!items.length) return -1;
  const start = Math.max(0, from);
  for (let i = start; i < items.length; i++) {
    if (!items[i]!.done) return i;
  }
  for (let i = 0; i < start; i++) {
    if (!items[i]!.done) return i;
  }
  return -1;
}

function normPack(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/×/g, 'x')
    .replace(/^\d+x\s*/u, '')
    .replace(/\b(?:unterwaesche|unterhosen?|slips?|boxershorts?)\b/g, 'unterwaesche');
}

export function matchWalkItem(
  items: PackWalkItem[],
  query: string | null,
  cursor: number,
): PackWalkItem | null {
  if (query) {
    const q = normPack(query);
    const hit = items.find((it) => {
      const bare = normPack(it.label);
      return bare.includes(q) || q.includes(bare);
    });
    if (hit) return hit;
  }
  const idx = items[cursor] && !items[cursor]!.done ? cursor : nextOpenIndex(items, cursor);
  return idx >= 0 ? items[idx]! : null;
}

export function packWalkCue(item: PackWalkItem): string {
  const qty =
    item.qty != null && item.qty > 1 ? ` Ich hätte ${item.qty} eingeplant.` : '';
  return `Als Nächstes ${item.label}.${qty} Passt das so, machst du es später, oder ist es wichtig?`;
}

export function missingSpeech(items: PackWalkItem[]): string {
  const open = items.filter((i) => !i.done);
  if (!open.length) return 'Die Packliste ist durch — nichts fehlt mehr.';
  const ranked = [...open].sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : a.later ? 2 : 1;
    const pb = b.priority === 'high' ? 0 : b.later ? 2 : 1;
    return pa - pb;
  });
  const top = ranked.slice(0, 4);
  const names = top.map((i) => {
    if (i.priority === 'high') return `${i.label} — dir wichtig`;
    if (i.later) return `${i.label} — später`;
    return i.label;
  });
  const rest = open.length - top.length;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  const more = rest > 0 ? ` Danach noch ${rest}.` : '';
  return `Offen ${open.length === 1 ? 'ist noch' : 'sind noch'} ${list}.${more}`;
}

/** Gesprochene Erinnerung kurz vor der Abfahrt — Struktur, kein Orts-Skript. */
export function packRemindSpeech(opts: {
  itemLabel: string;
  departLabel: string;
  leadMin: number;
}): string {
  const min = Math.max(5, Math.round(opts.leadMin));
  return `In ${min} Minuten musst du ${opts.departLabel} bekommen. Mach dich bitte bereit und denk daran, ${opts.itemLabel} noch einzupacken.`;
}
