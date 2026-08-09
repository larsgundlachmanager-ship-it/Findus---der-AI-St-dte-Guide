/**
 * Modul-5 Draft → nur vorlesbarer Text.
 *
 * Wichtig: FAKTEN/FLOW waren interne Agent-Hinweise für eine LLM-Synthese,
 * die in M5 oft gar nicht läuft — Draft geht nach diesem Filter direkt an TTS.
 * Deshalb: FAKTEN/FLOW und Instruktions-Sätze HARD droppen, nie vorlesen.
 */

import { isProtectedDot } from '../../services/audio/punctuationChunker';

const INSTRUCTION_LINE =
  /\b(kurz sagen|kurz nachfragen|kurz bestätigen|nicht wörtlich|nicht abdriften|Zeitersparnis nennen|Action-Buttons|Blind-Optionen|keine Meta|max\s*\d+\s*Sätze|nicht jetzt automatisch|Feintuning und Buchen|nur wenn du willst|darauf eingehen|nicht als neuen Wunsch|Bitte prüfen|FLOW\s*:|FAKTEN\s+(BESTÄTIGUNG|BRÜCKE|Planung)|Live-Bau|Hybrid\s*Phase|blau = noch|Blau aufgelöst|Optionen bauen|Plan sortieren|Wege berechnen|Gap-?Fill|Hintergrund)\b/i;

const META_LINE =
  /^(FLOW\b|FAKTEN\b|FLOW\s+(TON|GUARD)|User-Kontext|Constraints bindend|Aktueller Wunsch:|Live-Bau:|Scope:|Planungstag:|Offene Pläne|Schon abgelehnt|Nicht nochmal:|Label:|Status:|Hybrid\b|Ablehnungsrunde|Buchungen\/|Wege gesetzt|Nav-Trigger|Ort-Kontext:|GPS\s*~|Disclaimer|FEW.SHOT|FINDUS_|PHASE\s*\d|STRUKTUR-BLAUPAUSE|MODUL\s*5\s*VOICE|Timeline|nächster Schritt|zwei Optionen|2 Optionen)\b/i;

const PROCESS_SPEECH =
  /\b(zwei Optionen|2 Optionen|Optionen bauen|ich bau(e)?|Plan sortier|sortier(e)? den Plan|Wege gesetzt|Gap-?Fill|Hybrid\s*Phase|PHASE\s*\d|Timeline öffnen|nächster Schritt im Plan|Fortbewegung umgestellt)\b/i;

function stripFaktenPrefix(s: string): string {
  return s
    .replace(/^FAKTEN(?:\s+[A-ZÄÖÜa-zäöü\-]+)?\s*:\s*/i, '')
    .replace(/^FAKTEN\s+/i, '')
    .trim();
}

