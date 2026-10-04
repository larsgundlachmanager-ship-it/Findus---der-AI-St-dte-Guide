/**
 * Lokale Instant-Antworten (Rechnung) — ohne LLM/Recherche.
 * Call-1 = Lead, Call-2 = nur Ergebnis.
 * Ketten (5+5+5, 10 mal 3 minus 2) lokal — nicht nur Zwei-Zahlen-Muster.
 */

export type LocalInstantAnswer = {
  lead: string;
  speech: string;
  bullets: string[];
};

type MathOp = '+' | '-' | '*' | '/';

function parseOpToken(raw: string): MathOp | null {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t === '+' || t === 'plus' || t === 'und') return '+';
  if (t === '-' || t === 'minus') return '-';
  if (t === '*' || t === 'x' || t === '×' || t === 'mal' || t === '·') return '*';
  if (
    t === '/' ||
    t === ':' ||
    t === '÷' ||
    t === 'geteilt' ||
    t === 'durch' ||
    t === 'geteilt durch'
  ) {
    return '/';
  }
  return null;
}

function prettyNum(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
    return String(Math.round(n));
  }
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

function applyOp(a: number, op: MathOp, b: number): number | null {
  if (op === '/' && b === 0) return null;
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  return a / b;
}

/** * / vor + − (Schul-Reihenfolge). */
function evalOps(nums: number[], ops: MathOp[]): number | null {
  if (nums.length < 2 || ops.length !== nums.length - 1) return null;
  const n = nums.slice();
  const o = ops.slice();
  for (let i = 0; i < o.length; ) {
    if (o[i] === '*' || o[i] === '/') {
      const r = applyOp(n[i], o[i], n[i + 1]);
      if (r == null || !Number.isFinite(r)) return null;
      n.splice(i, 2, r);
      o.splice(i, 1);
    } else {
      i += 1;
    }
  }
  let acc = n[0];
  for (let i = 0; i < o.length; i++) {
    const r = applyOp(acc, o[i], n[i + 1]);
    if (r == null || !Number.isFinite(r)) return null;
    acc = r;
  }
  return acc;
}

/**
 * Uhrzeit, Temperaturspanne, Termin — nie Kopfrechnen.
 * „18 Uhr“, „18:00“, „13-18 Grad“, Flug/Termin.
 */
export function looksLikeClockOrRangeNotMath(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(uhr|grad|°c|°\s|wecker|termin|treffen|abflug|boarding|flieger|fliegen|flug\b|ankunft|leave-?by)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // „18:00“ / „18.30 Uhr“ / „um 18“ ohne Rechenwort
  if (
    /\b(?:um|gegen)\s+\d{1,2}(?:[:.]\d{2})?\b/iu.test(t) ||
    /\b\d{1,2}\s*[:.]\s*[0-5]\d\b/.test(t)
  ) {
    return true;
  }
  if (/\b\d{1,3}\s*[-–—−]\s*\d{1,3}\s*(?:grad|°|uhr|min)/iu.test(t)) {
    return true;
  }
  if (/\bbis\b/iu.test(t) && /\d/.test(t) && !/\b(minus|plus|mal|geteilt)\b/iu.test(t)) {
    return true;
  }
  return false;
}

function hasExplicitMathIntent(userText: string): boolean {
  return /\b(was\s+ist|rechne|rechner|berechne|ausrechnen|wieviel\s+ist|wie\s+viel\s+ist|plus|minus|mal\b|geteilt)\b/iu.test(
    userText || '',
  );
}

/**
 * Tokenisiert Zahlen + Operatoren aus dem Satz (auch Ketten).
 * „geteilt durch“ als ein Op; „und“ nur zwischen Zahlen.
 */
