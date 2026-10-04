/**
 * Packliste nachträglich ändern — ergänzen, streichen, abhaken.
 * Reine Logik, kein Store.
 */

export type PackListEdit =
  | { kind: 'add'; labels: string[] }
  | { kind: 'remove'; query: string }
  | { kind: 'check'; query: string; done: boolean };

const CREATE =
  /\b(neue\s+packliste|packliste\s+(?:erstell|neu|machen|bauen)|erstelle?\s+(?:mir\s+)?(?:eine\s+)?packliste)\b/iu;

export function looksLikePackListEdit(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || CREATE.test(t)) return false;
  if (!/\bpackliste\b/iu.test(t)) return false;
  return /\b(ergänz\w*|dazu|noch|streich\w*|entfern\w*|lösch\w*|nimm|ohne|hak\w*|abhak\w*|abgehakt|erledigt|wieder\s+offen|hab(?:e)?\s+ich)\b/iu.test(
    t,
  );
}

function cleanLabel(raw: string): string {
  return String(raw || '')
    .replace(/^(den|die|das|der|einen|eine|ein)\s+/iu, '')
    .replace(/[?.!]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function splitLabels(raw: string): string[] {
  return raw
    .split(/\s*(?:,| und | & )\s*/iu)
    .map(cleanLabel)
    .filter((s) => s.length >= 2)
    .slice(0, 8);
}

export function parsePackListEdit(text: string): PackListEdit | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!looksLikePackListEdit(t)) return null;

  if (/\b(wieder\s+offen|doch\s+nicht\s+erledigt|abhaken\s+rückgängig)\b/iu.test(t)) {
    const q =
      t.match(/\b(?:packliste[:\s]+)?(.+?)\s+(?:wieder\s+offen|doch\s+nicht)/iu)?.[1] ||
      t.match(/\b(?:wieder\s+offen|doch\s+nicht\s+erledigt)\s*[:\-]?\s*(.+)$/iu)?.[1] ||
      '';
    const query = cleanLabel(q.replace(/\bpackliste\b/iu, ''));
    if (query) return { kind: 'check', query, done: false };
  }

  if (/\b(hak\w*|abhak\w*|abgehakt|erledigt|hab(?:e)?\s+ich|ist\s+drin)\b/iu.test(t)) {
    const q =
      t.match(
        /\b(?:hake|packliste)\s+(.+?)\s+(?:ab|auf\s+der\s+packliste|als\s+erledigt)/iu,
      )?.[1] ||
      t.match(/\b(.+?)\s+(?:ist\s+)?(?:erledigt|abgehakt|hab(?:e)?\s+ich)\b/iu)?.[1] ||
      '';
    const query = cleanLabel(q.replace(/\bpackliste\b/iu, ''));
    if (query) return { kind: 'check', query, done: true };
  }

  if (/\b(streich|entfern|lösch|nimm|ohne)\b/iu.test(t)) {
    const q =
      t.match(
        /\b(?:streich(?:e)?|entfern(?:e)?|lösch(?:e)?|nimm)\s+(?:mir\s+)?(.+?)\s+(?:von|aus|weg)\b/iu,
      )?.[1] ||
      t.match(/\bpackliste\s+ohne\s+(.+)$/iu)?.[1] ||
      t.match(/\bohne\s+(.+?)\s+(?:auf|in)\s+(?:der\s+)?packliste/iu)?.[1] ||
      '';
    const query = cleanLabel(q);
    if (query) return { kind: 'remove', query };
  }

  const addRaw =
    t.match(/\b(?:ergänz\w*|füg\w*)\b.*?\b(?:um|mit)\s+(.+)$/iu)?.[1] ||
    t.match(/\bpackliste\b.*?\b(?:um|dazu|noch)\s+(.+)$/iu)?.[1] ||
    t.match(/\b(?:noch|dazu)\s+(.+?)\s+(?:auf|in|zur)\s+(?:die\s+|der\s+)?packliste/iu)?.[1] ||
    '';
  const labels = splitLabels(addRaw.replace(/\bpackliste\b/iu, ''));
  if (labels.length) return { kind: 'add', labels };
  return null;
}

export function itemMatchesQuery(label: string, query: string): boolean {
  const a = label.toLowerCase();
  const b = query.toLowerCase().trim();
  if (!b) return false;
  if (a.includes(b) || b.includes(a.replace(/^\d+×\s*/u, ''))) return true;
  const token = b.split(/\s+/)[0] || '';
  return token.length >= 4 && a.includes(token);
}