function cleanInline(s: string): string {
  return s
    .replace(/^Option\s*\d+\s*(?:\(Favorit\))?:\s*/i, '')
    .replace(/\bPrio\s*[1-6]\s*(?:·\s*)?[^\s·,]*/gi, '')
    .replace(/\bP\s*[1-6]\b/gi, '')
    .replace(/\s*·\s*bitte bestätigen/gi, '')
    .replace(/\((?:Favorit)\)/gi, '')
    .replace(/\b(insert_fixed|select_place|wish_only|pending_change|confirm_fixes|ping_pong)\b/gi, '')
    .replace(/\b(Blau aufgelöst|Fix-Nav bleibt grün|Hybridphase\s*[0-9\-–]+\s*|Hybrid Phase\s*[0-9\-–]+\s*)/gi, '')
    .replace(/\b(zwei Optionen|2 Optionen)\b/gi, '')
    .replace(/\bIst eingeloggt!?/gi, 'Check.')
    .replace(/\bAls Nächstes\b/gi, 'Weiter')
    .replace(/\[Preis-Hint:[^\]]*\]/gi, '')
    // Alles ab FLOW: weg (Instruktion an Synthese)
    .replace(/\s*FLOW\s*:.*$/i, '')
    .replace(/\s*FLOW\s+(TON|GUARD)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

function isInstructionOrMeta(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^FLOW\b/i.test(t)) return true;
  if (META_LINE.test(t)) return true;
  if (INSTRUCTION_LINE.test(t)) return true;
  if (PROCESS_SPEECH.test(t) && t.length < 80) return true;
  // Reine Regie-Anweisungen ohne konkreten Ort/Zeit-Inhalt
  if (
    /^(Bestätigen|kurz bestätigen|Weiter oder Abbrechen|neuer Wunsch|nicht neu planen)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function isPitchLine(raw: string, human: string): boolean {
  if (/^[🥇🥈]/.test(raw.trim()) || /^[🥇🥈]/.test(human.trim())) return true;
  if (/^Oder du wählst meinen Favorit/i.test(raw) || /^Oder du wählst meinen Favorit/i.test(human)) {
    return true;
  }
  if (human.length >= 280 && (human.match(/[.!?]/g) || []).length >= 3) {
    return true;
  }
  return false;
}

/**
 * Eine Draft-Zeile → vorlesbarer Text oder null.
 * FAKTEN: nur den menschlichen Teil nach dem Doppelpunkt, wenn kein Instruktions-Ton.
 * FLOW: immer null.
 */
function extractHumanFromLine(line: string): string | null {
  let l = line.trim();
  if (!l) return null;

  // Mehrere Blöcke in einer Zeile: „FAKTEN: … FLOW: …“
  if (/\bFLOW\s*:/i.test(l)) {
    l = l.replace(/\s*FLOW\s*:.*$/i, '').trim();
  }
  if (!l) return null;

  if (/^FLOW\b/i.test(l)) return null;
  if (/Disclaimer|FEW.SHOT|FINDUS_|PHASE\s*\d|STRUKTUR-BLAUPAUSE/i.test(l)) {
    return null;
  }

  const opt = l.match(/^Option\s*\d+\s*(?:\(Favorit\))?:\s*(.+)$/i);
  if (opt?.[1]) {
    const body = cleanInline(opt[1]);
    return body.length >= 8 && !isInstructionOrMeta(body) ? body : null;
  }

  if (/^[🥇🥈]/.test(l) || /^Oder du wählst meinen Favorit/i.test(l)) {
    const cleaned = cleanInline(l);
    return cleaned.length >= 8 ? cleaned : null;
  }

  if (/^FAKTEN\b/i.test(l)) {
    const after = stripFaktenPrefix(l);
    if (!after) return null;
    if (isInstructionOrMeta(after)) return null;
    // Label-only FAKTEN ohne Inhalt
    if (/^(BESTÄTIGUNG|BRÜCKE|Planung|AUSWAHL|Abschluss)/i.test(after)) {
      return null;
    }
    const cleaned = cleanInline(after);
    if (!cleaned || isInstructionOrMeta(cleaned)) return null;
    // Kurze Acks
    if (/^(Ist eingeloggt|Check|Geht klar|Wird gemacht|Perfekt|Super Wahl|Planung pausiert|Planung abgebrochen)/i.test(cleaned)) {
      return cleaned;
    }
    if (cleaned.length < 10) return null;
    return cleaned;
  }

  if (isInstructionOrMeta(l)) return null;

  const cleaned = cleanInline(l);
  if (!cleaned || cleaned.length < 8) return null;
  if (isInstructionOrMeta(cleaned)) return null;
  return cleaned;
}

function compressManagerLine(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  t = t
    .replace(/\b(übrigens|eigentlich|vielleicht|ggf\.|gegebenenfalls)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Ersten echten Satz behalten — nie an ca./Dr./z.B. abschneiden
  const maxScan = Math.min(t.length, 160);
  for (let i = 7; i < maxScan; i++) {
    const ch = t[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.' && isProtectedDot(t, i)) continue;
    const next = t[i + 1] ?? '';
    if (next && !/[\s"'»]/.test(next)) continue;
    return t.slice(0, i + 1).trim();
  }
  if (t.length > 110) return `${t.slice(0, 107).replace(/\s+\S*$/, '')}…`;
  return t;
}

function dedupeSentences(text: string): string {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  const keys: string[] = [];
  for (const p of parts) {
    if (isInstructionOrMeta(p)) continue;
    const k = p.toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (keys.some((x) => x === k || k.includes(x.slice(0, 28)) || x.includes(k.slice(0, 28)))) {
      continue;
    }
    keys.push(k);
    out.push(p);
  }
  return out.join(' ');
}

/**
 * Draft → vorlesbar. Manager-Zeilen kurz; Pitches (🥇/🥈) voll.
 */
export function humanizeAgentDraft(
  draft: string,
  opts?: { maxChars?: number; maxParts?: number; managerMode?: boolean },
): string {
  const managerMode = opts?.managerMode !== false;
  const maxChars = opts?.maxChars ?? 1400;
  const maxParts = opts?.maxParts ?? (managerMode ? 8 : 10);
  const raw = (draft || '').replace(/\r/g, '').trim();
  if (!raw) return '';

  // Auch „FAKTEN: x. FLOW: y“ ohne Newline auftrennen
  const normalized = raw
    .replace(/\s+FLOW\s*:/gi, '\nFLOW:')
    .replace(/\s+FAKTEN\s+/gi, '\nFAKTEN ');

  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const line of lines) {
    const human = extractHumanFromLine(line);
    if (!human) continue;
    if (parts.some((p) => p.toLowerCase() === human.toLowerCase())) continue;
    const piece =
      managerMode && !isPitchLine(line, human)
        ? compressManagerLine(human)
        : human;
    if (!piece || piece.length < 3) continue;
    if (isInstructionOrMeta(piece) && !isPitchLine(line, piece)) continue;
    if (parts.some((p) => p.toLowerCase() === piece.toLowerCase())) continue;
    parts.push(piece);
    if (parts.length >= maxParts) break;
  }

  let out = dedupeSentences(parts.join(' ').replace(/\s+/g, ' ').trim());

  out = out.replace(
    /(Kommen wir zu[^.!?]*[.!?])(?:\s+Kommen wir zu[^.!?]*[.!?])+/gi,
    '$1',
  );

  // Safety: nie FLOW/FAKTEN-Labels im Endtext
  out = out
    .replace(/\bFAKTEN(?:\s+[A-Za-zÄÖÜäöü\-]+)?\s*:\s*/gi, '')
    .replace(/\bFLOW\s*:\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars - 1);
    let lastEnd = -1;
    for (let i = cut.length - 1; i >= Math.floor(maxChars * 0.5); i--) {
      const ch = cut[i]!;
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      if (ch === '.' && isProtectedDot(cut, i)) continue;
      const next = cut[i + 1] ?? '';
      if (next && next !== ' ') continue;
      lastEnd = i;
      break;
    }
    out =
      lastEnd > 0
        ? cut.slice(0, lastEnd + 1).trim()
        : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return out;
}

export function humanizeBullets(bullets: string[], max = 3): string[] {
  const out: string[] = [];
  const MAX_LEN = 42; // 1 Zeile
  for (const b of bullets ?? []) {
    const raw = String(b || '').trim();
    if (!raw) continue;
    if (/^Prio\s*\d/i.test(raw) || /^P\s*[1-6]\b/i.test(raw)) continue;
    if (isInstructionOrMeta(raw) && raw.length < 80) continue;
    // TTS-/Meta-Lecks und leere Maß-Labels nie in die UI
    if (
      /\b(ausgeschrieben|buchstabier|in worten)\b/iu.test(raw) ||
      /[:：]\s*(\.\.\.|…)?\s*$/u.test(raw) ||
      (/\b(höhe|stufen|eintritt|preis)\b/iu.test(raw) && !/\d/.test(raw))
    ) {
      continue;
    }
    let t = cleanInline(stripFaktenPrefix(raw)).replace(/[\r\n]+/g, ' ');
    t = t.replace(/\s*ausgeschrieben\b.*$/iu, '').trim();
    if (!t || isInstructionOrMeta(t)) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    if (t.length > MAX_LEN) {
      const cut = t.slice(0, MAX_LEN);
      const sp = cut.lastIndexOf(' ');
      t = `${(sp > 12 ? cut.slice(0, sp) : cut).trim()}`;
    }
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