export function extractMathChain(userText: string): {
  nums: number[];
  ops: MathOp[];
  labels: string[];
} | null {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  if (looksLikeClockOrRangeNotMath(t) && !hasExplicitMathIntent(t)) {
    return null;
  }

  // Nur wenn klar Rechen-Intent oder reine Ziffernkette
  const looksMath =
    /\b(\d{1,12}(?:[.,]\d{1,4})?)\s*(\+|plus|und|-|minus|\*|x|×|mal|·|\/|:|÷|geteilt(?:\s+durch)?|durch)\s*(\d{1,12}(?:[.,]\d{1,4})?)/iu.test(
      t,
    ) ||
    /\b(was\s+ist|rechne|rechner|berechne|ausrechnen|wieviel\s+ist|wie\s+viel\s+ist)\b/iu.test(
      t,
    );
  if (!looksMath) return null;
  // Doppelpunkt nur als Division wenn wirklich gerechnet wird — sonst Uhrzeit.
  if (
    /:/.test(t) &&
    !hasExplicitMathIntent(t) &&
    !/\b(geteilt|durch|÷)\b/iu.test(t)
  ) {
    return null;
  }

  const nums: number[] = [];
  const ops: MathOp[] = [];
  const labels: string[] = [];

  const re =
    /(\d{1,12}(?:[.,]\d{1,4})?)|(\+|plus|und|-|minus|\*|x|×|mal|·|\/|:|÷|geteilt(?:\s+durch)?|durch)/giu;
  let m: RegExpExecArray | null;
  let expectNum = true;
  while ((m = re.exec(t)) !== null) {
    if (m[1]) {
      if (!expectNum) break;
      const label = String(m[1]).replace('.', ',');
      const n = Number(String(m[1]).replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      nums.push(n);
      labels.push(label);
      expectNum = false;
      continue;
    }
    const opRaw = (m[2] || '').replace(/\s+/g, ' ').trim();
    // „und“ nur als Plus zwischen Zahlen — sonst Satz-Müll
    if (/^und$/iu.test(opRaw) && expectNum) continue;
    if (expectNum) {
      // führendes Minus vor Zahl: −3
      if (/^(-|minus)$/iu.test(opRaw)) {
        const next = re.exec(t);
        if (next?.[1]) {
          const label = `-${String(next[1]).replace('.', ',')}`;
          const n = -Number(String(next[1]).replace(',', '.'));
          if (!Number.isFinite(n)) return null;
          nums.push(n);
          labels.push(label);
          expectNum = false;
          continue;
        }
      }
      continue;
    }
    const op = parseOpToken(opRaw);
    if (!op) break;
    ops.push(op);
    expectNum = true;
  }

  if (nums.length < 2 || ops.length !== nums.length - 1) return null;
  // Sanity: mind. ein echter Rechen-Op im Satz (nicht nur Zufallszahlen)
  if (ops.length === 0) return null;
  if (nums.length > 16) return null;
  return { nums, ops, labels };
}

/** Einfache Kopfrechnung — auch Ketten mit mehreren Zahlen. */
export function tryLocalArithmeticAnswer(userText: string): LocalInstantAnswer | null {
  const chain = extractMathChain(userText);
  if (!chain) return null;

  const result = evalOps(chain.nums, chain.ops);
  if (result == null || !Number.isFinite(result)) return null;
  // Overflow / Unsinn abfangen
  if (Math.abs(result) > 1e15) return null;

  const pretty = prettyNum(result);
  if (!pretty) return null;

  const longChain = chain.nums.length >= 3 || chain.ops.length >= 2;
  // Lange Ketten: immer „Das Ergebnis ist“ + Zahl (Call-2 = so viel).
  // Kurz: optional „5 plus 5 ist“.
  let lead: string;
  if (longChain) {
    lead = 'Das Ergebnis ist';
  } else {
    const aLabel = chain.labels[0];
    const bLabel = chain.labels[1];
    const op = chain.ops[0];
    const opWord =
      op === '+' ? 'plus' : op === '-' ? 'minus' : op === '*' ? 'mal' : 'geteilt durch';
    lead =
      Math.round(Math.abs(chain.nums[0]) + Math.abs(chain.nums[1])) % 2 === 0
        ? `${aLabel} ${opWord} ${bLabel} ist`
        : 'Das Ergebnis ist';
  }

  return {
    lead,
    speech: pretty,
    bullets: [`Ergebnis: ${pretty}`],
  };
}

/** Wurzel / einfache Instant-Mathe darüber hinaus. */
export function tryLocalMathAnswer(userText: string): LocalInstantAnswer | null {
  const arith = tryLocalArithmeticAnswer(userText);
  if (arith) return arith;
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const sqrt = t.match(/\bquadratwurzel\s+(?:aus\s+|von\s+)?(\d+(?:[.,]\d+)?)/iu)
    || t.match(/\bwurzel\s+(?:aus\s+|von\s+)?(\d+(?:[.,]\d+)?)/iu);
  if (sqrt) {
    const n = Number(String(sqrt[1]).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    const r = Math.sqrt(n);
    const pretty =
      Number.isInteger(r) || Math.abs(r - Math.round(r * 100) / 100) < 1e-9
        ? String(Math.round(r * 100) / 100).replace('.', ',')
        : (Math.round(r * 100) / 100).toFixed(2).replace('.', ',');
    const nLabel = String(sqrt[1]).replace('.', ',');
    return {
      lead: `Die Quadratwurzel aus ${nLabel} liegt bei`,
      speech: `etwa ${pretty}`,
      bullets: [`Ergebnis: ≈ ${pretty}`],
    };
  }
  return null;
}

/** Ob der Satz eine Instant-Schnellfrage ist (Peek/Local, kein Cover-Theater). */
export function isInstantFastAsk(userText: string): boolean {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (tryLocalMathAnswer(t) || tryLocalArithmeticAnswer(t)) return true;
  if (/\bwie\s+alt\s+ist\b/iu.test(t)) return true;
  if (/\bwer\s+ist\b/iu.test(t) && t.length < 80) return true;
  if (/\b(dollar|euro|pfund|yen|quadratwurzel|hektar|quadratmeter)\b/iu.test(t)) {
    return true;
  }
  if (/\b(wie\s+viele\s+einwohner|einwohnerzahl|fläche|flaeche)\b/iu.test(t)) return true;
  try {
    const { isQuickLookupQuery } = require('../concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    if (isQuickLookupQuery(t)) return true;
  } catch {
    /* soft */
  }
  return false;
}
