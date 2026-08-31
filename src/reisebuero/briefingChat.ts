/**
 * Phase A — Tischgespräch, keine Tools, keine Suche-Angebote.
 * Board hält die Notizen. Speech = eingehen + eine menschliche Frage.
 */

import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_REISEBUERO_DEEP_BRIEFING_BLOCK,
} from '../services/concierge/findusResponsePolicy';
import { generateGeminiText, hasGeminiApiKey } from '../services/geminiService';
import { getCachedUserProfile } from '../services/userProfileService';
import {
  briefingPath,
  buildRecapLines,
  nextQuestionKey,
} from './completeness';
import { useReisebueroStore } from './store';
import { hydrateTasteMemory, tastePersona, tastePromptLine } from './tasteMemory';
import type { ReiseLedger } from './types';
import { detectTripVibes, probeDirection, vibeDigest } from './vibeProbes';

function ledgerDigest(ledger: ReiseLedger): string {
  return buildRecapLines(ledger).join(' | ') || '(noch dünn)';
}

function firstName(): string {
  try {
    return (getCachedUserProfile()?.firstName || '').trim();
  } catch {
    return '';
  }
}

function lastUserLine(): string {
  const chat = useReisebueroStore.getState().trip.chat;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i]?.role === 'user') return chat[i]!.text;
  }
  return '';
}

function groupWord(ledger: ReiseLedger): 'du' | 'ihr' {
  const n = ledger.adults?.value ?? 0;
  return n > 1 ? 'ihr' : 'du';
}

