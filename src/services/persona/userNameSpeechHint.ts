/**
 * Aussprache-Schreibweise für den User-Vornamen.
 *
 * Anzeige / Reservierung / LLM bleiben `firstName` (Jonna).
 * Nur das TTS-Transcript darf die Hint-Form bekommen (Yonna),
 * damit Cartesia den Namen trifft — ohne IPA (zieht DE-Stimmen in US-Akzent).
 */

const MAX_HINT_LEN = 48;

/** Nur deutsche Buchstaben, Bindestrich, Apostroph, Leerzeichen. */
const HINT_KEEP_RE = /[^A-Za-zÄÖÜäöüß'\-\s]/g;

let skipUserNamePolicyDepth = 0;

export function isUserNamePolicySkipped(): boolean {
  return skipUserNamePolicyDepth > 0;
}

export function beginSkipUserNamePolicy(): void {
  skipUserNamePolicyDepth += 1;
}

export function endSkipUserNamePolicy(): void {
  skipUserNamePolicyDepth = Math.max(0, skipUserNamePolicyDepth - 1);
}

export function sanitizeNameSpeechHint(
  raw: string | null | undefined,
): string {
  if (!raw) return '';
  let s = raw.normalize('NFKC').replace(HINT_KEEP_RE, '').replace(/\s+/g, ' ').trim();
  if (s.length > MAX_HINT_LEN) s = s.slice(0, MAX_HINT_LEN).trim();
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchWordCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.charAt(0).toLowerCase() + replacement.slice(1);
}

/**
 * Ersetzt den geschriebenen Vornamen im Audio-Text durch die Hint-Form.
 * Untertitel / Display bleiben unangetastet (prepareDisplayText).
 */
export function applyFirstNameSpeechHint(
  text: string,
  firstName: string | null | undefined,
  hint: string | null | undefined,
  enabled?: boolean | null,
): string {
  if (!text) return text;
  if (enabled !== true) return text;
  const name = (firstName || '').trim();
  const spoken = sanitizeNameSpeechHint(hint);
  if (!name || name.length < 2 || !spoken) return text;
  if (spoken.toLowerCase() === name.toLowerCase()) return text;
  const esc = escapeRegExp(name);
  return text.replace(
    new RegExp(`(^|[^A-Za-zÄÖÜäöüß])(${esc})(?![A-Za-zÄÖÜäöüß])`, 'giu'),
    (_m, prefix: string, match: string) =>
      `${prefix}${matchWordCase(match, spoken)}`,
  );
}

/** Bekannte Stolpersteine — nur Vorschläge, nie Zwangs-Ausgabe. */
const KNOWN_HINTS: Record<string, string> = {
  jonna: 'Yonna',
  jonne: 'Yonne',
  jonas: 'Yonas',
  josef: 'Yosef',
  josefine: 'Yosefine',
  johanna: 'Yohanna',
  johannes: 'Yohannes',
  jens: 'Yens',
  jürgen: 'Yürgen',
  juergen: 'Yürgen',
  sean: 'Schohn',
  shaun: 'Schohn',
  siobhan: 'Schiwahn',
  niamh: 'Niew',
  chloe: 'Kloe',
  chloé: 'Kloe',
  celine: 'Selin',
  céline: 'Selin',
};

function pushUnique(out: string[], written: string, candidate: string): void {
  const hint = sanitizeNameSpeechHint(candidate);
  if (!hint) return;
  if (hint.toLowerCase() === written.toLowerCase()) return;
  if (out.some((x) => x.toLowerCase() === hint.toLowerCase())) return;
  out.push(hint);
}

/**
 * Lokale Umschreib-Vorschläge für deutsche Cartesia-Stimmen.
 * J am Wortanfang wird oft englisch /dʒ/ gelesen → Y trifft das deutsche /j/.
 */
export function suggestNameSpeechHints(firstName: string): string[] {
  const name = (firstName || '').trim();
  if (name.length < 2) return [];
  const out: string[] = [];
  const lower = name.toLowerCase();
  const known = KNOWN_HINTS[lower];
  if (known) pushUnique(out, name, known);

  if (/^[Jj][aeiouäöüyAEIOUÄÖÜY]/.test(name)) {
    pushUnique(out, name, `Y${name.slice(1)}`);
  }

  if (/[aeiouäöüy]$/i.test(name) && !/[hH]$/.test(name)) {
    pushUnique(out, name, `${name}h`);
  }

  return out.slice(0, 4);
}

/**
 * Automatischer KI-/Heuristik-Tipp — nie selbst aktivieren.
 * Nur klare Stolpersteine (J→Y, bekannte Namen), kein „Maria → Mariah“.
 */
export function preferAutoNameSpeechHint(firstName: string): string {
  const name = (firstName || '').trim();
  if (name.length < 2) return '';
  const known = KNOWN_HINTS[name.toLowerCase()];
  if (known) return sanitizeNameSpeechHint(known);
  if (/^[Jj][aeiouäöüyAEIOUÄÖÜY]/.test(name)) {
    return sanitizeNameSpeechHint(`Y${name.slice(1)}`);
  }
  return '';
}

/**
 * Immer ein sichtbarer Vorschlag: Umschrift wenn nötig, sonst der Vorname selbst.
 */
export function displayNameSpeechSuggestion(
  firstName: string,
  preferred?: string | null,
): string {
  const name = (firstName || '').trim();
  if (name.length < 2) return '';
  const extra = sanitizeNameSpeechHint(preferred);
  if (extra) return extra;
  const auto = preferAutoNameSpeechHint(name);
  return auto || name;
}

export function previewSentenceForName(spoken: string): string {
  const name = sanitizeNameSpeechHint(spoken);
  if (!name) return '';
  return `Moin ${name}.`;
}

/**
 * STT schreibt oft die Standard-Orthografie, nicht die Lautschrift.
 * Trotzdem als Startpunkt nutzbar — User hört danach Probe und justiert.
 */
export function speechHintFromTranscript(
  transcript: string,
  _writtenName?: string,
): string {
  const raw = (transcript || '').normalize('NFKC').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[„“”"'.!?:,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter((w) => /[A-Za-zÄÖÜäöüß]/.test(w));
  if (words.length === 0) return '';
  const skip = /^(ich|heiße|heisse|bin|mein|name|ist|also|äh|ähm)$/i;
  const picked = words.filter((w) => !skip.test(w));
  const token = (picked[0] ?? words[0] ?? '').trim();
  return sanitizeNameSpeechHint(token);
}

export async function suggestNameSpeechHintWithLlm(
  firstName: string,
  heardApprox?: string | null,
): Promise<string> {
  const name = (firstName || '').trim();
  if (name.length < 2) return '';
  const { generateGeminiText } = require('../geminiService') as {
    generateGeminiText: (
      prompt: string,
      options?: {
        useFindusSystem?: boolean;
        systemInstruction?: string;
        maxTokens?: number;
        temperature?: number;
        tier?: 'lite' | 'pro';
        task?: string;
      },
    ) => Promise<string>;
  };
  const heard = sanitizeNameSpeechHint(heardApprox);
  const prompt = [
    `Vorname wie geschrieben: ${name}`,
    heard ? `So ungefähr soll er klingen: ${heard}` : '',
    'Gib nur die Umschreibung in deutschen Buchstaben.',
  ]
    .filter(Boolean)
    .join('\n');
  const raw = await generateGeminiText(prompt, {
    useFindusSystem: false,
    systemInstruction:
      'Du prüfst, ob eine deutsche TTS-Stimme den Vornamen falsch sagen würde. Wenn die Schreibweise schon stimmt, wiederhole genau den Vornamen. Nur dann eine andere Umschreibung in deutschen Buchstaben. Kein IPA, kein Satz, keine Anführungszeichen.',
    maxTokens: 24,
    temperature: 0.2,
    tier: 'lite',
    task: 'generic',
  });
  const line = String(raw || '')
    .split(/\n/)[0]
    ?.replace(/^["'`„“]+|["'`“”]+$/g, '')
    .trim();
  const hint = sanitizeNameSpeechHint(line);
  if (!hint || hint.toLowerCase() === name.toLowerCase()) return '';
  return hint;
}

const llmHintCache = new Map<string, string>();

/** Pro Vorname einmal überlegen — Ergebnis nur Vorschlag, nie Auto-Aktivierung. */
export async function considerNameSpeechHint(
  firstName: string,
): Promise<string> {
  const name = (firstName || '').trim();
  if (name.length < 2) return '';
  const key = name.toLowerCase();
  const cached = llmHintCache.get(key);
  if (cached !== undefined) return cached;
  const local = preferAutoNameSpeechHint(name);
  let next = local;
  try {
    const llm = await suggestNameSpeechHintWithLlm(name, local);
    if (llm) next = llm;
  } catch {
    /* local bleibt */
  }
  const out =
    next && next.toLowerCase() !== name.toLowerCase() ? next : '';
  llmHintCache.set(key, out);
  return out;
}