function recentChat(): string {
  const chat = useReisebueroStore.getState().trip.chat;
  return chat
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'User' : 'Yorro'}: ${t.text}`)
    .join('\n') || '(noch leer)';
}

function fallbackHint(askedKey: string | null, opening: boolean): string {
  if (opening) return 'Wie kann ich helfen?';
  if (askedKey === 'adults') return 'Allein oder zu mehreren?';
  if (askedKey === 'when') return 'Wann soll’s losgehen?';
  if (askedKey === 'budget') return 'Was schwebt preislich vor?';
  if (askedKey === 'mode') return 'Wie kommt ihr hin?';
  if (askedKey === 'lodging') return 'Wo wollt ihr unterkommen?';
  if (askedKey === 'departWindow') return 'Los- und Ankunftszeit?';
  if (askedKey === 'directFlight') return 'Direktflug wichtig?';
  if (askedKey === 'weather') return 'Wie soll das Wetter sein?';
  if (askedKey === 'driveTime') return 'Wie weit darf die Anfahrt sein?';
  if (askedKey === 'purpose') return 'Was für eine Reise soll das werden?';
  if (askedKey === 'locationBias') return 'Eher zentral oder ruhig?';
  if (askedKey === 'lastTrip') return 'Highlight vom letzten Urlaub?';
  if (askedKey === 'highlight') return 'Was wäre euer Highlight?';
  if (askedKey === 'dealbreaker') return 'Was darf nicht passieren?';
  if (askedKey === 'partyStyle') return 'Clubs, Bars oder Open Air?';
  if (askedKey === 'spaStyle') return 'Pool, Meer, Massage, Sauna?';
  if (askedKey === 'kidsStyle') return 'Was mögen die Kinder?';
  if (askedKey === 'tripShape') return 'Ein Ort oder mehrere?';
  if (askedKey === 'ideaHook') return 'Wäre das was für euch?';
  if (askedKey === 'extraWishes') return 'Noch Wünsche aufs Board?';
  if (askedKey === 'rentalCar') return 'Mietwagen dazu?';
  if (askedKey === 'wrap_up') return 'Soll ich suchen?';
  if (askedKey === 'keep_talking') return 'Sonst Suche starten?';
  return 'Was soll noch aufs Board?';
}

function fallbackOpening(): { speech: string; hint: string } {
  const name = firstName();
  const speech = name ? `Hey ${name}, wie kann ich dir helfen?` : 'Hey, wie kann ich dir helfen?';
  return { speech, hint: 'Wie kann ich helfen?' };
}

function fallbackSpeech(
  ledger: ReiseLedger,
  asked: string[],
  userLine: string,
): { speech: string; askedKey: string | null; hint: string } {
  const gap = nextQuestionKey(ledger, asked);
  const addr = groupWord(ledger);
  const hint = fallbackHint(gap.key, false);
  const ack = reactFallback(userLine, ledger);
  if (gap.key === 'purpose') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was für eine Reise soll das werden — Stadt, Strand, oder eher so ein Mix?`
          : `${ack} Was für eine Reise soll das werden?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'adults') {
    return {
      speech: addr === 'ihr' ? `${ack} Wie viele seid ihr insgesamt?` : `${ack} Bist du allein unterwegs oder sind noch Leute dabei?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'origin') {
    const home = ledger.originCity?.value;
    const last = userLine.replace(/\s+/g, ' ').trim();
    const odd = /\b(kristof|christoph|christopher)\b/iu.test(last);
    return {
      speech: odd
        ? `${ack} Den Startort hab ich nicht erkannt. Welcher Ort — oder von ${home || 'zu Hause'} aus?`
        : home
          ? `${ack} Startet ihr von ${home} aus, oder trefft ihr euch woanders?`
          : addr === 'ihr'
            ? `${ack} Von wo wollt ihr starten?`
            : `${ack} Von wo willst du starten?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'departWindow') {
    return {
      speech: `${ack} Ab wann könnt ihr los, und wie spät dürft ihr ankommen — noch was in der Stadt am Abend?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'budget') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was ist eure Schmerzgrenze beim Budget — grob pro Person?`
          : `${ack} Was schwebt dir preislich vor, grob pro Person?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'when') {
    const monthOnly = Boolean(ledger.dateMonth && !ledger.dateStart);
    return {
      speech: monthOnly
        ? `${ack} Welches Wochenende — welche Tage genau?`
        : addr === 'ihr'
          ? `${ack} Wann wollt ihr weg — welcher Monat, und welches Wochenende genau?`
          : `${ack} Wann soll’s losgehen — welches Wochenende genau?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'mode') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wie wollt ihr hinkommen — Flug, Bahn oder Auto?`
          : `${ack} Wie willst du hinkommen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'lodging') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was schwebt euch bei der Unterkunft vor — eher Hotel, Ferienhaus oder Apartment?`
          : `${ack} Hotel, Ferienhaus oder Apartment — was liegt dir näher?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'directFlight') {
    return {
      speech: `${ack} Ist euch ein Direktflug wichtig, oder wäre Umsteigen auch okay?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'locationBias') {
    const path = briefingPath(ledger);
    if (path === 'senior') {
      return {
        speech: `${ack} Darf’s eher eine flache Küste sein, oder seid ihr auch gerne in den Bergen?`,
        askedKey: gap.key,
        hint,
      };
    }
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Abends eher ein paar Restaurants in Gehweite, oder lieber richtig ruhig und abgeschieden?`
          : `${ack} Lieber Restaurants um die Ecke, oder eher Abgeschiedenheit?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'extraWishes') {
    const path = briefingPath(ledger);
    if (path === 'family') {
      return {
        speech: `${ack} Gibt’s sonst noch was, das euch richtig wichtig ist — Ausstattung vor Ort, Lage, irgendwas Pflicht?`,
        askedKey: gap.key,
        hint,
      };
    }
    if (path === 'chill') {
      return {
        speech: `${ack} Gibt’s ein No-Go, worauf ihr gar keine Lust habt?`,
        askedKey: gap.key,
        hint,
      };
    }
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Noch Wünsche aufs Board — oder ist der Rest flexibel?`
          : `${ack} Noch Wünsche, oder lassen wir’s so?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'wrap_up') {
    return {
      speech: `${ack} Dann hab ich die wichtigen Infos zusammen. Soll ich zwei Optionen raussuchen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'dest') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Habt ihr eine Richtung im Kopf — oder ist der Ort noch egal?`
          : `${ack} Wohin soll’s gehen — oder ist der Ort noch egal?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'weather') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Soll’s eher warm sein, oder ist das Wetter egal?`
          : `${ack} Soll’s eher warm sein, oder ist das egal?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'driveTime') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wie lange darf die Anfahrt sein, bis es euch zu viel wird?`
          : `${ack} Wie lange darf die Anfahrt maximal dauern?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'lastTrip') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was war das Highlight vom letzten Urlaub — nur so als Vibe-Check?`
          : `${ack} Was war das Highlight deines letzten Urlaubs?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'highlight') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wenn der Trip sitzt: was wäre die eine Sache, die sitzen muss?`
          : `${ack} Was wäre dein Highlight auf der Reise?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'dealbreaker') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was wollt ihr auf keinen Fall erleben?`
          : `${ack} Was darf auf keinen Fall passieren?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'partyStyle') {
    return {
      speech: addr === 'ihr' ? `${ack} Wie wollt ihr feiern?` : `${ack} Wie willst du feiern?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'spaStyle') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Beim Spa: eher Pool und chillen, Meer und Sand, oder auch Massage und Sauna?`
          : `${ack} Spa eher Pool, Meer, oder auch Massage und Sauna?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'kidsStyle') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was mögen die Kinder denn — und soll das Haus einen Kids-Club haben, wo man sie abgeben kann?`
          : `${ack} Was mag das Kind — Kids-Club, oder eher alles zusammen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'tripShape') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Ein Ort als Basis, oder mehrere Stationen hintereinander — Roadtrip oder sogar Kreuzfahrt ein Thema?`
          : `${ack} Ein Ort, mehrere Stationen, Roadtrip — oder eher bleiben?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'ideaHook') {
    return {
      speech: `${ack} ${ideaFallbackQuestion(ledger, addr)}`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'rentalCar') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Mietwagen vor Ort, oder kommt ihr ohne klar?`
          : `${ack} Mietwagen vor Ort, oder kommst du ohne klar?`,
      askedKey: gap.key,
      hint,
    };
  }
  return {
    speech: /\b(september|freitag|\d{1,2}\.\s*(september)?)\b/iu.test(userLine)
      ? `${ack} Termin sitzt. Soll ich die Recherche starten?`
      : `${ack} Soll ich die Recherche starten, oder fehlt noch was Wichtiges?`,
    askedKey: 'keep_talking',
    hint,
  };
}

function ideaFallbackQuestion(ledger: ReiseLedger, addr: 'du' | 'ihr'): string {
  const v = detectTripVibes(ledger);
  const you = addr === 'ihr' ? 'ihr' : 'du';
  const want = addr === 'ihr' ? 'wollt ihr' : 'willst du';
  if (v.kids && v.sport) {
    return `Wenn ${you} sowas mögt: Tennis-Camp oder Reiterurlaub — ${want} sowas überhaupt?`;
  }
  if (v.kids) {
    return `Wäre so ein Haus mit Kids-Club oder eher alles zusammen was für ${addr === 'ihr' ? 'euch' : 'dich'}?`;
  }
  if (v.wine) {
    return `Ein Hub, oder mehrere Orte hintereinander abklappern — ${want} sowas?`;
  }
  if (v.water) {
    return `Tour, Kanu, oder sogar eine Kreuzfahrt — klingt irgendwas davon?`;
  }
  if (v.hop) {
    return `Mehrere Städte abhaken oder ein Roadtrip — ${want} in die Richtung?`;
  }
  return `Wäre rumreisen, eine Tour oder ein Roadtrip irgendwas — oder lieber an einem Ort bleiben?`;
}

function reactFallback(userLine: string, ledger: ReiseLedger): string {
  const t = (userLine || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/\b(nicht\s+campen|kein(?:en)?\s+camping|kein(?:es)?\s+zelt|nicht\s+zelten)\b/iu.test(t)) {
    return 'Camping streiche ich.';
  }
  const budget = ledger.budgetEur?.value;
  if (
    budget != null &&
    (/\b(euro|€|budget|pro\s+person)\b/iu.test(t) || new RegExp(`\\b${budget}\\b`).test(t))
  ) {
    if (budget < 280) return 'Okay, dann müssen wir schon ein bisschen gucken, dass es sitzt.';
    if (budget < 500) return 'Solides Budget für ein Wochenende.';
    return 'Damit können wir auf jeden Fall was reißen.';
  }
  if (/\bpool\b/iu.test(t) && /egal|frei/iu.test(t)) {
    return 'Verstehe — Typ ist zweitrangig, ein Pool wäre der Bonus.';
  }
  if (/\bpool\b/iu.test(t)) return 'Pool hab ich als Wunsch drauf.';
  if (/\b(september|freitag|montag|samstag)\b/iu.test(t) && /\b\d{1,2}\b/.test(t)) {
    return 'Termin notiert.';
  }
  if (/\b(unser\s+baby|neugeboren|\d{1,2}\s+monate)\b/iu.test(t)) {
    return 'Glückwunsch zum Nachwuchs — dann wird’s eher ruhig.';
  }
  if (/\bparty|feiern|kneipe|männerwochenende|jungs\b/iu.test(t) && !ledger.purpose) {
    return 'Klingt nach einem lockeren Trip.';
  }
  if (/\b(spa|wellness|massage|sauna)\b/iu.test(t)) return 'Richtig runterkommen — nice.';
  if (/\b(kind|kinder|kids)\b/iu.test(t)) return 'Mit den Kleinen dabei, klar.';
  if (/\b(wein|weinfest)\b/iu.test(t)) return 'Wein-Richtung merke ich mir.';
  if (/\bgünstig|guenstig\b/iu.test(t)) return 'Günstig ist völlig okay.';
  return 'Alles klar.';
}

function ensureQuestion(speech: string, question: string): string {
  const s = (speech || '').trim();
  if (/\?/.test(s)) return s;
  const q = (question || 'Was soll ich noch festhalten?').trim().replace(/\?+$/, '?');
  if (!s) return q;
  return `${s.replace(/[.!]+$/, '')}. ${q.endsWith('?') ? q : `${q}?`}`;
}

function splitSpeechAndHint(raw: string, fallbackHint: string): { speech: string; hint: string } {
  const hintMatch = raw.match(/\bFRAGE:\s*(.+)$/imu);
  let speech = raw
    .replace(/\n?FRAGE:\s*.+$/imu, '')
    .replace(/^TEXT:\s*/imu, '')
    .trim();
  const hint = (hintMatch?.[1] || fallbackHint).replace(/^["'\s]+|["'\s]+$/g, '').trim();
  if (speech.length < 8) speech = raw.replace(/\bFRAGE:\s*.+$/imu, '').trim();
  return { speech, hint: hint.slice(0, 48) || fallbackHint };
}

async function polishSpeech(prompt: string, fallback: string): Promise<string> {
  if (!hasGeminiApiKey()) return fallback;
  try {
    const raw = await generateGeminiText(prompt, {
      maxTokens: 280,
      temperature: 0.85,
      useFindusSystem: false,
      task: 'concierge',
      tier: 'lite',
    });
    const cleaned = (raw || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
    if (cleaned.length >= 12 && cleaned.length < 900) return cleaned;
  } catch {
    /* fallback */
  }
  return fallback;
}

export function composeBriefingFallback(
  ledger: ReiseLedger,
  asked: string[],
  userLine: string,
): { speech: string; askedKey: string | null; hint: string } {
  return fallbackSpeech(ledger, asked, userLine);
}

export async function runOpeningGreeting(): Promise<string> {
  const { trip, appendAssistant } = useReisebueroStore.getState();
  if (trip.chat.length) return trip.chat[0]?.text ?? '';
  const fb = fallbackOpening();
  appendAssistant(fb.speech, fb.hint);
  return fb.speech;
}

export async function runBriefingReply(): Promise<string> {
  const { trip, appendAssistant, markAsked } = useReisebueroStore.getState();
  if (trip.ledger.recapDone?.value) {
    const speech = 'Alles klar — ich erstelle den Plan.';
    appendAssistant(speech, 'Plan erstellen');
    return speech;
  }
  const userLine = lastUserLine();
  const fb = fallbackSpeech(trip.ledger, trip.askedSlotKeys, userLine);
  let speech = fb.speech;
  let hint = fb.hint;
  const direction = probeDirection(fb.askedKey || '') || fb.hint;
  let learned = '';
  try {
    learned = await hydrateTasteMemory();
  } catch {
    learned = tastePromptLine();
  }
  let autoBriefs = '';
  try {
    const { getLearnedFactBriefs } = require('../module2/blueprints/autoLearn/index') as {
      getLearnedFactBriefs: (o: { blueprintId: string; personaVariant: string }) => Promise<string[]>;
    };
    const briefs = await getLearnedFactBriefs({
      blueprintId: 'reisebuero',
      personaVariant: tastePersona(trip.ledger),
    });
    autoBriefs = briefs.slice(0, 6).join(' | ');
  } catch {
    /* soft */
  }
  const raw = await polishSpeech(
    `${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}

${FINDUS_REISEBUERO_DEEP_BRIEFING_BLOCK}

${FINDUS_FEW_SHOT_DISCLAIMER}

Du planst mit dem User eine Reise am Tisch. Zuhören-Modus: eine Frage, dann Notiz, dann die nächste Lücke. Kein Fragebogen, kein Vorwegnehmen.
Ping-Pong: kurz bestätigen, was gerade gesagt wurde — dann GENAU EINE Frage, und zwar die nächste leere Lücke in ${fb.askedKey || 'frei'} (${direction}).
Board: grün = Hard Facts / Pflicht, gelb = Wünsche / Soft Facts, rot = No-Gos unten.
Struktur:
1. Nur auf den letzten User-Satz eingehen. Schon notierte Kategorien nicht nochmal fragen.
2. Nichts erfinden. Korrekturen ersetzen den alten Sticker.
3. Fragen kurz. Unterkunft darf Hotel/Ferienhaus/Apartment als Beispiele nennen, NUR wenn die Lücke Unterkunft ist — sonst keine Menüs.
4. Extra-Fragen (Lage, No-Go, Direktflug, Ausstattung) nur wenn die Richtung das sagt. Nicht Highlight/letzten Urlaub von selbst anstoßen.
${fb.askedKey === 'wrap_up' || fb.askedKey === 'keep_talking' ? 'ABSCHLUSS: Eine Frage ob die Suche starten soll. Keine neuen Kategorien.' : ''}

Pflicht:
- ${fb.askedKey === 'wrap_up' || fb.askedKey === 'keep_talking' ? 'Abschlussfrage, dann Schluss.' : 'Genau eine Frage zur aktuellen Lücke.'}
- Prio-Paare merken (Bahn sonst Auto / Apartment sonst Hotel). Egal = Typ offen, gelber Sticker.
- Budget-Zahl nicht umrechnen.
- Max 3 kurze Sätze.

User gerade: ${userLine || '(leer)'}
Letzte Runden:
${recentChat()}
Notizen: ${ledgerDigest(trip.ledger)}
Vibe: ${vibeDigest(trip.ledger)}
Gelernt von diesem User: ${learned}
Gelernt (Blaupause): ${autoBriefs || '(leer)'}
Nächstes Thema (nur Richtung, kein Skript): ${fb.askedKey} — ${direction}

Ausgabe exakt:
TEXT: <gesprochen, MUSS mit Frage enden>
FRAGE: <Kurzfrage für die Leiste, max 8 Wörter>`,
    `TEXT: ${fb.speech}\nFRAGE: ${fb.hint}`,
  );
  const split = splitSpeechAndHint(raw, fb.hint);
  speech = ensureQuestion(split.speech, `${fb.hint}?`);
  hint = split.hint;
  if (fb.askedKey) markAsked(fb.askedKey);
  appendAssistant(speech, hint);
  return speech;
}
